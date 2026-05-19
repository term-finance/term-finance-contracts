/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  ITermController,
  ITermController__factory,
  TermRepoDeployerFactory,
  TermRepoDeployerFactory__factory,
  TestPriceFeed,
  TestRevertContract,
  TestTermEventEmitter,
  TestTermPriceConsumerV3,
  TestToken,
} from "../typechain-types";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

describe("TermRepoDeployerFactory Tests", () => {
  let adminWallet: SignerWithAddress;
  let devopsWallet: SignerWithAddress;
  let termDelisterWallet: SignerWithAddress;
  let termInitializerWallet: SignerWithAddress;
  let wallet1: SignerWithAddress;
  let termDiamond: SignerWithAddress;

  let purchaseToken: TestToken;
  let collateralToken: TestToken;
  let collateral2Token: TestToken;
  let highDecimalsToken: TestToken;
  let unregisteredToken: TestToken;
  let revertContract: TestRevertContract; // contract with no decimals() — causes revert in catch path

  let priceFeedPurchase: TestPriceFeed;
  let priceFeedCollateral: TestPriceFeed;
  let priceFeedCollateral2: TestPriceFeed;

  let oracle: TestTermPriceConsumerV3;
  let emitter: TestTermEventEmitter;
  let mockController: MockContract<ITermController>;

  let servicerImpl: string;
  let collateralManagerImpl: string;
  let lockerImpl: string;
  let tokenImpl: string;
  let rolloverManagerImpl: string;

  let auctionImpl: string;
  let bidLockerImpl: string;
  let offerLockerImpl: string;

  let factory: TermRepoDeployerFactory;
  let snapshotId: any;

  before(async () => {
    [adminWallet, devopsWallet, termDelisterWallet, termInitializerWallet, wallet1, termDiamond] =
      await ethers.getSigners();

    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const blockTimestamp = block!.timestamp;

    // ── Tokens ────────────────────────────────────────────────────────────────
    const TestTokenFactory = await ethers.getContractFactory("TestToken");

    purchaseToken = (await TestTokenFactory.deploy()) as unknown as TestToken;
    await purchaseToken.waitForDeployment();
    await purchaseToken.initialize("USD Coin", "USDC", 6, [], []);

    collateralToken = (await TestTokenFactory.deploy()) as unknown as TestToken;
    await collateralToken.waitForDeployment();
    await collateralToken.initialize("Wrapped Bitcoin", "WBTC", 8, [], []);

    collateral2Token = (await TestTokenFactory.deploy()) as unknown as TestToken;
    await collateral2Token.waitForDeployment();
    await collateral2Token.initialize("Wrapped Ether", "WETH", 18, [], []);

    highDecimalsToken = (await TestTokenFactory.deploy()) as unknown as TestToken;
    await highDecimalsToken.waitForDeployment();
    await highDecimalsToken.initialize("HighDec", "HD", 19, [], []);

    unregisteredToken = (await TestTokenFactory.deploy()) as unknown as TestToken;
    await unregisteredToken.waitForDeployment();
    await unregisteredToken.initialize("Unregistered", "UNREG", 6, [], []);

    // Contract with no decimals() function — calling decimals() reverts (no fallback)
    const RevertContractFactory = await ethers.getContractFactory("TestRevertContract");
    revertContract = (await RevertContractFactory.deploy()) as unknown as TestRevertContract;
    await revertContract.waitForDeployment();

    // ── Price Feeds ───────────────────────────────────────────────────────────
    const TestPriceFeedFactory = await ethers.getContractFactory("TestPriceFeed");

    priceFeedPurchase = (await TestPriceFeedFactory.deploy(
      8, "USDC/USD", 1, 1, 100000000n, 0, blockTimestamp, 1,
    )) as unknown as TestPriceFeed;
    await priceFeedPurchase.waitForDeployment();

    priceFeedCollateral = (await TestPriceFeedFactory.deploy(
      8, "WBTC/USD", 1, 1, 3000000000000n, 0, blockTimestamp, 1,
    )) as unknown as TestPriceFeed;
    await priceFeedCollateral.waitForDeployment();

    priceFeedCollateral2 = (await TestPriceFeedFactory.deploy(
      8, "ETH/USD", 1, 1, 200000000000n, 0, blockTimestamp, 1,
    )) as unknown as TestPriceFeed;
    await priceFeedCollateral2.waitForDeployment();

    // ── Oracle ────────────────────────────────────────────────────────────────
    const OracleFactory = await ethers.getContractFactory("TestTermPriceConsumerV3");
    oracle = (await upgrades.deployProxy(OracleFactory, [devopsWallet.address], {
      kind: "uups",
    })) as unknown as TestTermPriceConsumerV3;

    // refreshRateThreshold = 0 bypasses staleness check (threshold == 0 always returns primary)
    await oracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(await purchaseToken.getAddress(), await priceFeedPurchase.getAddress(), 0);
    await oracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(await collateralToken.getAddress(), await priceFeedCollateral.getAddress(), 0);
    await oracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(await collateral2Token.getAddress(), await priceFeedCollateral2.getAddress(), 0);

    // ── Event Emitter ─────────────────────────────────────────────────────────
    const EmitterFactory = await ethers.getContractFactory("TestTermEventEmitter");
    emitter = (await upgrades.deployProxy(
      EmitterFactory,
      [devopsWallet.address, termDelisterWallet.address, termInitializerWallet.address, adminWallet.address, termDiamond.address],
      { kind: "uups" },
    )) as unknown as TestTermEventEmitter;

    // ── Mock Controller (wildcard write stub for markTermFactoryDeployed) ─────
    mockController = await deployMock<ITermController>(ITermController__factory.abi, wallet1);
    const iface = ITermController__factory.createInterface();
    await mockController.setup({
      abi: iface.getFunction("markTermFactoryDeployed"),
      kind: "write",
      inputs: undefined,
    });

    // ── Real Implementations (bare deploy, no init) ───────────────────────────
    const ServicerFactory = await ethers.getContractFactory("TermRepoServicer");
    const servicer = await ServicerFactory.deploy();
    await servicer.waitForDeployment();
    servicerImpl = await servicer.getAddress();

    const CollateralManagerFactory = await ethers.getContractFactory("TermRepoCollateralManager");
    const collateralManager = await CollateralManagerFactory.deploy();
    await collateralManager.waitForDeployment();
    collateralManagerImpl = await collateralManager.getAddress();

    const LockerFactory = await ethers.getContractFactory("TermRepoLocker");
    const locker = await LockerFactory.deploy();
    await locker.waitForDeployment();
    lockerImpl = await locker.getAddress();

    const TokenFactory = await ethers.getContractFactory("TermRepoToken");
    const token = await TokenFactory.deploy();
    await token.waitForDeployment();
    tokenImpl = await token.getAddress();

    const RolloverManagerFactory = await ethers.getContractFactory("TermRepoRolloverManager");
    const rolloverManager = await RolloverManagerFactory.deploy();
    await rolloverManager.waitForDeployment();
    rolloverManagerImpl = await rolloverManager.getAddress();

    // ── Auction Implementations ───────────────────────────────────────────────
    const AuctionFactory = await ethers.getContractFactory("TermAuction");
    const auctionContract = await AuctionFactory.deploy();
    await auctionContract.waitForDeployment();
    auctionImpl = await auctionContract.getAddress();

    const BidLockerFactory = await ethers.getContractFactory("TermAuctionBidLocker");
    const bidLockerContract = await BidLockerFactory.deploy();
    await bidLockerContract.waitForDeployment();
    bidLockerImpl = await bidLockerContract.getAddress();

    const OfferLockerFactory = await ethers.getContractFactory("TermAuctionOfferLocker");
    const offerLockerContract = await OfferLockerFactory.deploy();
    await offerLockerContract.waitForDeployment();
    offerLockerImpl = await offerLockerContract.getAddress();

    // ── Additional mock stubs for auction flow ────────────────────────────────
    // isFactoryDeployed: wildcard read → true (overridden per-test when false is needed)
    await mockController.setup({
      abi: iface.getFunction("isFactoryDeployed"),
      kind: "read",
      inputs: undefined,
      outputs: [true],
    });
    // pairAuction: wildcard write stub
    await mockController.setup({
      abi: iface.getFunction("pairAuction"),
      kind: "write",
      inputs: undefined,
    });
    // registeredRepoIds: wildcard read → false (repo ID not yet registered)
    await mockController.setup({
      abi: iface.getFunction("registeredRepoIds"),
      kind: "read",
      inputs: undefined,
      outputs: [false],
    });
    // registerRepoId: wildcard write stub
    await mockController.setup({
      abi: iface.getFunction("registerRepoId"),
      kind: "write",
      inputs: undefined,
    });
    // registerAuctionId: wildcard write stub
    await mockController.setup({
      abi: iface.getFunction("registerAuctionId"),
      kind: "write",
      inputs: undefined,
    });
    // registeredAuctionIds: wildcard read → false (auction ID not yet registered)
    await mockController.setup({
      abi: iface.getFunction("registeredAuctionIds"),
      kind: "read",
      inputs: undefined,
      outputs: [false],
    });
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);

    const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
    factory = (await FactoryContract.connect(adminWallet).deploy(
      adminWallet.address,
      devopsWallet.address,
      await mockController.getAddress(),
      await emitter.getAddress(),
      await oracle.getAddress(),
      termDiamond.address, // termDiamond (any non-zero address)
    )) as unknown as TermRepoDeployerFactory;
    await factory.waitForDeployment();

    await factory.connect(devopsWallet).setTermRepoImplementations(
      servicerImpl,
      collateralManagerImpl,
      lockerImpl,
      tokenImpl,
      rolloverManagerImpl,
      "v1",
    );

    await factory.connect(devopsWallet).setTermAuctionImplementations(
      auctionImpl,
      bidLockerImpl,
      offerLockerImpl,
      "v1",
    );

    await emitter.connect(adminWallet).pairTermFactory(await factory.getAddress());
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // ── Helper ──────────────────────────────────────────────────────────────────

  async function makeValidAuctionParams(termRepoId: string, overrides?: Record<string, any>): Promise<any> {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const now = block!.timestamp;

    return {
      termRepoId,
      termAuctionId: "term-auction-001",
      auctionStartTime: now + 100,
      revealTime: now + 200,
      auctionEndTime: now + 300,
      termStart: now + 400, // > auctionEndTime, well within THIRTY_DAYS maturity window
      minimumTenderAmount: 1000n,
      clearingPricePostProcessingOffset: 0,
      ...overrides,
    };
  }

  async function makeValidParams(overrides?: Record<string, any>): Promise<any> {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const blockTimestamp = block!.timestamp;

    return {
      termRepoId: "term-repo-001",
      maturityTimestamp: blockTimestamp + THIRTY_DAYS,
      repurchaseWindow: 86400,
      redemptionBuffer: 300,
      purchaseToken: await purchaseToken.getAddress(),
      servicingFee: 0,
      netExposureCapOnLiquidation: 5n * 10n ** 16n,   // 5e16 > 1e16 boundary
      liquidatedDamagesDueToProtocol: 1n * 10n ** 16n, // 1e16
      collateralTokens: [
        {
          tokenAddress: await collateralToken.getAddress(),
          initialCollateralRatio: 15n * 10n ** 17n, // 1.5e18
          maintenanceRatio: 125n * 10n ** 16n,       // 1.25e18
          liquidatedDamage: 5n * 10n ** 16n,         // 5e16 > 1e16 ✓
        },
        {
          tokenAddress: await collateral2Token.getAddress(),
          initialCollateralRatio: 15n * 10n ** 17n,
          maintenanceRatio: 125n * 10n ** 16n,
          liquidatedDamage: 5n * 10n ** 16n,
        },
      ],
      tokenName: "Term Repo Token",
      tokenSymbol: "TRT",
      mintExposureCap: 1n * 10n ** 24n,
      ...overrides,
    };
  }

  // ============================================================================
  // = Constructor ==============================================================
  // ============================================================================

  describe("Constructor", () => {
    it("reverts ZeroAddress when admin = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          ethers.ZeroAddress,
          devopsWallet.address,
          await mockController.getAddress(),
          await emitter.getAddress(),
          await oracle.getAddress(),
          wallet1.address,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("reverts ZeroAddress when devops = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          adminWallet.address,
          ethers.ZeroAddress,
          await mockController.getAddress(),
          await emitter.getAddress(),
          await oracle.getAddress(),
          wallet1.address,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("reverts ZeroAddress when controller = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          adminWallet.address,
          devopsWallet.address,
          ethers.ZeroAddress,
          await emitter.getAddress(),
          await oracle.getAddress(),
          wallet1.address,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("reverts ZeroAddress when emitter = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          adminWallet.address,
          devopsWallet.address,
          await mockController.getAddress(),
          ethers.ZeroAddress,
          await oracle.getAddress(),
          wallet1.address,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("reverts ZeroAddress when priceOracle = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          adminWallet.address,
          devopsWallet.address,
          await mockController.getAddress(),
          await emitter.getAddress(),
          ethers.ZeroAddress,
          wallet1.address,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("reverts ZeroAddress when termDiamond = address(0)", async () => {
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      await expect(
        FactoryContract.deploy(
          adminWallet.address,
          devopsWallet.address,
          await mockController.getAddress(),
          await emitter.getAddress(),
          await oracle.getAddress(),
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(
        { interface: TermRepoDeployerFactory__factory.createInterface() },
        "ZeroAddress",
      );
    });

    it("success — stores all constructor params correctly", async () => {
      expect(await factory.admin()).to.equal(adminWallet.address);
      expect(await factory.devops()).to.equal(devopsWallet.address);
      expect(await factory.termDiamond()).to.equal(termDiamond.address);
      expect(await factory.controller()).to.equal(await mockController.getAddress());
      expect(await factory.emitter()).to.equal(await emitter.getAddress());
      expect(await factory.priceOracle()).to.equal(await oracle.getAddress());
    });
  });

  // ============================================================================
  // = setImplementations =======================================================
  // ============================================================================

  describe("setImplementations", () => {
    it("reverts ZeroAddress when servicerImpl = address(0)", async () => {
      await expect(
        factory.connect(devopsWallet).setTermRepoImplementations(
          ethers.ZeroAddress,
          collateralManagerImpl,
          lockerImpl,
          tokenImpl,
          rolloverManagerImpl,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts NoTermVersion when termVersion = ''", async () => {
      await expect(
        factory.connect(devopsWallet).setTermRepoImplementations(
          servicerImpl,
          collateralManagerImpl,
          lockerImpl,
          tokenImpl,
          rolloverManagerImpl,
          "",
        ),
      ).to.be.revertedWithCustomError(factory, "NoTermVersion");
    });

    it("success — stores all 5 impls and emits ImplementationsUpdated", async () => {
      // beforeEach already called setImplementations("v1"); call again with new version
      await expect(
        factory.connect(devopsWallet).setTermRepoImplementations(
          servicerImpl,
          collateralManagerImpl,
          lockerImpl,
          tokenImpl,
          rolloverManagerImpl,
          "v2",
        ),
      )
        .to.emit(factory, "RepoImplementationsUpdated")
        .withArgs(servicerImpl, collateralManagerImpl, lockerImpl, tokenImpl, rolloverManagerImpl);

      expect(await factory.termRepoServicerImpl()).to.equal(servicerImpl);
      expect(await factory.termRepoCollateralManagerImpl()).to.equal(collateralManagerImpl);
      expect(await factory.termRepoLockerImpl()).to.equal(lockerImpl);
      expect(await factory.termRepoTokenImpl()).to.equal(tokenImpl);
      expect(await factory.termRepoRolloverManagerImpl()).to.equal(rolloverManagerImpl);
      expect(await factory.termVersion()).to.equal("v2");
    });

    it("reverts when caller does not have DEVOPS_ROLE", async () => {
      await expect(
        factory.connect(wallet1).setTermRepoImplementations(
          servicerImpl,
          collateralManagerImpl,
          lockerImpl,
          tokenImpl,
          rolloverManagerImpl,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
    });
  });

  // ============================================================================
  // = setProtocolContracts =====================================================
  // ============================================================================

  describe("setProtocolContracts", () => {
    it("success — updates controller, emitter, priceOracle", async () => {
      const newAddr = devopsWallet.address; // use any non-zero address
      await factory
        .connect(devopsWallet)
        .setProtocolContracts(newAddr as any, newAddr as any, newAddr as any);

      expect(await factory.controller()).to.equal(newAddr);
      expect(await factory.emitter()).to.equal(newAddr);
      expect(await factory.priceOracle()).to.equal(newAddr);
    });

    it("reverts when caller does not have DEVOPS_ROLE", async () => {
      await expect(
        factory
          .connect(wallet1)
          .setProtocolContracts(
            await mockController.getAddress() as any,
            await emitter.getAddress() as any,
            await oracle.getAddress() as any,
          ),
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
    });
  });

  // ============================================================================
  // = pauseDeploying / unpauseDeploying ========================================
  // ============================================================================

  describe("pauseDeploying", () => {
    it("success — sets deployingPaused = true", async () => {
      await factory.connect(adminWallet).pauseDeploying();
      expect(await factory.deployingPaused()).to.be.true;
    });

    it("reverts when caller does not have ADMIN_ROLE", async () => {
      await expect(factory.connect(wallet1).pauseDeploying()).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("unpauseDeploying", () => {
    it("success — sets deployingPaused = false after pausing", async () => {
      await factory.connect(adminWallet).pauseDeploying();
      expect(await factory.deployingPaused()).to.be.true;
      await factory.connect(adminWallet).unpauseDeploying();
      expect(await factory.deployingPaused()).to.be.false;
    });

    it("reverts when caller does not have ADMIN_ROLE", async () => {
      await expect(factory.connect(wallet1).unpauseDeploying()).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ============================================================================
  // = deployTermRepo — validation reverts =====================================
  // ============================================================================

  describe("deployTermRepo — validation", () => {
    it("reverts DeployingPaused when paused", async () => {
      await factory.connect(adminWallet).pauseDeploying();
      const params = await makeValidParams();
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "DeployingPaused",
      );
    });

    it("reverts EmptyTermRepoId when termRepoId = ''", async () => {
      const params = await makeValidParams({ termRepoId: "" });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "EmptyTermRepoId",
      );
    });

    it("reverts MaturityTimestampInPast when maturityTimestamp <= block.timestamp", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const params = await makeValidParams({ maturityTimestamp: block!.timestamp });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "MaturityTimestampInPast",
      );
    });

    it("reverts ZeroRepurchaseWindow when repurchaseWindow = 0", async () => {
      const params = await makeValidParams({ repurchaseWindow: 0 });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "ZeroRepurchaseWindow",
      );
    });

    it("reverts ZeroMintExposureCap when mintExposureCap = 0", async () => {
      const params = await makeValidParams({ mintExposureCap: 0 });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "ZeroMintExposureCap",
      );
    });

    it("reverts InvalidNetExposureCapOnLiquidation when netExposureCapOnLiquidation = 1e16 (boundary)", async () => {
      const params = await makeValidParams({ netExposureCapOnLiquidation: 1n * 10n ** 16n });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidNetExposureCapOnLiquidation",
      );
    });

    it("reverts TokenZeroAddress when purchaseToken = address(0)", async () => {
      const params = await makeValidParams({ purchaseToken: ethers.ZeroAddress });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "TokenZeroAddress",
      );
    });

    it("reverts InvalidTokenDecimals (catch path) when purchaseToken has no decimals() function", async () => {
      // revertContract has no decimals() and no fallback — external call reverts → catch fires → InvalidTokenDecimals
      const params = await makeValidParams({ purchaseToken: await revertContract.getAddress() });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidTokenDecimals",
      );
    });

    it("reverts InvalidTokenDecimals (>18 path) when purchaseToken has 19 decimals", async () => {
      // highDecimalsToken.decimals() returns 19 > 18 → InvalidTokenDecimals
      const params = await makeValidParams({ purchaseToken: await highDecimalsToken.getAddress() });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidTokenDecimals",
      );
    });

    it("reverts TokenNotSupportedByOracle when purchaseToken not registered", async () => {
      // unregisteredToken has valid decimals (6) but is not in the oracle
      const params = await makeValidParams({ purchaseToken: await unregisteredToken.getAddress() });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "TokenNotSupportedByOracle",
      );
    });

    it("reverts NoCollateralTokens when collateralTokens = []", async () => {
      const params = await makeValidParams({ collateralTokens: [] });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "NoCollateralTokens",
      );
    });

    it("reverts DuplicateCollateralToken when two collaterals share the same address", async () => {
      const addr = await collateralToken.getAddress();
      const params = await makeValidParams({
        collateralTokens: [
          {
            tokenAddress: addr,
            initialCollateralRatio: 15n * 10n ** 17n,
            maintenanceRatio: 125n * 10n ** 16n,
            liquidatedDamage: 5n * 10n ** 16n,
          },
          {
            tokenAddress: addr, // duplicate
            initialCollateralRatio: 15n * 10n ** 17n,
            maintenanceRatio: 125n * 10n ** 16n,
            liquidatedDamage: 5n * 10n ** 16n,
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "DuplicateCollateralToken",
      );
    });

    it("reverts InvalidMaintenanceRatio when maintenanceRatio = 0", async () => {
      const params = await makeValidParams({
        collateralTokens: [
          {
            tokenAddress: await collateralToken.getAddress(),
            initialCollateralRatio: 15n * 10n ** 17n,
            maintenanceRatio: 0n,
            liquidatedDamage: 5n * 10n ** 16n,
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidMaintenanceRatio",
      );
    });

    it("reverts InvalidInitialCollateralRatio when initialCollateralRatio = 0", async () => {
      const params = await makeValidParams({
        collateralTokens: [
          {
            tokenAddress: await collateralToken.getAddress(),
            initialCollateralRatio: 0n,
            maintenanceRatio: 125n * 10n ** 16n,
            liquidatedDamage: 5n * 10n ** 16n,
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidInitialCollateralRatio",
      );
    });

    it("reverts InitialRatioBelowMaintenance when initialCollateralRatio < maintenanceRatio", async () => {
      const params = await makeValidParams({
        collateralTokens: [
          {
            tokenAddress: await collateralToken.getAddress(),
            initialCollateralRatio: 1n * 10n ** 17n,   // 0.1e18 < 1.25e18
            maintenanceRatio: 125n * 10n ** 16n,         // 1.25e18
            liquidatedDamage: 5n * 10n ** 16n,
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InitialRatioBelowMaintenance",
      );
    });

    it("reverts InvalidLiquidatedDamage when liquidatedDamage = 0", async () => {
      const params = await makeValidParams({
        collateralTokens: [
          {
            tokenAddress: await collateralToken.getAddress(),
            initialCollateralRatio: 15n * 10n ** 17n,
            maintenanceRatio: 125n * 10n ** 16n,
            liquidatedDamage: 0n,
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidLiquidatedDamage",
      );
    });

    it("reverts InvalidLiquidatedDamageDueToProtocol when liquidatedDamage <= liquidatedDamagesDueToProtocol", async () => {
      // Equal case: liquidatedDamage == liquidatedDamagesDueToProtocol
      const params = await makeValidParams({
        liquidatedDamagesDueToProtocol: 5n * 10n ** 16n,
        collateralTokens: [
          {
            tokenAddress: await collateralToken.getAddress(),
            initialCollateralRatio: 15n * 10n ** 17n,
            maintenanceRatio: 125n * 10n ** 16n,
            liquidatedDamage: 5n * 10n ** 16n, // equal to liquidatedDamagesDueToProtocol
          },
        ],
      });
      await expect(factory.connect(wallet1).deployTermRepo(params)).to.be.revertedWithCustomError(
        factory,
        "InvalidLiquidatedDamageDueToProtocol",
      );
    });
  });

  // ============================================================================
  // = deployTermRepo — success + _deployProxy zero-address ===================
  // ============================================================================

  describe("deployTermRepo — success", () => {
    it("deploys all 5 contracts, emits TermRepoDeployed, returns non-zero addresses", async () => {
      const params = await makeValidParams();

      const tx = factory.connect(wallet1).deployTermRepo(params);

      // Emits TermRepoDeployed with correct termRepoId and msg.sender
      // The servicer stores termRepoId as keccak256(abi.encodePacked(termRepoId_)) (TermRepoServicer.sol:147)
      // and the factory emits that bytes32 value (TermRepoDeployerFactory.sol:269).
      const expectedTermRepoId = ethers.solidityPackedKeccak256(["string"], [params.termRepoId]);
      await expect(tx)
        .to.emit(factory, "TermRepoDeployed")
        .withArgs(
          expectedTermRepoId,
          // addresses are unknown in advance; use anyValue for the 5 deployed addrs
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          wallet1.address,
          true,
          params.termRepoId,
        );

      // Verify returned struct has non-zero addresses
      const result = await (await factory.connect(wallet1).deployTermRepo(params).catch(() => null),
        factory.connect(wallet1).deployTermRepo.staticCall(params));
      expect(result.termRepoServicer).to.not.equal(ethers.ZeroAddress);
      expect(result.termRepoCollateralManager).to.not.equal(ethers.ZeroAddress);
      expect(result.termRepoLocker).to.not.equal(ethers.ZeroAddress);
      expect(result.termRepoToken).to.not.equal(ethers.ZeroAddress);
      expect(result.rolloverManager).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("_deployProxy — ZeroAddress revert when no implementations set", () => {
    it("reverts ZeroAddress when deployTermRepo called before setImplementations", async () => {
      // Deploy a fresh factory WITHOUT calling setImplementations
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      const bareFactory = (await FactoryContract.connect(adminWallet).deploy(
        adminWallet.address,
        devopsWallet.address,
        await mockController.getAddress(),
        await emitter.getAddress(),
        await oracle.getAddress(),
        wallet1.address,
      )) as unknown as TermRepoDeployerFactory;
      await bareFactory.waitForDeployment();

      // Grant bareFactory INITIALIZER_ROLE on emitter so pairTermContract calls succeed
      await emitter.connect(adminWallet).pairTermFactory(await bareFactory.getAddress());

      const params = await makeValidParams();
      await expect(
        bareFactory.connect(wallet1).deployTermRepo(params),
      ).to.be.revertedWithCustomError(bareFactory, "ZeroAddress");
    });
  });

  // ============================================================================
  // = setTermAuctionImplementations ============================================
  // ============================================================================

  describe("setTermAuctionImplementations", () => {
    it("reverts ZeroAddress when termAuctionImpl = address(0)", async () => {
      await expect(
        factory.connect(devopsWallet).setTermAuctionImplementations(
          ethers.ZeroAddress,
          bidLockerImpl,
          offerLockerImpl,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts ZeroAddress when termAuctionBidLockerImpl = address(0)", async () => {
      await expect(
        factory.connect(devopsWallet).setTermAuctionImplementations(
          auctionImpl,
          ethers.ZeroAddress,
          offerLockerImpl,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts ZeroAddress when termAuctionOfferLockerImpl = address(0)", async () => {
      await expect(
        factory.connect(devopsWallet).setTermAuctionImplementations(
          auctionImpl,
          bidLockerImpl,
          ethers.ZeroAddress,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts NoAuctionVersion when auctionVersion = ''", async () => {
      await expect(
        factory.connect(devopsWallet).setTermAuctionImplementations(
          auctionImpl,
          bidLockerImpl,
          offerLockerImpl,
          "",
        ),
      ).to.be.revertedWithCustomError(factory, "NoAuctionVersion");
    });

    it("success — stores all 3 impls and emits AuctionImplementationsUpdated", async () => {
      await expect(
        factory.connect(devopsWallet).setTermAuctionImplementations(
          auctionImpl,
          bidLockerImpl,
          offerLockerImpl,
          "v2",
        ),
      )
        .to.emit(factory, "AuctionImplementationsUpdated")
        .withArgs(auctionImpl, bidLockerImpl, offerLockerImpl);

      expect(await factory.termAuctionImpl()).to.equal(auctionImpl);
      expect(await factory.termAuctionBidLockerImpl()).to.equal(bidLockerImpl);
      expect(await factory.termAuctionOfferLockerImpl()).to.equal(offerLockerImpl);
      expect(await factory.auctionVersion()).to.equal("v2");
    });

    it("reverts when caller does not have DEVOPS_ROLE", async () => {
      await expect(
        factory.connect(wallet1).setTermAuctionImplementations(
          auctionImpl,
          bidLockerImpl,
          offerLockerImpl,
          "v1",
        ),
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
    });
  });

  // ============================================================================
  // = pauseAuctionDeploys / unpauseAuctionDeploys ==============================
  // ============================================================================

  describe("pauseAuctionDeploys", () => {
    it("success — sets deployingAuctionsPaused = true", async () => {
      await factory.connect(adminWallet).pauseAuctionDeploys();
      expect(await factory.deployingAuctionsPaused()).to.be.true;
    });

    it("reverts when caller does not have ADMIN_ROLE", async () => {
      await expect(factory.connect(wallet1).pauseAuctionDeploys()).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("unpauseAuctionDeploys", () => {
    it("success — sets deployingAuctionsPaused = false after pausing", async () => {
      await factory.connect(adminWallet).pauseAuctionDeploys();
      expect(await factory.deployingAuctionsPaused()).to.be.true;
      await factory.connect(adminWallet).unpauseAuctionDeploys();
      expect(await factory.deployingAuctionsPaused()).to.be.false;
    });

    it("reverts when caller does not have ADMIN_ROLE", async () => {
      await expect(factory.connect(wallet1).unpauseAuctionDeploys()).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ============================================================================
  // = deployAuctionAndReopenTerm — validation ==================================
  // ============================================================================

  describe("deployAuctionAndReopenTerm — validation", () => {
    const REPO_TERM_REPO_ID = "term-repo-001";
    let deployedServicerAddr: string;
    let repoMaturityTimestamp: number;

    beforeEach(async () => {
      const repoParams = await makeValidParams();
      repoMaturityTimestamp = repoParams.maturityTimestamp;
      const staticResult = await factory.connect(wallet1).deployTermRepo.staticCall(repoParams);
      await factory.connect(wallet1).deployTermRepo(repoParams);
      deployedServicerAddr = staticResult.termRepoServicer;
    });

    it("reverts DeployingPaused when deployingPaused = true", async () => {
      await factory.connect(adminWallet).pauseDeploying();
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID);
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "DeployingPaused");
    });

    it("reverts DeployingAuctionsPaused when deployingAuctionsPaused = true", async () => {
      await factory.connect(adminWallet).pauseAuctionDeploys();
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID);
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "DeployingAuctionsPaused");
    });

    it("reverts NotFactoryDeployed when servicer is not factory-deployed", async () => {
      // Set up specific mock for this servicer address to return false
      const iface = ITermController__factory.createInterface();
      await mockController.setup({
        abi: iface.getFunction("isFactoryDeployed"),
        kind: "read",
        inputs: [deployedServicerAddr],
        outputs: [false],
      });
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID);
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "NotFactoryDeployed");
    });

    it("reverts TermPastMaturity when servicer maturity has passed", async () => {
      await ethers.provider.send("evm_increaseTime", [THIRTY_DAYS + 1]);
      await ethers.provider.send("evm_mine", []);
      // Pass any params — the maturity check fires before param validation
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID);
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "TermPastMaturity");
    });

    it("reverts EmptyTermRepoId when termRepoId = ''", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, { termRepoId: "" });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "EmptyTermRepoId");
    });

    it("reverts RepoIdMismatch when termRepoId does not match servicer", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        termRepoId: "wrong-term-repo-id",
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "RepoIdMismatch");
    });

    it("reverts EmptyTermAuctionId when termAuctionId = ''", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, { termAuctionId: "" });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "EmptyTermAuctionId");
    });

    it("reverts InvalidAuctionStartTime when auctionStartTime < block.timestamp", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, { auctionStartTime: 0 });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidAuctionStartTime");
    });

    it("reverts InvalidRevealTime when revealTime <= auctionStartTime (boundary: equal)", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const now = block!.timestamp;
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        auctionStartTime: now + 100,
        revealTime: now + 100, // equal — fails the > check
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidRevealTime");
    });

    it("reverts InvalidAuctionEndTime when auctionEndTime < revealTime", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const now = block!.timestamp;
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        auctionStartTime: now + 100,
        revealTime: now + 200,
        auctionEndTime: now + 199, // less than revealTime
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidAuctionEndTime");
    });

    it("reverts InvalidTermStartTime when termStart < auctionEndTime", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const now = block!.timestamp;
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        auctionStartTime: now + 100,
        revealTime: now + 200,
        auctionEndTime: now + 300,
        termStart: now + 299, // less than auctionEndTime
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidTermStartTime");
    });

    it("reverts InvalidTermStartTime when termStart >= servicer maturityTimestamp (boundary: equal)", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        termStart: repoMaturityTimestamp, // equal to maturity — fails the < check
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidTermStartTime");
    });

    it("reverts ZeroMinimumTenderAmount when minimumTenderAmount = 0", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, { minimumTenderAmount: 0 });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "ZeroMinimumTenderAmount");
    });

    it("reverts InvalidClearingPricePostProcessingOffset when offset = 2", async () => {
      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID, {
        clearingPricePostProcessingOffset: 2,
      });
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(factory, "InvalidClearingPricePostProcessingOffset");
    });
  });

  // ============================================================================
  // = deployAuctionAndReopenTerm — success =====================================
  // ============================================================================

  describe("deployAuctionAndReopenTerm — success", () => {
    it("deploys 3 auction contracts, emits TermAuctionDeployed, returns non-zero addresses", async () => {
      const REPO_TERM_REPO_ID = "term-repo-001";
      const repoParams = await makeValidParams();
      const repoStaticResult = await factory.connect(wallet1).deployTermRepo.staticCall(repoParams);
      await factory.connect(wallet1).deployTermRepo(repoParams);
      const deployedServicerAddr = repoStaticResult.termRepoServicer;

      const auctionParams = await makeValidAuctionParams(REPO_TERM_REPO_ID);

      const expectedTermRepoId = ethers.solidityPackedKeccak256(["string"], [REPO_TERM_REPO_ID]);
      const expectedTermAuctionId = ethers.solidityPackedKeccak256(["string"], ["term-auction-001"]);

      // Verify returned struct via static call first (does not change state)
      const staticResult = await factory
        .connect(wallet1)
        .deployAuctionAndReopenTerm.staticCall(auctionParams, deployedServicerAddr);
      expect(staticResult.termAuction).to.not.equal(ethers.ZeroAddress);
      expect(staticResult.termAuctionBidLocker).to.not.equal(ethers.ZeroAddress);
      expect(staticResult.termAuctionOfferLocker).to.not.equal(ethers.ZeroAddress);

      // Actual call: verify event emission
      await expect(
        factory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      )
        .to.emit(factory, "TermAuctionDeployed")
        .withArgs(
          expectedTermRepoId,
          expectedTermAuctionId,
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          (v: string) => v !== ethers.ZeroAddress,
          wallet1.address,
          true,
        );
    });
  });

  // ============================================================================
  // = deployAuctionAndReopenTerm — ZeroAddress when no auction impls set =======
  // ============================================================================

  describe("deployAuctionAndReopenTerm — ZeroAddress revert when no auction impls set", () => {
    it("reverts ZeroAddress when deployAuctionAndReopenTerm called before setTermAuctionImplementations", async () => {
      // Deploy a fresh factory WITHOUT calling setTermAuctionImplementations
      const FactoryContract = await ethers.getContractFactory("TermRepoDeployerFactory");
      const bareFactory = (await FactoryContract.connect(adminWallet).deploy(
        adminWallet.address,
        devopsWallet.address,
        await mockController.getAddress(),
        await emitter.getAddress(),
        await oracle.getAddress(),
        wallet1.address,
      )) as unknown as TermRepoDeployerFactory;
      await bareFactory.waitForDeployment();

      // Set repo implementations only (not auction implementations)
      await bareFactory.connect(devopsWallet).setTermRepoImplementations(
        servicerImpl,
        collateralManagerImpl,
        lockerImpl,
        tokenImpl,
        rolloverManagerImpl,
        "v1",
      );

      // Grant bareFactory INITIALIZER_ROLE on emitter via pairTermFactory
      await emitter.connect(adminWallet).pairTermFactory(await bareFactory.getAddress());

      // Deploy a term repo to get a real servicer
      const repoParams = await makeValidParams();
      const repoStaticResult = await bareFactory.connect(wallet1).deployTermRepo.staticCall(repoParams);
      await bareFactory.connect(wallet1).deployTermRepo(repoParams);
      const deployedServicerAddr = repoStaticResult.termRepoServicer;

      const auctionParams = await makeValidAuctionParams("term-repo-001");
      await expect(
        bareFactory.connect(wallet1).deployAuctionAndReopenTerm(auctionParams, deployedServicerAddr),
      ).to.be.revertedWithCustomError(bareFactory, "ZeroAddress");
    });
  });
});
