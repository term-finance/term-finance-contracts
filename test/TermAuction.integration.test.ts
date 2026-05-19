/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  TermAuction,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermController,
  TermDiamond,
  TermDiamondFactory,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
  TestPriceFeed,
  TestToken,
} from "../typechain-types";
import {
  BigNumberish,
  NonceManager,
  Signer,
  solidityPackedKeccak256,
} from "ethers";
import dayjs from "dayjs";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployAdditionalAuction,
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import {
  parseBidsOffers,
  getBytesHash,
  bidToSubmission,
  offerToSubmission,
  getGeneratedTenderId,
} from "../utils/simulation-utils";

const clearingPriceTestCSV_random1 = `1	235610440000	4.9	1	269816180000	3.3
2	323003960000	6	2	380489230000	7.4
3	188737020000	3.5	3	251448030000	2.6
4	481792720000	4.2	4	88591690000	6.3
`;

const BID_PRICE_NONCE = "12345";
const OFFER_PRICE_NONCE = "678910";

function expectbigintEq(
  actual: bigint,
  expected: BigNumberish,
  message: string = `Expected ${expected.toString()} but was ${actual.toString()}`,
): void {
  // eslint-disable-next-line no-unused-expressions
  expect(actual === BigInt(expected), message).to.be.true;
}

