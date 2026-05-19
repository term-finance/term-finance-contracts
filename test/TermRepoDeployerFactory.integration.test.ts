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
  TermRepoDeployerFactory,
  TermRepoServicer,
  TermRepoToken,
} from "../typechain-types";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { NonceManager, Signer } from "ethers";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { v4 } from "uuid";
import {
  parseBidsOffers,
  bidToSubmission,
  offerToSubmission,
  getGeneratedTenderId,
} from "../utils/simulation-utils";

dayjs.extend(duration);

// CSV: col0=offer_wallet_idx, col1=offer_amount, col2=offer_price,
//      col3=bid_wallet_idx,   col4=bid_amount,   col5=bid_price
const clearingPriceTestCSV = `1	235610440000	4.9	1	269816180000	3.3
2	323003960000	6	2	380489230000	7.4
3	188737020000	3.5	3	251448030000	2.6
4	481792720000	4.2	4	88591690000	6.3
`;

const BID_PRICE_NONCE = "12345";
const OFFER_PRICE_NONCE = "678910";

describe("TermRepoDeployerFactory Integration", () => {
  let wallets: SignerWithAddress[];
  let termController: TermController;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let termEventEmitter: TermEventEmitter;
  let termOracle: TermPriceConsumerV3;
  let termDiamond: TermDiamond;
  let factory: TermRepoDeployerFactory;
  let snapshotId: string;

  beforeEach(async () => {
    upgrades.silenceWarnings();
    snapshotId = await network.provider.send("evm_snapshot", []);
    wallets = await ethers.getSigners();

    const purchaseTokenDecimals = 8;
    const collateralTokenDecimals = 8;

    // 1. Deploy test tokens
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

    // 2. Deploy TermPriceConsumerV3
    const termPriceOracleFactory =
      await ethers.getContractFactory("TermPriceConsumerV3");
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [wallets[4].address],
      { kind: "uups" },
    )) as unknown as TermPriceConsumerV3;

    // 3. Deploy TermController
    const termControllerFactory =
      await ethers.getContractFactory("TermController");
    termController = (await upgrades.deployProxy(
      termControllerFactory,
      [
        wallets[7].address, // treasury
        wallets[8].address, // reserve
        wallets[5].address, // controllerAdmin
        wallets[4].address, // devops
        wallets[6].address, // admin (ADMIN_ROLE)
      ],
      { kind: "uups" },
    )) as unknown as TermController;

    // 4. Deploy TermInitializer (needed as param for TermEventEmitter init)
    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    const termInitializer: TermInitializer = await termInitializerFactory.deploy(
      wallets[7].address,
      wallets[3].address,
    );
    await termInitializer.waitForDeployment();
    await termController
      .connect(wallets[6])
      .pairInitializer(await termInitializer.getAddress());

    // 5. Deploy TermDiamond via TermDiamondFactory
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
    const decodedDiamondEvent =
      termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    termDiamond = (await ethers.getContractAt(
      "TermDiamond",
      decodedDiamondEvent!.args.diamond,
    )) as unknown as TermDiamond;

    // 6. Deploy TermEventEmitter
    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        wallets[4].address, // devops
        wallets[5].address, // termDelister
        await termInitializer.getAddress(), // termInitializer (gets INITIALIZER_ROLE)
        wallets[5].address, // adminWallet on emitter (gets ADMIN_ROLE on emitter)
        await termDiamond.getAddress(),
      ],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    // Wire TermInitializer with protocol contracts
    await termInitializer.pairTermContracts(
      await termController.getAddress(),
      await termEventEmitter.getAddress(),
      await termOracle.getAddress(),
      await termDiamond.getAddress(),
    );

    // 7. Register price feeds
    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    const mockCollateralFeed: TestPriceFeed = await mockPriceFeedFactory.deploy(
      collateralTokenDecimals,
      "",
      1,
      1,
      1e10,
      1,
      1,
      1,
    );
    const mockPurchaseFeed: TestPriceFeed = await mockPriceFeedFactory.deploy(
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

    // 8. Deploy implementation contracts (raw, uninitialized)
    const termRepoServicerImpl = await (
      await ethers.getContractFactory("TermRepoServicer")
    ).deploy();
    await termRepoServicerImpl.waitForDeployment();

    const termRepoCollateralManagerImpl = await (
      await ethers.getContractFactory("TermRepoCollateralManager")
    ).deploy();
    await termRepoCollateralManagerImpl.waitForDeployment();

    const termRepoLockerImpl = await (
      await ethers.getContractFactory("TermRepoLocker")
    ).deploy();
    await termRepoLockerImpl.waitForDeployment();

    const termRepoTokenImpl = await (
      await ethers.getContractFactory("TermRepoToken")
    ).deploy();
    await termRepoTokenImpl.waitForDeployment();

    const termRepoRolloverManagerImpl = await (
      await ethers.getContractFactory("TermRepoRolloverManager")
    ).deploy();
    await termRepoRolloverManagerImpl.waitForDeployment();

    const termAuctionImpl = await (
      await ethers.getContractFactory("TermAuction")
    ).deploy();
    await termAuctionImpl.waitForDeployment();

    const termAuctionBidLockerImpl = await (
      await ethers.getContractFactory("TermAuctionBidLocker")
    ).deploy();
    await termAuctionBidLockerImpl.waitForDeployment();

    const termAuctionOfferLockerImpl = await (
      await ethers.getContractFactory("TermAuctionOfferLocker")
    ).deploy();
    await termAuctionOfferLockerImpl.waitForDeployment();

    // 9. Deploy TermRepoDeployerFactory
    const factoryContractFactory = await ethers.getContractFactory(
      "TermRepoDeployerFactory",
    );
    factory = (await factoryContractFactory.deploy(
      wallets[6].address, // admin_
      wallets[4].address, // devops_
      await termController.getAddress(), // controller_
      await termEventEmitter.getAddress(), // emitter_
      await termOracle.getAddress(), // priceOracle_
      await termDiamond.getAddress(), // termDiamond_
    )) as unknown as TermRepoDeployerFactory;
    await factory.waitForDeployment();

    // 10. Grant factory FACTORY_DEPLOYER_ROLE on controller (requires ADMIN_ROLE = wallets[6])
    await termController
      .connect(wallets[6])
      .pairFactoryDeployer(await factory.getAddress());

    // 11. Grant factory INITIALIZER_ROLE on emitter (requires ADMIN_ROLE on emitter = wallets[5])
    await termEventEmitter
      .connect(wallets[5])
      .pairTermFactory(await factory.getAddress());

    // 12. Set implementation addresses on factory (requires DEVOPS_ROLE = wallets[4])
    await factory.connect(wallets[4]).setTermRepoImplementations(
      await termRepoServicerImpl.getAddress(),
      await termRepoCollateralManagerImpl.getAddress(),
      await termRepoLockerImpl.getAddress(),
      await termRepoTokenImpl.getAddress(),
      await termRepoRolloverManagerImpl.getAddress(),
      "0.1.0",
    );
    await factory.connect(wallets[4]).setTermAuctionImplementations(
      await termAuctionImpl.getAddress(),
      await termAuctionBidLockerImpl.getAddress(),
      await termAuctionOfferLockerImpl.getAddress(),
      "0.1.0",
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  async function deployTestTermRepo() {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const maturity = now + dayjs.duration(30, "days").asSeconds();
    const repurchaseWindow = dayjs.duration(1, "day").asSeconds();
    const redemptionBuffer = dayjs.duration(5, "minutes").asSeconds();
    const termRepoId = v4();

    const tx = await factory.deployTermRepo({
      termRepoId,
      maturityTimestamp: maturity,
      repurchaseWindow,
      redemptionBuffer,
      purchaseToken: await testPurchaseToken.getAddress(),
      servicingFee: "3" + "0".repeat(15), //  0.3%
      netExposureCapOnLiquidation: "5" + "0".repeat(16), //  5%
      liquidatedDamagesDueToProtocol: "3" + "0".repeat(16), //  3%
      collateralTokens: [
        {
          tokenAddress: await testCollateralToken.getAddress(),
          initialCollateralRatio: "15" + "0".repeat(17), // 150%
          maintenanceRatio: "125" + "0".repeat(16), // 125%
          liquidatedDamage: "5" + "0".repeat(16), //   5%
        },
      ],
      tokenName: "Term Repo Token",
      tokenSymbol: "TRT",
      mintExposureCap: "1" + "0".repeat(24),
    });

    // TermRepoServicerInitialized: deployerWallet must equal factory address
    await expect(tx)
      .to.emit(termEventEmitter, "TermRepoServicerInitialized")
      .withArgs(
        anyValue, // termRepoId
        anyValue, // termRepoServicer
        anyValue, // purchaseToken
        anyValue, // maturityTimestamp
        anyValue, // endOfRepurchaseWindow
        anyValue, // redemptionTimestamp
        anyValue, // servicingFee
        await factory.getAddress(), // deployerWallet
        anyValue, // version
      );

    const receipt = await tx.wait();

    const eventTopic =
      factory.interface.getEvent("TermRepoDeployed").topicHash;
    const log = receipt!.logs.find((l) => l.topics[0] === eventTopic);
    if (!log) throw new Error("TermRepoDeployed event not found");
    const decoded = factory.interface.parseLog(log)!;

    const servicer = (await ethers.getContractAt(
      "TermRepoServicer",
      decoded.args.termRepoServicer,
    )) as unknown as TermRepoServicer;
    const token = (await ethers.getContractAt(
      "TermRepoToken",
      decoded.args.termRepoToken,
    )) as unknown as TermRepoToken;
    const locker = await ethers.getContractAt(
      "TermRepoLocker",
      decoded.args.termRepoLocker,
    );

    return {
      termRepoId,
      maturity,
      repurchaseWindow,
      redemptionBuffer,
      servicerAddress: decoded.args.termRepoServicer as string,
      servicer,
      token,
      locker,
    };
  }

  async function deployTestAuction(
    termRepoId: string,
    servicerAddress: string,
  ) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    // Add a 120s buffer so auctionStartTime > block.timestamp when the tx is mined
    const auctionStart = now + 120;
    const revealTime =
      auctionStart + dayjs.duration(1, "hour").asSeconds();
    const auctionEnd =
      revealTime + dayjs.duration(10, "minutes").asSeconds();
    const termStart = auctionEnd; // termStart >= auctionEndTime

    const tx = await factory.deployAuctionAndReopenTerm(
      {
        termRepoId,
        termAuctionId: v4(),
        auctionStartTime: auctionStart,
        revealTime,
        auctionEndTime: auctionEnd,
        termStart,
        minimumTenderAmount: 10,
        clearingPricePostProcessingOffset: 0,
      },
      servicerAddress,
    );

    // TermAuctionInitialized: deployerWallet must equal factory address
    await expect(tx)
      .to.emit(termEventEmitter, "TermAuctionInitialized")
      .withArgs(
        anyValue, // termRepoId
        anyValue, // termAuctionId
        anyValue, // termAuction
        anyValue, // auctionEndTime
        await factory.getAddress(), // deployerWallet
        anyValue, // version
      );

    const receipt = await tx.wait();

    const eventTopic =
      factory.interface.getEvent("TermAuctionDeployed").topicHash;
    const log = receipt!.logs.find((l) => l.topics[0] === eventTopic);
    if (!log) throw new Error("TermAuctionDeployed event not found");
    const decoded = factory.interface.parseLog(log)!;

    const auction = (await ethers.getContractAt(
      "TermAuction",
      decoded.args.termAuction,
    )) as unknown as TermAuction;
    const bidLocker = (await ethers.getContractAt(
      "TermAuctionBidLocker",
      decoded.args.termAuctionBidLocker,
    )) as unknown as TermAuctionBidLocker;
    const offerLocker = (await ethers.getContractAt(
      "TermAuctionOfferLocker",
      decoded.args.termAuctionOfferLocker,
    )) as unknown as TermAuctionOfferLocker;

    return { auction, bidLocker, offerLocker, auctionStart, revealTime, auctionEnd };
  }

  // Deploys an auction and runs it to completion; returns bids/offers arrays
  async function runAuction(termRepoId: string, servicerAddress: string, lockerAddress: string) {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );

    const { auction, bidLocker, offerLocker, auctionStart, revealTime, auctionEnd } =
      await deployTestAuction(termRepoId, servicerAddress);

    const walletsByAddress: { [address: string]: Signer } = {};
    for (const wallet of wallets) {
      walletsByAddress[wallet.address] = new NonceManager(wallet as unknown as Signer);
    }

    // Fund bidders with collateral tokens (approved to locker)
    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const collateral = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        wallet,
      )) as unknown as TestToken;
      await (await collateral.mint(bid.bidder.toString(), "1" + "0".repeat(25))).wait();
      await (await collateral.approve(lockerAddress, "1" + "0".repeat(25))).wait();
    }

    // Fund offerors with purchase tokens (approved to locker)
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const purchase = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        wallet,
      )) as unknown as TestToken;
      await (await purchase.mint(offer.offeror.toString(), "1" + "0".repeat(25))).wait();
      await (await purchase.approve(lockerAddress, "1" + "0".repeat(25))).wait();
    }

    // Advance time past auctionStart so bids/offers can be locked
    const nowBeforeLock = (await ethers.provider.getBlock("latest"))!.timestamp;
    if (nowBeforeLock < auctionStart) {
      await network.provider.send("evm_increaseTime", [auctionStart - nowBeforeLock + 1]);
      await network.provider.send("evm_mine", []);
    }

    // Lock bids
    const bidIdMappings = new Map<string, string>();
    for (const bid of bids) {
      const wallet = walletsByAddress[bid.bidder.toString()];
      const bidLockerConnected = (await ethers.getContractAt(
        "TermAuctionBidLocker",
        await bidLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionBidLocker;
      const submission = bidToSubmission(bid);
      const bidId = await getGeneratedTenderId(
        bid.id.toString(),
        bidLockerConnected,
        wallet,
      );
      bidIdMappings.set(bid.id.toString(), bidId);
      await (await bidLockerConnected.lockBids([submission])).wait();
    }

    // Lock offers
    const offerIdMappings = new Map<string, string>();
    for (const offer of offers) {
      const wallet = walletsByAddress[offer.offeror.toString()];
      const offerLockerConnected = (await ethers.getContractAt(
        "TermAuctionOfferLocker",
        await offerLocker.getAddress(),
        wallet,
      )) as unknown as TermAuctionOfferLocker;
      const submission = offerToSubmission(offer);
      const offerId = await getGeneratedTenderId(
        offer.id.toString(),
        offerLockerConnected,
        wallet,
      );
      offerIdMappings.set(offer.id.toString(), offerId);
      await (await offerLockerConnected.lockOffers([submission])).wait();
    }

    // Advance time past revealTime
    const nowAfterLock = (await ethers.provider.getBlock("latest"))!.timestamp;
    await network.provider.send("evm_increaseTime", [
      revealTime - nowAfterLock + 60,
    ]);
    await network.provider.send("evm_mine", []);

    // Reveal bids
    const revealedBids: string[] = [];
    for (const bid of bids) {
      const bidId = bidIdMappings.get(bid.id.toString())!;
      await (
        await bidLocker.revealBids(
          [bidId],
          [bid.bidPriceRevealed || 0],
          [BID_PRICE_NONCE],
        )
      ).wait();
      revealedBids.push(bidId);
    }

    // Reveal offers
    const revealedOffers: string[] = [];
    for (const offer of offers) {
      const offerId = offerIdMappings.get(offer.id.toString())!;
      await (
        await offerLocker.revealOffers(
          [offerId],
          [offer.offerPriceRevealed || 0],
          [OFFER_PRICE_NONCE],
        )
      ).wait();
      revealedOffers.push(offerId);
    }

    // Advance time past auctionEnd
    const nowAfterReveal = (await ethers.provider.getBlock("latest"))!.timestamp;
    await network.provider.send("evm_increaseTime", [
      auctionEnd - nowAfterReveal + 60,
    ]);
    await network.provider.send("evm_mine", []);

    // Complete auction (wallets[0] is the default completer)
    const completer = new NonceManager(wallets[0] as unknown as Signer);
    const auctionConnected = (await ethers.getContractAt(
      "TermAuction",
      await auction.getAddress(),
      completer,
    )) as unknown as TermAuction;
    await (
      await auctionConnected.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    ).wait();

    return { auction, bids, offers };
  }

  // Submit repurchase payments for all borrowers with outstanding obligations
  async function repayAllBorrowers(
    servicer: TermRepoServicer,
    lockerAddress: string,
    borrowerAddresses: string[],
  ) {
    const unique = [...new Set(borrowerAddresses)];
    for (const borrower of unique) {
      const obligation = await servicer.getBorrowerRepurchaseObligation(borrower);
      if (obligation === 0n) continue;

      const borrowerWallet = wallets.find(
        (w) => w.address.toLowerCase() === borrower.toLowerCase(),
      )!;
      await testPurchaseToken.mint(borrower, obligation);
      await testPurchaseToken
        .connect(borrowerWallet)
        .approve(lockerAddress, obligation);
      await servicer
        .connect(borrowerWallet)
        .submitRepurchasePayment(obligation);
    }
  }

  // =========================================================================
  // TC1: Factory deployment + mintOpenExposure
  // =========================================================================

  it("TC1: deploys term repo via factory and mints open exposure after granting SPECIALIST_ROLE", async () => {
    const { servicer, token, locker } = await deployTestTermRepo();

    // Grant wallets[9] SPECIALIST_ROLE via controller (requires ADMIN_ROLE = wallets[6])
    await termController
      .connect(wallets[6])
      .grantMintExposureAccess(wallets[9].address);

    // mint 100 repo tokens; collateral at 150% ratio
    const mintAmount = "100" + "0".repeat(8); // 100 tokens (8 dec)
    const collateralAmount = (
      (BigInt(mintAmount) * 3n) /
      2n
    ).toString(); // 150 tokens (8 dec)

    await testCollateralToken.mint(wallets[9].address, collateralAmount);
    await testCollateralToken
      .connect(wallets[9])
      .approve(await locker.getAddress(), collateralAmount);

    const tokenBefore = await token.balanceOf(wallets[9].address);

    await servicer
      .connect(wallets[9])
      .mintOpenExposure(mintAmount, [collateralAmount]);

    const tokenAfter = await token.balanceOf(wallets[9].address);
    expect(tokenAfter).to.be.gt(tokenBefore);

    const obligation = await servicer.getBorrowerRepurchaseObligation(
      wallets[9].address,
    );
    expect(obligation).to.be.gt(0n);
  });

  // =========================================================================
  // TC2: Auction deployment + completion
  // =========================================================================

  it("TC2: deploys auction via factory, completes after bids and offers submitted and revealed", async () => {
    const { termRepoId, servicerAddress, locker } = await deployTestTermRepo();

    const { auction } = await runAuction(
      termRepoId,
      servicerAddress,
      await locker.getAddress(),
    );

    const clearingPrice = await auction.clearingPrice();
    expect(clearingPrice).to.be.gt(0n);
    expect(await auction.auctionCompleted()).to.be.true;
  });

  // =========================================================================
  // TC3: Repayments after mintOpenExposure + auction
  // =========================================================================

  it("TC3: repayments on all open positions from mints and auction", async () => {
    const { termRepoId, servicer, locker } = await deployTestTermRepo();

    // Mint open exposure for wallets[9]
    await termController
      .connect(wallets[6])
      .grantMintExposureAccess(wallets[9].address);
    const mintAmount = "100" + "0".repeat(8);
    const collateralAmount = ((BigInt(mintAmount) * 3n) / 2n).toString();
    await testCollateralToken.mint(wallets[9].address, collateralAmount);
    await testCollateralToken
      .connect(wallets[9])
      .approve(await locker.getAddress(), collateralAmount);
    await servicer
      .connect(wallets[9])
      .mintOpenExposure(mintAmount, [collateralAmount]);

    // Complete auction (creates additional borrowers from winning bids)
    const { bids } = await runAuction(
      termRepoId,
      await servicer.getAddress(),
      await locker.getAddress(),
    );

    // Repay all: wallets[9] (mint) + all auction bid winners
    const allBorrowers = [
      wallets[9].address,
      ...bids.map((b) => b.bidder.toString()),
    ];
    await repayAllBorrowers(servicer, await locker.getAddress(), allBorrowers);

    // Verify all obligations are cleared
    expect(
      await servicer.getBorrowerRepurchaseObligation(wallets[9].address),
    ).to.equal(0n);
    for (const bid of bids) {
      expect(
        await servicer.getBorrowerRepurchaseObligation(bid.bidder.toString()),
      ).to.equal(0n);
    }
  });

  // =========================================================================
  // TC4: Token redemptions after repayments and fast-forward to redemption period
  // =========================================================================

  it("TC4: term repo token redemptions after fast forward to redemption period", async () => {
    const { termRepoId, maturity, repurchaseWindow, redemptionBuffer, servicer, token, locker } =
      await deployTestTermRepo();

    // Mint open exposure for wallets[9] (receives repo tokens)
    await termController
      .connect(wallets[6])
      .grantMintExposureAccess(wallets[9].address);
    const mintAmount = "100" + "0".repeat(8);
    const collateralAmount = ((BigInt(mintAmount) * 3n) / 2n).toString();
    await testCollateralToken.mint(wallets[9].address, collateralAmount);
    await testCollateralToken
      .connect(wallets[9])
      .approve(await locker.getAddress(), collateralAmount);
    await servicer
      .connect(wallets[9])
      .mintOpenExposure(mintAmount, [collateralAmount]);

    // Complete auction (offerors receive repo tokens)
    const { bids, offers } = await runAuction(
      termRepoId,
      await servicer.getAddress(),
      await locker.getAddress(),
    );

    // All borrowers repay within repurchase window
    const allBorrowers = [
      wallets[9].address,
      ...bids.map((b) => b.bidder.toString()),
    ];
    await repayAllBorrowers(servicer, await locker.getAddress(), allBorrowers);

    // Advance time past redemptionTimestamp
    const redemptionTimestamp = maturity + repurchaseWindow + redemptionBuffer;
    const nowAfterRepay = (await ethers.provider.getBlock("latest"))!.timestamp;
    await network.provider.send("evm_increaseTime", [
      redemptionTimestamp - nowAfterRepay + 60,
    ]);
    await network.provider.send("evm_mine", []);

    // Redeem for wallets[9]
    const balance9 = await token.balanceOf(wallets[9].address);
    if (balance9 > 0n) {
      const purchaseBefore9 = await testPurchaseToken.balanceOf(
        wallets[9].address,
      );
      await servicer.redeemTermRepoTokens(wallets[9].address, balance9);
      const purchaseAfter9 = await testPurchaseToken.balanceOf(
        wallets[9].address,
      );
      expect(purchaseAfter9).to.be.gt(purchaseBefore9);
      expect(await token.balanceOf(wallets[9].address)).to.equal(0n);
    }

    // Redeem for each offeror who received repo tokens from the auction
    const uniqueOfferors = [...new Set(offers.map((o) => o.offeror.toString()))];
    for (const offeror of uniqueOfferors) {
      const balance = await token.balanceOf(offeror);
      if (balance > 0n) {
        const purchaseBefore = await testPurchaseToken.balanceOf(offeror);
        await servicer.redeemTermRepoTokens(offeror, balance);
        const purchaseAfter = await testPurchaseToken.balanceOf(offeror);
        expect(purchaseAfter).to.be.gt(purchaseBefore);
        expect(await token.balanceOf(offeror)).to.equal(0n);
      }
    }
  });
});
