/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import dayjs from "dayjs";
import {
  ZeroAddress,
  ZeroHash,
  solidityPackedKeccak256,
} from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { getBytesHash } from "../utils/simulation-utils";
import {
  ITermController,
  TermController__factory,
  ITermRepoRolloverManager,
  TermRepoRolloverManager,
  TermEventEmitter,
  TestTermRepoServicer,
  TestToken,
  TestTermRepoLocker,
  TestTermRepoCollateralManager,
  TermPriceConsumerV3,
  TermController,
  TermRepoRolloverManager__factory,
  TermRepoToken,
  TestPriceFeed,
} from "../typechain-types";
import {
  MockContract,
  deployMockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";

describe("Encumbered Collateral Tracking Tests", () => {
  let wallet1: SignerWithAddress; // Lender
  let wallet2: SignerWithAddress; // Borrower (Alice)
  let wallet3: SignerWithAddress; // Liquidator / Borrower (Bob)
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let treasuryWallet: SignerWithAddress;
  let reserveAddress: SignerWithAddress;
  let termDiamond: SignerWithAddress;

  let termAuctionAddress: SignerWithAddress;
  let termAuctionBidLockerAddress: SignerWithAddress;
  let termAuctionOfferLockerAddress: SignerWithAddress;

  let termController: MockContract<ITermController>;
  let termEventEmitter: TermEventEmitter;
  let termRepoCollateralManager: TestTermRepoCollateralManager;
  let termRepoServicer: TestTermRepoServicer;
  let termRepoRolloverManager: MockContract<ITermRepoRolloverManager>;
  let termRepoLocker: TestTermRepoLocker;

  // Two collateral tokens (6 decimals each, matching existing test patterns)
  let collateralToken1: TestToken;
  let collateralToken2: TestToken;
  let purchaseToken: TestToken;

  // Price feeds (stored so we can manipulate prices for liquidation tests)
  let collateral1Feed: TestPriceFeed;
  let collateral2Feed: TestPriceFeed;

  let testTermRepoToken: TermRepoToken;
  let testOracleConsumer: TermPriceConsumerV3;

  let termIdString: string;
  let termIdHashed: string;

  let snapshotId: any;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");

    upgrades.silenceWarnings();

    const signers = await ethers.getSigners();
    [
      wallet1,
      wallet2,
      wallet3,
      devopsMultisig,
      adminWallet,
      termInitializer,
      treasuryWallet,
      termAuctionAddress,
      termAuctionBidLockerAddress,
      termAuctionOfferLockerAddress,
      reserveAddress,
      termDiamond,
    ] = signers;

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");

    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet3.address, termInitializer.address, adminWallet.address, termDiamond.address],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    const TermRepoCollateralManager = await ethers.getContractFactory(
      "TestTermRepoCollateralManager",
    );
    const TermRepoServicer = await ethers.getContractFactory(
      "TestTermRepoServicer",
    );
    const TermRepoLocker =
      await ethers.getContractFactory("TestTermRepoLocker");
    const TermRepoToken = await ethers.getContractFactory("TermRepoToken");
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    const TermPriceConsumerV3 = await ethers.getContractFactory(
      "TermPriceConsumerV3",
    );

    // All tokens use 6 decimals (matching existing TermManager test patterns)
    // collateralToken1: price $2 per token (feed answer = 2000, 3 dec)
    // collateralToken2: price $1 per token (feed answer = 1000, 3 dec)
    // purchaseToken:    price $1 per token (feed answer = 1000, 3 dec)
    collateralToken1 = (await upgrades.deployProxy(TestTokenFactory, [
      "CollateralToken1",
      "CT1",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["250000000", "250000000", "250000000"],
    ])) as unknown as TestToken;

    collateralToken2 = (await upgrades.deployProxy(TestTokenFactory, [
      "CollateralToken2",
      "CT2",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "300000000", "300000000"],
    ])) as unknown as TestToken;

    purchaseToken = (await upgrades.deployProxy(TestTokenFactory, [
      "PurchaseToken",
      "PT",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "300000000", "300000000"],
    ])) as unknown as TestToken;

    // Deploy price feeds (stored for price manipulation in liquidation tests)
    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");

    collateral1Feed = await mockPriceFeedFactory.deploy(
      3, "", 1, 1, 2 * 1e3, 1, 1, 1, // $2 per token
    );
    collateral2Feed = await mockPriceFeedFactory.deploy(
      3, "", 1, 1, 1e3, 1, 1, 1, // $1 per token
    );
    const purchaseTokenFeed = await mockPriceFeedFactory.deploy(
      3, "", 1, 1, 1e3, 1, 1, 1, // $1 per token
    );

    testOracleConsumer = (await upgrades.deployProxy(TermPriceConsumerV3, [
      devopsMultisig.address,
    ])) as unknown as TermPriceConsumerV3;

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await collateralToken1.getAddress(),
        await collateral1Feed.getAddress(),
        0,
      );
    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await collateralToken2.getAddress(),
        await collateral2Feed.getAddress(),
        0,
      );
    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await purchaseToken.getAddress(),
        await purchaseTokenFeed.getAddress(),
        0,
      );

    // Mock controller
    termController = await deployMockContract<TermController>(
      wallet1,
      TermController__factory.abi,
    );
    await termController.mock.getTreasuryAddress.returns(
      treasuryWallet.address,
    );
    await termController.mock.getProtocolReserveAddress.returns(
      reserveAddress.address,
    );

    await termController.mock.termContractsPaused.returns(false);

    // Mock rollover manager
    termRepoRolloverManager =
      await deployMockContract<TermRepoRolloverManager>(
        wallet1,
        TermRepoRolloverManager__factory.abi,
      );
    await termRepoRolloverManager.mock.fulfillRollover.returns();
    await termRepoRolloverManager.mock.getRolloverInstructions.returns({
      rolloverAuctionBidLocker: ZeroAddress,
      rolloverAmount: 0n,
      rolloverBidPriceHash: ZeroHash,
      processed: false,
    });

    const termStartTimestamp = (await ethers.provider.getBlock("latest"))!
      .timestamp;
    const maturationTimestamp = termStartTimestamp + 60 * 60 * 24 * 365;

    termIdString = maturationTimestamp.toString() + "_pt_ct1-ct2";
    termIdHashed = solidityPackedKeccak256(["string"], [termIdString]);

    // Deploy collateral manager with 2 collateral tokens
    termRepoCollateralManager = (await upgrades.deployProxy(
      TermRepoCollateralManager,
      [
        termIdString,
        BigInt("200000000000000000"), // deMinimisMarginThreshold
        BigInt("50000000000000000"), // liquidatedDamagesDueToProtocol
        BigInt("5000000000000000"), // netExposureCapOnLiquidation
        await purchaseToken.getAddress(),
        [
          {
            tokenAddress: await collateralToken1.getAddress(),
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
          {
            tokenAddress: await collateralToken2.getAddress(),
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
        ],
        await termEventEmitter.getAddress(),
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestTermRepoCollateralManager;

    // Deploy servicer
    termRepoServicer = (await upgrades.deployProxy(
      TermRepoServicer,
      [
        termIdString,
        maturationTimestamp,
        60 * 60 * 8,
        60 * 15,
        BigInt("200000000000000000"), // servicingFee (20%)
        await purchaseToken.getAddress(),
        await termController.getAddress(),
        await termEventEmitter.getAddress(),
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestTermRepoServicer;

    // Deploy locker
    termRepoLocker = (await upgrades.deployProxy(
      TermRepoLocker,
      [termIdString, termInitializer.address],
      { kind: "uups" },
    )) as unknown as TestTermRepoLocker;

    // Deploy repo token
    testTermRepoToken = (await upgrades.deployProxy(
      TermRepoToken,
      [
        termIdString,
        "TermRepoToken_MMDDYY",
        "TT",
        6,
        "1000000000000000000",
        "1000000000000000000",
        termInitializer.address,
        {
          redemptionTimestamp: dayjs().unix(),
          purchaseToken: await purchaseToken.getAddress(),
          termRepoServicer: await termRepoServicer.getAddress(),
          termRepoCollateralManager:
            await termRepoCollateralManager.getAddress(),
        },
      ],
      { kind: "uups" },
    )) as unknown as TermRepoToken;

    // Pair contracts
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoLocker.getAddress());

    await termRepoLocker
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoCollateralManager.getAddress(),
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoCollateralManager.getAddress());

    await termRepoCollateralManager
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoLocker.getAddress(),
        await termRepoServicer.getAddress(),
        termAuctionBidLockerAddress.address,
        termAuctionAddress.address,
        await termController.getAddress(),
        await testOracleConsumer.getAddress(),
        await termRepoRolloverManager.getAddress(),
        termDiamond.address,
        devopsMultisig.address,
        adminWallet.address,
      );

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoServicer.getAddress());

    await termRepoServicer
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoLocker.getAddress(),
        await termRepoCollateralManager.getAddress(),
        await testTermRepoToken.getAddress(),
        termDiamond.address,
        termAuctionOfferLockerAddress.address,
        termAuctionAddress.address,
        await termRepoRolloverManager.getAddress(),
        devopsMultisig.address,
        wallet1.address,
        "0.1.0",
      );

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await testTermRepoToken.getAddress());

    await testTermRepoToken
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );

    // Approve tokens for locker
    const lockerAddress = await termRepoLocker.getAddress();
    await collateralToken1.connect(wallet1).approve(lockerAddress, "250000000");
    await collateralToken1.connect(wallet2).approve(lockerAddress, "250000000");
    await collateralToken1.connect(wallet3).approve(lockerAddress, "250000000");
    await collateralToken2.connect(wallet1).approve(lockerAddress, "300000000");
    await collateralToken2.connect(wallet2).approve(lockerAddress, "300000000");
    await collateralToken2.connect(wallet3).approve(lockerAddress, "300000000");
    await purchaseToken.connect(wallet1).approve(lockerAddress, "300000000");
    await purchaseToken.connect(wallet2).approve(lockerAddress, "300000000");
    await purchaseToken.connect(wallet3).approve(lockerAddress, "300000000");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  /**
   * Helper: Set up a loan position for a borrower.
   * Locks collateral via auction, locks lender offer, fulfills offer + bid.
   */
  async function setupLoanPosition(
    borrower: SignerWithAddress,
    collateral1Amount: string,
    collateral2Amount: string,
    loanAmount: string,
    repurchasePrice: string,
    offerId: string,
  ) {
    if (BigInt(collateral1Amount) > 0n) {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          borrower.address,
          await collateralToken1.getAddress(),
          collateral1Amount,
        );
    }
    if (BigInt(collateral2Amount) > 0n) {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          borrower.address,
          await collateralToken2.getAddress(),
          collateral2Amount,
        );
    }

    await termRepoServicer
      .connect(termAuctionOfferLockerAddress)
      .lockOfferAmount(wallet1.address, wallet1.address, loanAmount);

    await termRepoServicer
      .connect(termAuctionAddress)
      .fulfillOffer(
        wallet1.address,
        loanAmount,
        repurchasePrice,
        getBytesHash(offerId),
      );

    const collateralAddresses: string[] = [];
    const collateralAmounts: string[] = [];
    if (BigInt(collateral1Amount) > 0n) {
      collateralAddresses.push(await collateralToken1.getAddress());
      collateralAmounts.push(collateral1Amount);
    }
    if (BigInt(collateral2Amount) > 0n) {
      collateralAddresses.push(await collateralToken2.getAddress());
      collateralAmounts.push(collateral2Amount);
    }

    await termRepoServicer
      .connect(termAuctionAddress)
      .fulfillBid(
        borrower.address,
        loanAmount,
        repurchasePrice,
        collateralAddresses,
        collateralAmounts,
        "1000000000000000000",
      );
  }

  /**
   * Helper: Create the "stuck collateral" state for a borrower.
   * Sets up a loan, blocks a collateral token transfer, then fully repays.
   * After: obligation=0, encumbered=0, locked[blockedToken]>0 (stuck).
   */
  async function createStuckCollateralState(
    borrower: SignerWithAddress,
    collateral1Amount: string,
    collateral2Amount: string,
    loanAmount: string,
    repurchasePrice: string,
    offerId: string,
    blockedToken: TestToken,
  ) {
    await setupLoanPosition(
      borrower,
      collateral1Amount,
      collateral2Amount,
      loanAmount,
      repurchasePrice,
      offerId,
    );

    // Block transfers to borrower on the target token
    await blockedToken.setTransferFailure(borrower.address, true);

    // Full repayment → unlockCollateralOnRepurchase runs
    // Pre-decrements encumbered, then _unlockCollateral(false)
    // Blocked token's unlock fails silently → locked stays > 0
    await termRepoServicer
      .connect(borrower)
      .submitRepurchasePayment(repurchasePrice);

    // Unblock for future operations
    await blockedToken.setTransferFailure(borrower.address, false);
  }

  // =========================================================================
  // Test 1: Variant #1 — Per-token catch-up covers ALL tokens
  // =========================================================================
  describe("Variant #1: Per-token catch-up gap", () => {
    it("journalBidCollateralToCollateralManager catches up ALL tokens on 0->nonzero transition", async function () {
      // Set up Alice with a loan using BOTH collateral tokens
      // CT1: 15M tokens ($30), CT2: 15M tokens ($15) = $45 total
      // Loan: 15M, Repurchase: 20M
      await setupLoanPosition(
        wallet2, "15000000", "15000000", "15000000", "20000000", "offer-1",
      );

      // Verify initial encumbered state
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("15000000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal("15000000");

      // Block CT2 transfers to Alice, then repay to create stuck CT2
      await collateralToken2.setTransferFailure(wallet2.address, true);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("20000000");

      // After repayment:
      // - obligation = 0
      // - encumbered[CT1] = 0, encumbered[CT2] = 0 (both pre-decremented)
      // - locked[CT1] = 0 (unlock succeeded), locked[CT2] = 15M (unlock failed)
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(0);

      const aliceStuckCT2 =
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken2.getAddress(),
        );
      expect(aliceStuckCT2).to.equal("15000000");

      // Unblock CT2
      await collateralToken2.setTransferFailure(wallet2.address, false);

      // New loan for Alice using ONLY CT1
      // journalBidCollateralToCollateralManager should catch up ALL tokens
      await setupLoanPosition(
        wallet2, "10000000", "0", "10000000", "15000000", "offer-2",
      );

      // Verify: encumbered[CT2] includes stuck amount (caught up via _encumberExistingCollateralInternal)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(aliceStuckCT2);

      // encumbered[CT1] = new locked amount only (old was unlocked)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("10000000");
    });
  });

  // =========================================================================
  // Test 2: Variant #2 — Repurchase unlock silent failure keeps encumbered correct
  // =========================================================================
  describe("Variant #2: Repurchase unlock silent failure", () => {
    it("unlockCollateralOnRepurchase pre-decrements encumbered even on transfer failure", async function () {
      // Set up Alice with CT1-only loan
      await setupLoanPosition(
        wallet2, "15000000", "0", "15000000", "20000000", "offer-1",
      );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("15000000");

      // Block CT1 transfers to Alice
      await collateralToken1.setTransferFailure(wallet2.address, true);

      // Alice fully repays
      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("20000000");

      // obligation = 0
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);

      // encumbered correctly decremented to 0 (pre-decrement before _unlockCollateral)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);

      // But collateral is stuck (transfer failed, locked not decremented)
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal("15000000");
    });
  });

  // =========================================================================
  // Test 3: Variant #3 — No double-encumber on rollover after repurchase failure
  // =========================================================================
  describe("Variant #3: No double-encumber via rollover", () => {
    it("encumberExistingCollateral correctly encumbers stuck collateral once", async function () {
      // Create stuck state: obligation=0, locked[CT1]=15M, encumbered=0
      await createStuckCollateralState(
        wallet2, "15000000", "0", "15000000", "20000000", "offer-1",
        collateralToken1,
      );

      const stuckAmount =
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        );
      expect(stuckAmount).to.equal("15000000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);

      // Simulate rollover encumber (called by auction during rollover)
      await termRepoCollateralManager
        .connect(termAuctionAddress)
        .encumberExistingCollateral(wallet2.address);

      // encumbered should equal stuck amount (single-counted, not double)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(stuckAmount);
    });
  });

  // =========================================================================
  // Test 4: Variant #5 — No cascading underflow to other borrowers
  // =========================================================================
  describe("Variant #5: No cascading underflow", () => {
    it("other borrowers not affected when stuck collateral is re-encumbered", async function () {
      // Set up Alice with CT1 loan
      await setupLoanPosition(
        wallet2, "15000000", "0", "15000000", "20000000", "offer-1",
      );

      // Set up Bob with CT1 loan
      await setupLoanPosition(
        wallet3, "15000000", "0", "15000000", "20000000", "offer-2",
      );

      // Both encumbered: 15M + 15M = 30M CT1
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("30000000");

      // Block CT1 transfers to Alice, repay to create stuck state
      await collateralToken1.setTransferFailure(wallet2.address, true);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("20000000");

      // Alice: obligation=0, locked[CT1]=15M (stuck), encumbered decremented
      // encumbered should be Bob's 15M only
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("15000000"); // Bob's share only

      // Unblock transfers, new loan for Alice catches up stuck collateral
      await collateralToken1.setTransferFailure(wallet2.address, false);

      await setupLoanPosition(
        wallet2, "10000000", "0", "10000000", "15000000", "offer-3",
      );

      // Alice's stuck 15M + new 10M = 25M, plus Bob's 15M = 40M total
      const aliceLockedCT1 =
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        );
      expect(aliceLockedCT1).to.equal("25000000"); // 15M stuck + 10M new

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("40000000"); // 25M Alice + 15M Bob

      // Verify Bob's obligation is unaffected
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet3.address),
      ).to.equal("20000000");
    });
  });

  // =========================================================================
  // Test 5: externalUnlockCollateral — recover stuck collateral
  // =========================================================================
  describe("externalUnlockCollateral: recover stuck collateral", () => {
    it("borrower recovers stuck collateral after repurchase silent failure", async function () {
      // Create stuck state
      await createStuckCollateralState(
        wallet2, "15000000", "0", "15000000", "20000000", "offer-1",
        collateralToken1,
      );

      // State: obligation=0, encumbered=0, locked=15M (stuck but unblocked)
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal("15000000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);

      // Alice recovers stuck collateral via externalUnlockCollateral
      // (obligation=0, so decrementEncumberedCollateral=false → encumbered stays 0)
      await termRepoCollateralManager
        .connect(wallet2)
        .externalUnlockCollateral(
          await collateralToken1.getAddress(),
          "15000000",
        );

      // Collateral fully recovered
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);

      // encumbered stays at 0 (was already 0, not decremented again)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
    });
  });

  // =========================================================================
  // Test 6: _lockCollateral per-token catch-up via new loan
  // =========================================================================
  describe("_lockCollateral per-token catch-up", () => {
    it("new loan catches up stuck collateral for each token independently", async function () {
      // Set up Alice with BOTH collateral tokens
      await setupLoanPosition(
        wallet2, "15000000", "15000000", "15000000", "20000000", "offer-1",
      );

      // Block CT2 transfers, create stuck CT2 via repayment
      await collateralToken2.setTransferFailure(wallet2.address, true);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("20000000");

      // obligation=0, encumbered=0 for both, locked[CT2]=15M (stuck)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(0);

      const stuckCT2 =
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken2.getAddress(),
        );
      expect(stuckCT2).to.equal("15000000");

      // Unblock CT2
      await collateralToken2.setTransferFailure(wallet2.address, false);

      // New loan with ONLY CT2 (not CT1)
      // journalBidCollateralToCollateralManager catches up ALL tokens
      await setupLoanPosition(
        wallet2, "0", "10000000", "10000000", "15000000", "offer-2",
      );

      // encumbered[CT2] = stuck 15M + new 10M = 25M
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal("25000000");

      // encumbered[CT1] = 0 (CT1 was fully unlocked, no stuck balance)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
    });
  });

  // =========================================================================
  // Test 7: batchLiquidation with price crash — encumbered correctly tracked
  // =========================================================================
  describe("batchLiquidation: encumbered accounting with price crash", () => {
    it("partial liquidation correctly decrements encumbered by seizure amount", async function () {
      // Set up Alice with CT1 + CT2
      // CT1: 50M ($100), CT2: 50M ($50). Loan: 80M, Repurchase: 90M ($90)
      await setupLoanPosition(
        wallet2, "50000000", "50000000", "80000000", "90000000", "offer-1",
      );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("50000000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal("50000000");

      // Crash CT1 price: $2 → $0.50 (answer 500)
      // Collateral value: 50*$0.50 + 50*$1 = $25 + $50 = $75
      // Haircut: $75/1.5 = $50 < $90 → shortfall
      await collateral1Feed.setAnswer(500);

      // Partial liquidation: cover 10M obligation ($10) via CT1
      // Seizure: $10 / $0.50 * 1.05 = 21M CT1 tokens, protocol: $10 / $0.50 * 0.05 = 1M
      const liquidator = wallet3;
      await termRepoCollateralManager
        .connect(liquidator)
        .batchLiquidation(wallet2.address, ["10000000", "0"]);

      // obligation reduced by 10M: 90M - 10M = 80M
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("80000000");

      // encumbered[CT1] reduced by seizure amount (21M): 50M - 21M = 29M
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("29000000");

      // locked[CT1] also reduced: 50M - 21M = 29M
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal("29000000");

      // CT2 encumbered unchanged
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal("50000000");
    });

    it("batchLiquidation cleanup pre-decrements encumbered before _unlockCollateral", async function () {
      // Set up Alice with CT1 + CT2
      // CT1: 10M ($20), CT2: 50M ($50). Loan: 15M, Repurchase: 20M
      await setupLoanPosition(
        wallet2, "10000000", "50000000", "15000000", "20000000", "offer-1",
      );

      // Block CT2 transfers to Alice
      await collateralToken2.setTransferFailure(wallet2.address, true);

      // Crash CT1 price: $2 → $0.50
      // Collateral value: 10*$0.50 + 50*$1 = $5 + $50 = $55
      // Haircut: $55/1.5 = $36.67 > $20 → NOT in shortfall
      // Need haircut < obligation($20). Crash CT2 too: $1 → $0.20
      // Collateral: 10*$0.50 + 50*$0.20 = $5 + $10 = $15
      // Haircut: $15/1.5 = $10 < $20 → shortfall ✓
      // Full liquidation: $15 < $20 + $0.20 ✓
      await collateral1Feed.setAnswer(500);
      await collateral2Feed.setAnswer(200);

      // Liquidate via CT1: cover as much as seizure allows
      // CT1 seizure for $X: X / $0.50 * 1.05 must be <= 10M → X <= 10M * 0.50 / 1.05 ≈ 4.76M
      // Liquidate 4M via CT1: seizure = 4M / 0.50 * 1.05 = 8.4M (< 10M ✓)
      // Liquidate remainder (16M) via CT2: seizure = 16M / 0.20 * 1.05 = 84M (> 50M ✗)
      // Need less via CT2. Liquidate 9M via CT2: seizure = 9M / 0.20 * 1.05 = 47.25M (< 50M ✓)
      // Total: 4M + 9M = 13M. Remaining: 20M - 13M = 7M.
      await termRepoCollateralManager
        .connect(wallet3)
        .batchLiquidation(wallet2.address, ["4000000", "9000000"]);

      // obligation = 20M - 13M = 7M
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("7000000");

      // Restore prices and repay remaining to bring obligation to 0
      await collateral1Feed.setAnswer(2000);
      await collateral2Feed.setAnswer(1000);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("7000000");

      // obligation = 0 → unlockCollateralOnRepurchase runs
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);

      // encumbered should be 0 for both (pre-decremented before unlock)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(0);

      // CT1 should be unlocked (transfer was not blocked)
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);

      // CT2 is stuck (transfer was blocked)
      const stuckCT2 = await termRepoCollateralManager.getCollateralBalance(
        wallet2.address,
        await collateralToken2.getAddress(),
      );
      expect(stuckCT2).to.be.gt(0);

      // Now unblock CT2 and verify catch-up works on new loan
      await collateralToken2.setTransferFailure(wallet2.address, false);

      await setupLoanPosition(
        wallet2, "10000000", "0", "10000000", "15000000", "offer-2",
      );

      // encumbered[CT2] should include stuck amount (caught up)
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(stuckCT2);

      // encumbered[CT1] = new 10M
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("10000000");
    });
  });

  // =========================================================================
  // Test 9: Variant #1 via batchLiquidation — partial liquidation + repay
  // =========================================================================
  describe("Variant #1 via batchLiquidation: catch-up after partial liquidation + repay", () => {
    it("partial batchLiquidation then repay creates stuck CT2; new loan catches up ALL tokens", async function () {
      // CT1: 50M ($100), CT2: 50M ($50). Loan: 80M, Repurchase: 90M ($90)
      await setupLoanPosition(
        wallet2, "50000000", "50000000", "80000000", "90000000", "offer-liq-1",
      );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("50000000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal("50000000");

      // Block CT2 transfers TO Alice (seizure goes to liquidator, unaffected)
      await collateralToken2.setTransferFailure(wallet2.address, true);

      // Crash CT1 price: $2 → $0.50
      // Collateral: 50*$0.50 + 50*$1 = $25 + $50 = $75
      // Haircut: $75/1.5 = $50 < $90 → shortfall ✓
      await collateral1Feed.setAnswer(500);

      // Partial liquidation: cover 10M via CT1 only
      // CT1 seizure = 10M / $0.50 * 1.05 = 21M tokens
      await termRepoCollateralManager
        .connect(wallet3)
        .batchLiquidation(wallet2.address, ["10000000", "0"]);

      // obligation = 90M - 10M = 80M
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("80000000");

      // Restore prices and repay remaining to bring obligation to 0
      await collateral1Feed.setAnswer(2000);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("80000000");

      // obligation = 0 → unlockCollateralOnRepurchase runs
      // pre-decrements encumbered, then _unlockCollateral(false)
      // CT2 unlock fails → stuck
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(0);

      // CT1 unlocked, CT2 stuck
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      const stuckCT2 = await termRepoCollateralManager.getCollateralBalance(
        wallet2.address,
        await collateralToken2.getAddress(),
      );
      expect(stuckCT2).to.equal("50000000");

      // Unblock CT2 and open new loan with CT1 only
      await collateralToken2.setTransferFailure(wallet2.address, false);

      await setupLoanPosition(
        wallet2, "10000000", "0", "10000000", "15000000", "offer-liq-2",
      );

      // Verify catch-up: encumbered[CT2] includes stuck amount
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(stuckCT2);

      // encumbered[CT1] = new locked amount
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("10000000");
    });
  });

  // =========================================================================
  // Test 10: Variant #1 via batchLiquidationWithRepoToken — partial liquidation + repay
  // =========================================================================
  describe("Variant #1 via batchLiquidationWithRepoToken: catch-up after partial liquidation + repay", () => {
    it("partial batchLiquidationWithRepoToken then repay creates stuck CT2; new loan catches up ALL tokens", async function () {
      // Same setup: CT1: 50M ($100), CT2: 50M ($50). Loan: 80M, Repurchase: 90M ($90)
      await setupLoanPosition(
        wallet2, "50000000", "50000000", "80000000", "90000000", "offer-repo-1",
      );

      // wallet1 (lender) received 90M repo tokens from fulfillOffer
      // (redemptionValue = 1e18, so 1:1 with purchase token value)
      expect(
        await testTermRepoToken.balanceOf(wallet1.address),
      ).to.equal("90000000");

      // Block CT2 transfers TO Alice
      await collateralToken2.setTransferFailure(wallet2.address, true);

      // Crash CT1 price: $2 → $0.50
      await collateral1Feed.setAnswer(500);

      // wallet1 liquidates using repo tokens: cover 10M via CT1
      // burnValue = 10M (redemptionValue = 1e18), same seizure: 21M CT1 tokens
      await termRepoCollateralManager
        .connect(wallet1)
        .batchLiquidationWithRepoToken(wallet2.address, ["10000000", "0"]);

      // obligation = 90M - 10M = 80M
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("80000000");

      // wallet1 repo tokens: 90M - 10M = 80M remaining
      expect(
        await testTermRepoToken.balanceOf(wallet1.address),
      ).to.equal("80000000");

      // Restore prices and repay remaining
      await collateral1Feed.setAnswer(2000);

      await termRepoServicer
        .connect(wallet2)
        .submitRepurchasePayment("80000000");

      // obligation = 0 → unlockCollateralOnRepurchase → CT2 stuck
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(0);

      // CT1 unlocked, CT2 stuck
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await collateralToken1.getAddress(),
        ),
      ).to.equal(0);
      const stuckCT2 = await termRepoCollateralManager.getCollateralBalance(
        wallet2.address,
        await collateralToken2.getAddress(),
      );
      expect(stuckCT2).to.equal("50000000");

      // Unblock CT2 and open new loan with CT1 only
      await collateralToken2.setTransferFailure(wallet2.address, false);

      await setupLoanPosition(
        wallet2, "10000000", "0", "10000000", "15000000", "offer-repo-2",
      );

      // Verify catch-up: encumbered[CT2] includes stuck amount
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken2.getAddress(),
        ),
      ).to.equal(stuckCT2);

      // encumbered[CT1] = new locked amount
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await collateralToken1.getAddress(),
        ),
      ).to.equal("10000000");
    });
  });
});
