/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { ZeroAddress, solidityPackedKeccak256 } from "ethers";

dayjs.extend(duration);
import { deployMaturityPeriod, MaturityPeriodInfo } from "../utils/deploy-utils";
import { getGeneratedTenderId } from "../utils/simulation-utils";
import {
  TermController,
  TermDiamond,
  TermDiamondFactory,
  TermEventEmitter,
  TermPriceConsumerV3,
  TermInitializer,
  TestToken,
  DiamondCutFacet,
  TermLoanIntentFacet,
  TermControllerFacet,
} from "../typechain-types";

/**
 * TermFlashLoop Integration Tests
 *
 * End-to-end tests for flash-loan-funded loop (leverage/deleverage) scenarios
 * through TermFlashLoanExecutorFacet on a real TermDiamond. Only external protocol
 * contracts (flash loan aggregator, swap aggregator, ERC4626 vaults) are mocked.
 * All Term Finance contracts are real.
 *
 * Tests 4 scenarios:
 *   1. Loop out of period1 term loan via simple swap (rawCollateral → rawPurchase)
 *   2. Loop out of period2 term loan with full vault pipeline (deposit/repay/redeem/swap)
 *   3. Loop out of period3 term loan with vault collateral only (repay/redeem)
 *   4. Loop into term loan (flash borrow collateral, settle lend order, swap purchase → collateral)
 */
