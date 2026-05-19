/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import dayjs from "dayjs";
import { ZeroAddress } from "ethers";
import { deployMaturityPeriod, MaturityPeriodInfo } from "../utils/deploy-utils";
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
 * IntentOrders Integration Tests
 *
 * End-to-end tests for TermLoanIntentFacet settlement through a real TermDiamond,
 * deployed using deployMaturityPeriod with real TermRepoServicer / TermRepoCollateralManager.
 *
 * Tests all 4 LimitLendOrder retrieveFunds variants and 5 LimitBorrowOrder variants.
 */
describe("IntentOrders Integration Tests", () => {
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
  let maturityPeriod: MaturityPeriodInfo;

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

  // Vault mocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let purchaseVault: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collateralVault: any;

  // Diamond
  let loanIntent: TermLoanIntentFacet;
  let loanIntentFacetImpl: TermLoanIntentFacet;
  let diamondAddress: string;
  let termRepoLockerAddress: string;
  let termRepoServicerAddress: string;

  // EIP-712
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let domain: any;

  // Function selectors
  let AAVE_WITHDRAW_SELECTOR: string;
  let AAVE_BORROW_SELECTOR: string;
  let MORPHO_BORROW_SELECTOR: string;
  let MORPHO_WITHDRAW_COLLATERAL_SELECTOR: string;
  let VAULT_WITHDRAW_SELECTOR: string;

  // Morpho market IDs
  let lendMarketId: string;
  let borrowMarketId: string;

  let snapshotId: string;

  // EIP-712 type definitions
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
  const BORROW_ORDER_TYPES = {
    RetrieveFundsStruct: RETRIEVE_FUNDS_TYPE,
    LimitBorrowOrder: [
      { name: "repoServicer", type: "address" },
      { name: "purchaseTokenAmount", type: "uint256" },
      { name: "collateralAmounts", type: "uint256[]" },
      { name: "offerRate", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "taker", type: "address" },
      { name: "borrowFee", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "retrieveFundsList", type: "RetrieveFundsStruct[]" },
    ],
  };

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
  async function signBorrowOrder(signer: SignerWithAddress, order: any) {
    const sig = await signer.signTypedData(domain, BORROW_ORDER_TYPES, order);
    const { v, r, s } = ethers.Signature.from(sig);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [v, r, s],
    );
    return { sigType: 0, sigData };
  }

  const sel = (sig: string) => ethers.id(sig).slice(0, 10);

  const FILL_AMOUNT = ethers.parseUnits("1000", 6);
  const COLLATERAL_AMOUNTS = [ethers.parseEther("1500")];
  const OFFER_RATE = ethers.parseUnits("5", 16);
  let ORDER_EXPIRY_TS: bigint;
  const ORDER_EXPIRY = () => ORDER_EXPIRY_TS;

  before(async () => {
    upgrades.silenceWarnings();
    wallets = await ethers.getSigners();
    lender = wallets[0];
    borrower = wallets[1];
    feeRecipient = wallets[2];
    devops = wallets[4];

    const initialBlock = await ethers.provider.getBlock("latest");
    ORDER_EXPIRY_TS = BigInt(initialBlock!.timestamp + 86400 * 365);
    controllerAdmin = wallets[5];
    admin = wallets[6];
    treasury = wallets[7];
    protocolReserve = wallets[8];

    // ── 1. Deploy purchase and collateral tokens ──────────────────────────────
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.waitForDeployment();
    await testPurchaseToken.initialize("Purchase Token", "PT", 6, [], []);

    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.waitForDeployment();
    await testCollateralToken.initialize("Collateral Token", "CT", 18, [], []);

    // ── 2. Deploy TermPriceConsumerV3 ─────────────────────────────────────────
    const termPriceOracleFactory =
      await ethers.getContractFactory("TermPriceConsumerV3");
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [devops.address],
      { kind: "uups" },
    )) as unknown as TermPriceConsumerV3;

    // ── 3. Deploy TermController ──────────────────────────────────────────────
    const termControllerFactory =
      await ethers.getContractFactory("TermController");
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

    // ── 4. Deploy TermInitializer and TermEventEmitter ────────────────────────
    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      treasury.address,
      wallets[3].address,
    );
    await termInitializer.waitForDeployment();
    await termController
      .connect(admin)
      .pairInitializer(await termInitializer.getAddress());

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

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
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

    // ── 5. Price feeds ────────────────────────────────────────────────────────
    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    // Purchase token: $1.00 (8-decimal Chainlink feed, answer = 1e8)
    const mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      8, "", 1, 1, 100000000n, 1, 1, 1,
    );
    // Collateral token: $1.00 (same price for easy ratio math: 150% -> 1500 tokens)
    const mockCollateralFeed = await mockPriceFeedFactory.deploy(
      8, "", 1, 1, 100000000n, 1, 1, 1,
    );
    await termOracle
      .connect(devops)
      .addNewTokenPriceFeed(
        await testPurchaseToken.getAddress(),
        await mockPurchaseFeed.getAddress(),
        0,
      );
    await termOracle
      .connect(devops)
      .addNewTokenPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed.getAddress(),
        0,
      );

    // ── 6. Deploy maturity period (real TermRepoServicer etc.) ────────────────
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = dayjs.unix(latestBlock!.timestamp);
    const auctionStart = now.subtract(1, "minute");
    const auctionReveal = auctionStart.add(1, "day");
    const auctionEnd = auctionReveal.add(10, "minute");
    const maturity = auctionEnd.add(1, "month");

    maturityPeriod = await deployMaturityPeriod(
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
        minimumTenderAmount: "10",
        repurchaseWindow: "86400",
        redemptionBuffer: "300",
        netExposureCapOnLiquidation: "5" + "0".repeat(16),
        deMinimisMarginThreshold: "50" + "0".repeat(18),
        liquidateDamangesDueToProtocol: "3" + "0".repeat(16),
        servicingFee: "3" + "0".repeat(15),
        purchaseTokenAddress: await testPurchaseToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        initialCollateralRatios: ["15" + "0".repeat(17)],
        maintenanceCollateralRatios: ["125" + "0".repeat(16)],
        liquidatedDamages: ["5" + "0".repeat(16)],
        mintExposureCap: "1000000000000000000",
        termApprovalMultisig: treasury,
        devopsMultisig: devops.address,
        adminWallet: admin.address,
        controllerAdmin: controllerAdmin,
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );

    diamondAddress = await maturityPeriod.termDiamond.getAddress();
    termRepoLockerAddress = await maturityPeriod.termRepoLocker.getAddress();
    termRepoServicerAddress = await maturityPeriod.termRepoServicer.getAddress();

    // ── 7. Deploy Aave mock infrastructure ────────────────────────────────────
    const MockATokenFactory = await ethers.getContractFactory("TestMockAToken");
    purchaseAToken = await MockATokenFactory.deploy();
    await purchaseAToken.waitForDeployment();
    collateralAToken = await MockATokenFactory.deploy();
    await collateralAToken.waitForDeployment();

    const MockCreditDelegFactory = await ethers.getContractFactory(
      "TestMockCreditDelegationToken",
    );
    purchaseCreditDelegation = await MockCreditDelegFactory.deploy();
    await purchaseCreditDelegation.waitForDeployment();
    collateralCreditDelegation = await MockCreditDelegFactory.deploy();
    await collateralCreditDelegation.waitForDeployment();

    const MockDataProviderFactory = await ethers.getContractFactory(
      "TestMockAavePoolDataProvider",
    );
    aaveDataProvider = await MockDataProviderFactory.deploy();
    await aaveDataProvider.waitForDeployment();

    const MockAddressesProviderFactory = await ethers.getContractFactory(
      "TestMockAavePoolAddressesProvider",
    );
    aaveAddressesProvider = await MockAddressesProviderFactory.deploy();
    await aaveAddressesProvider.waitForDeployment();

    const MockAavePoolFactory =
      await ethers.getContractFactory("TestMockAavePool");
    mockAavePool = await MockAavePoolFactory.deploy();
    await mockAavePool.waitForDeployment();

    // Wire up Aave stack
    await aaveAddressesProvider.setPoolDataProvider(
      await aaveDataProvider.getAddress(),
    );
    await mockAavePool.setAddressesProvider(
      await aaveAddressesProvider.getAddress(),
    );
    const pAddr = await testPurchaseToken.getAddress();
    const cAddr = await testCollateralToken.getAddress();
    const pAToken = await purchaseAToken.getAddress();
    const cAToken = await collateralAToken.getAddress();
    const pCreditDeleg = await purchaseCreditDelegation.getAddress();
    const cCreditDeleg = await collateralCreditDelegation.getAddress();
    const aavePoolAddr = await mockAavePool.getAddress();

    // Data provider: used by _lookupReserveTokens (variableDebtToken must be non-zero)
    await aaveDataProvider.setReserveTokensAddresses(
      pAddr, pAToken, pCreditDeleg, pCreditDeleg,
    );
    await aaveDataProvider.setReserveTokensAddresses(
      cAddr, cAToken, cCreditDeleg, cCreditDeleg,
    );
    // Pool storage: used by pool.withdraw to burn aTokens
    await mockAavePool.setReserveTokens(pAddr, pAToken, pCreditDeleg, pCreditDeleg);
    await mockAavePool.setReserveTokens(cAddr, cAToken, cCreditDeleg, cCreditDeleg);

    // ── 8. Deploy Morpho mock pool ────────────────────────────────────────────
    const MockMorphoFactory =
      await ethers.getContractFactory("TestMockMorphoPool");
    mockMorphoPool = await MockMorphoFactory.deploy();
    await mockMorphoPool.waitForDeployment();
    const morphoPoolAddr = await mockMorphoPool.getAddress();

    // Use aavePool address as dummy oracle/irm (any non-zero address)
    const lltv = 8n * 10n ** 17n;
    const oracleAddr = aavePoolAddr;
    const irmAddr = aavePoolAddr;

    // lendMarket: loanToken=purchaseToken  (borrow yields purchaseToken)
    // borrowMarket: loanToken=collateralToken (borrow yields collateralToken)
    lendMarketId = computeMarketId(pAddr, cAddr, oracleAddr, irmAddr, lltv);
    borrowMarketId = computeMarketId(cAddr, pAddr, oracleAddr, irmAddr, lltv);

    await mockMorphoPool.setMarketParams(lendMarketId, [
      pAddr, cAddr, oracleAddr, irmAddr, lltv,
    ]);
    await mockMorphoPool.setMarketParams(borrowMarketId, [
      cAddr, pAddr, oracleAddr, irmAddr, lltv,
    ]);

    // ── 9. Deploy vault mocks (no proxy needed) ───────────────────────────────
    const MockVaultFactory = await ethers.getContractFactory("TestMockVault");
    purchaseVault = await MockVaultFactory.deploy();
    await purchaseVault.waitForDeployment();
    await purchaseVault.initialize(pAddr, "Purchase Vault", "PV");

    collateralVault = await MockVaultFactory.deploy();
    await collateralVault.waitForDeployment();
    await collateralVault.initialize(cAddr, "Collateral Vault", "CV");

    // ── 10. Deploy facets ─────────────────────────────────────────────────────
    const DiamondLoupeFacetFactory =
      await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();

    const TermControllerFacetFactory =
      await ethers.getContractFactory("TermControllerFacet");
    const termControllerFacet = await TermControllerFacetFactory.deploy();
    await termControllerFacet.waitForDeployment();

    const TermLoanIntentFacetFactory =
      await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacetImpl = await TermLoanIntentFacetFactory.deploy();
    await loanIntentFacetImpl.waitForDeployment();

    const TermAaveInterfaceFacetFactory =
      await ethers.getContractFactory("TermAaveInterfaceFacet");
    const aaveInterfaceFacet = await TermAaveInterfaceFacetFactory.deploy();
    await aaveInterfaceFacet.waitForDeployment();

    const TermMorphoInterfaceFacetFactory =
      await ethers.getContractFactory("TermMorphoInterfaceFacet");
    const morphoInterfaceFacet = await TermMorphoInterfaceFacetFactory.deploy(
      morphoPoolAddr,
    );
    await morphoInterfaceFacet.waitForDeployment();

    const ERC4626InterfaceFacetFactory =
      await ethers.getContractFactory("ERC4626InterfaceFacet");
    const erc4626Facet = await ERC4626InterfaceFacetFactory.deploy();
    await erc4626Facet.waitForDeployment();

    // ── 11. Diamond cut: add all facets ───────────────────────────────────────
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

    // Write-only Aave selectors (exclude view generateCalldata to avoid collision)
    const aaveSelectors = [
      "aaveApproveDelegationWithSig(address,address,uint256,uint256,uint8,bytes32,bytes32)",
      "aaveSupply(address,address,uint256,bool)",
      "aaveSupply(address,address,uint256,address,bool)",
      "aaveWithdrawOnBehalfOf(address,address,uint256)",
      "aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)",
      "aaveBorrow(address,address,uint256)",
      "aaveBorrow(address,address,uint256,address,bool)",
      "aaveRepay(address,address,uint256,bool)",
      "aaveRepay(address,address,uint256,address,bool)",
    ].map(sel);

    // Write-only Morpho selectors (exclude view generateCalldata)
    const morphoSelectors = [
      "morphoSetAuthorizationWithSig(address,(address,bool,uint256),(uint8,bytes32,bytes32),bool)",
      "morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)",
      "morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,address,bool)",
      "morphoSupply(address,(address,address,address,address,uint256),uint256,bool)",
      "morphoSupply(address,(address,address,address,address,uint256),uint256,address,bool)",
      "morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256)",
      "morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)",
      "morphoBorrow(address,(address,address,address,address,uint256),uint256)",
      "morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)",
      "morphoRepay(address,(address,address,address,address,uint256),uint256,bool)",
      "morphoRepay(address,(address,address,address,address,uint256),uint256,address,bool)",
    ].map(sel);

    // Write-only ERC4626 selectors (exclude view generateCalldata)
    const erc4626Selectors = [
      "depositToVault(address,uint256,bool)",
      "withdrawFromVault(address,uint256,bool)",
      "withdrawFromVault(address,uint256,address,bool,bool)",
      "redeemFromVault(address,uint256,bool)",
      "userApproveVault(address,uint256,bytes)",
      "userRevokeVault(address)",
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
          facetAddress: await loanIntentFacetImpl.getAddress(),
          action: 0,
          functionSelectors: loanIntentSelectors,
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
          facetAddress: await erc4626Facet.getAddress(),
          action: 0,
          functionSelectors: erc4626Selectors,
        },
      ],
      ZeroAddress,
      "0x",
    );

    // ── 12. Initialize TermLoanIntentFacet through diamond ────────────────────
    loanIntent = (await ethers.getContractAt(
      "TermLoanIntentFacet",
      diamondAddress,
    )) as TermLoanIntentFacet;
    await loanIntent.initializeTermIntentFacet(
      await termEventEmitter.getAddress(),
    );

    // ── 13. Configure TermControllerFacet (via diamond, needs DEVOPS_ROLE) ────
    const ctrlFacet = (await ethers.getContractAt(
      "TermControllerFacet",
      diamondAddress,
    )) as TermControllerFacet;
    await ctrlFacet
      .connect(devops)
      .approveTermController(await maturityPeriod.controller.getAddress());
    await ctrlFacet
      .connect(devops)
      .approveFeeRecipient(feeRecipient.address);

    // ── 14. Mark external protocols as approved in controller (ADMIN_ROLE) ────
    await termController.connect(admin).markTermApproved(aavePoolAddr);
    await termController
      .connect(admin)
      .markTermApproved(await purchaseVault.getAddress());
    await termController
      .connect(admin)
      .markTermApproved(await collateralVault.getAddress());

    // ── 15. Ensure diamond is whitelisted for event emitter access ────────────
    // markTermDeployed requires CONTROLLER_ADMIN_ROLE
    await termController
      .connect(controllerAdmin)
      .markTermDeployed(diamondAddress);

    // ── 16. Pre-fund mock pools with large token reserves ─────────────────────
    const LARGE_PURCHASE = ethers.parseUnits("1000000", 6);
    const LARGE_COLLATERAL = ethers.parseEther("1000000");
    await testPurchaseToken.mint(aavePoolAddr, LARGE_PURCHASE);
    await testCollateralToken.mint(aavePoolAddr, LARGE_COLLATERAL);
    await testPurchaseToken.mint(morphoPoolAddr, LARGE_PURCHASE);
    await testCollateralToken.mint(morphoPoolAddr, LARGE_COLLATERAL);

    // ── 17. Build EIP-712 domain ──────────────────────────────────────────────
    // version() returns "development" in test builds (Versionable)
    const versionStr = await loanIntentFacetImpl.version();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = {
      name: "TermFinance",
      version: versionStr,
      chainId,
      verifyingContract: diamondAddress,
    };

    // ── 18. Cache function selectors ──────────────────────────────────────────
    AAVE_WITHDRAW_SELECTOR = sel(
      "aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)",
    );
    AAVE_BORROW_SELECTOR = sel("aaveBorrow(address,address,uint256,address,bool)");
    MORPHO_BORROW_SELECTOR = sel(
      "morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)",
    );
    MORPHO_WITHDRAW_COLLATERAL_SELECTOR = sel(
      "morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)",
    );
    VAULT_WITHDRAW_SELECTOR = sel(
      "withdrawFromVault(address,uint256,address,bool,bool)",
    );
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // ── Order helpers ──────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeLendOrder(overrides: any = {}) {
    return {
      repoServicer: termRepoServicerAddress,
      purchaseTokenAmount: FILL_AMOUNT,
      offerRate: OFFER_RATE,
      maker: lender.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: feeRecipient.address,
      expiry: ORDER_EXPIRY(),
      salt: 1n,
      retrieveFunds: {
        method: "0x00000000",
        target: ZeroAddress,
        additionalCalldata: "0x",
      },
      ...overrides,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeBorrowOrder(overrides: any = {}) {
    return {
      repoServicer: termRepoServicerAddress,
      purchaseTokenAmount: FILL_AMOUNT,
      collateralAmounts: COLLATERAL_AMOUNTS,
      offerRate: OFFER_RATE,
      maker: borrower.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: feeRecipient.address,
      expiry: ORDER_EXPIRY(),
      salt: 1n,
      retrieveFundsList: [
        {
          method: "0x00000000",
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      ],
      ...overrides,
    };
  }

  // ── FulfillOrder encode helpers ────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function encodeLendFillParams(order: any, fillAmount: bigint, sig: any): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address,uint256,uint256,address,address,uint256,address,uint256,uint256,tuple(bytes4,address,bytes)),uint256,tuple(uint8,bytes))"],
      [[
        [
          order.repoServicer, order.purchaseTokenAmount, order.offerRate,
          order.maker, order.taker, order.borrowFee, order.feeRecipient,
          order.expiry, order.salt,
          [order.retrieveFunds.method, order.retrieveFunds.target, order.retrieveFunds.additionalCalldata],
        ],
        fillAmount,
        [sig.sigType, sig.sigData],
      ]],
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function encodeBorrowFillParams(order: any, sig: any): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(tuple(address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,tuple(bytes4,address,bytes)[]),tuple(uint8,bytes))"],
      [[
        [
          order.repoServicer, order.purchaseTokenAmount, order.collateralAmounts,
          order.offerRate, order.maker, order.taker, order.borrowFee, order.feeRecipient,
          order.expiry, order.salt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          order.retrieveFundsList.map((r: any) => [r.method, r.target, r.additionalCalldata]),
        ],
        [sig.sigType, sig.sigData],
      ]],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LimitLendOrder tests
  // maker = lender (wallets[0]), taker/caller = borrower (wallets[1])
  // Borrower must approve termRepoLocker for collateral in all cases.
  // ═══════════════════════════════════════════════════════════════════════════
  describe("LimitLendOrder", () => {
    it("Test 1: aaveWithdrawOnBehalfOf", async () => {
      // Lender has aTokens; pool has purchase tokens to send after burning aTokens
      await purchaseAToken.mint(lender.address, FILL_AMOUNT);
      await purchaseAToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);
      await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await testCollateralToken
        .connect(borrower)
        .approve(termRepoLockerAddress, COLLATERAL_AMOUNTS[0]);

      const order = makeLendOrder({
        retrieveFunds: {
          method: AAVE_WITHDRAW_SELECTOR,
          target: await mockAavePool.getAddress(),
          additionalCalldata: "0x",
        },
      });
      const sig = await signLendOrder(lender, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      const diamondPurchaseATokenBefore = await purchaseAToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(borrower)
        ["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
          order, FILL_AMOUNT, COLLATERAL_AMOUNTS, sig, false,
        );
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
      expect(await purchaseAToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseATokenBefore);
    });

    it("Test 2: aaveBorrow", async () => {
      // Lender grants credit delegation to diamond so diamond can borrow on lender's behalf
      await purchaseCreditDelegation.setBorrowAllowance(
        lender.address,
        diamondAddress,
        FILL_AMOUNT,
      );
      await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await testCollateralToken
        .connect(borrower)
        .approve(termRepoLockerAddress, COLLATERAL_AMOUNTS[0]);

      const order = makeLendOrder({
        retrieveFunds: {
          method: AAVE_BORROW_SELECTOR,
          target: await mockAavePool.getAddress(),
          additionalCalldata: "0x",
        },
      });
      const sig = await signLendOrder(lender, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(borrower)
        ["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
          order, FILL_AMOUNT, COLLATERAL_AMOUNTS, sig, false,
        );
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
    });

    it("Test 3: morphoBorrow", async () => {
      // lendMarket: loanToken=purchaseToken → borrow yields purchaseToken
      await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await testCollateralToken
        .connect(borrower)
        .approve(termRepoLockerAddress, COLLATERAL_AMOUNTS[0]);

      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [lendMarketId],
      );
      const order = makeLendOrder({
        retrieveFunds: {
          method: MORPHO_BORROW_SELECTOR,
          target: await mockMorphoPool.getAddress(),
          additionalCalldata,
        },
      });
      const sig = await signLendOrder(lender, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(borrower)
        ["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
          order, FILL_AMOUNT, COLLATERAL_AMOUNTS, sig, false,
        );
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
    });

    it("Test 4: withdrawFromVault", async () => {
      // Lender deposits purchase tokens into vault, then approves diamond for shares
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken
        .connect(lender)
        .approve(await purchaseVault.getAddress(), FILL_AMOUNT);
      await purchaseVault.connect(lender).deposit(FILL_AMOUNT, lender.address);
      const shares = await purchaseVault.balanceOf(lender.address);
      await purchaseVault.connect(lender).approve(diamondAddress, shares);

      await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await testCollateralToken
        .connect(borrower)
        .approve(termRepoLockerAddress, COLLATERAL_AMOUNTS[0]);

      const order = makeLendOrder({
        retrieveFunds: {
          method: VAULT_WITHDRAW_SELECTOR,
          target: await purchaseVault.getAddress(),
          additionalCalldata: "0x",
        },
      });
      const sig = await signLendOrder(lender, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      const diamondPurchaseVaultBefore = await purchaseVault.balanceOf(diamondAddress);
      await loanIntent
        .connect(borrower)
        ["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
          order, FILL_AMOUNT, COLLATERAL_AMOUNTS, sig, false,
        );
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await purchaseVault.balanceOf(lender.address)).to.equal(0n);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
      expect(await purchaseVault.balanceOf(diamondAddress)).to.equal(diamondPurchaseVaultBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LimitBorrowOrder tests
  // maker = borrower (wallets[1]), taker/caller = lender (wallets[0])
  // Lender must approve diamond for purchase tokens in all cases.
  // isRoutedCollateral = true: collateral comes through diamond via retrieveFunds.
  // ═══════════════════════════════════════════════════════════════════════════
  describe("LimitBorrowOrder", () => {
    it("Test 5: aaveWithdrawOnBehalfOf (for collateral)", async () => {
      // Lender provides purchase tokens; borrower's collateral comes from Aave withdrawal
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);
      await collateralAToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await collateralAToken
        .connect(borrower)
        .approve(diamondAddress, COLLATERAL_AMOUNTS[0]);

      const order = makeBorrowOrder({
        retrieveFundsList: [
          {
            method: AAVE_WITHDRAW_SELECTOR,
            target: await mockAavePool.getAddress(),
            additionalCalldata: "0x",
          },
        ],
      });
      const sig = await signBorrowOrder(borrower, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      const diamondCollateralATokenBefore = await collateralAToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(lender)
        ["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](order, FILL_AMOUNT, sig, false);
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
      expect(await collateralAToken.balanceOf(diamondAddress)).to.equal(diamondCollateralATokenBefore);
    });

    it("Test 6: aaveBorrow (for collateral)", async () => {
      // Borrower uses credit delegation to borrow collateral token from Aave
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);
      await collateralCreditDelegation.setBorrowAllowance(
        borrower.address,
        diamondAddress,
        COLLATERAL_AMOUNTS[0],
      );

      const order = makeBorrowOrder({
        retrieveFundsList: [
          {
            method: AAVE_BORROW_SELECTOR,
            target: await mockAavePool.getAddress(),
            additionalCalldata: "0x",
          },
        ],
      });
      const sig = await signBorrowOrder(borrower, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(lender)
        ["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](order, FILL_AMOUNT, sig, false);
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
    });

    it("Test 7: morphoBorrow (for collateral)", async () => {
      // borrowMarket: loanToken=collateralToken → morpho borrow yields collateralToken
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);

      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [borrowMarketId],
      );
      const order = makeBorrowOrder({
        retrieveFundsList: [
          {
            method: MORPHO_BORROW_SELECTOR,
            target: await mockMorphoPool.getAddress(),
            additionalCalldata,
          },
        ],
      });
      const sig = await signBorrowOrder(borrower, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(lender)
        ["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](order, FILL_AMOUNT, sig, false);
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
    });

    it("Test 8: withdrawFromVault (for collateral)", async () => {
      // Borrower deposits collateral into vault, then approves diamond for shares
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);

      await testCollateralToken.mint(borrower.address, COLLATERAL_AMOUNTS[0]);
      await testCollateralToken
        .connect(borrower)
        .approve(await collateralVault.getAddress(), COLLATERAL_AMOUNTS[0]);
      await collateralVault
        .connect(borrower)
        .deposit(COLLATERAL_AMOUNTS[0], borrower.address);
      const shares = await collateralVault.balanceOf(borrower.address);
      await collateralVault.connect(borrower).approve(diamondAddress, shares);

      const order = makeBorrowOrder({
        retrieveFundsList: [
          {
            method: VAULT_WITHDRAW_SELECTOR,
            target: await collateralVault.getAddress(),
            additionalCalldata: "0x",
          },
        ],
      });
      const sig = await signBorrowOrder(borrower, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      const diamondCollateralVaultBefore = await collateralVault.balanceOf(diamondAddress);
      await loanIntent
        .connect(lender)
        ["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](order, FILL_AMOUNT, sig, false);
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await collateralVault.balanceOf(borrower.address)).to.equal(0n);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
      expect(await collateralVault.balanceOf(diamondAddress)).to.equal(diamondCollateralVaultBefore);
    });

    it("Test 9: morphoWithdrawCollateral", async () => {
      // lendMarket has collateralToken as collateral; morphoWithdrawCollateral sends it
      await testPurchaseToken.mint(lender.address, FILL_AMOUNT);
      await testPurchaseToken.connect(lender).approve(diamondAddress, FILL_AMOUNT);

      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [lendMarketId],
      );
      const order = makeBorrowOrder({
        retrieveFundsList: [
          {
            method: MORPHO_WITHDRAW_COLLATERAL_SELECTOR,
            target: await mockMorphoPool.getAddress(),
            additionalCalldata,
          },
        ],
      });
      const sig = await signBorrowOrder(borrower, order);

      const before = await testPurchaseToken.balanceOf(borrower.address);
      const diamondPurchaseBefore = await testPurchaseToken.balanceOf(diamondAddress);
      const diamondCollateralBefore = await testCollateralToken.balanceOf(diamondAddress);
      await loanIntent
        .connect(lender)
        ["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](order, FILL_AMOUNT, sig, false);
      const after = await testPurchaseToken.balanceOf(borrower.address);

      expect(after - before).to.equal(FILL_AMOUNT);
      expect(await testPurchaseToken.balanceOf(diamondAddress)).to.equal(diamondPurchaseBefore);
      expect(await testCollateralToken.balanceOf(diamondAddress)).to.equal(diamondCollateralBefore);
    });
  });
});
