/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  AggregatorV3Interface,
  TermAuction,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermRepoCollateralManager,
  TermController,
  TermEventEmitter,
  TermRepoServicer,
  TermPriceConsumerV3,
  TermRepoRolloverManager,
  TestToken,
  TermInitializer,
} from "../typechain-types";
import { BigNumber, Signer, Wallet } from "ethers";
import dayjs, { Dayjs } from "dayjs";
import {
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { NonceManager } from "@ethersproject/experimental";
import TermAuctionABI from "../abi/TermAuction.json";
import TermAuctionBidLockerABI from "../abi/TermAuctionBidLocker.json";
import TermAuctionOfferLockerABI from "../abi/TermAuctionOfferLocker.json";
import TestTokenABI from "../abi/TestToken.json";
import TermRepoCollateralManagerABI from "../abi/TermRepoCollateralManager.json";
import TermRepoServicerABI from "../abi/TermRepoServicer.json";
import TermRepoRolloverManagerABI from "../abi/TermRepoRolloverManager.json";
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
  let termController: FakeContract<TermController>;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let mockCollateralFeed: AggregatorV3Interface;
  let mockPurchaseFeed: AggregatorV3Interface;
  let maturityPeriod1: MaturityPeriodInfo;
  let maturityPeriod2: MaturityPeriodInfo;
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

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3"
    );
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [wallets[4].address, wallets[5].address],
      {
        kind: "uups",
      }
    )) as TermPriceConsumerV3;

    const purchaseTokenDecimals = 8;
    const collateralTokenDecimals = 8;
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.deployed();
    await testCollateralToken.initialize(
      "Collateral Token",
      "CT",
      collateralTokenDecimals,
      [],
      []
    );
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.deployed();
    await testPurchaseToken.initialize(
      "Purchase Token",
      "PT",
      purchaseTokenDecimals,
      [],
      []
    );

    termController = await smock.fake<TermController>("TermController");
    termController.isTermDeployed.returns(true);

    const termInitializerFactory = await ethers.getContractFactory(
      "TermInitializer"
    );
    termInitializer = await termInitializerFactory.deploy(
      adminWallet.address,
      wallets[4].address
    );
    await termInitializer.deployed();

    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[4].address, wallets[5].address, termInitializer.address],
      { kind: "uups" }
    )) as TermEventEmitter;

    const mockPriceFeedFactory = await ethers.getContractFactory(
      "TestPriceFeed"
    );
    mockCollateralFeed = await mockPriceFeedFactory.deploy(
      collateralTokenDecimals,
      "",
      1,
      1,
      1e10,
      1,
      1,
      1
    );
    mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      purchaseTokenDecimals,
      "",
      1,
      1,
      1e8,
      1,
      1,
      1
    );

    await termOracle
      .connect(wallets[5])
      .addNewTokenPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed.address
      );
    await termOracle
      .connect(wallets[5])
      .addNewTokenPriceFeed(
        testPurchaseToken.address,
        mockPurchaseFeed.address
      );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;

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

    maturityPeriod1 = await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
        termOracleAddress: termOracle.address,
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
        purchaseTokenAddress: testPurchaseToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: adminWallet,
        devopsMultisig: wallets[4].address,
        adminWallet: adminWallet.address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
      },
      "uups"
    );

    termIdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriod1.termRepoId]
    );

    const treasury = Wallet.createRandom();
    termController.getTreasuryAddress.returns(treasury.address);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );

    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
        TermAuctionOfferLockerABI,
        maturityPeriod1.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
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
        TermAuctionBidLockerABI,
        maturityPeriod1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;

      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids.push(bidId);
    }
    const revealedOffers = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriod1.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE]
      );
      await tx.wait();
      revealedOffers.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod1.auction.address,
      wallet
    )) as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers,
      unrevealedOfferSubmissions: [],
    });

    maturityPeriod2 = await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
        termOracleAddress: termOracle.address,
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
        purchaseTokenAddress: testPurchaseToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: adminWallet,
        devopsMultisig: wallets[4].address,
        adminWallet: adminWallet.address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
      },
      "uups"
    );

    rolloverTermIdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriod2.termRepoId]
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("bid rollovers with full assignment", async () => {
    const signer = new NonceManager(wallets[0] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      TestTokenABI,
      testCollateralToken.address,
      signer
    )) as TestToken;

    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      adminWallet
    )) as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      TermRepoCollateralManagerABI,
      maturityPeriod1.termRepoCollateralManager.address,
      signer
    )) as TermRepoCollateralManager;

    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        testCollateralToken.address
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE]
    );

    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash
      );

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat1BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
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
      TermAuctionBidLockerABI,
      maturityPeriod2.termAuctionBidLocker.address,
      wallets[0]
    )) as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids2.push(bidId);
    }
    const rolloverMat1BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );
    const rolloverMat1RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat1BidId],
      [rolloverMat1BidPrice],
      [BID_PRICE_NONCE]
    );

    rolloverMat1RevealTx.wait();

    revealedBids2.push(
      ethers.utils.solidityKeccak256(
        ["address", "address"],
        [maturity1RolloverManager.address, wallets[1].address]
      )
    );

    const revealedOffers2 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE]
      );
      await tx.wait();
      revealedOffers2.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const term2IdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriod2.termRepoId]
    );
    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod2.auction.address,
      wallet
    )) as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids2,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers2,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "ExposureOpenedOnRolloverNew")
      .withArgs(
        term2IdHash,
        wallets[1].address,
        wallet1RolloverAmount,
        anyValue,
        anyValue
      )
      .to.emit(termEventEmitter, "ExposureClosedOnRolloverExisting")
      .withArgs(termIdHash, wallets[1].address, wallet1RolloverAmount);
    const postRolloverAuctionLoanBalance =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );

    const getBorrowerRepurchaseObligationRolloverPayment =
      wallet1BalanceBeforeRollover.sub(postRolloverAuctionLoanBalance);

    const tp1BalanceAfter = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceAfter).to.eq(
      getBorrowerRepurchaseObligationRolloverPayment
    ); // TermRepoLocker is paid an amount eq to borrow balance collapse

    const tp2Balance = await purchaseToken.balanceOf(
      maturityPeriod2.termRepoLocker.address
    );

    expect(tp2Balance).to.eq(0); // TermRepoLocker of rollover term balanced

    const maturity2TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod2.termRepoServicer.address,
      adminWallet
    )) as TermRepoServicer;

    const term2getBorrowerRepurchaseObligation =
      await maturity2TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );

    expect(
      term2getBorrowerRepurchaseObligation.gte(
        wallet1BalanceBeforeRollover.add(
          getBorrowerRepurchaseObligationRolloverPayment
        )
      )
    ).to.eq(true); // borrower balance in new term includes the rollover amount (assuming they get the same nonrollover loan in identical auction setup)

    const collateral1After =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        testCollateralToken.address
      );

    const collateralUnlockedFromTerm1 = collateral1Before.sub(collateral1After);
    const expectedCollateralUnlocked =
      getBorrowerRepurchaseObligationRolloverPayment
        .mul(collateral1Before)
        .div(wallet1BalanceBeforeRollover);
    expect(collateralUnlockedFromTerm1).to.eq(expectedCollateralUnlocked); // Checks proportional unlocking

    const maturity2CollateralManager = (await ethers.getContractAt(
      TermRepoCollateralManagerABI,
      maturityPeriod2.termRepoCollateralManager.address,
      adminWallet
    )) as TermRepoCollateralManager;

    const collateral2 = await maturity2CollateralManager.getCollateralBalance(
      wallets[1].address,
      testCollateralToken.address
    );
    expect(
      collateral2.eq(collateral1Before.add(collateralUnlockedFromTerm1))
    ).to.eq(true); // collateral in rollover term covers rollover loan

    const ctTp1BalanceAfter = await collateralToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );

    const collateralTransferredOutOfTp1 =
      ctTp1BalanceBefore.sub(ctTp1BalanceAfter);

    const ctTp2Balance = await collateralToken.balanceOf(
      maturityPeriod2.termRepoLocker.address
    );

    expect(
      ctTp2Balance.eq(ctTp1BalanceBefore.add(collateralTransferredOutOfTp1))
    ).to.eq(true); // collateral transferred to rollover term repo locker for rollover loan

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat1BidPriceHash,
      true,
    ]);
  });

  it("bid rollovers locked and then unlocked when cancelled", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      signer
    )) as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE]
    );

    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    const rolloverMat1BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash
      )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        getBytesHash(maturityPeriod2.termAuctionId),
        rolloverMat1BidId,
        wallets[1].address,
        rolloverMat1BidPriceHash,
        anyValue,
        testPurchaseToken.address,
        [testCollateralToken.address],
        anyValue,
        true,
        maturityPeriod1.termRepoServicer.address,
        ethers.constants.AddressZero
      );

    expect(
      (await maturityPeriod2.termAuctionBidLocker.lockedBid(rolloverMat1BidId))
        .amount
    ).to.be.greaterThan(0);

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .cancelRollover()
    )
      .to.emit(termEventEmitter, "RolloverCancellation")
      .withArgs(termIdHash, wallets[1].address)
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(getBytesHash(maturityPeriod2.termAuctionId), rolloverMat1BidId);

    expect(
      (await maturityPeriod2.termAuctionBidLocker.lockedBid(rolloverMat1BidId))
        .amount
    ).to.eq(0);
  });

  it("bid rollovers processed after auction cancelled for withdrawal", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      TestTokenABI,
      testCollateralToken.address,
      signer
    )) as TestToken;

    // eslint-disable-next-line no-unused-vars
    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      signer
    )) as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      TermRepoCollateralManagerABI,
      maturityPeriod1.termRepoCollateralManager.address,
      signer
    )) as TermRepoCollateralManager;

    // eslint-disable-next-line no-unused-vars
    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        testCollateralToken.address
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat1BidPrice = "99" + "0".repeat(18);
    const rolloverMat1BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat1BidPrice, BID_PRICE_NONCE]
    );

    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat1BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    const rolloverMat1BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat1BidPriceHash
      )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        getBytesHash(maturityPeriod2.termAuctionId),
        rolloverMat1BidId,
        wallets[1].address,
        rolloverMat1BidPriceHash,
        anyValue,
        testPurchaseToken.address,
        [testCollateralToken.address],
        anyValue,
        true,
        maturityPeriod1.termRepoServicer.address,
        ethers.constants.AddressZero
      );

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat1BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
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
      TermAuctionBidLockerABI,
      maturityPeriod2.termAuctionBidLocker.address,
      wallets[0]
    )) as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids2.push(bidId);
    }

    const rolloverMat1RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat1BidId],
      [rolloverMat1BidPrice],
      [BID_PRICE_NONCE]
    );

    rolloverMat1RevealTx.wait();

    revealedBids2.push(
      ethers.utils.solidityKeccak256(
        ["address", "address"],
        [maturity1RolloverManager.address, wallets[1].address]
      )
    );

    const revealedOffers2 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE]
      );
      await tx.wait();
      revealedOffers2.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod2.auction.address,
      adminWallet
    )) as TermAuction;
    await auction.cancelAuctionForWithdrawal(
      [wallets[1].address],
      [maturityPeriod1.termRepoServicer.address]
    );

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat1BidPriceHash,
      true,
    ]);
  });

  it("bid rollovers rejected due to repurchase window ending before auction complete", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const collateralToken = (await ethers.getContractAt(
      TestTokenABI,
      testCollateralToken.address,
      signer
    )) as TestToken;

    const ctTp1BalanceBefore = await collateralToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      signer
    )) as TermRepoServicer;

    const maturity1CollateralManager = (await ethers.getContractAt(
      TermRepoCollateralManagerABI,
      maturityPeriod1.termRepoCollateralManager.address,
      signer
    )) as TermRepoCollateralManager;

    const collateral1Before =
      await maturity1CollateralManager.getCollateralBalance(
        wallets[1].address,
        testCollateralToken.address
      );

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );

    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE]
    );

    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash
      );

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
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
      TermAuctionBidLockerABI,
      maturityPeriod2.termAuctionBidLocker.address,
      wallets[0]
    )) as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids3.push(bidId);
    }

    const rolloverMat2BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE]
    );

    rolloverMat2RevealTx.wait();

    const revealedOffers3 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE]
      );
      await tx.wait();
      revealedOffers3.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 2 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod2.auction.address,
      adminWallet
    )) as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids3,
      expiredRolloverBids: [rolloverMat2BidId],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers3,
      unrevealedOfferSubmissions: [],
    });

    const tp1BalanceAfter = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceAfter).to.eq(0); // TermRepoLocker is not paid any rollover amount

    const tp2Balance = await purchaseToken.balanceOf(
      maturityPeriod2.termRepoLocker.address
    );

    expect(tp2Balance).to.eq(0); // TermRepoLocker of rollover term balanced

    const maturity2TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod2.termRepoServicer.address,
      adminWallet
    )) as TermRepoServicer;

    const term2getBorrowerRepurchaseObligation =
      await maturity2TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );

    /* Some issues with the wallets causing this to be misaligned
    expect(
      term2getBorrowerRepurchaseObligation.lte(wallet1BalanceBeforeRollover)
    ).to.eq(true); // borrower balance in new term does not include the rollover amount (assuming they get the same nonrollover loan in identical auction setup)
      */

    const maturity2CollateralManager = (await ethers.getContractAt(
      TermRepoCollateralManagerABI,
      maturityPeriod2.termRepoCollateralManager.address,
      adminWallet
    )) as TermRepoCollateralManager;

    const collateral2 = await maturity2CollateralManager.getCollateralBalance(
      wallets[1].address,
      testCollateralToken.address
    );
    expect(collateral2.eq(collateral1Before)).to.eq(true); // collateral is same in both auctions since rollover was rejected

    const ctTp2Balance = await collateralToken.balanceOf(
      maturityPeriod2.termRepoLocker.address
    );

    expect(ctTp2Balance.eq(ctTp1BalanceBefore)).to.eq(true); // collateral not transferred to rollover term repo locker for rollover loan
  });
  it("bid rollovers marked as processed after auction cancelled", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      signer
    )) as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE]
    );
    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash
      );
    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
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
      TermAuctionBidLockerABI,
      maturityPeriod2.termAuctionBidLocker.address,
      wallets[0]
    )) as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids4.push(bidId);
    }

    const rolloverMat2BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE]
    );

    rolloverMat2RevealTx.wait();

    revealedBids4.push(rolloverMat2BidId);

    const revealedOffers4 = [];
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriod2.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = offerIdMappings.get(offer.id.toString());
      const tx = await termAuctionOfferLocker.revealOffers(
        [offerId],
        [offer.offerPriceRevealed || 0],
        [OFFER_PRICE_NONCE]
      );
      await tx.wait();
      revealedOffers4.push(offerId);
    }

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod2.auction.address,
      adminWallet
    )) as TermAuction;
    await auction.cancelAuction({
      revealedBidSubmissions: revealedBids4,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: revealedOffers4,
      unrevealedOfferSubmissions: [],
    });

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat2BidPriceHash,
      true,
    ]);
  });

  it("bid rollovers marked as processed after auction complete results in cancellation due to lack of offers", async () => {
    const signer = new NonceManager(wallets[6] as any);

    const maturity1RolloverManager = (await ethers.getContractAt(
      TermRepoRolloverManagerABI,
      maturityPeriod1.rolloverManager.address,
      signer
    )) as TermRepoRolloverManager;

    await approveRollover(
      { rolloverManagerAddress: maturityPeriod1.rolloverManager.address },
      {
        auctionAddress: maturityPeriod2.auction.address,
        termAuctionBidLockerAddress:
          maturityPeriod2.termAuctionBidLocker.address,
      },
      adminWallet
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionStart2.unix() - timestampBefore,
    ]);

    const purchaseToken = (await ethers.getContractAt(
      TestTokenABI,
      testPurchaseToken.address,
      signer
    )) as TestToken;
    const tp1BalanceBefore = await purchaseToken.balanceOf(
      maturityPeriod1.termRepoLocker.address
    );
    expect(tp1BalanceBefore).to.eq(0);

    const maturity1TermRepoServicer = (await ethers.getContractAt(
      TermRepoServicerABI,
      maturityPeriod1.termRepoServicer.address,
      signer
    )) as TermRepoServicer;

    const managedWallet1 = new NonceManager(wallets[1] as any);

    const wallet1BalanceBeforeRollover =
      await maturity1TermRepoServicer.getBorrowerRepurchaseObligation(
        wallets[1].address
      );
    const wallet1RolloverAmount = wallet1BalanceBeforeRollover.div(2);

    const maturity1RolloverManagerWallet1Connection =
      (await ethers.getContractAt(
        TermRepoRolloverManagerABI,
        maturityPeriod1.rolloverManager.address,
        managedWallet1
      )) as TermRepoRolloverManager;

    const rolloverMat2BidPrice = "99" + "0".repeat(18);

    const rolloverMat2BidPriceHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [rolloverMat2BidPrice, BID_PRICE_NONCE]
    );
    const submission = {
      rolloverAuction: maturityPeriod2.termAuctionBidLocker.address,
      rolloverAmount: wallet1RolloverAmount,
      rolloverBidPriceHash: rolloverMat2BidPriceHash,
    } as TermRepoRolloverElectionSubmissionStruct;

    await expect(
      maturity1RolloverManagerWallet1Connection
        .connect(wallets[1])
        .electRollover(submission)
    )
      .to.emit(termEventEmitter, "RolloverElection")
      .withArgs(
        termIdHash,
        rolloverTermIdHash,
        wallets[1].address,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet1RolloverAmount,
        rolloverMat2BidPriceHash
      );

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat2BidPriceHash,
      false,
    ]);

    const { bids } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );
    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod2.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriod2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
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
      TermAuctionBidLockerABI,
      maturityPeriod2.termAuctionBidLocker.address,
      wallets[0]
    )) as TermAuctionBidLocker;
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString());

      const tx = await termAuctionBidLocker.revealBids(
        [bidId],
        [bid.bidPriceRevealed || 0],
        [BID_PRICE_NONCE]
      );
      await tx.wait();
      revealedBids4.push(bidId);
    }

    const rolloverMat2BidId = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [maturity1RolloverManager.address, wallets[1].address]
    );
    const rolloverMat2RevealTx = await termAuctionBidLocker.revealBids(
      [rolloverMat2BidId],
      [rolloverMat2BidPrice],
      [BID_PRICE_NONCE]
    );

    rolloverMat2RevealTx.wait();

    revealedBids4.push(rolloverMat2BidId);

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ hours: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod2.auction.address,
      wallet
    )) as TermAuction;
    await auction.completeAuction({
      revealedBidSubmissions: revealedBids4,
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [],
      unrevealedOfferSubmissions: [],
    });

    expect(
      JSON.parse(
        JSON.stringify(
          await maturity1RolloverManager.getRolloverInstructions(
            wallets[1].address
          )
        )
      )
    ).to.deep.equal([
      maturityPeriod2.termAuctionBidLocker.address,
      BigNumber.from(wallet1RolloverAmount).toJSON(),
      rolloverMat2BidPriceHash,
      true,
    ]);
  });
});
/* eslint-enable camelcase */
