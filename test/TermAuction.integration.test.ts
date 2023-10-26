/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  TermAuction,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermController,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
  TestPriceFeed,
  TestToken,
} from "../typechain-types";
import { BigNumber, BigNumberish, Signer, Wallet } from "ethers";
import dayjs from "dayjs";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployAdditionalAuction,
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { NonceManager } from "@ethersproject/experimental";
import TermAuctionABI from "../abi/TermAuction.json";
import TermAuctionBidLockerABI from "../abi/TermAuctionBidLocker.json";
import TermAuctionOfferLockerABI from "../abi/TermAuctionOfferLocker.json";
import TestTokenABI from "../abi/TestToken.json";
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

function expectBigNumberEq(
  actual: BigNumber,
  expected: BigNumberish,
  message: string = `Expected ${expected.toString()} but was ${actual.toString()}`
): void {
  // eslint-disable-next-line no-unused-expressions
  expect(actual.eq(expected), message).to.be.true;
}

describe("TermAuctionIntegration", () => {
  let wallets: SignerWithAddress[];
  let termController: FakeContract<TermController>;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let mockCollateralFeed: TestPriceFeed;
  let mockPurchaseFeed: TestPriceFeed;
  let termInitializer: TermInitializer;
  let maturityPeriodOffset1: MaturityPeriodInfo;
  let maturityPeriodOffset0: MaturityPeriodInfo;
  let auctionIdOffset1Hash: string;
  let auctionIdOffset0Hash: string;
  let snapshotId: string;
  let termEventEmitter: TermEventEmitter;
  let termOracle: TermPriceConsumerV3;

  beforeEach(async () => {
    upgrades.silenceWarnings();
    snapshotId = await network.provider.send("evm_snapshot", []);

    wallets = await ethers.getSigners();

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

    const termInitializerFactory = await ethers.getContractFactory(
      "TermInitializer"
    );
    termInitializer = await termInitializerFactory.deploy(
      wallets[7].address,
      wallets[3].address
    );
    await termInitializer.deployed();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[4].address, wallets[5].address, termInitializer.address],
      { kind: "uups" }
    )) as TermEventEmitter;

    termController = await smock.fake<TermController>("TermController");
    termController.isTermDeployed.returns(true);

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
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed.address
      );
    await termOracle
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        testPurchaseToken.address,
        mockPurchaseFeed.address
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
        termControllerAddress: termController.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
        termOracleAddress: termOracle.address,
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
        purchaseTokenAddress: testPurchaseToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
      },
      "uups"
    );

    maturityPeriodOffset0 = await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
        termOracleAddress: termOracle.address,
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
        purchaseTokenAddress: testPurchaseToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups"
    );
    auctionIdOffset1Hash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriodOffset1.termAuctionId]
    );
    auctionIdOffset0Hash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriodOffset0.termAuctionId]
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("completeAuction completes an auction - random1 - offset 1", async () => {
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
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset1.termAuctionBidLocker.address,
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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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
        maturityPeriodOffset1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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
      maturityPeriodOffset1.auction.address,
      wallet
    )) as TermAuction;

    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdOffset1Hash,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdOffset1Hash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "545000000000000000"
      );

    const clearingPrice = await auction.clearingPrice();
    expectBigNumberEq(clearingPrice, "545000000000000000");
  });
  it("completeAuction completes an auction - random1 - offset 0", async () => {
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
        maturityPeriodOffset0.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriodOffset0.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset0.termAuctionBidLocker.address,
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
        maturityPeriodOffset0.termAuctionOfferLocker.address,
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
        maturityPeriodOffset0.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        maturityPeriodOffset0.termAuctionOfferLocker.address,
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
      maturityPeriodOffset0.auction.address,
      wallet
    )) as TermAuction;

    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdOffset0Hash,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdOffset0Hash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "525000000000000000"
      );

    const clearingPrice = await auction.clearingPrice();
    expectBigNumberEq(clearingPrice, "525000000000000000");
  });
  it("cancelAuctionForWithdrawal cancels auction and allows participants to withdraw funds...complete auction reverts after", async () => {
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
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset1.termAuctionBidLocker.address,
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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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
        maturityPeriodOffset1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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
      maturityPeriodOffset1.auction.address,
      wallet
    )) as TermAuction;

    expect(await auction.auctionCancelledForWithdrawal()).to.eq(false);

    for (const bid of bids) {
      const walletAddr = await walletsByAddress[
        bid.bidder.toString()
      ].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }
      const wallet = new NonceManager(
        walletsByAddress[bid.bidder.toString()] as any
      );
      console.log(
        `${await wallet.getAddress()} ${await wallet.getTransactionCount()}`
      );
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      await expect(
        termAuctionBidLocker.connect(wallet).unlockBids([bidId])
      ).to.be.revertedWithCustomError(termAuctionBidLocker, "AuctionNotOpen");
    }

    for (const offer of offers) {
      const walletAddr = await walletsByAddress[
        offer.offeror.toString()
      ].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }

      const wallet = new NonceManager(
        walletsByAddress[offer.offeror.toString()] as any
      );
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriodOffset1.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      await expect(
        termAuctionOfferLocker.connect(wallet).unlockOffers([offerId])
      ).to.be.revertedWithCustomError(termAuctionOfferLocker, "AuctionNotOpen");
    }

    const auctionAdminConnection = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriodOffset1.auction.address,
      walletsByAddress[wallets[6].address]
    )) as TermAuction;

    const cancelTx = await auctionAdminConnection.cancelAuctionForWithdrawal(
      [],
      []
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
      })
    ).to.be.revertedWithCustomError(auction, "AuctionCancelledForWithdrawal");

    for (const bid of bids) {
      const walletAddr = await walletsByAddress[
        bid.bidder.toString()
      ].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }
      const wallet = new NonceManager(
        walletsByAddress[bid.bidder.toString()] as any
      );

      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      const bidId = await getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        wallet
      );

      bidIdMappings.set(bid.id.toString(), bidId);
      const tx = await termAuctionBidLocker.connect(wallet).unlockBids([bidId]);
      await tx.wait();
    }

    for (const offer of offers) {
      const walletAddr = await walletsByAddress[
        offer.offeror.toString()
      ].getAddress();

      // preventing some weird error where admin wallet is getting stuck on a nonce
      if (walletAddr === wallets[0].address) {
        continue;
      }

      const wallet = new NonceManager(
        walletsByAddress[offer.offeror.toString()] as any
      );
      const termAuctionOfferLocker = (await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        maturityPeriodOffset1.termAuctionOfferLocker.address,
        wallet
      )) as TermAuctionOfferLocker;

      const offerId = await getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        wallet
      );

      offerIdMappings.set(offer.id.toString(), offerId);

      const tx = await termAuctionOfferLocker
        .connect(wallet)
        .unlockOffers([offerId]);
      await tx.wait();
    }
  });
  it("completeAuction cancels an auction when all bids are undercollateralized after collateral price tanks", async () => {
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
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }
    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        maturityPeriodOffset1.termAuctionBidLocker.address,
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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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
        maturityPeriodOffset1.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        maturityPeriodOffset1.termAuctionOfferLocker.address,
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

    // drop price of collateral
    await mockCollateralFeed.setAnswer(1e7);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriodOffset1.auction.address,
      wallet
    )) as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidInShortfall")
      .withArgs(
        auctionIdOffset1Hash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-1"),
          maturityPeriodOffset1.termAuctionBidLocker,
          walletsByAddress[bids[1].bidder.toString()]
        )
      )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdOffset1Hash, false, false);
  });
  it("completeAuction completes an auction after reopening", async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
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
      termControllerAddress: termController.address,
      termOracleAddress: termOracle.address,
      termEventEmitterAddress: termEventEmitter.address,
      termInitializerAddress: termInitializer.address,
      auctionStartDate: auctionStart.unix().toString(),
      auctionRevealDate: auctionReveal.unix().toString(),
      auctionEndDate: auctionEnd.unix().toString(),
      redemptionTimestamp: maturity.unix().toString(),
      minimumTenderAmount,
      purchaseTokenAddress: testPurchaseToken.address,
      collateralTokenAddresses: [testCollateralToken.address],
      termRepoServicerAddress: maturityPeriodOffset1.termRepoServicer.address,
      collateralManagerAddress:
        maturityPeriodOffset1.termRepoCollateralManager.address,
      termApprovalMultisig: wallets[7],
      devopsMultisig: wallets[4].address,
      adminWallet: wallets[6].address,
      auctionVersion: "0.1.0",
    });

    const auctionId2 = ethers.utils.solidityKeccak256(
      ["string"],
      [auctionGroup2.termAuctionId]
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
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriodOffset1.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    const bidIdMappings = new Map<string, any>();

    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const termAuctionBidLocker = (await ethers.getContractAt(
        TermAuctionBidLockerABI,
        auctionGroup2.termAuctionBidLocker.address,
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
        auctionGroup2.termAuctionOfferLocker.address,
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
        auctionGroup2.termAuctionBidLocker.address,
        wallet
      )) as TermAuctionBidLocker;
      console.log(bid.bidPriceRevealed);

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
        auctionGroup2.termAuctionOfferLocker.address,
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
      auctionGroup2.auction.address,
      wallet
    )) as TermAuction;

    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionId2,
        bidIdMappings.get(getBytesHash("test-bid-2")),
        anyValue
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionId2,
        bidIdMappings.get(getBytesHash("test-bid-4")),
        anyValue
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionId2,
        offerIdMappings.get(getBytesHash("test-offer-3")),
        anyValue
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionId2,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "545000000000000000"
      );

    const clearingPrice = await auction.clearingPrice();
    expectBigNumberEq(clearingPrice, "545000000000000000");
  });
});
/* eslint-enable camelcase */
