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
  TermEventEmitter,
  TermPriceConsumerV3,
  TermInitializer,
  TestToken,
  DiamondCutFacet,
  TermLoanIntentFacet,
  TermControllerFacet,
} from "../typechain-types";

/**
 * TermRefinance Integration Tests
 *
 * End-to-end tests for flash-loan-funded refinancing through TermFlashLoanExecutorFacet
 * on a real TermDiamond. Only external protocol contracts (Aave, Morpho, InstaFlash)
 * are mocked. All Term Finance contracts are real.
 *
 * Tests 5 refinance scenarios:
 *   1. Term → Aave (repay Term, open Aave position)
 *   2. Term → Morpho (repay Term, open Morpho position)
 *   3. Term → Term (repay period1 loan, open period2 loan via lend order)
 *   4. Aave → Term (repay Aave, open Term loan via lend order)
 *   5. Morpho → Term (repay Morpho, open Term loan via lend order)
 */
describe("TermRefinance Integration Tests", () => {
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

  // Two maturity periods: period1 = source, period2 = destination (scenarios 3/4/5)
  let maturityPeriod1: MaturityPeriodInfo;
  let maturityPeriod2: MaturityPeriodInfo;

  let testPurchaseToken: TestToken;
  let testCollateralToken: TestToken;

  // Aave mocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAavePool: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let purchaseAToken: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collateralAToken: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let purchaseCreditDelegation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collateralCreditDelegation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aaveDataProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aaveAddressesProvider: any;

  // Morpho mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMorphoPool: any;

  // Flash loan aggregator mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFlashLoanAggregator: any;

  // Diamond (period1's diamond, cut with all required facets)
  let diamondAddress: string;
  let loanIntentFacetImpl: TermLoanIntentFacet;

  // EIP-712 domain for period2 lend orders
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let domain: any;

  // Morpho market IDs
  // refinanceMarketId: loanToken=purchaseToken, collateralToken=collateralToken
  // (used for both Term→Morpho and Morpho→Term scenarios)
  let refinanceMarketId: string;

  let snapshotId: string;

  // ─── Constants ────────────────────────────────────────────────────────────
  const LOAN_AMOUNT = ethers.parseUnits("1000", 6);          // 1000 purchase tokens (6 dec)
  const COLLATERAL_AMOUNT = ethers.parseEther("1500");       // 1500 collateral tokens (18 dec)
  const BORROW_RATE = 5n * 10n ** 16n;                       // 5% per year

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

  function computeMarketId(
    loanToken: string,
    collateralToken: string,
    oracle: string,
    irm: string,
    lltv: bigint,
  ): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256"],
        [loanToken, collateralToken, oracle, irm, lltv],
      ),
    );
  }

  async function signLendOrder(signer: SignerWithAddress, order: any) {
    const sig = await signer.signTypedData(domain, LEND_ORDER_TYPES, order);
    const { v, r, s } = ethers.Signature.from(sig);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [v, r, s],
    );
    return { sigType: 0, sigData };
  }

  // Build a LimitLendOrder for maturityPeriod2
  // Uses blockchain timestamp (not wall clock) because tests time-travel in before()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function makeLendOrder2(purchaseTokenAmount: bigint, salt = 1n): Promise<any> {
    const block = await ethers.provider.getBlock("latest");
    const blockTimestamp = BigInt(block!.timestamp);
    return {
      repoServicer: maturityPeriod2 ? maturityPeriod2.termRepoServicer.target : ZeroAddress,
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

  // Encode additionalCalldata for settleLimitLendHook
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

  // ─── Setup ────────────────────────────────────────────────────────────────

  before(async () => {
    upgrades.silenceWarnings();
    wallets = await ethers.getSigners();
    lender         = wallets[0];
    borrower       = wallets[1];
    feeRecipient   = wallets[2];
    devops         = wallets[4];
    controllerAdmin = wallets[5];
    admin          = wallets[6];
    treasury       = wallets[7];
    protocolReserve = wallets[8];

    // ── 1. Deploy purchase and collateral tokens ────────────────────────────
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.waitForDeployment();
    await testPurchaseToken.initialize("Purchase Token", "PT", 6, [], []);

    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.waitForDeployment();
    await testCollateralToken.initialize("Collateral Token", "CT", 18, [], []);

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
    await termController
      .connect(admin)
      .pairInitializer(await termInitializer.getAddress());


    // ── 5. Price feeds ($1.00 for both tokens) ──────────────────────────────
    const mockPriceFeedFactory = await ethers.getContractFactory("TestPriceFeed");
    const mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      8, "", 1, 1, 100000000n, 1, 1, 1,
    );
    const mockCollateralFeed = await mockPriceFeedFactory.deploy(
      8, "", 1, 1, 100000000n, 1, 1, 1,
    );
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await testPurchaseToken.getAddress(), await mockPurchaseFeed.getAddress(), 0,
    );
    await termOracle.connect(devops).addNewTokenPriceFeed(
      await testCollateralToken.getAddress(), await mockCollateralFeed.getAddress(), 0,
    );

    // ── 6. Pre-deploy a shared TermDiamond for both maturity periods ────────
    // Both periods will grant DIAMOND_ROLE to this diamond during pairing,
    // enabling it to call mintOpenExposureFromIntent on either period's servicer.
    const TermDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = await TermDiamondFactoryFactory.deploy(admin.address, devops.address);
    await termDiamondFactory.waitForDeployment();

    const deployDiamondTx = await termDiamondFactory.deployDiamond();
    const deployDiamondReceipt = await deployDiamondTx.wait();
    const diamondDeployedEvent = deployDiamondReceipt?.logs.find(
      (log) => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash,
    );
    if (!diamondDeployedEvent) throw new Error("DiamondDeployed event not found");
    const decodedDiamondEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    diamondAddress = decodedDiamondEvent?.args.diamond;

    const termEventEmitterFactory = await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        devops.address,
        controllerAdmin.address,
        await termInitializer.getAddress(),
        controllerAdmin.address,
        diamondAddress,
      ],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;
    await termInitializer.pairTermContracts(
      await termController.getAddress(),
      await termEventEmitter.getAddress(),
      await termOracle.getAddress(),
      diamondAddress
    );

    // ── 7. Deploy maturityPeriod1 (source) and maturityPeriod2 (destination) ─
    // Pass our shared diamond so both periods grant DIAMOND_ROLE to it.
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = dayjs.unix(latestBlock!.timestamp);
    const auctionStart   = now.subtract(1, "minute");
    const auctionReveal  = auctionStart.add(1, "day");
    const auctionEnd     = auctionReveal.add(10, "minute");
    const maturity       = auctionEnd.add(1, "month");

    const commonPeriodArgs = {
      termControllerAddress:    await termController.getAddress(),
      termEventEmitterAddress:  await termEventEmitter.getAddress(),
      termInitializerAddress:   await termInitializer.getAddress(),
      termOracleAddress:        await termOracle.getAddress(),
      auctionStartDate:         auctionStart.unix().toString(),
      auctionRevealDate:        auctionReveal.unix().toString(),
      auctionEndDate:           auctionEnd.unix().toString(),
      maturityTimestamp:        maturity.unix().toString(),
      servicerMaturityTimestamp: maturity.unix().toString(),
      minimumTenderAmount:      "10",
      repurchaseWindow:         "86400",
      redemptionBuffer:         "300",
      netExposureCapOnLiquidation: "5" + "0".repeat(16),
      deMinimisMarginThreshold:    "50" + "0".repeat(18),
      liquidateDamangesDueToProtocol: "3" + "0".repeat(16),
      servicingFee:             "3" + "0".repeat(15),
      purchaseTokenAddress:     await testPurchaseToken.getAddress(),
      collateralTokenAddresses: [await testCollateralToken.getAddress()],
      initialCollateralRatios:  ["15" + "0".repeat(17)],
      maintenanceCollateralRatios: ["125" + "0".repeat(16)],
      liquidatedDamages:        ["5" + "0".repeat(16)],
      mintExposureCap:          "1000000000000000000",
      termApprovalMultisig:     treasury,
      devopsMultisig:           devops.address,
      adminWallet:              admin.address,
      controllerAdmin:          controllerAdmin,
      termVersion:              "0.1.0",
      auctionVersion:           "0.1.0",
      clearingPricePostProcessingOffset: "0",
      termDiamondAddress:       diamondAddress,
    };

    maturityPeriod1 = await deployMaturityPeriod(commonPeriodArgs, "uups");
    maturityPeriod2 = await deployMaturityPeriod(
      { ...commonPeriodArgs, termOracleAddress: await termOracle.getAddress() },
      "uups",
    );

    // ── 7. Deploy Aave mock infrastructure ─────────────────────────────────
    const MockATokenFactory = await ethers.getContractFactory("TestMockAToken");
    purchaseAToken = await MockATokenFactory.deploy();
    await purchaseAToken.waitForDeployment();
    collateralAToken = await MockATokenFactory.deploy();
    await collateralAToken.waitForDeployment();

    const MockCreditDelegFactory = await ethers.getContractFactory("TestMockCreditDelegationToken");
    purchaseCreditDelegation = await MockCreditDelegFactory.deploy();
    await purchaseCreditDelegation.waitForDeployment();
    collateralCreditDelegation = await MockCreditDelegFactory.deploy();
    await collateralCreditDelegation.waitForDeployment();

    const MockDataProviderFactory = await ethers.getContractFactory("TestMockAavePoolDataProvider");
    aaveDataProvider = await MockDataProviderFactory.deploy();
    await aaveDataProvider.waitForDeployment();

    const MockAddressesProviderFactory = await ethers.getContractFactory("TestMockAavePoolAddressesProvider");
    aaveAddressesProvider = await MockAddressesProviderFactory.deploy();
    await aaveAddressesProvider.waitForDeployment();

    const MockAavePoolFactory = await ethers.getContractFactory("TestMockAavePool");
    mockAavePool = await MockAavePoolFactory.deploy();
    await mockAavePool.waitForDeployment();

    // Wire up Aave stack
    await aaveAddressesProvider.setPoolDataProvider(await aaveDataProvider.getAddress());
    await mockAavePool.setAddressesProvider(await aaveAddressesProvider.getAddress());

    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const pAToken = await purchaseAToken.getAddress();
    const cAToken = await collateralAToken.getAddress();
    const pCreditDeleg = await purchaseCreditDelegation.getAddress();
    const cCreditDeleg = await collateralCreditDelegation.getAddress();
    const aavePoolAddr = await mockAavePool.getAddress();

    await aaveDataProvider.setReserveTokensAddresses(pAddr, pAToken, pCreditDeleg, pCreditDeleg);
    await aaveDataProvider.setReserveTokensAddresses(cAddr, cAToken, cCreditDeleg, cCreditDeleg);
    await mockAavePool.setReserveTokens(pAddr, pAToken, pCreditDeleg, pCreditDeleg);
    await mockAavePool.setReserveTokens(cAddr, cAToken, cCreditDeleg, cCreditDeleg);

    // ── 8. Deploy Morpho mock pool ──────────────────────────────────────────
    const MockMorphoFactory = await ethers.getContractFactory("TestMockMorphoPool");
    mockMorphoPool = await MockMorphoFactory.deploy();
    await mockMorphoPool.waitForDeployment();
    const morphoPoolAddr = await mockMorphoPool.getAddress();

    // Market: loanToken=purchaseToken, collateralToken=collateralToken
    // Used for both Term→Morpho (morphoRefinanceIn) and Morpho→Term (morphoRefinanceOut)
    const lltv = 8n * 10n ** 17n;
    const oracleAddr = aavePoolAddr;  // dummy oracle address
    const irmAddr = aavePoolAddr;     // dummy IRM address
    refinanceMarketId = computeMarketId(pAddr, cAddr, oracleAddr, irmAddr, lltv);
    await mockMorphoPool.setMarketParams(refinanceMarketId, [pAddr, cAddr, oracleAddr, irmAddr, lltv]);

    // ── 9. Deploy flash loan aggregator mock ───────────────────────────────
    const MockFlashFactory = await ethers.getContractFactory("TestMockFlashLoanAggregator");
    mockFlashLoanAggregator = await MockFlashFactory.deploy();
    await mockFlashLoanAggregator.waitForDeployment();
    const flashAggregatorAddr = await mockFlashLoanAggregator.getAddress();

    // ── 10. Deploy facets ───────────────────────────────────────────────────
    const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();

    const TermControllerFacetFactory = await ethers.getContractFactory("TermControllerFacet");
    const termControllerFacet = await TermControllerFacetFactory.deploy() as TermControllerFacet;
    await termControllerFacet.waitForDeployment();

    const TermFlashLoanExecutorFacetFactory = await ethers.getContractFactory("TermFlashLoanExecutorFacet");
    const flashLoanExecutorFacet = await TermFlashLoanExecutorFacetFactory.deploy(flashAggregatorAddr);
    await flashLoanExecutorFacet.waitForDeployment();

    const TermRouterFacetFactory = await ethers.getContractFactory("TermRouterFacet");
    const termRouterFacet = await TermRouterFacetFactory.deploy();
    await termRouterFacet.waitForDeployment();

    const TermAaveInterfaceFacetFactory = await ethers.getContractFactory("TermAaveInterfaceFacet");
    const aaveInterfaceFacet = await TermAaveInterfaceFacetFactory.deploy();
    await aaveInterfaceFacet.waitForDeployment();

    const TermMorphoInterfaceFacetFactory = await ethers.getContractFactory("TermMorphoInterfaceFacet");
    const morphoInterfaceFacet = await TermMorphoInterfaceFacetFactory.deploy(morphoPoolAddr);
    await morphoInterfaceFacet.waitForDeployment();

    const TermLoanIntentHookFacetFactory = await ethers.getContractFactory("TermLoanIntentHookFacet");
    const loanIntentHookFacet = await TermLoanIntentHookFacetFactory.deploy();
    await loanIntentHookFacet.waitForDeployment();

    const TermLoanIntentFacetFactory = await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacetImpl = await TermLoanIntentFacetFactory.deploy() as TermLoanIntentFacet;
    await loanIntentFacetImpl.waitForDeployment();

    // ── 11. Diamond cut: add all facets ────────────────────────────────────
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

    const aaveSelectors = [
      "aaveRefinanceInHook((address,address,uint256,address,uint256,address,bytes))",
      "aaveRefinanceOutHook((address,address,uint256,address,uint256,address,bytes))",
      "previewAaveRefinanceIn((address,address,uint256,address,uint256,address,bytes))",
      "previewAaveRefinanceOut((address,address,uint256,address,uint256,address,bytes))",
    ].map(sel);

    const morphoSelectors = [
      "morphoRefinanceInHook((address,address,uint256,address,uint256,address,bytes))",
      "morphoRefinanceOutHook((address,address,uint256,address,uint256,address,bytes))",
      "previewMorphoRefinanceIn((address,address,uint256,address,uint256,address,bytes))",
      "previewMorphoRefinanceOut((address,address,uint256,address,uint256,address,bytes))",
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
          facetAddress: await aaveInterfaceFacet.getAddress(),
          action: 0,
          functionSelectors: aaveSelectors,
        },
        {
          facetAddress: await morphoInterfaceFacet.getAddress(),
          action: 0,
          functionSelectors: morphoSelectors,
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
      ],
      ZeroAddress,
      "0x",
    );

    // ── 12. Initialize TermLoanIntentFacet ──────────────────────────────────
    const loanIntent = (await ethers.getContractAt(
      "TermLoanIntentFacet",
      diamondAddress,
    )) as TermLoanIntentFacet;
    await loanIntent.initializeTermIntentFacet(await termEventEmitter.getAddress());

    // ── 13. Configure TermControllerFacet ──────────────────────────────────
    const ctrlFacet = (await ethers.getContractAt(
      "TermControllerFacet",
      diamondAddress,
    )) as TermControllerFacet;
    await ctrlFacet.connect(devops).approveTermController(await termController.getAddress());
    await ctrlFacet.connect(devops).approveFeeRecipient(feeRecipient.address);

    // ── 14. Mark external protocols as approved ─────────────────────────────
    await termController.connect(admin).markTermApproved(aavePoolAddr);
    await termController.connect(admin).markTermApproved(morphoPoolAddr);

    // ── 15. Mark diamond as deployed (for event emitter access) ─────────────
    await termController.connect(controllerAdmin).markTermDeployed(diamondAddress);

    // ── 16. Pre-fund mock pools ─────────────────────────────────────────────
    const LARGE_PURCHASE = ethers.parseUnits("1000000", 6);
    const LARGE_COLLATERAL = ethers.parseEther("1000000");
    await testPurchaseToken.mint(aavePoolAddr, LARGE_PURCHASE);
    await testCollateralToken.mint(aavePoolAddr, LARGE_COLLATERAL);
    await testPurchaseToken.mint(morphoPoolAddr, LARGE_PURCHASE);
    await testCollateralToken.mint(morphoPoolAddr, LARGE_COLLATERAL);

    // ── 17. Run auction in period1 to create an active Term loan ───────────
    //
    // Flow:
    //   a) Lender locks offer (LOAN_AMOUNT at BORROW_RATE)
    //   b) Borrower locks bid (LOAN_AMOUNT at BORROW_RATE, COLLATERAL_AMOUNT collateral)
    //   c) Time-travel past reveal date
    //   d) Reveal both
    //   e) Time-travel past auction end
    //   f) completeAuction → borrower has active Term loan

    const termRepoLocker1Addr = await maturityPeriod1.termRepoLocker.getAddress();
    const bidLockerAddr = await maturityPeriod1.termAuctionBidLocker.getAddress();
    const offerLockerAddr = await maturityPeriod1.termAuctionOfferLocker.getAddress();

    // Fund participants
    await testPurchaseToken.mint(lender.address, LOAN_AMOUNT);
    await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNT);
    await testPurchaseToken.connect(lender).approve(termRepoLocker1Addr, LOAN_AMOUNT);
    await testCollateralToken.connect(borrower).approve(termRepoLocker1Addr, COLLATERAL_AMOUNT);

    // Offer: lender offers LOAN_AMOUNT at BORROW_RATE
    const offerId = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("offer-1")),
      maturityPeriod1.termAuctionOfferLocker,
      lender,
    );
    await maturityPeriod1.termAuctionOfferLocker.connect(lender).lockOffers([
      {
        id: ethers.keccak256(ethers.toUtf8Bytes("offer-1")),
        offeror: lender.address,
        offerPriceHash: solidityPackedKeccak256(
          ["uint256", "uint256"],
          [BORROW_RATE, OFFER_NONCE],
        ),
        amount: LOAN_AMOUNT,
        purchaseToken: await testPurchaseToken.getAddress(),
      },
    ]);

    // Bid: borrower bids LOAN_AMOUNT at BORROW_RATE with COLLATERAL_AMOUNT collateral
    const bidId = await getGeneratedTenderId(
      ethers.keccak256(ethers.toUtf8Bytes("bid-1")),
      maturityPeriod1.termAuctionBidLocker,
      borrower,
    );
    await maturityPeriod1.termAuctionBidLocker.connect(borrower).lockBids([
      {
        id: ethers.keccak256(ethers.toUtf8Bytes("bid-1")),
        bidder: borrower.address,
        bidPriceHash: solidityPackedKeccak256(
          ["uint256", "uint256"],
          [BORROW_RATE, BID_NONCE],
        ),
        amount: LOAN_AMOUNT,
        collateralAmounts: [COLLATERAL_AMOUNT],
        purchaseToken: await testPurchaseToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
      },
    ]);

    // Time-travel past reveal date
    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1, minutes: 1 }).asSeconds(),
    ]);
    await network.provider.send("evm_mine", []);

    // Reveal offer
    await maturityPeriod1.termAuctionOfferLocker.connect(lender).revealOffers(
      [offerId],
      [BORROW_RATE],
      [OFFER_NONCE],
    );

    // Reveal bid
    await maturityPeriod1.termAuctionBidLocker.connect(borrower).revealBids(
      [bidId],
      [BORROW_RATE],
      [BID_NONCE],
    );

    // Time-travel past auction end
    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ minutes: 11 }).asSeconds(),
    ]);
    await network.provider.send("evm_mine", []);

    // Complete auction (use lender signer explicitly — maturityPeriod1.auction.runner has a
    // stale nonce because deployMaturityPeriod wraps the default signer in its own NonceManager)
    await maturityPeriod1.auction.connect(lender).completeAuction({
      revealedBidSubmissions: [bidId],
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [offerId],
      unrevealedOfferSubmissions: [],
    });

    // ── 18. Build EIP-712 domain for period2 lend orders ───────────────────
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
  // Scenario 1: Term → Aave
  // Borrower repays period1 Term loan and opens Aave collateral+borrow position.
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 1: Term to Aave refinance", async () => {
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const aavePoolAddr = await mockAavePool.getAddress();
    const servicer1Addr = await maturityPeriod1.termRepoServicer.getAddress();

    // Query borrower's repurchase obligation
    const repurchaseObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation).to.be.gt(0n);

    // Grant borrower → diamond approval for collateral (submitRepurchasePaymentHook will pull it)
    await testCollateralToken
      .connect(borrower)
      .approve(diamondAddress, COLLATERAL_AMOUNT);

    // Grant credit delegation so diamond can borrow purchaseToken on borrower's behalf from Aave
    await purchaseCreditDelegation.setBorrowAllowance(
      borrower.address,
      diamondAddress,
      repurchaseObligation * 2n, // generous allowance
    );

    // Fund the flash loan aggregator so it can transfer tokens to the diamond
    await testPurchaseToken.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation);

    // Build flash execute request
    const flashExecutor = await ethers.getContractAt(
      "TermFlashLoanExecutorFacet",
      diamondAddress,
    );

    const actions = [
      {
        // Action 0: repay Term loan, receive collateral from borrower
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
        // Action 1: supply collateral to Aave, borrow purchaseToken back
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: 0n, // back-propagated to repurchaseObligation
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("aaveRefinanceInHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: aavePoolAddr,
        additionalCalldata: "0x",
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: true,
    });
    await tx.wait();

    // Assertions:
    // 1. Borrower's period1 obligation is cleared
    const finalObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation).to.equal(0n);

    // 2. Borrower has Aave collateral position (received collateralATokens)
    const aTokenBalance = await collateralAToken.balanceOf(borrower.address);
    expect(aTokenBalance).to.be.gte(COLLATERAL_AMOUNT);

    // 3. Diamond has no residual tokens
    expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(0n);
    expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 2: Term → Morpho
  // Borrower repays period1 Term loan and opens Morpho collateral+borrow position.
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 2: Term to Morpho refinance", async () => {
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const morphoPoolAddr = await mockMorphoPool.getAddress();
    const servicer1Addr = await maturityPeriod1.termRepoServicer.getAddress();

    // Query borrower's repurchase obligation
    const repurchaseObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation).to.be.gt(0n);

    // Grant borrower → diamond approval for collateral
    await testCollateralToken
      .connect(borrower)
      .approve(diamondAddress, COLLATERAL_AMOUNT);

    // Fund the flash loan aggregator so it can transfer tokens to the diamond
    await testPurchaseToken.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation);

    const flashExecutor = await ethers.getContractAt(
      "TermFlashLoanExecutorFacet",
      diamondAddress,
    );

    // Encode Morpho market ID for action 1's additionalCalldata
    const morphoAdditionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32"],
      [refinanceMarketId],
    );

    const actions = [
      {
        // Action 0: repay Term loan, receive collateral
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
        // Action 1: supply collateral to Morpho, borrow purchaseToken
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: 0n, // back-propagated
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("morphoRefinanceInHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: morphoPoolAddr,
        additionalCalldata: morphoAdditionalCalldata,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: true,
    });
    await tx.wait();

    // Assertions:
    const finalObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation).to.equal(0n);

    // Diamond is clean
    expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(0n);
    expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 3: Term → Term
  // Borrower repays period1 loan and enters period2 loan via signed lend order.
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 3: Term to Term refinance", async () => {
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const servicer1Addr = await maturityPeriod1.termRepoServicer.getAddress();
    const servicer2Addr = await maturityPeriod2.termRepoServicer.getAddress();
    const repoLocker2Addr = await maturityPeriod2.termRepoLocker.getAddress();

    // Query repurchase obligation — new loan fill amount must cover it
    const repurchaseObligation = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(repurchaseObligation).to.be.gt(0n);

    // Lender for period2: must have purchaseToken and approve diamond
    await testPurchaseToken.mint(lender.address, repurchaseObligation);
    await testPurchaseToken.connect(lender).approve(diamondAddress, repurchaseObligation);

    // Borrower approvals:
    //   - collateral → for submitRepurchasePaymentHook to pull
    //   - purchaseToken → for settleLimitLendHook to pull borrowAmount back
    await testCollateralToken.connect(borrower).approve(diamondAddress, COLLATERAL_AMOUNT);
    await testPurchaseToken.connect(borrower).approve(diamondAddress, repurchaseObligation);

    // Fund the flash loan aggregator so it can transfer tokens to the diamond
    await testPurchaseToken.mint(await mockFlashLoanAggregator.getAddress(), repurchaseObligation);

    // Create signed lend order for period2
    const lendOrder = await makeLendOrder2(repurchaseObligation);
    const sig = await signLendOrder(lender, lendOrder);

    // Encode additionalCalldata for settleLimitLendHook
    const hookCalldata = encodeLendHookCalldata(
      [lendOrder],
      [sig],
      [repurchaseObligation],
    );

    const flashExecutor = await ethers.getContractAt(
      "TermFlashLoanExecutorFacet",
      diamondAddress,
    );

    const actions = [
      {
        // Action 0: repay period1 Term loan, receive collateral from borrower
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
        // Action 1: use collateral to enter period2 loan, get purchaseToken back
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: 0n, // back-propagated to repurchaseObligation
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("settleLimitLendHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer2Addr,
        additionalCalldata: hookCalldata,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: true,
    });
    await tx.wait();

    // Assertions:
    // 1. Period1 obligation cleared
    const finalObligation1 = await maturityPeriod1.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(finalObligation1).to.equal(0n);

    // 2. Borrower has period2 loan (positive repurchase obligation)
    const period2Obligation = await maturityPeriod2.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(period2Obligation).to.be.gt(0n);

    // 3. Diamond is clean
    expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(0n);
    expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 4: Aave → Term
  // Borrower repays Aave debt (with flash loan) and opens period2 Term loan.
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 4: Aave to Term refinance", async () => {
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const aavePoolAddr = await mockAavePool.getAddress();
    const servicer2Addr = await maturityPeriod2.termRepoServicer.getAddress();

    // Simulate borrower's Aave position:
    //   - borrower has collateralATokens (representing Aave collateral)
    //   - borrower has LOAN_AMOUNT of purchaseToken debt
    await collateralAToken.mint(borrower.address, COLLATERAL_AMOUNT);
    await collateralAToken.connect(borrower).approve(diamondAddress, COLLATERAL_AMOUNT);

    // Lender for period2: provides LOAN_AMOUNT purchaseToken
    await testPurchaseToken.mint(lender.address, LOAN_AMOUNT);
    await testPurchaseToken.connect(lender).approve(diamondAddress, LOAN_AMOUNT);

    // Borrower must approve diamond for purchaseToken (hook pulls borrowAmount back)
    await testPurchaseToken.connect(borrower).approve(diamondAddress, LOAN_AMOUNT);

    // Fund the flash loan aggregator so it can transfer tokens to the diamond
    await testPurchaseToken.mint(await mockFlashLoanAggregator.getAddress(), LOAN_AMOUNT);

    // Create signed lend order for period2
    const lendOrder = await makeLendOrder2(LOAN_AMOUNT, 2n);
    const sig = await signLendOrder(lender, lendOrder);
    const hookCalldata = encodeLendHookCalldata([lendOrder], [sig], [LOAN_AMOUNT]);

    const flashExecutor = await ethers.getContractAt(
      "TermFlashLoanExecutorFacet",
      diamondAddress,
    );

    const actions = [
      {
        // Action 0: repay Aave debt (purchaseToken), withdraw collateral
        inputToken: pAddr,
        maxInputAmount: LOAN_AMOUNT,
        outputToken: cAddr,
        minOutputAmount: COLLATERAL_AMOUNT,
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("aaveRefinanceOutHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: aavePoolAddr,
        additionalCalldata: "0x",
      },
      {
        // Action 1: enter period2 Term loan with collateral, get purchaseToken back
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: 0n, // back-propagated
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("settleLimitLendHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer2Addr,
        additionalCalldata: hookCalldata,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: true,
    });
    await tx.wait();

    // Assertions:
    // 1. Borrower's Aave collateral tokens were consumed (aTokens burned)
    const aTokenBalance = await collateralAToken.balanceOf(borrower.address);
    expect(aTokenBalance).to.equal(0n);

    // 2. Borrower has period2 Term loan
    const period2Obligation = await maturityPeriod2.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(period2Obligation).to.be.gt(0n);

    // 3. Diamond is clean
    expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(0n);
    expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 5: Morpho → Term
  // Borrower repays Morpho debt (with flash loan) and opens period2 Term loan.
  // ═══════════════════════════════════════════════════════════════════════════
  it("Scenario 5: Morpho to Term refinance", async () => {
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const morphoPoolAddr = await mockMorphoPool.getAddress();
    const servicer2Addr = await maturityPeriod2.termRepoServicer.getAddress();

    // Lender for period2
    await testPurchaseToken.mint(lender.address, LOAN_AMOUNT);
    await testPurchaseToken.connect(lender).approve(diamondAddress, LOAN_AMOUNT);

    // Borrower must approve diamond for purchaseToken (hook pulls borrowAmount back)
    await testPurchaseToken.connect(borrower).approve(diamondAddress, LOAN_AMOUNT);

    // Fund the flash loan aggregator so it can transfer tokens to the diamond
    await testPurchaseToken.mint(await mockFlashLoanAggregator.getAddress(), LOAN_AMOUNT);

    // Create signed lend order for period2
    const lendOrder = await makeLendOrder2(LOAN_AMOUNT, 3n);
    const sig = await signLendOrder(lender, lendOrder);
    const hookCalldata = encodeLendHookCalldata([lendOrder], [sig], [LOAN_AMOUNT]);

    // Morpho market ID encoded in additionalCalldata for morphoRefinanceOutHook
    const morphoAdditionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32"],
      [refinanceMarketId],
    );

    const flashExecutor = await ethers.getContractAt(
      "TermFlashLoanExecutorFacet",
      diamondAddress,
    );

    const actions = [
      {
        // Action 0: repay Morpho debt (purchaseToken), withdraw collateral
        inputToken: pAddr,
        maxInputAmount: LOAN_AMOUNT,
        outputToken: cAddr,
        minOutputAmount: COLLATERAL_AMOUNT,
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("morphoRefinanceOutHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: morphoPoolAddr,
        additionalCalldata: morphoAdditionalCalldata,
      },
      {
        // Action 1: enter period2 Term loan with collateral, get purchaseToken back
        inputToken: cAddr,
        maxInputAmount: COLLATERAL_AMOUNT,
        outputToken: pAddr,
        minOutputAmount: 0n, // back-propagated
        outputTokenAmountIn: 0n,
        usePermit2ForOutputTokenIn: false,
        method: sel("settleLimitLendHook((address,address,uint256,address,uint256,address,bytes))"),
        targetAddress: servicer2Addr,
        additionalCalldata: hookCalldata,
      },
    ];

    const tx = await flashExecutor.connect(borrower).flashExecute({
      flashLoanRoute: 0,
      flashLoanInstaData: "0x",
      flashLoanToken: pAddr,
      actions,
      backPropagate: true,
    });
    await tx.wait();

    // Assertions:
    // 1. Borrower has period2 Term loan
    const period2Obligation = await maturityPeriod2.termRepoServicer
      .getBorrowerRepurchaseObligation(borrower.address);
    expect(period2Obligation).to.be.gt(0n);

    // 2. Diamond is clean
    expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(0n);
    expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(0n);
  });
});