describe("TermFlashLoop Integration Tests", () => {
  let wallets: SignerWithAddress[];
  let lender: SignerWithAddress;
  let borrower: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let devops: SignerWithAddress;
  let controllerAdmin: SignerWithAddress;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let protocolReserve: SignerWithAddress;

  let termController: TermController;
  let termEventEmitter: TermEventEmitter;
  let termOracle: TermPriceConsumerV3;
  let termInitializer: TermInitializer;

  // 3 maturity periods
  let maturityPeriod1: MaturityPeriodInfo; // rawPurchase / rawCollateral    (scenarios 1, 4)
  let maturityPeriod2: MaturityPeriodInfo; // purchaseVaultShares / collateralVaultShares   (scenario 2)
  let maturityPeriod3: MaturityPeriodInfo; // rawPurchase / collateral2VaultShares          (scenario 3)

  let rawPurchase: TestToken;
  let rawCollateral: TestToken;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let purchaseVault: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collateralVault: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collateral2Vault: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFlashLoanAggregator: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSwapAggregator: any;

  let diamondAddress: string;
  let loanIntentFacetImpl: TermLoanIntentFacet;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let domain: any;

  let snapshotId: string;

  // ─── Constants ────────────────────────────────────────────────────────────
  const LOAN_AMOUNT = ethers.parseUnits("1000", 6);    // 1000 rawPurchase (6 dec)
  const COLLATERAL_AMOUNT = ethers.parseEther("1500"); // 1500 (18 dec scale)
  const BORROW_RATE = 5n * 10n ** 16n;                 // 5% per year
  const EXTRA_PURCHASE = ethers.parseUnits("500", 6);  // extra rawPurchase for scenario 4

  // Rate for TestMockSwapAggregator: amountOut = amountIn * rate / 1e18
  // rawCollateral (18 dec) → rawPurchase (6 dec) at $1:$1:  1500e18 * 1e6 / 1e18 = 1500e6
  const RATE_COLLATERAL_TO_PURCHASE = 1_000_000n;       // 1e6
  // rawPurchase (6 dec) → rawCollateral (18 dec) at $1:$1: 1500e6 * 1e30 / 1e18 = 1500e18
  const RATE_PURCHASE_TO_COLLATERAL = 10n ** 30n;       // 1e30

  const BID_NONCE = "12345";
  const OFFER_NONCE = "67890";

  // ─── EIP-712 type definitions ─────────────────────────────────────────────
  const RETRIEVE_FUNDS_TYPE = [
    { name: "method", type: "bytes4" },
    { name: "target", type: "address" },
    { name: "additionalCalldata", type: "bytes" },
  ];
  const LEND_ORDER_TYPES = {
    RetrieveFundsStruct: RETRIEVE_FUNDS_TYPE,
    LimitLendOrder: [
      { name: "repoServicer", type: "address" },
      { name: "purchaseTokenAmount", type: "uint256" },
      { name: "offerRate", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "taker", type: "address" },
      { name: "borrowFee", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "retrieveFunds", type: "RetrieveFundsStruct" },
    ],
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const sel = (sig: string) => ethers.id(sig).slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function signLendOrder(signer: SignerWithAddress, order: any) {
    const sig = await signer.signTypedData(domain, LEND_ORDER_TYPES, order);
    const { v, r, s } = ethers.Signature.from(sig);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [v, r, s],
    );
    return { sigType: 0, sigData };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function makeLendOrder(repoServicerAddr: string, purchaseTokenAmount: bigint, salt = 1n): Promise<any> {
    const block = await ethers.provider.getBlock("latest");
    const blockTimestamp = BigInt(block!.timestamp);
    return {
      repoServicer: repoServicerAddr,
      purchaseTokenAmount,
      offerRate: BORROW_RATE,
      maker: lender.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: feeRecipient.address,
      expiry: blockTimestamp + 86400n,
      salt,
      retrieveFunds: {
        method: "0x00000000",
        target: ZeroAddress,
        additionalCalldata: "0x",
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function encodeLendHookCalldata(orders: any[], sigs: any[], fillAmounts: bigint[]): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bool",
        "tuple(address repoServicer,uint256 purchaseTokenAmount,uint256 offerRate,address maker,address taker,uint256 borrowFee,address feeRecipient,uint256 expiry,uint256 salt,tuple(bytes4 method,address target,bytes additionalCalldata) retrieveFunds)[]",
        "tuple(uint8 sigType,bytes sigData)[]",
        "uint256[]",
      ],
      [
        false, // usePermit2
        orders.map((o) => [
          o.repoServicer, o.purchaseTokenAmount, o.offerRate, o.maker, o.taker,
          o.borrowFee, o.feeRecipient, o.expiry, o.salt,
          [o.retrieveFunds.method, o.retrieveFunds.target, o.retrieveFunds.additionalCalldata],
        ]),
        sigs.map((s) => [s.sigType, s.sigData]),
        fillAmounts,
      ],
    );
  }

  function encodeSwapRouterData(): string {
    const innerSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(uint8 swapType, address extRouter, bytes extCalldata, bool needScale)"],
      [{ swapType: 0, extRouter: ZeroAddress, extCalldata: "0x", needScale: false }],
    );
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes swapData, bool isTokenInPendlePT, bool isTokenOutPendlePT)"],
      [{ swapData: innerSwapData, isTokenInPendlePT: false, isTokenOutPendlePT: false }],
    );
  }

  // ─── Setup ────────────────────────────────────────────────────────────────
  before(async () => {
    upgrades.silenceWarnings();
    wallets = await ethers.getSigners();
    lender          = wallets[0];
    borrower        = wallets[1];
    feeRecipient    = wallets[2];
    devops          = wallets[4];
    controllerAdmin = wallets[5];
    admin           = wallets[6];
    treasury        = wallets[7];
    protocolReserve = wallets[8];

    // ── 1. Deploy rawPurchase (6 dec) and rawCollateral (18 dec) ────────────
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    rawPurchase = await testTokenFactory.deploy() as TestToken;
    await rawPurchase.waitForDeployment();
    await rawPurchase.initialize("Purchase Token", "PT", 6, [], []);

    rawCollateral = await testTokenFactory.deploy() as TestToken;
    await rawCollateral.waitForDeployment();
    await rawCollateral.initialize("Collateral Token", "CT", 18, [], []);

    // ── 2. Deploy TermPriceConsumerV3 ───────────────────────────────────────
    const termPriceOracleFactory = await ethers.getContractFactory("TermPriceConsumerV3");
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [devops.address],
      { kind: "uups" },
    )) as unknown as TermPriceConsumerV3;

    // ── 3. Deploy TermController ────────────────────────────────────────────
    const termControllerFactory = await ethers.getContractFactory("TermController");
    termController = (await upgrades.deployProxy(
      termControllerFactory,
      [
        treasury.address,
        protocolReserve.address,
        controllerAdmin.address,
        devops.address,
        admin.address,
      ],
      { kind: "uups" },
    )) as unknown as TermController;

    // ── 4. Deploy TermInitializer and TermEventEmitter ──────────────────────
    const termInitializerFactory = await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      treasury.address,
      wallets[3].address,
    );
    await termInitializer.waitForDeployment();
    await termController.connect(admin).pairInitializer(await termInitializer.getAddress());

    // Deploy TermDiamond via factory
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = (await termDiamondFactoryFactory.deploy(
      admin.address,
      devops.address,
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

    const termEventEmitterFactory = await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        devops.address,
        controllerAdmin.address,
        await termInitializer.getAddress(),
        controllerAdmin.address,
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

    // ── 5. Price feeds for rawPurchase and rawCollateral ($1.00) ────────────
    const mockPriceFeedFactory = await ethers.getContractFactory("TestPriceFeed");
    const purchaseFeed = await mockPriceFeedFactory.deploy(8, "", 1, 1, 100000000n, 1, 1, 1);
    const collateralFeed = await mockPriceFeedFactory.deploy(8, "", 1, 1, 100000000n, 1, 1, 1);
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await rawPurchase.getAddress(), await purchaseFeed.getAddress(), 0,
    );
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await rawCollateral.getAddress(), await collateralFeed.getAddress(), 0,
    );

    // ── 6. Deploy ERC4626 vaults ────────────────────────────────────────────
    const vaultFactory = await ethers.getContractFactory("TestMockVault");

    // purchaseVault: asset = rawPurchase; shares used as period2's purchase token
    purchaseVault = await vaultFactory.deploy();
    await purchaseVault.waitForDeployment();
    await purchaseVault.initialize(await rawPurchase.getAddress(), "Purchase Vault Shares", "PVS");

    // collateralVault: asset = rawCollateral; shares used as period2's collateral token
    collateralVault = await vaultFactory.deploy();
    await collateralVault.waitForDeployment();
    await collateralVault.initialize(await rawCollateral.getAddress(), "Collateral Vault Shares", "CVS");

    // collateral2Vault: asset = rawPurchase; shares used as period3's collateral token
    collateral2Vault = await vaultFactory.deploy();
    await collateral2Vault.waitForDeployment();
    await collateral2Vault.initialize(await rawPurchase.getAddress(), "Collateral2 Vault Shares", "C2VS");

    // ── 7. Price feeds for vault share tokens ($1.00) ───────────────────────
    const pvFeed  = await mockPriceFeedFactory.deploy(8, "", 1, 1, 100000000n, 1, 1, 1);
    const cvFeed  = await mockPriceFeedFactory.deploy(8, "", 1, 1, 100000000n, 1, 1, 1);
    const c2vFeed = await mockPriceFeedFactory.deploy(8, "", 1, 1, 100000000n, 1, 1, 1);
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await purchaseVault.getAddress(), await pvFeed.getAddress(), 0,
    );
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await collateralVault.getAddress(), await cvFeed.getAddress(), 0,
    );
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await collateral2Vault.getAddress(), await c2vFeed.getAddress(), 0,
    );

    // ── 8. Use the shared TermDiamond deployed above ────────────────────────
    diamondAddress = await termDiamond.getAddress();

    // ── 9. Deploy 3 maturity periods (shared diamond, same auction dates) ───
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = dayjs.unix(latestBlock!.timestamp);
    const auctionStart  = now.subtract(1, "minute");
    const auctionReveal = auctionStart.add(1, "day");
    const auctionEnd    = auctionReveal.add(10, "minute");
    const maturity      = auctionEnd.add(1, "month");

    const commonArgs = {
      termControllerAddress:       await termController.getAddress(),
      termEventEmitterAddress:     await termEventEmitter.getAddress(),
      termInitializerAddress:      await termInitializer.getAddress(),
      termOracleAddress:           await termOracle.getAddress(),
      termDiamondAddress:          diamondAddress,
      auctionStartDate:            auctionStart.unix().toString(),
      auctionRevealDate:           auctionReveal.unix().toString(),
      auctionEndDate:              auctionEnd.unix().toString(),
      maturityTimestamp:           maturity.unix().toString(),
      servicerMaturityTimestamp:   maturity.unix().toString(),
      minimumTenderAmount:         "10",
      repurchaseWindow:            "86400",
      redemptionBuffer:            "300",
      netExposureCapOnLiquidation: "5" + "0".repeat(16),
      deMinimisMarginThreshold:    "50" + "0".repeat(18),
      liquidateDamangesDueToProtocol: "3" + "0".repeat(16),
      servicingFee:                "3" + "0".repeat(15),
      purchaseTokenAddress:        await rawPurchase.getAddress(),
      collateralTokenAddresses:    [await rawCollateral.getAddress()],
      initialCollateralRatios:     ["15" + "0".repeat(17)],
      maintenanceCollateralRatios: ["125" + "0".repeat(16)],
      liquidatedDamages:           ["5" + "0".repeat(16)],
      mintExposureCap:             "1000000000000000000",
      termApprovalMultisig:        treasury,
      devopsMultisig:              devops.address,
      adminWallet:                 admin.address,
      controllerAdmin:             controllerAdmin,
      termVersion:                 "0.1.0",
      auctionVersion:              "0.1.0",
      clearingPricePostProcessingOffset: "0",
    };

    // period1: rawPurchase / rawCollateral
    maturityPeriod1 = await deployMaturityPeriod(commonArgs, "uups");

    // period2: purchaseVaultShares / collateralVaultShares
    maturityPeriod2 = await deployMaturityPeriod(
      {
        ...commonArgs,
        purchaseTokenAddress:     await purchaseVault.getAddress(),
        collateralTokenAddresses: [await collateralVault.getAddress()],
      },
      "uups",
    );

    // period3: rawPurchase / collateral2VaultShares
    maturityPeriod3 = await deployMaturityPeriod(
      {
        ...commonArgs,
        collateralTokenAddresses: [await collateral2Vault.getAddress()],
      },
      "uups",
    );

    // ── 10. Deploy mock flash loan and swap aggregators ──────────────────────
    const MockFlashFactory = await ethers.getContractFactory("TestMockFlashLoanAggregator");
    mockFlashLoanAggregator = await MockFlashFactory.deploy();
    await mockFlashLoanAggregator.waitForDeployment();

    const MockSwapFactory = await ethers.getContractFactory("TestMockSwapAggregator");
    mockSwapAggregator = await MockSwapFactory.deploy();
    await mockSwapAggregator.waitForDeployment();

    // ── 11. Deploy facets ───────────────────────────────────────────────────
    const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();

    const TermControllerFacetFactory = await ethers.getContractFactory("TermControllerFacet");
    const termControllerFacet = await TermControllerFacetFactory.deploy() as TermControllerFacet;
    await termControllerFacet.waitForDeployment();

    const flashAggAddr = await mockFlashLoanAggregator.getAddress();
    const TermFlashLoanExecutorFacetFactory = await ethers.getContractFactory("TermFlashLoanExecutorFacet");
    const flashLoanExecutorFacet = await TermFlashLoanExecutorFacetFactory.deploy(flashAggAddr);
    await flashLoanExecutorFacet.waitForDeployment();

    const TermRouterFacetFactory = await ethers.getContractFactory("TermRouterFacet");
    const termRouterFacet = await TermRouterFacetFactory.deploy();
    await termRouterFacet.waitForDeployment();

    const TermLoanIntentHookFacetFactory = await ethers.getContractFactory("TermLoanIntentHookFacet");
    const loanIntentHookFacet = await TermLoanIntentHookFacetFactory.deploy();
    await loanIntentHookFacet.waitForDeployment();

    const TermLoanIntentFacetFactory = await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacetImpl = await TermLoanIntentFacetFactory.deploy() as TermLoanIntentFacet;
    await loanIntentFacetImpl.waitForDeployment();

    const ERC4626InterfaceFacetFactory = await ethers.getContractFactory("ERC4626InterfaceFacet");
    const erc4626InterfaceFacet = await ERC4626InterfaceFacetFactory.deploy();
    await erc4626InterfaceFacet.waitForDeployment();

    // SwapRouterFacet: pendleRouter_ must be non-zero (use feeRecipient as dummy); pendleSwap_ = swap agg
    const swapAggAddr = await mockSwapAggregator.getAddress();
    const SwapRouterFacetFactory = await ethers.getContractFactory("SwapRouterFacet");
    const swapRouterFacet = await SwapRouterFacetFactory.deploy(feeRecipient.address, swapAggAddr);
    await swapRouterFacet.waitForDeployment();

    // ── 12. Diamond cut: add all facets ────────────────────────────────────
    const loupeSelectors = [
      "facets()",
      "facetFunctionSelectors(address)",
      "facetAddresses()",
      "facetAddress(bytes4)",
      "diamondPaused()",
      "supportsInterface(bytes4)",
    ].map(sel);

    const controllerSelectors = [
      "approveTermController(address)",
      "revokeTermController(address)",
      "approveFeeRecipient(address)",
      "revokeFeeRecipient(address)",
    ].map(sel);

    const flashExecutorSelectors = [
      "flashExecute((uint256,bytes,address,(address,uint256,address,uint256,uint256,bool,bytes4,address,bytes)[],bool))",
      "flashExecuteCallback(address[],uint256[],uint256[],address,bytes)",
      "quoteExecutionPlan((address,address,uint256,(address,uint256,address,uint256,uint256,bool,bytes4,address,bytes)[],bool),uint256)",
    ].map(sel);

    const routerSelectors = [
      "submitRepurchasePaymentHook((address,address,uint256,address,uint256,address,bytes))",
      "previewSubmitRepurchasePayment((address,address,uint256,address,uint256,address,bytes))",
    ].map(sel);

    const loanIntentHookSelectors = [
      "settleLimitLendHook((address,address,uint256,address,uint256,address,bytes))",
      "previewSettleLimitLend((address,address,uint256,address,uint256,address,bytes))",
    ].map(sel);

    const loanIntentSelectors = [
      "initializeTermIntentFacet(address)",
      "settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)",
      "settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)",
      "settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,uint256[],(uint8,bytes))",
      "settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),address,uint256,(uint8,bytes))",
      "setPreSignedLendOrderHash((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      "setPreSignedBorrowOrderHash((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]))",
      "revokePreSignedLimitOrderHash(bytes32)",
      "setLimitOrderMakerTokenPairMinSaltValue(address,address,uint256)",
      "getLimitOrderMakerTokenPairMinSaltValue(address,address,address)",
      "cancelLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),(uint8,bytes))",
      "cancelLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),(uint8,bytes))",
      "getLendOrderHash((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      "getBorrowOrderHash((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]))",
    ].map(sel);

    const erc4626Selectors = [
      "depositToVaultHook((address,address,uint256,address,uint256,address,bytes))",
      "redeemFromVaultHook((address,address,uint256,address,uint256,address,bytes))",
      "previewDeposit((address,address,uint256,address,uint256,address,bytes))",
      "previewRedeem((address,address,uint256,address,uint256,address,bytes))",
    ].map(sel);

    const swapSelectors = [
      "swapHook((address,address,uint256,address,uint256,address,bytes))",
      "previewSwap((address,address,uint256,address,uint256,address,bytes))",
    ].map(sel);

    const diamondCutFacet = (await ethers.getContractAt(
      "DiamondCutFacet",
      diamondAddress,
    )) as DiamondCutFacet;

    await diamondCutFacet.connect(devops).diamondCut(
      [
        {
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0,
          functionSelectors: loupeSelectors,
        },
        {
          facetAddress: await termControllerFacet.getAddress(),
          action: 0,
          functionSelectors: controllerSelectors,
        },
        {
          facetAddress: await flashLoanExecutorFacet.getAddress(),
          action: 0,
          functionSelectors: flashExecutorSelectors,
        },
        {
          facetAddress: await termRouterFacet.getAddress(),
          action: 0,
          functionSelectors: routerSelectors,
        },
        {
          facetAddress: await loanIntentHookFacet.getAddress(),
          action: 0,
          functionSelectors: loanIntentHookSelectors,
        },
        {
          facetAddress: await loanIntentFacetImpl.getAddress(),
          action: 0,
          functionSelectors: loanIntentSelectors,
        },
        {
          facetAddress: await erc4626InterfaceFacet.getAddress(),
          action: 0,
          functionSelectors: erc4626Selectors,
        },
        {
          facetAddress: await swapRouterFacet.getAddress(),
          action: 0,
          functionSelectors: swapSelectors,
        },
      ],
      ZeroAddress,
      "0x",
    );

    // ── 13. Initialize TermLoanIntentFacet ──────────────────────────────────
    const loanIntent = (await ethers.getContractAt(
      "TermLoanIntentFacet",
      diamondAddress,
    )) as TermLoanIntentFacet;
    await loanIntent.initializeTermIntentFacet(await termEventEmitter.getAddress());

    // ── 14. Configure TermControllerFacet ──────────────────────────────────
    const ctrlFacet = (await ethers.getContractAt(
      "TermControllerFacet",
      diamondAddress,
    )) as TermControllerFacet;
    await ctrlFacet.connect(devops).approveTermController(await termController.getAddress());
    await ctrlFacet.connect(devops).approveFeeRecipient(feeRecipient.address);

    // ── 15. markTermApproved for all 3 vaults ──────────────────────────────
    await termController.connect(admin).markTermApproved(await purchaseVault.getAddress());
    await termController.connect(admin).markTermApproved(await collateralVault.getAddress());
    await termController.connect(admin).markTermApproved(await collateral2Vault.getAddress());

    // ── 16. markTermDeployed for diamond ───────────────────────────────────
    await termController.connect(controllerAdmin).markTermDeployed(diamondAddress);

    // ── 17. Configure swap rates ────────────────────────────────────────────
    await mockSwapAggregator.setSwap(
      await rawCollateral.getAddress(),
      await rawPurchase.getAddress(),
      RATE_COLLATERAL_TO_PURCHASE,
    );
    await mockSwapAggregator.setSwap(
      await rawPurchase.getAddress(),
      await rawCollateral.getAddress(),
      RATE_PURCHASE_TO_COLLATERAL,
    );

    // ── 18. Run 3 auctions (all share same dates; lock all → reveal all → complete all) ─

    // Period 1 setup: lender provides rawPurchase, borrower provides rawCollateral
    const repoLocker1Addr = await maturityPeriod1.termRepoLocker.getAddress();
    await rawPurchase.mint(lender.address, LOAN_AMOUNT);
    await rawCollateral.mint(borrower.address, COLLATERAL_AMOUNT);
    await rawPurchase.connect(lender).approve(repoLocker1Addr, LOAN_AMOUNT);
    await rawCollateral.connect(borrower).approve(repoLocker1Addr, COLLATERAL_AMOUNT);

    // Period 2 setup: lender deposits rawPurchase → purchaseVaultShares; borrower deposits rawCollateral → collateralVaultShares
    const repoLocker2Addr = await maturityPeriod2.termRepoLocker.getAddress();
    await rawPurchase.mint(lender.address, LOAN_AMOUNT);
    await rawPurchase.connect(lender).approve(await purchaseVault.getAddress(), LOAN_AMOUNT);
    await purchaseVault.connect(lender).deposit(LOAN_AMOUNT, lender.address);
    await purchaseVault.connect(lender).approve(repoLocker2Addr, LOAN_AMOUNT);

    await rawCollateral.mint(borrower.address, COLLATERAL_AMOUNT);
    await rawCollateral.connect(borrower).approve(await collateralVault.getAddress(), COLLATERAL_AMOUNT);
    await collateralVault.connect(borrower).deposit(COLLATERAL_AMOUNT, borrower.address);
    await collateralVault.connect(borrower).approve(repoLocker2Addr, COLLATERAL_AMOUNT);

    // Period 3 setup: lender provides rawPurchase, borrower deposits COLLATERAL_AMOUNT rawPurchase → collateral2VaultShares
    const repoLocker3Addr = await maturityPeriod3.termRepoLocker.getAddress();
    await rawPurchase.mint(lender.address, LOAN_AMOUNT);
    await rawPurchase.connect(lender).approve(repoLocker3Addr, LOAN_AMOUNT);

    // COLLATERAL_AMOUNT of rawPurchase (6-dec token) for collateral2Vault deposit
    await rawPurchase.mint(borrower.address, COLLATERAL_AMOUNT);
    await rawPurchase.connect(borrower).approve(await collateral2Vault.getAddress(), COLLATERAL_AMOUNT);
    await collateral2Vault.connect(borrower).deposit(COLLATERAL_AMOUNT, borrower.address);
    await collateral2Vault.connect(borrower).approve(repoLocker3Addr, COLLATERAL_AMOUNT);

    // Lock all bids/offers
    const bidLocker1   = maturityPeriod1.termAuctionBidLocker;
    const offerLocker1 = maturityPeriod1.termAuctionOfferLocker;
    const bidLocker2   = maturityPeriod2.termAuctionBidLocker;
    const offerLocker2 = maturityPeriod2.termAuctionOfferLocker;
    const bidLocker3   = maturityPeriod3.termAuctionBidLocker;
    const offerLocker3 = maturityPeriod3.termAuctionOfferLocker;

    const offerId1 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("offer-p1")), offerLocker1, lender,
    );
    await offerLocker1.connect(lender).lockOffers([{
      id: ethers.keccak256(ethers.toUtf8Bytes("offer-p1")),
      offeror: lender.address,
      offerPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, OFFER_NONCE]),
      amount: LOAN_AMOUNT,
      purchaseToken: await rawPurchase.getAddress(),
    }]);

    const bidId1 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("bid-p1")), bidLocker1, borrower,
    );
    await bidLocker1.connect(borrower).lockBids([{
      id: ethers.keccak256(ethers.toUtf8Bytes("bid-p1")),
      bidder: borrower.address,
      bidPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, BID_NONCE]),
      amount: LOAN_AMOUNT,
      collateralAmounts: [COLLATERAL_AMOUNT],
      purchaseToken: await rawPurchase.getAddress(),
      collateralTokens: [await rawCollateral.getAddress()],
    }]);

    const offerId2 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("offer-p2")), offerLocker2, lender,
    );
    await offerLocker2.connect(lender).lockOffers([{
      id: ethers.keccak256(ethers.toUtf8Bytes("offer-p2")),
      offeror: lender.address,
      offerPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, OFFER_NONCE]),
      amount: LOAN_AMOUNT,
      purchaseToken: await purchaseVault.getAddress(),
    }]);

    const bidId2 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("bid-p2")), bidLocker2, borrower,
    );
    await bidLocker2.connect(borrower).lockBids([{
      id: ethers.keccak256(ethers.toUtf8Bytes("bid-p2")),
      bidder: borrower.address,
      bidPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, BID_NONCE]),
      amount: LOAN_AMOUNT,
      collateralAmounts: [COLLATERAL_AMOUNT],
      purchaseToken: await purchaseVault.getAddress(),
      collateralTokens: [await collateralVault.getAddress()],
    }]);

    const offerId3 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("offer-p3")), offerLocker3, lender,
    );
    await offerLocker3.connect(lender).lockOffers([{
      id: ethers.keccak256(ethers.toUtf8Bytes("offer-p3")),
      offeror: lender.address,
      offerPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, OFFER_NONCE]),
      amount: LOAN_AMOUNT,
      purchaseToken: await rawPurchase.getAddress(),
    }]);

    const bidId3 = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("bid-p3")), bidLocker3, borrower,
    );
    await bidLocker3.connect(borrower).lockBids([{
      id: ethers.keccak256(ethers.toUtf8Bytes("bid-p3")),
      bidder: borrower.address,
      bidPriceHash: solidityPackedKeccak256(["uint256", "uint256"], [BORROW_RATE, BID_NONCE]),
      amount: LOAN_AMOUNT,
      collateralAmounts: [COLLATERAL_AMOUNT],
      purchaseToken: await rawPurchase.getAddress(),
      collateralTokens: [await collateral2Vault.getAddress()],
    }]);

    // Time-travel past reveal date (shared across all 3 periods)
    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1, minutes: 1 }).asSeconds(),
    ]);
    await network.provider.send("evm_mine", []);

    // Reveal all offers and bids
    await offerLocker1.connect(lender).revealOffers([offerId1], [BORROW_RATE], [OFFER_NONCE]);
    await bidLocker1.connect(borrower).revealBids([bidId1], [BORROW_RATE], [BID_NONCE]);
    await offerLocker2.connect(lender).revealOffers([offerId2], [BORROW_RATE], [OFFER_NONCE]);
    await bidLocker2.connect(borrower).revealBids([bidId2], [BORROW_RATE], [BID_NONCE]);
    await offerLocker3.connect(lender).revealOffers([offerId3], [BORROW_RATE], [OFFER_NONCE]);
    await bidLocker3.connect(borrower).revealBids([bidId3], [BORROW_RATE], [BID_NONCE]);

    // Time-travel past auction end (shared)
    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ minutes: 11 }).asSeconds(),
    ]);
    await network.provider.send("evm_mine", []);

    // Complete all 3 auctions (use lender signer to avoid NonceManager desync)
    await maturityPeriod1.auction.connect(lender).completeAuction({
      revealedBidSubmissions:    [bidId1],
      expiredRolloverBids:       [],
      unrevealedBidSubmissions:  [],
      revealedOfferSubmissions:  [offerId1],
      unrevealedOfferSubmissions: [],
    });
    await maturityPeriod2.auction.connect(lender).completeAuction({
      revealedBidSubmissions:    [bidId2],
      expiredRolloverBids:       [],
      unrevealedBidSubmissions:  [],
      revealedOfferSubmissions:  [offerId2],
      unrevealedOfferSubmissions: [],
    });
    await maturityPeriod3.auction.connect(lender).completeAuction({
      revealedBidSubmissions:    [bidId3],
      expiredRolloverBids:       [],
      unrevealedBidSubmissions:  [],
      revealedOfferSubmissions:  [offerId3],
      unrevealedOfferSubmissions: [],
    });

    // ── 19. Build EIP-712 domain for lend order signing ────────────────────
    const versionStr = await loanIntentFacetImpl.version();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = {
      name: "TermFinance",
      version: versionStr,
      chainId,
      verifyingContract: diamondAddress,
    };
  });

  // ─── Snapshot / Restore ───────────────────────────────────────────────────

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 1: Loop out of period1 term loan via simple collateral swap
  // Flash-borrow rawPurchase → repay term loan → recover rawCollateral →
  // swap rawCollateral → rawPurchase → repay flash loan
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 1: Loop out of period1 term loan via simple swap", async () => {
    const pAddr = await rawPurchase.getAddress();
    const cAddr = await rawCollateral.getAddress();
    const servicer1Addr = await maturityPeriod1.termRepoServicer.getAddress();

    const repurchaseObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation).to.be.gt(0n);

    // Amount of rawPurchase we get from swapping COLLATERAL_AMOUNT rawCollateral
    const swapOutputAmount = COLLATERAL_AMOUNT * RATE_COLLATERAL_TO_PURCHASE / 10n ** 18n;

    // Fund mock contracts
    await rawPurchase.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation);
    await rawPurchase.mint(await mockSwapAggregator.getAddress(), swapOutputAmount);

    // Borrower approves diamond for collateral (hook will pull it after repayment)
    await rawCollateral.connect(borrower).approve(diamondAddress, COLLATERAL_AMOUNT);

    const swapRouterData = encodeSwapRouterData();
    const flashExecutor = await ethers.getContractAt("TermFlashLoanExecutorFacet", diamondAddress);

    const actions = [
      {
        // Action 0: repay period1 term loan, receive rawCollateral from borrower
        inputToken: pAddr,
        maxInputAmount: repurchaseObligation,
        outputToken: cAddr,
        minOutputAmount: COLLATERAL_AMOUNT,
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("submitRepurchasePaymentHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer1Addr,
        additionalCalldata: ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [false]),
      },
      {
        // Action 1: swap rawCollateral → rawPurchase to repay flash loan
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: repurchaseObligation, // at least enough to repay flash loan
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("swapHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: ZeroAddress,
        additionalCalldata: swapRouterData,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: false,
    });
    await tx.wait();

    // Borrower's period1 obligation is cleared
    const finalObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation).to.equal(0n);

    // Diamond has no residual tokens
    expect(await rawPurchase.balanceOf(diamondAddress)).to.equal(0n);
    expect(await rawCollateral.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 2: Loop out of period2 term loan with full ERC4626 vault pipeline
  // Flash-borrow rawPurchase → deposit to purchaseVault → repay vault-token loan
  // → recover collateralVaultShares → redeem to rawCollateral
  // → swap rawCollateral → rawPurchase → repay flash loan
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 2: Loop out of period2 term loan with full vault pipeline", async () => {
    const pAddr   = await rawPurchase.getAddress();
    const cAddr   = await rawCollateral.getAddress();
    const pvAddr  = await purchaseVault.getAddress();
    const cvAddr  = await collateralVault.getAddress();
    const servicer2Addr = await maturityPeriod2.termRepoServicer.getAddress();

    const repurchaseObligation2 = await maturityPeriod2.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation2).to.be.gt(0n);

    // Amount of rawPurchase we get from swapping COLLATERAL_AMOUNT rawCollateral
    const swapOutputAmount = COLLATERAL_AMOUNT * RATE_COLLATERAL_TO_PURCHASE / 10n ** 18n;

    // Fund mock contracts
    // Flash aggregator needs repurchaseObligation2 rawPurchase (to deposit to vault)
    await rawPurchase.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation2);
    // Swap aggregator needs rawPurchase output
    await rawPurchase.mint(await mockSwapAggregator.getAddress(), swapOutputAmount);

    // Borrower approves diamond for collateralVaultShares (hook pulls them after repayment releases them)
    await collateralVault.connect(borrower).approve(diamondAddress, COLLATERAL_AMOUNT);

    const swapRouterData = encodeSwapRouterData();
    const flashExecutor = await ethers.getContractAt("TermFlashLoanExecutorFacet", diamondAddress);

    const actions = [
      {
        // Action 0: deposit rawPurchase to purchaseVault → get purchaseVaultShares
        inputToken: pAddr,
        maxInputAmount: repurchaseObligation2 * 2n, // generous cap; preview pins to exact
        outputToken: pvAddr,
        minOutputAmount: repurchaseObligation2, // desired vault shares = obligation
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("depositToVaultHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: pvAddr,
        additionalCalldata: "0x",
      },
      {
        // Action 1: repay period2 term loan with purchaseVaultShares → recover collateralVaultShares
        inputToken: pvAddr,
        maxInputAmount: repurchaseObligation2 * 2n,
        outputToken: cvAddr,
        minOutputAmount: COLLATERAL_AMOUNT,
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("submitRepurchasePaymentHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer2Addr,
        additionalCalldata: ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [false]),
      },
      {
        // Action 2: redeem collateralVaultShares → rawCollateral
        inputToken: cvAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: cAddr,
        minOutputAmount: COLLATERAL_AMOUNT, // 1:1 vault, redeem all collateral
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("redeemFromVaultHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: cvAddr,
        additionalCalldata: "0x",
      },
      {
        // Action 3: swap rawCollateral → rawPurchase to repay flash loan
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: repurchaseObligation2,
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("swapHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: ZeroAddress,
        additionalCalldata: swapRouterData,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: false,
    });
    await tx.wait();

    // Period2 obligation cleared
    const finalObligation2 = await maturityPeriod2.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation2).to.equal(0n);

    // Diamond has no residual tokens
    expect(await rawPurchase.balanceOf(diamondAddress)).to.equal(0n);
    expect(await rawCollateral.balanceOf(diamondAddress)).to.equal(0n);
    expect(await purchaseVault.balanceOf(diamondAddress)).to.equal(0n);
    expect(await collateralVault.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 3: Loop out of period3 term loan with vault-only collateral
  // Flash-borrow rawPurchase → repay period3 loan → recover collateral2VaultShares
  // → redeem enough shares for repayment → repay flash loan
  // (surplus collateral2VaultShares refunded to borrower)
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 3: Loop out of period3 term loan with vault collateral (no swap)", async () => {
    const pAddr   = await rawPurchase.getAddress();
    const c2vAddr = await collateral2Vault.getAddress();
    const servicer3Addr = await maturityPeriod3.termRepoServicer.getAddress();

    const repurchaseObligation3 = await maturityPeriod3.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation3).to.be.gt(0n);

    // Fund flash aggregator with rawPurchase (to repay period3 loan)
    await rawPurchase.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation3);

    // Borrower approves diamond for all collateral2VaultShares (hook pulls them after repayment)
    await collateral2Vault.connect(borrower).approve(diamondAddress, COLLATERAL_AMOUNT);

    const flashExecutor = await ethers.getContractAt("TermFlashLoanExecutorFacet", diamondAddress);

    const actions = [
      {
        // Action 0: repay period3 term loan with rawPurchase → recover collateral2VaultShares
        inputToken: pAddr,
        maxInputAmount: repurchaseObligation3 * 2n,
        outputToken: c2vAddr,
        minOutputAmount: COLLATERAL_AMOUNT, // pull all collateral back from borrower
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("submitRepurchasePaymentHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer3Addr,
        additionalCalldata: ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [false]),
      },
      {
        // Action 1: redeem exactly repurchaseObligation3 collateral2VaultShares → rawPurchase
        // Preview pins maxInputAmount to previewWithdraw(minOutputAmount) = obligation shares
        // Executor refunds remaining ~COLLATERAL_AMOUNT collateral2VaultShares to borrower
        inputToken: c2vAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: repurchaseObligation3, // exact amount needed to repay flash loan
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("redeemFromVaultHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: c2vAddr,
        additionalCalldata: "0x",
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: false,
    });
    await tx.wait();

    // Period3 obligation cleared
    const finalObligation3 = await maturityPeriod3.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation3).to.equal(0n);

    // Diamond has no residual tokens
    expect(await rawPurchase.balanceOf(diamondAddress)).to.equal(0n);
    expect(await collateral2Vault.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 4: Loop into term (leverage up on rawCollateral)
  // Flash-borrow rawCollateral → settle lend order (new period1 loan, collateral routed from diamond)
  // → borrower receives rawPurchase, hook pulls it back → executor pulls EXTRA_PURCHASE from borrower
  // → swap (rawPurchase → rawCollateral) → repay flash loan
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 4: Loop into term loan (leverage via flash-borrowed collateral)", async () => {
    const pAddr = await rawPurchase.getAddress();
    const cAddr = await rawCollateral.getAddress();
    const servicer1Addr = await maturityPeriod1.termRepoServicer.getAddress();

    // Total rawPurchase that will be swapped: LOAN_AMOUNT (from lend order) + EXTRA_PURCHASE (from borrower)
    const totalPurchaseToSwap = LOAN_AMOUNT + EXTRA_PURCHASE; // 1500e6
    // Swap output: 1500e6 * 1e30 / 1e18 = 1500e18 = COLLATERAL_AMOUNT
    const swapOutputAmount = totalPurchaseToSwap * RATE_PURCHASE_TO_COLLATERAL / 10n ** 18n;
    expect(swapOutputAmount).to.equal(COLLATERAL_AMOUNT);

    // Fund mock contracts
    // Flash aggregator lends COLLATERAL_AMOUNT rawCollateral (used as collateral for new loan)
    await rawCollateral.mint(await mockFlashLoanAggregator.getAddress(), COLLATERAL_AMOUNT);
    // Swap aggregator needs rawCollateral to return after swapping rawPurchase
    await rawCollateral.mint(await mockSwapAggregator.getAddress(), swapOutputAmount);

    // Lender provides LOAN_AMOUNT rawPurchase for the new term loan
    await rawPurchase.mint(lender.address, LOAN_AMOUNT);
    await rawPurchase.connect(lender).approve(diamondAddress, LOAN_AMOUNT);

    // Borrower provides EXTRA_PURCHASE rawPurchase for outputTokenAmountIn
    // Also approves LOAN_AMOUNT for the hook's safeTransferFrom (totalBorrowAmount)
    await rawPurchase.mint(borrower.address, LOAN_AMOUNT + EXTRA_PURCHASE);
    await rawPurchase.connect(borrower).approve(diamondAddress, LOAN_AMOUNT + EXTRA_PURCHASE);

    // Create and sign lend order for period1
    const lendOrder = await makeLendOrder(servicer1Addr, LOAN_AMOUNT, 1n);
    const sig = await signLendOrder(lender, lendOrder);
    const hookCalldata = encodeLendHookCalldata([lendOrder], [sig], [LOAN_AMOUNT]);

    const swapRouterData = encodeSwapRouterData();
    const flashExecutor = await ethers.getContractAt("TermFlashLoanExecutorFacet", diamondAddress);

    const actions = [
      {
        // Action 0: settle lend order → routes COLLATERAL_AMOUNT rawCollateral (from diamond/flash loan)
        //           as collateral for new period1 loan; borrower receives LOAN_AMOUNT rawPurchase;
        //           hook pulls LOAN_AMOUNT rawPurchase back from borrower;
        //           outputTokenAmountIn: executor then pulls EXTRA_PURCHASE rawPurchase from borrower
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: LOAN_AMOUNT,
        outputTokenAmountIn: EXTRA_PURCHASE,
        usePermit2ForOutputTokenIn: false,
        method: sel("settleLimitLendHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer1Addr,
        additionalCalldata: hookCalldata,
      },
      {
        // Action 1: swap (LOAN_AMOUNT + EXTRA_PURCHASE) rawPurchase → rawCollateral to repay flash loan
        inputToken: pAddr,
        maxInputAmount: totalPurchaseToSwap,
        outputToken: cAddr,
        minOutputAmount: COLLATERAL_AMOUNT, // must cover flash loan repayment
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("swapHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: ZeroAddress,
        additionalCalldata: swapRouterData,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: cAddr,
      actions,
      backPropagate: false,
    });
    await tx.wait();

    // Borrower now has a (new/increased) period1 repurchase obligation
    const finalObligation1 = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation1).to.be.gt(0n);

    // Diamond has no residual tokens
    expect(await rawPurchase.balanceOf(diamondAddress)).to.equal(0n);
    expect(await rawCollateral.balanceOf(diamondAddress)).to.equal(0n);
  });
});