describe("TermAuctionIntegration", () => {
  let wallets: SignerWithAddress[];
  let termController: TermController;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let mockCollateralFeed: TestPriceFeed;
  let mockPurchaseFeed: TestPriceFeed;
  let termInitializer: TermInitializer;
  let maturityPeriodOffset1: MaturityPeriodInfo;
  let maturityPeriodOffset0: MaturityPeriodInfo;
  let auctionIdOffset1Hash: string;
  let auctionIdOffset0Hash: string;
  let termRepoIdOffset1Hash: string;
  let termRepoIdOffset0Hash: string;
  let snapshotId: string;
  let termEventEmitter: TermEventEmitter;
  let termOracle: TermPriceConsumerV3;
  let termDiamond: TermDiamond;

  beforeEach(async () => {
    upgrades.silenceWarnings();
    snapshotId = await network.provider.send("evm_snapshot", []);

    wallets = await ethers.getSigners();

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

    const termControllerFactory =
      await ethers.getContractFactory("TermController");

    termController = (await upgrades.deployProxy(
      termControllerFactory,
      [
        wallets[7].address,
        wallets[8].address,
        wallets[5].address,
        wallets[4].address,
        wallets[6].address,
      ],
      {
        kind: "uups",
      },
    )) as unknown as TermController;

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");

    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      wallets[7].address,
      wallets[3].address,
    );
    await termInitializer.waitForDeployment();
    await termController
      .connect(wallets[6])
      .pairInitializer(await termInitializer.getAddress());

    // Deploy TermDiamond via factory
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = (await termDiamondFactoryFactory.deploy(
      wallets[6].address,
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
    termDiamond = (await ethers.getContractAt(
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
    await termInitializer.pairTermContracts(
      await termController.getAddress(),
      await termEventEmitter.getAddress(),
      await termOracle.getAddress(),
      await termDiamond.getAddress(),
    );

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

    const auctionStart = dayjs().subtract(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    maturityPeriodOffset1 = await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        servicerMaturityTimestamp: maturity.unix().toString(),
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
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );

    maturityPeriodOffset0 = await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        servicerMaturityTimestamp: maturity.unix().toString(),
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
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );
    auctionIdOffset1Hash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriodOffset1.termAuctionId],
    );
    auctionIdOffset0Hash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriodOffset0.termAuctionId],
    );
    termRepoIdOffset1Hash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriodOffset1.termRepoId],
    );
    termRepoIdOffset0Hash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriodOffset0.termRepoId],
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("completeAuction completes an auction - random1 - offset 1", async () => {
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
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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
      await maturityPeriodOffset1.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;

    const completeAuctionTx = await auction.completeAuction({
      revealedBidSubmissions: revealedBids,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers,
      unrevealedOfferSubmissions: [],
    });

    expect(completeAuctionTx)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue,
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue,
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue,
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdOffset1Hash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "525000000000000000",
      );

    const tx = await completeAuctionTx.wait();

    const clearingPrice = await auction.clearingPrice();
    expectbigintEq(clearingPrice, "525000000000000000");

    const termAuctionHistory = await termController.getTermAuctionResults(
      termRepoIdOffset1Hash,
    );

    const blockNumber = tx?.blockNumber;
    const block = await ethers.provider.getBlock(blockNumber!);

    expect(termAuctionHistory).to.deep.eq([
      [
        [
          auctionIdOffset1Hash,
          525000000000000000n,
          BigInt(block?.timestamp ?? 0),
        ],
      ],
      1n,
    ]);
  });
  it("completeAuction completes an auction - random1 - offset 0", async () => {
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
        await maturityPeriodOffset0.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriodOffset0.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset0.termAuctionBidLocker.getAddress(),
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
        await maturityPeriodOffset0.termAuctionOfferLocker.getAddress(),
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
        await maturityPeriodOffset0.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        await maturityPeriodOffset0.termAuctionOfferLocker.getAddress(),
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
      await maturityPeriodOffset0.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;

    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      }),
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue,
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue,
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue,
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdOffset0Hash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "525000000000000000",
      );

    const clearingPrice = await auction.clearingPrice();
    expectbigintEq(clearingPrice, "525000000000000000");
  });
  it("cancelAuctionForWithdrawal cancels auction and allows participants to withdraw funds...complete auction reverts after", async () => {
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
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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
      await maturityPeriodOffset1.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;

    expect(await auction.auctionCancelledForWithdrawal()).to.eq(false);

    for (const bid of bids) {
      const walletAddr =
        await walletsByAddress[bid.bidder.toString()].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }
      const wallet = new NonceManager(
        walletsByAddress[bid.bidder.toString()] as any,
      );
      console.log(`${await wallet.getAddress()} ${await wallet.getNonce()}`);
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      await expect(
        termAuctionBidLocker.connect(wallet).unlockBids([bidId]),
      ).to.be.revertedWithCustomError(termAuctionBidLocker, "AuctionNotOpen");
    }

    for (const offer of offers) {
      const walletAddr =
        await walletsByAddress[offer.offeror.toString()].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }

      const wallet = new NonceManager(
        walletsByAddress[offer.offeror.toString()] as any,
      );
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      await expect(
        termAuctionOfferLocker.connect(wallet).unlockOffers([offerId]),
      ).to.be.revertedWithCustomError(termAuctionOfferLocker, "AuctionNotOpen");
    }

    const auctionAdminConnection = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriodOffset1.auction.getAddress(),
      walletsByAddress[wallets[6].address],
    )) as unknown as TermAuction;

    const cancelTx = await auctionAdminConnection.cancelAuctionForWithdrawal(
      [],
      [],
    );
    console.log(cancelTx.nonce);

    await expect(cancelTx)
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdOffset1Hash, false, true);

    expect(await auction.auctionCancelledForWithdrawal()).to.eq(true);

    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        revealedOfferSubmissions: revealedOffers,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        unrevealedOfferSubmissions: [],
      }),
    ).to.be.revertedWithCustomError(auction, "AuctionCancelledForWithdrawal");

    for (const bid of bids) {
      const walletAddr =
        await walletsByAddress[bid.bidder.toString()].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }
      const wallet = new NonceManager(
        walletsByAddress[bid.bidder.toString()] as any,
      );

      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet,
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      const tx = await termAuctionBidLocker.connect(wallet).unlockBids([bidId]);
      await tx.wait();
    }

    for (const offer of offers) {
      const walletAddr =
        await walletsByAddress[offer.offeror.toString()].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }

      const wallet = new NonceManager(
        walletsByAddress[offer.offeror.toString()] as any,
      );
      const termAuctionOfferLocker = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet,
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .unlockOffers([offerId]);
      await tx.wait();
    }
  });
  it("completeAuction cancels an auction when all bids are undercollateralized after collateral price tanks", async () => {
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
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }
    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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
        await maturityPeriodOffset1.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        await maturityPeriodOffset1.termAuctionOfferLocker.getAddress(),
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

    // drop price of collateral
    await mockCollateralFeed.setAnswer(1e7);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriodOffset1.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      }),
    )
      .to.emit(termEventEmitter, "BidInShortfall")
      .withArgs(
        auctionIdOffset1Hash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-1"),
          maturityPeriodOffset1.termAuctionBidLocker,
          walletsByAddress[bids[1].bidder.toString()],
        ),
      )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdOffset1Hash, false, false);
  });
  it("completeAuction completes an auction after reopening", async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    if (!blockBefore) {
      throw new Error("blockBefore is null");
    }
    const timestampBefore = blockBefore.timestamp;
    const auctionStart = dayjs.unix(timestampBefore).subtract(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);

    const minimumTenderAmount = "10";

    const auctionGroup2 = await deployAdditionalAuction({
      termControllerAddress: await termController.getAddress(),
      termOracleAddress: await termOracle.getAddress(),
      termEventEmitterAddress: await termEventEmitter.getAddress(),
      termInitializerAddress: await termInitializer.getAddress(),
      auctionStartDate: auctionStart.unix().toString(),
      auctionRevealDate: auctionReveal.unix().toString(),
      auctionEndDate: auctionEnd.unix().toString(),
      redemptionTimestamp: maturity.unix().toString(),
      minimumTenderAmount,
      purchaseTokenAddress: await testPurchaseToken.getAddress(),
      collateralTokenAddresses: [await testCollateralToken.getAddress()],
      termRepoServicerAddress:
        await maturityPeriodOffset1.termRepoServicer.getAddress(),
      collateralManagerAddress:
        await maturityPeriodOffset1.termRepoCollateralManager.getAddress(),
      termApprovalMultisig: wallets[7],
      devopsMultisig: wallets[4].address,
      controllerAdmin: wallets[5],
      adminWallet: wallets[6].address,
      termRepoIdUnhashed: maturityPeriodOffset1.termRepoId,
      auctionVersion: "0.1.0",
      clearingPricePostProcessingOffset: "0",
      termDiamond: await maturityPeriodOffset1.termDiamond.getAddress(),
    });

    const auctionId2 = solidityPackedKeccak256(
      ["string"],
      [auctionGroup2.termAuctionId],
    );

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
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        await maturityPeriodOffset1.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await auctionGroup2.termAuctionBidLocker.getAddress(),
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
        await auctionGroup2.termAuctionOfferLocker.getAddress(),
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
        await auctionGroup2.termAuctionBidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        await auctionGroup2.termAuctionOfferLocker.getAddress(),
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
      await auctionGroup2.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;

    const completeAuctionTx = await auction.completeAuction({
      revealedBidSubmissions: revealedBids,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers,
      unrevealedOfferSubmissions: [],
    });

    await expect(completeAuctionTx)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionId2,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue,
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionId2,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue,
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionId2,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue,
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionId2,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "525000000000000000",
      );

    const clearingPrice = await auction.clearingPrice();
    expectbigintEq(clearingPrice, "525000000000000000");

    const tx = await completeAuctionTx.wait();

    const termAuctionHistory = await termController.getTermAuctionResults(
      termRepoIdOffset1Hash,
    );

    const blockNumber = tx?.blockNumber;
    const block = await ethers.provider.getBlock(blockNumber!);

    expect(termAuctionHistory).to.deep.eq([
      [[auctionId2, 525000000000000000n, BigInt(block?.timestamp ?? 0)]],
      1n,
    ]);
  });
});
/* eslint-enable camelcase */
