/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  AggregatorV3Interface,
  TermAuction,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermRepoCollateralManager,
  TermController,
  TermDiamond,
  TermDiamondFactory,
  TermEventEmitter,
  TermRepoServicer,
  TermPriceConsumerV3,
  TermRepoRolloverManager,
  TestToken,
  TermInitializer,
  TermController__factory,
} from "../typechain-types";
import {
  NonceManager,
  Signer,
  Wallet,
  ZeroAddress,
  solidityPackedKeccak256,
} from "ethers";
import dayjs, { Dayjs } from "dayjs";
import {
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import { approveRollover } from "../utils/approve-rollover";
import {
  bidToSubmission,
  getBytesHash,
  getGeneratedTenderId,
  offerToSubmission,
  parseBidsOffers,
} from "../utils/simulation-utils";
import { TermRepoRolloverElectionSubmissionStruct } from "../typechain-types/contracts/TermRepoRolloverManager";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployMockContract,
  MockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";

const clearingPriceTestCSV_random1 = `1	235610440000	4.9	1	269816180000	3.3
2	323003960000	6	2	380489230000	7.4
3	188737020000	3.5	3	251448030000	2.6
4	481792720000	4.2	4	88591690000	6.3
`;

const BID_PRICE_NONCE = "12345";
const OFFER_PRICE_NONCE = "678910";

describe("TermRepoRolloverIntegration", () => {
  let wallets: SignerWithAddress[];
  let adminWallet: SignerWithAddress;
  let termController: MockContract<TermController>;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let mockCollateralFeed: AggregatorV3Interface;
  let mockPurchaseFeed: AggregatorV3Interface;
  let maturityPeriod1: MaturityPeriodInfo;
  let maturityPeriod2: MaturityPeriodInfo;
  let maturityPeriod3: MaturityPeriodInfo;
  let termIdHash: string;
  let rolloverTermIdHash: string;
  let snapshotId: string;
  let termEventEmitter: TermEventEmitter;
  let termInitializer: TermInitializer;
  let termOracle: TermPriceConsumerV3;

  let auctionStart2: Dayjs;

  beforeEach(async () => {
    upgrades.silenceWarnings();
    snapshotId = await network.provider.send("evm_snapshot", []);

    const signers = await ethers.getSigners();

    wallets = signers.splice(1, signers.length);
    adminWallet = signers[0];


    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3",
    );
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [wallets[4].address],
      {
        kind: "uups",
      },
    )) as unknown as TermPriceConsumerV3;

    const purchaseTokenDecimals = 8;
    const collateralTokenDecimals = 8;
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.waitForDeployment();
    await testCollateralToken.initialize(
      "Collateral Token",
      "CT",
      collateralTokenDecimals,
      [],
      [],
    );
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.waitForDeployment();
    await testPurchaseToken.initialize(
      "Purchase Token",
      "PT",
      purchaseTokenDecimals,
      [],
      [],
    );

    termController = await deployMockContract<TermController>(
      wallets[0],
      TermController__factory.abi,
    );

    await termController.mock.termContractsPaused.returns(false);

    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      adminWallet.address,
      wallets[4].address,
    );
    await termInitializer.waitForDeployment();

    // Deploy TermDiamond via factory
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = (await termDiamondFactoryFactory.deploy(
      adminWallet.address,
      wallets[4].address,
    )) as unknown as TermDiamondFactory;
    await termDiamondFactory.waitForDeployment();

    const termDiamondTx = await termDiamondFactory.deployDiamond();
    const termDiamondReceipt = await termDiamondTx.wait();
    const diamondDeployedEvent = termDiamondReceipt?.logs.find(
      (log) =>
        log.topics[0] ===
        termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash,
    );
    if (!diamondDeployedEvent)
      throw new Error("DiamondDeployed event not found");
    const decodedEvent =
      termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    const termDiamond = (await ethers.getContractAt(
      "TermDiamond",
      decodedEvent!.args.diamond,
    )) as unknown as TermDiamond;

    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        wallets[4].address,
        wallets[5].address,
        await termInitializer.getAddress(),
        wallets[5].address,
        await termDiamond.getAddress(),
      ],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    mockCollateralFeed = await mockPriceFeedFactory.deploy(
      collateralTokenDecimals,
      "",
      1,
      1,
      1e10,
      1,
      1,
      1,
    );
    mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      purchaseTokenDecimals,
      "",
      1,
      1,
      1e8,
      1,
      1,
      1,
    );

    await termOracle
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed.getAddress(),
        0,
      );
    await termOracle
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        await testPurchaseToken.getAddress(),
        await mockPurchaseFeed.getAddress(),
        0,
      );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;

    const auctionStart1 = dayjs.unix(timestampBefore).subtract(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal1 = auctionStart1.add(defaultAuctionDuration);
    const auctionEnd1 = auctionReveal1.add(defaultRevealDuration);
    const maturity1 = auctionEnd1.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const auctionEnd2 = maturity1
      .add(repurchaseWindow)
      .subtract(dayjs.duration(10, "hours"));
    const auctionReveal2 = auctionEnd2.subtract(defaultRevealDuration);
    auctionStart2 = auctionReveal2.subtract(defaultAuctionDuration);
    const maturity2 = auctionEnd2.add(defaultTermLength);

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    await termController.mock.markTermDeployed.returns();
    await termController.mock.isTermDeployed.returns(true);
    await termController.mock.pairAuction.returns();
    await termController.mock.recordAuctionResult.returns();
    await termController.mock.registeredRepoIds.returns(false);
    await termController.mock.registerRepoId.returns();
    await termController.mock.registeredAuctionIds.returns(false);
    await termController.mock.registerAuctionId.returns();

    maturityPeriod1 = await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
        auctionStartDate: auctionStart1.unix().toString(),
        auctionRevealDate: auctionReveal1.unix().toString(),
        auctionEndDate: auctionEnd1.unix().toString(),
        maturityTimestamp: maturity1.unix().toString(),
        servicerMaturityTimestamp: maturity1.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asSeconds().toString(),
        redemptionBuffer: redemptionBuffer.asSeconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: await testPurchaseToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: adminWallet,
        devopsMultisig: wallets[4].address,
        adminWallet: adminWallet.address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );

    termIdHash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriod1.termRepoId],
    );

    const treasury = Wallet.createRandom();
    await termController.mock.getTreasuryAddress.returns(treasury.address);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );

    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);

      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    const offerIdMappings = new Map<string, any>();

    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod1.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const submission = offerToSubmission(offer);
      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .lockOffers([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids = [];
    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;

      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids.push(bidId);
    }
    const revealedOffers = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod1.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE],
      );
      await tx.wait();
      revealedOffers.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod1.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers,
      unrevealedOfferSubmissions: [],
    });

    maturityPeriod2 = await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
        auctionStartDate: auctionStart2.unix().toString(),
        auctionRevealDate: auctionReveal2.unix().toString(),
        auctionEndDate: auctionEnd2.unix().toString(),
        maturityTimestamp: maturity2.unix().toString(),
        servicerMaturityTimestamp: maturity2.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asSeconds().toString(),
        redemptionBuffer: redemptionBuffer.asSeconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: await testPurchaseToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: adminWallet,
        devopsMultisig: wallets[4].address,
        adminWallet: adminWallet.address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );

    maturityPeriod3 = await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
        auctionStartDate: auctionStart2.unix().toString(),
        auctionRevealDate: auctionReveal2.unix().toString(),
        auctionEndDate: auctionEnd2.unix().toString(),
        maturityTimestamp: maturity2.unix().toString(),
        servicerMaturityTimestamp: maturity2.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asSeconds().toString(),
        redemptionBuffer: redemptionBuffer.asSeconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: await testPurchaseToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: adminWallet,
        devopsMultisig: wallets[4].address,
        adminWallet: adminWallet.address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );

    rolloverTermIdHash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriod2.termRepoId],
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("bid rollovers with full assignment", async () => {
    const signer = new NonceManager(wallets[0] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      "TestToken",
      await testCollateralToken.getAddress(),
      signer,
    )) as unknown as TestToken;

    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      adminWallet,
    )) as unknown as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod1.termRepoCollateralManager.getAddress(),
      signer,
    )) as unknown as TermRepoCollateralManager;

    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        await testCollateralToken.getAddress(),
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE],
    );

    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash,
      );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat1BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    const offerIdMappings = new Map<string, any>();

    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const submission = offerToSubmission(offer);
      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .lockOffers([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids2 = [];
    const termAuctionBidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      wallets[0],
    )) as unknown as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids2.push(bidId);
    }
    const rolloverMat1BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );
    const rolloverMat1RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat1BidId],
      [rolloverMat1BidPrice],
      [BID_PRICE_NONCE],
    );

    rolloverMat1RevealTx.wait();

    revealedBids2.push(
      solidityPackedKeccak256(
        ["address", "address"],
        [await maturity1RolloverManager.getAddress(), wallets[1].address],
      ),
    );

    const revealedOffers2 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE],
      );
      await tx.wait();
      revealedOffers2.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const term2IdHash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriod2.termRepoId],
    );
    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod2.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids2,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers2,
        unrevealedOfferSubmissions: [],
      }),
    )
      .to.emit(termEventEmitter, "ExposureOpenedOnRolloverNew")
      .withArgs(
        term2IdHash,
        wallets[1].address,
        wallet1RolloverAmount,
        anyValue,
        anyValue,
      )
      .to.emit(termEventEmitter, "ExposureClosedOnRolloverExisting")
      .withArgs(termIdHash, wallets[1].address, wallet1RolloverAmount);
    const postRolloverAuctionLoanBalance =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );

    const getBorrowerRepurchaseObligationRolloverPayment =
      wallet1BalanceBeforeRollover - postRolloverAuctionLoanBalance;

    const tp1BalanceAfter = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceAfter).to.eq(
      getBorrowerRepurchaseObligationRolloverPayment,
    ); // TermRepoLocker is paid an amount eq to borrow balance collapse

    const tp2Balance = await purchaseToken.balanceOf(
      await maturityPeriod2.termRepoLocker.getAddress(),
    );

    expect(tp2Balance).to.eq(0); // TermRepoLocker of rollover term balanced

    const maturity2TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod2.termRepoServicer.getAddress(),
      adminWallet,
    )) as unknown as TermRepoServicer;

    const term2getBorrowerRepurchaseObligation =
      await maturity2TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );

    expect(
      term2getBorrowerRepurchaseObligation >=
        wallet1BalanceBeforeRollover +
          getBorrowerRepurchaseObligationRolloverPayment,
    ).to.eq(true); // borrower balance in new term includes the rollover amount (assuming they get the same nonrollover loan in identical auction setup)

    const collateral1After =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        await testCollateralToken.getAddress(),
      );

    const collateralUnlockedFromTerm1 = collateral1Before - collateral1After;
    const expectedCollateralUnlocked =
      (getBorrowerRepurchaseObligationRolloverPayment * collateral1Before) /
      wallet1BalanceBeforeRollover;
    expect(collateralUnlockedFromTerm1).to.eq(expectedCollateralUnlocked); // Checks proportional unlocking

    const maturity2CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod2.termRepoCollateralManager.getAddress(),
      adminWallet,
    )) as unknown as TermRepoCollateralManager;

    const collateral2 = await maturity2CollateralManager.getCollateralBalance(
      wallets[1].address,
      await testCollateralToken.getAddress(),
    );
    expect(collateral2).to.eq(collateral1Before + collateralUnlockedFromTerm1); // collateral in rollover term covers rollover loan

    const ctTp1BalanceAfter = await collateralToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );

    const collateralTransferredOutOfTp1 =
      ctTp1BalanceBefore - ctTp1BalanceAfter;

    const ctTp2Balance = await collateralToken.balanceOf(
      await maturityPeriod2.termRepoLocker.getAddress(),
    );

    expect(ctTp2Balance).to.eq(
      ctTp1BalanceBefore + collateralTransferredOutOfTp1,
    ); // collateral transferred to rollover term repo locker for rollover loan

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat1BidPriceHash,
      true,
    ]);
  });

  it("re-electing rollover to another approved auction cancels the previous rollover bid", async () => {
    const signer = new NonceManager(wallets[0] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod3.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod3.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      "TestToken",
      await testCollateralToken.getAddress(),
      signer,
    )) as unknown as TestToken;

    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      adminWallet,
    )) as unknown as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod1.termRepoCollateralManager.getAddress(),
      signer,
    )) as unknown as TermRepoCollateralManager;

    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        await testCollateralToken.getAddress(),
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE],
    );

    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    const rolloverTermIdHash2 = solidityPackedKeccak256(
      ["string"],
      [maturityPeriod3.termRepoId],
    );

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash,
      );

    const rolloverBidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat1BidPriceHash,
      false,
    ]);

    const maturity2BidLockerWallet1Connection = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      managedWallet1,
    )) as unknown as TermAuctionBidLocker;

    // Rollover locked into rollover auction from maturity period 2

    const lockedBidAuction2RolloverAttempt1 =
      await maturity2BidLockerWallet1Connection.lockedBid(rolloverBidId);

    expect(lockedBidAuction2RolloverAttempt1.amount).to.gt(
      wallet1RolloverAmount,
    );

    const submission2 = {
      rolloverAuctionBidLocker:
        await maturityPeriod3.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission2),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash2,
        wallets[1].address,
        await maturityPeriod3.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash,
      );

    // rollover should be unlocked from maturity period 2 auction bid locker when rollover re-elected to maturity period 3

    const lockedBidAuction2RolloverAttempt2 =
      await maturity2BidLockerWallet1Connection.lockedBid(rolloverBidId);

    expect(lockedBidAuction2RolloverAttempt2.amount).to.eq(0);
  });

  it("bid rollovers locked and then unlocked when cancelled", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      signer,
    )) as unknown as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE],
    );

    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    const rolloverMat1BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash,
      )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        getBytesHash(maturityPeriod2.termAuctionId),
        rolloverMat1BidId,
        wallets[1].address,
        rolloverMat1BidPriceHash,
        anyValue,
        await testPurchaseToken.getAddress(),
        [await testCollateralToken.getAddress()],
        anyValue,
        true,
        await maturityPeriod1.termRepoServicer.getAddress(),
        ZeroAddress,
      );

    expect(
      (await maturityPeriod2.termAuctionBidLocker.lockedBid(rolloverMat1BidId))
        .amount,
    ).to.be.greaterThan(0);

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .cancelRollover(),
    )
      .to.emit(termEventEmitter, "RolloverCancellation")
      .withArgs(termIdHash, wallets[1].address)
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(getBytesHash(maturityPeriod2.termAuctionId), rolloverMat1BidId);

    expect(
      (await maturityPeriod2.termAuctionBidLocker.lockedBid(rolloverMat1BidId))
        .amount,
    ).to.eq(0);
  });

  it("bid rollovers processed after auction cancelled for withdrawal", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      "TestToken",
      await testCollateralToken.getAddress(),
      signer,
    )) as unknown as TestToken;

    // eslint-disable-next-line no-unused-vars
    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      signer,
    )) as unknown as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod1.termRepoCollateralManager.getAddress(),
      signer,
    )) as unknown as TermRepoCollateralManager;

    // eslint-disable-next-line no-unused-vars
    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        await testCollateralToken.getAddress(),
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE],
    );

    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    const rolloverMat1BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash,
      )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        getBytesHash(maturityPeriod2.termAuctionId),
        rolloverMat1BidId,
        wallets[1].address,
        rolloverMat1BidPriceHash,
        anyValue,
        await testPurchaseToken.getAddress(),
        [await testCollateralToken.getAddress()],
        anyValue,
        true,
        await maturityPeriod1.termRepoServicer.getAddress(),
        ZeroAddress,
      );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat1BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);

      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    const offerIdMappings = new Map<string, any>();

    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const submission = offerToSubmission(offer);
      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .lockOffers([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids2 = [];
    const termAuctionBidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      wallets[0],
    )) as unknown as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids2.push(bidId);
    }

    const rolloverMat1RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat1BidId],
      [rolloverMat1BidPrice],
      [BID_PRICE_NONCE],
    );

    rolloverMat1RevealTx.wait();

    revealedBids2.push(
      solidityPackedKeccak256(
        ["address", "address"],
        [await maturity1RolloverManager.getAddress(), wallets[1].address],
      ),
    );

    const revealedOffers2 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE],
      );
      await tx.wait();
      revealedOffers2.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod2.auction.getAddress(),
      adminWallet,
    )) as unknown as TermAuction;
    await auction.cancelAuctionForWithdrawal(
      [wallets[1].address],
      [await maturityPeriod1.termRepoServicer.getAddress()],
    );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat1BidPriceHash,
      true,
    ]);
  });

  it("bid rollovers rejected due to repurchase window ending before auction complete", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      "TestToken",
      await testCollateralToken.getAddress(),
      signer,
    )) as unknown as TestToken;

    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      signer,
    )) as unknown as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod1.termRepoCollateralManager.getAddress(),
      signer,
    )) as unknown as TermRepoCollateralManager;

    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        await testCollateralToken.getAddress(),
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );

    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE],
    );

    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash,
      );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);

      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    const offerIdMappings = new Map<string, any>();

    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const submission = offerToSubmission(offer);
      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .lockOffers([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids3 = [];
    const termAuctionBidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      wallets[0],
    )) as unknown as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids3.push(bidId);
    }

    const rolloverMat2BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE],
    );

    rolloverMat2RevealTx.wait();

    const revealedOffers3 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE],
      );
      await tx.wait();
      revealedOffers3.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 2 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod2.auction.getAddress(),
      adminWallet,
    )) as unknown as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids3,
      expiredRolloverBids: [rolloverMat2BidId],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers3,
      unrevealedOfferSubmissions: [],
    });

    const tp1BalanceAfter = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceAfter).to.eq(0); // TermRepoLocker is not paid any rollover amount

    const tp2Balance = await purchaseToken.balanceOf(
      await maturityPeriod2.termRepoLocker.getAddress(),
    );

    expect(tp2Balance).to.eq(0); // TermRepoLocker of rollover term balanced

    const maturity2TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod2.termRepoServicer.getAddress(),
      adminWallet,
    )) as unknown as TermRepoServicer;

    const term2getBorrowerRepurchaseObligation =
      await maturity2TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );

    /* Some issues with the wallets causing this to be misaligned
    expect(
      term2getBorrowerRepurchaseObligation.lte(wallet1BalanceBeforeRollover)
    ).to.eq(true); // borrower balance in new term does not include the rollover amount (assuming they get the same nonrollover loan in identical auction setup)
      */

    const maturity2CollateralManager = (await ethers.getContractAt(
      "TermRepoCollateralManager",
      await maturityPeriod2.termRepoCollateralManager.getAddress(),
      adminWallet,
    )) as unknown as TermRepoCollateralManager;

    const collateral2 = await maturity2CollateralManager.getCollateralBalance(
      wallets[1].address,
      await testCollateralToken.getAddress(),
    );
    expect(collateral2).to.eq(collateral1Before); // collateral is same in both auctions since rollover was rejected

    const ctTp2Balance = await collateralToken.balanceOf(
      await maturityPeriod2.termRepoLocker.getAddress(),
    );

    expect(ctTp2Balance).to.eq(ctTp1BalanceBefore); // collateral not transferred to rollover term repo locker for rollover loan
  });
  it("bid rollovers marked as processed after auction cancelled", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      signer,
    )) as unknown as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE],
    );
    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash,
      );
    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    const offerIdMappings = new Map<string, any>();

    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const submission = offerToSubmission(offer);
      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .lockOffers([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids4 = [];
    const termAuctionBidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      wallets[0],
    )) as unknown as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids4.push(bidId);
    }

    const rolloverMat2BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE],
    );

    rolloverMat2RevealTx.wait();

    revealedBids4.push(rolloverMat2BidId);

    const revealedOffers4 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriod2.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE],
      );
      await tx.wait();
      revealedOffers4.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod2.auction.getAddress(),
      adminWallet,
    )) as unknown as TermAuction;
    await auction.cancelAuction({
      revealedBidSubmissions: revealedBids4,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers4,
      unrevealedOfferSubmissions: [],
    });

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat2BidPriceHash,
      true,
    ]);
  });

  it("bid rollovers marked as processed after auction complete results in cancellation due to lack of offers", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      "TermRepoRolloverManager",
      await maturityPeriod1.rolloverManager.getAddress(),
      signer,
    )) as unknown as TermRepoRolloverManager;

    await approveRollover(
      {
        rolloverManagerAddress:
          await maturityPeriod1.rolloverManager.getAddress(),
      },
      {
        auctionAddress: await maturityPeriod2.auction.getAddress(),
        termAuctionBidLockerAddress:
          await maturityPeriod2.termAuctionBidLocker.getAddress(),
      },
      adminWallet,
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      "TestToken",
      await testPurchaseToken.getAddress(),
      signer,
    )) as unknown as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      await maturityPeriod1.termRepoLocker.getAddress(),
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      "TermRepoServicer",
      await maturityPeriod1.termRepoServicer.getAddress(),
      signer,
    )) as unknown as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address,
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover / 2n;

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        "TermRepoRolloverManager",
        await maturityPeriod1.rolloverManager.getAddress(),
        managedWallet1,
      )) as unknown as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE],
    );
    const submission = {
      rolloverAuctionBidLocker:
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission),
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash,
      );

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriod2.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriod2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);

      const tx = await termAuctionBidLocker
        .connect(wallet)
        .lockBids([submission]);
      await tx.wait();
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);
    const revealedBids4 = [];
    const termAuctionBidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      wallets[0],
    )) as unknown as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE],
      );
      await tx.wait();
      revealedBids4.push(bidId);
    }

    const rolloverMat2BidId = solidityPackedKeccak256(
      ["address", "address"],
      [await maturity1RolloverManager.getAddress(), wallets[1].address],
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE],
    );

    rolloverMat2RevealTx.wait();

    revealedBids4.push(rolloverMat2BidId);

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod2.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids4,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [],
      unrevealedOfferSubmissions: [],
    });

    expect(
      await maturity1RolloverManager.getRolloverInstructions(
        wallets[1].address,
      ),
    ).to.deep.equal([
      await maturityPeriod2.termAuctionBidLocker.getAddress(),
      BigInt(wallet1RolloverAmount),
      rolloverMat2BidPriceHash,
      true,
    ]);
  });
});
/* eslint-enable camelcase */
