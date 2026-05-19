/* eslint-disable no-unused-expressions */
/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  MockContract,
  deployMockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";
import { ZeroAddress, ZeroHash } from "ethers";
import {
  TermDiamond,
  DiamondCutFacet,
  TermLoanIntentFacet,
  TermRepoTokenIntentFacet,
  TermControllerFacet,
} from "../typechain-types";

/**
 * Unit Tests for TermSettlementWithHooksFacet
 *
 * Achieves 100% branch and line coverage of contracts/facets/TermSettlementWithHooksFacet.sol
 */
describe("TermSettlementWithHooksFacet Unit Tests", () => {
  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let maker: SignerWithAddress;
  let taker: SignerWithAddress;
  let approvedFeeRecipient: SignerWithAddress;

  let termDiamond: TermDiamond;
  let diamondCutFacet: DiamondCutFacet;

  // Facet implementations (deployed once in before())
  let loanIntentFacetImpl: TermLoanIntentFacet;
  let repoTokenIntentFacetImpl: TermRepoTokenIntentFacet;
  let settlementFacetImpl: any;
  let termControllerFacetImpl: TermControllerFacet;

  // Mock contracts
  let mockTermController: MockContract;
  let mockRepoServicer: MockContract;
  let mockCollateralManager: MockContract;
  let mockPurchaseToken: MockContract;
  let mockCollateralToken: MockContract;
  let mockTermEventEmitter: MockContract;
  let mockRepoToken: MockContract;

  // Pre-stored addresses for use in synchronous helpers
  let mockRepoServicerAddr: string;
  let mockPurchaseTokenAddr: string;
  let mockCollateralTokenAddr: string;
  let mockRepoTokenAddr: string;

  let snapshotId: any;

  let CURRENT_TIME: number;
  let MATURITY_TIME: number;
  let ORDER_EXPIRY: number;

  // Selector strings for the hook functions (the contract under test)
  const LEND_HOOK_SIG =
    "settleLimitLendWithHook((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),(bytes4,address,bytes)[])";
  const BORROW_HOOK_SIG =
    "settleLimitBorrowWithHook((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),(bytes4,address,bytes))";
  const SWAP_HOOK_SIG =
    "swapRepoTokenWithHook((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,(uint8,bytes),(bytes4,address,bytes))";

  // Selectors for retrieve funds test helpers
  let mockRetrieveFundsSelector: string;

  const FILL_AMOUNT = ethers.parseUnits("1000", 6);
  const COLLATERAL_AMOUNT = ethers.parseEther("100");

  before(async () => {
    [devops, admin, maker, taker, approvedFeeRecipient] =
      await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    CURRENT_TIME = latestBlock!.timestamp;
    MATURITY_TIME = CURRENT_TIME + 86400 * 30;
    ORDER_EXPIRY = CURRENT_TIME + 86400 * 365;

    // Precompute retrieve funds selector
    mockRetrieveFundsSelector = ethers
      .id("mockRetrieveFunds(address,uint256)")
      .slice(0, 10);

    // Deploy Permit2 no-op stub so SafeERC20 Permit2 calls don't revert
    await ethers.provider.send("hardhat_setCode", [
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "0x60006000f3",
    ]);

    // Deploy TermDiamondFactory and create diamond
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = await termDiamondFactoryFactory.deploy(
      admin.address,
      devops.address
    );
    await termDiamondFactory.waitForDeployment();

    const deployTx = await termDiamondFactory.deployDiamond();
    const receipt = await deployTx.wait();

    const diamondDeployedEvent = receipt?.logs.find(
      (log) =>
        log.topics[0] ===
        termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
    );
    if (!diamondDeployedEvent)
      throw new Error("DiamondDeployed event not found");

    const decodedEvent =
      termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    const diamondAddress = decodedEvent?.args[0];
    const diamondCutFacetAddr = decodedEvent?.args[1];

    termDiamond = (await ethers.getContractAt(
      "TermDiamond",
      diamondAddress
    )) as TermDiamond;
    diamondCutFacet = await ethers.getContractAt(
      "DiamondCutFacet",
      diamondCutFacetAddr
    );
    await diamondCutFacet.waitForDeployment();

    // Deploy facet implementations
    const TermLoanIntentFacetFactory =
      await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacetImpl =
      (await TermLoanIntentFacetFactory.deploy()) as TermLoanIntentFacet;
    await loanIntentFacetImpl.waitForDeployment();

    const TermRepoTokenIntentFacetFactory = await ethers.getContractFactory(
      "TermRepoTokenIntentFacet"
    );
    repoTokenIntentFacetImpl =
      (await TermRepoTokenIntentFacetFactory.deploy()) as TermRepoTokenIntentFacet;
    await repoTokenIntentFacetImpl.waitForDeployment();

    const TermSettlementWithHooksFacetFactory =
      await ethers.getContractFactory("TermSettlementWithHooksFacet");
    settlementFacetImpl = await TermSettlementWithHooksFacetFactory.deploy();
    await settlementFacetImpl.waitForDeployment();

    const TermControllerFacetFactory =
      await ethers.getContractFactory("TermControllerFacet");
    termControllerFacetImpl =
      (await TermControllerFacetFactory.deploy()) as TermControllerFacet;
    await termControllerFacetImpl.waitForDeployment();

    // Mock ABIs
    const termControllerABI = [
      "function isTermDeployed(address) external view returns (bool)",
      "function isFactoryDeployed(address) external view returns (bool)",
      "function getProtocolReserveAddress() external view returns (address)",
    ];
    const repoServicerABI = [
      "function termController() external view returns (address)",
      "function termRepoId() external view returns (bytes32)",
      "function maturityTimestamp() external view returns (uint256)",
      "function purchaseToken() external view returns (address)",
      "function termRepoCollateralManager() external view returns (address)",
      "function termRepoToken() external view returns (address)",
      "function termRepoLocker() external view returns (address)",
      "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
    ];
    const collateralManagerABI = [
      "function numOfAcceptedCollateralTokens() external view returns (uint8)",
      "function collateralTokens(uint256) external view returns (address)",
    ];
    const erc20ABI = [
      "function decimals() external view returns (uint8)",
      "function balanceOf(address) external view returns (uint256)",
      "function transfer(address,uint256) external returns (bool)",
      "function transferFrom(address,address,uint256) external returns (bool)",
      "function approve(address,uint256) external returns (bool)",
      "function mint(address,uint256) external",
    ];
    const repoTokenABI = [
      "function config() external view returns (uint256, address, address, uint256)",
      "function redemptionValue() external view returns (uint256)",
      "function transfer(address,uint256) external returns (bool)",
      "function transferFrom(address,address,uint256) external returns (bool)",
      "function mint(address,uint256) external",
    ];
    const eventEmitterABI = [
      "function emitLimitOrderTokenPairMinSaltValue(address, address, address, uint256) external",
      "function emitIntentCancelled(bytes32) external",
      "function emitIntentFilled(bytes32,bytes32,address,address,address,address,address,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256) external",
      "function emitRepoTokenSwapFilled(bytes32, (address,address,address,address,address,address,uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256)) external",
    ];

    // Deploy mocks
    mockTermController = await deployMockContract(devops, termControllerABI);
    mockRepoServicer = await deployMockContract(devops, repoServicerABI);
    mockCollateralManager = await deployMockContract(
      devops,
      collateralManagerABI
    );
    mockPurchaseToken = await deployMockContract(devops, erc20ABI);
    mockCollateralToken = await deployMockContract(devops, erc20ABI);
    mockTermEventEmitter = await deployMockContract(devops, eventEmitterABI);
    mockRepoToken = await deployMockContract(devops, repoTokenABI);

    // Store addresses for synchronous helpers
    mockRepoServicerAddr = await mockRepoServicer.getAddress();
    mockPurchaseTokenAddr = await mockPurchaseToken.getAddress();
    mockCollateralTokenAddr = await mockCollateralToken.getAddress();
    mockRepoTokenAddr = await mockRepoToken.getAddress();

    // Configure mock behaviors
    await mockTermController.mock.isTermDeployed.returns(true);
    await mockTermController.mock.isFactoryDeployed.returns(true);
    await mockTermController.mock.getProtocolReserveAddress.returns(
      approvedFeeRecipient.address
    );

    await mockRepoServicer.mock.termController.returns(
      await mockTermController.getAddress()
    );
    await mockRepoServicer.mock.termRepoId.returns(ZeroHash);
    await mockRepoServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
    await mockRepoServicer.mock.purchaseToken.returns(mockPurchaseTokenAddr);
    await mockRepoServicer.mock.termRepoCollateralManager.returns(
      await mockCollateralManager.getAddress()
    );
    await mockRepoServicer.mock.termRepoToken.returns(mockRepoTokenAddr);
    await mockRepoServicer.mock.termRepoLocker.returns(mockRepoTokenAddr);
    await mockRepoServicer.mock.mintOpenExposureFromIntent.returns(FILL_AMOUNT);

    await mockCollateralManager.mock.numOfAcceptedCollateralTokens.returns(1);
    await mockCollateralManager.mock.collateralTokens.returns(
      mockCollateralTokenAddr
    );

    await mockPurchaseToken.mock.decimals.returns(6);
    await mockPurchaseToken.mock.balanceOf.returns(
      ethers.parseUnits("1000000", 6)
    );
    await mockPurchaseToken.mock.transfer.returns(true);
    await mockPurchaseToken.mock.transferFrom.returns(true);
    await mockPurchaseToken.mock.approve.returns(true);
    await mockPurchaseToken.mock.mint.returns();

    await mockCollateralToken.mock.transfer.returns(true);
    await mockCollateralToken.mock.transferFrom.returns(true);
    await mockCollateralToken.mock.approve.returns(true);
    await mockCollateralToken.mock.mint.returns();

    await mockTermEventEmitter.mock.emitLimitOrderTokenPairMinSaltValue.returns();
    await mockTermEventEmitter.mock.emitIntentCancelled.returns();
    await mockTermEventEmitter.mock.emitIntentFilled.returns();
    await mockTermEventEmitter.mock.emitRepoTokenSwapFilled.returns();

    await mockRepoToken.mock.config.returns(
      MATURITY_TIME,
      mockPurchaseTokenAddr,
      mockRepoServicerAddr,
      0
    );
    await mockRepoToken.mock.redemptionValue.returns(
      ethers.parseUnits("1", 18)
    );
    await mockRepoToken.mock.transfer.returns(true);
    await mockRepoToken.mock.transferFrom.returns(true);
    await mockRepoToken.mock.mint.returns();
  });

  beforeEach(async () => {
    // Snapshot taken BEFORE adding facets (reverted in afterEach)
    snapshotId = await network.provider.send("evm_snapshot");

    const diamondCut = await ethers.getContractAt(
      "DiamondCutFacet",
      await termDiamond.getAddress()
    );

    const loanIntentSelectors = [
      "initializeTermIntentFacet(address)",
      "setPreSignedLendOrderHash((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      "setPreSignedBorrowOrderHash((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]))",
      // 5-arg internal version called by TermSettlementWithHooksFacet
      "settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,uint256[],(uint8,bytes))",
      // 4-arg-with-taker internal version called by TermSettlementWithHooksFacet
      "settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),address,uint256,(uint8,bytes))",
      "getLendOrderHash((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      "getBorrowOrderHash((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]))",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const repoTokenIntentSelectors = [
      "setPreSignedSwapHash((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      // 4-arg-with-taker internal version called by TermSettlementWithHooksFacet
      "swapRepoToken((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,(uint8,bytes))",
      "getSwapOrderHash((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const settlementSelectors = [
      LEND_HOOK_SIG,
      BORROW_HOOK_SIG,
      SWAP_HOOK_SIG,
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const controllerSelectors = [
      "approveTermController(address)",
      "revokeTermController(address)",
      "approveFeeRecipient(address)",
      "revokeFeeRecipient(address)",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const DiamondLoupeFacetFactory =
      await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();
    const loupeSelectors = [
      "facets()",
      "facetFunctionSelectors(address)",
      "facetAddresses()",
      "facetAddress(bytes4)",
      "diamondPaused()",
      "supportsInterface(bytes4)",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const TestRetrieveFundsFacetFactory =
      await ethers.getContractFactory("TestRetrieveFundsFacet");
    const testRetrieveFundsFacet = await TestRetrieveFundsFacetFactory.deploy();
    await testRetrieveFundsFacet.waitForDeployment();
    const retrieveFundsSelectors = [
      "noopForRetrieveFunds()",
      "mockRetrieveFunds(address,uint256)",
      "generateCalldata(bytes4,address,address,address,uint256,bool,bytes)",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    const TestAtomicTxHelperFactory = await ethers.getContractFactory(
      "TestAtomicTxProtectionHelper"
    );
    const testAtomicTxHelper = await TestAtomicTxHelperFactory.deploy();
    await testAtomicTxHelper.waitForDeployment();
    const atomicTxHelperSelectors = [
      "setAtomicTxInitiator(address)",
      "clearAtomicTxInitiator()",
    ].map((sig) => ethers.id(sig).slice(0, 10));

    await diamondCut.diamondCut(
      [
        {
          facetAddress: await loanIntentFacetImpl.getAddress(),
          action: 0,
          functionSelectors: loanIntentSelectors,
        },
        {
          facetAddress: await repoTokenIntentFacetImpl.getAddress(),
          action: 0,
          functionSelectors: repoTokenIntentSelectors,
        },
        {
          facetAddress: await settlementFacetImpl.getAddress(),
          action: 0,
          functionSelectors: settlementSelectors,
        },
        {
          facetAddress: await termControllerFacetImpl.getAddress(),
          action: 0,
          functionSelectors: controllerSelectors,
        },
        {
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0,
          functionSelectors: loupeSelectors,
        },
        {
          facetAddress: await testRetrieveFundsFacet.getAddress(),
          action: 0,
          functionSelectors: retrieveFundsSelectors,
        },
        {
          facetAddress: await testAtomicTxHelper.getAddress(),
          action: 0,
          functionSelectors: atomicTxHelperSelectors,
        },
      ],
      ZeroAddress,
      "0x"
    );

    // Initialize loan intent facet
    const loanIntent = await ethers.getContractAt(
      "TermLoanIntentFacet",
      await termDiamond.getAddress()
    );
    await loanIntent.initializeTermIntentFacet(
      await mockTermEventEmitter.getAddress()
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function approveTermControllerProper() {
    const tcf = await ethers.getContractAt(
      "TermControllerFacet",
      await termDiamond.getAddress()
    );
    await tcf
      .connect(devops)
      .approveTermController(await mockTermController.getAddress());
  }

  async function approveFeeRecipientProper() {
    const tcf = await ethers.getContractAt(
      "TermControllerFacet",
      await termDiamond.getAddress()
    );
    await tcf.connect(devops).approveFeeRecipient(approvedFeeRecipient.address);
  }

  // Synchronous order factories using pre-stored addresses
  function makeLendOrder(overrides: any = {}) {
    return {
      repoServicer: mockRepoServicerAddr,
      purchaseTokenAmount: FILL_AMOUNT,
      offerRate: ethers.parseUnits("5", 16),
      maker: maker.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: approvedFeeRecipient.address,
      expiry: BigInt(ORDER_EXPIRY),
      salt: 1n,
      retrieveFunds: {
        method: "0x00000000",
        target: ZeroAddress,
        additionalCalldata: "0x",
      },
      ...overrides,
    };
  }

  function makeBorrowOrder(overrides: any = {}) {
    return {
      repoServicer: mockRepoServicerAddr,
      purchaseTokenAmount: FILL_AMOUNT,
      collateralAmounts: [COLLATERAL_AMOUNT],
      offerRate: ethers.parseUnits("5", 16),
      maker: maker.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: approvedFeeRecipient.address,
      expiry: BigInt(ORDER_EXPIRY),
      salt: 1n,
      retrieveFundsList: [
        { method: "0x00000000", target: ZeroAddress, additionalCalldata: "0x" },
      ],
      ...overrides,
    };
  }

  function makeSwapOrder(overrides: any = {}) {
    return {
      repoToken: mockRepoTokenAddr,
      makerAssetIsPurchaseToken: false,
      purchaseTokenAmount: FILL_AMOUNT,
      discountRate: ethers.parseUnits("2", 16),
      maker: maker.address,
      taker: ZeroAddress,
      makerFee: 0n,
      takerFee: 0n,
      feeRecipient: approvedFeeRecipient.address,
      expiry: BigInt(ORDER_EXPIRY),
      salt: 1n,
      retrieveFunds: {
        method: "0x00000000",
        target: ZeroAddress,
        additionalCalldata: "0x",
      },
      ...overrides,
    };
  }

  const zeroRetrieveFunds = () => ({
    method: "0x00000000",
    target: ZeroAddress,
    additionalCalldata: "0x",
  });

  const mockRetrieveFunds = () => ({
    method: mockRetrieveFundsSelector,
    target: ZeroAddress,
    additionalCalldata: "0x",
  });

  // A non-zero selector that is NOT registered in the diamond
  const invalidRetrieveFunds = () => ({
    method: "0x12345678",
    target: ZeroAddress,
    additionalCalldata: "0x",
  });

  // Presigned signature (sigType=1 = PRESIGN, sigData irrelevant)
  const PRESIGNED_SIG = { sigType: 1, sigData: "0x" };
  // Invalid EIP712 signature that will fail at settlement — used to trigger reverts past the loop
  const INVALID_SIG = { sigType: 0, sigData: "0x00" };

  // ═══════════════════════════════════════════════════════════════════════════
  // settleLimitLendWithHook
  // ═══════════════════════════════════════════════════════════════════════════

  describe("settleLimitLendWithHook", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("reverts InvalidFillAmount when fillAmount == 0", async () => {
      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          0n,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidFillAmount");
    });

    it("reverts InvalidCollateralAmountsInput when collateralAmounts.length != numOfAcceptedCollateralTokens", async () => {
      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      // numOfAcceptedCollateralTokens returns 1, but we provide 2
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT, COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds(), mockRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InvalidCollateralAmountsInput"
      );
    });

    it("reverts InvalidRetrieveFundsListLength when retrieveFundsList.length != collateralAmounts.length", async () => {
      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      // collateralAmounts length 1, retrieveFundsList length 2
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds(), mockRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InvalidRetrieveFundsListLength"
      );
    });

    it("reverts RetrieveFundsNotSpecified when collateralAmounts[i] > 0 and method == bytes4(0)", async () => {
      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [zeroRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(settlement, "RetrieveFundsNotSpecified");
    });

    it("reverts InvalidRetrieveFundsFunction when method is non-zero but not in diamond", async () => {
      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [invalidRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InvalidRetrieveFundsFunction"
      );
    });

    it("reverts InsufficientRemainingCapacity when fillAmount > purchaseTokenAmount", async () => {
      const order = makeLendOrder({ purchaseTokenAmount: FILL_AMOUNT });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT + 1n,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds()]
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InsufficientRemainingCapacity"
      );
    });

    it("covers continue branch when collateralAmounts[i] == 0 (skips retrieve funds for zero-amount entry)", async () => {
      // collateralAmounts[0] == 0 → inner loop hits 'continue' (line 68-70 in contract)
      // Pre-loop validation: since amount==0, _validateRetrieveFunds is NOT called (short-circuit)
      // After loop: settleLimitLend is called but fails at signature check (invalid sig)
      // The 'continue' branch is covered before the eventual revert
      const order = makeLendOrder({ purchaseTokenAmount: FILL_AMOUNT });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [0n], // amount == 0 → continue
          INVALID_SIG, // will fail at settleLimitLend signature check
          [zeroRetrieveFunds()] // method==0 but never validated since amount==0
        )
      ).to.be.reverted;
    });

    it("succeeds end-to-end: presigned lend order with mockRetrieveFunds hook minting collateral", async () => {
      const TestToken = await ethers.getContractFactory("TestToken");
      const collateralToken = await TestToken.deploy();
      await collateralToken.waitForDeployment();
      await collateralToken.initialize("Test ETH", "TETH", 18, [], []);
      const collateralTokenAddr = await collateralToken.getAddress();

      const collateralManager = await deployMockContract(devops, [
        "function numOfAcceptedCollateralTokens() external view returns (uint8)",
        "function collateralTokens(uint256) external view returns (address)",
      ]);
      await collateralManager.mock.numOfAcceptedCollateralTokens.returns(1);
      await collateralManager.mock.collateralTokens.returns(collateralTokenAddr);

      const repoServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await repoServicer.mock.termController.returns(await mockTermController.getAddress());
      await repoServicer.mock.termRepoId.returns(ZeroHash);
      await repoServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await repoServicer.mock.purchaseToken.returns(mockPurchaseTokenAddr);
      await repoServicer.mock.termRepoCollateralManager.returns(await collateralManager.getAddress());
      await repoServicer.mock.termRepoToken.returns(mockRepoTokenAddr);
      await repoServicer.mock.termRepoLocker.returns(mockRepoTokenAddr);
      await repoServicer.mock.mintOpenExposureFromIntent.returns(FILL_AMOUNT);

      const order = makeLendOrder({
        repoServicer: await repoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: FILL_AMOUNT,
        offerRate: ethers.parseUnits("5", 16),
        feeRecipient: approvedFeeRecipient.address,
      });

      // Maker presigns the lend order
      const loanIntent = await ethers.getContractAt(
        "TermLoanIntentFacet",
        await termDiamond.getAddress()
      );
      await loanIntent.connect(maker).setPreSignedLendOrderHash(order);

      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );

      // Taker calls hook: mockRetrieveFunds mints real collateral to diamond,
      // balance check passes, then settleLimitLend runs with mocked servicer
      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds()]
        )
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // settleLimitBorrowWithHook
  // ═══════════════════════════════════════════════════════════════════════════

  describe("settleLimitBorrowWithHook", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("reverts InvalidFillAmount when fillAmount == 0", async () => {
      const order = makeBorrowOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[BORROW_HOOK_SIG](
          order,
          0n,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidFillAmount");
    });

    it("reverts RetrieveFundsNotSpecified when retrieveFunds.method == bytes4(0)", async () => {
      const order = makeBorrowOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[BORROW_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          zeroRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(settlement, "RetrieveFundsNotSpecified");
    });

    it("reverts InvalidRetrieveFundsFunction when method is non-zero but not in diamond", async () => {
      const order = makeBorrowOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[BORROW_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          invalidRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InvalidRetrieveFundsFunction"
      );
    });

    it("reverts InsufficientRemainingCapacity when fillAmount > purchaseTokenAmount", async () => {
      const order = makeBorrowOrder({ purchaseTokenAmount: FILL_AMOUNT });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[BORROW_HOOK_SIG](
          order,
          FILL_AMOUNT + 1n,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InsufficientRemainingCapacity"
      );
    });

    it("succeeds end-to-end: presigned borrow order with mockRetrieveFunds hook minting purchase tokens", async () => {
      const TestToken = await ethers.getContractFactory("TestToken");
      const purchaseToken = await TestToken.deploy();
      await purchaseToken.waitForDeployment();
      await purchaseToken.initialize("Test USDC", "TUSDC", 6, [], []);
      const purchaseTokenAddr = await purchaseToken.getAddress();

      const repoServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await repoServicer.mock.termController.returns(await mockTermController.getAddress());
      await repoServicer.mock.termRepoId.returns(ZeroHash);
      await repoServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await repoServicer.mock.purchaseToken.returns(purchaseTokenAddr);
      await repoServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());
      await repoServicer.mock.termRepoToken.returns(mockRepoTokenAddr);
      await repoServicer.mock.termRepoLocker.returns(mockRepoTokenAddr);
      await repoServicer.mock.mintOpenExposureFromIntent.returns(FILL_AMOUNT);

      const order = makeBorrowOrder({
        repoServicer: await repoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: FILL_AMOUNT,
        collateralAmounts: [COLLATERAL_AMOUNT],
        offerRate: ethers.parseUnits("5", 16),
        feeRecipient: approvedFeeRecipient.address,
      });

      // Maker (borrower) presigns the borrow order
      const loanIntent = await ethers.getContractAt(
        "TermLoanIntentFacet",
        await termDiamond.getAddress()
      );
      await loanIntent.connect(maker).setPreSignedBorrowOrderHash(order);

      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );

      // Taker (lender) calls hook: mockRetrieveFunds mints real purchase tokens to diamond,
      // balance check passes, then settleLimitBorrow runs with mocked servicer
      await expect(
        settlement.connect(taker)[BORROW_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // swapRepoTokenWithHook
  // ═══════════════════════════════════════════════════════════════════════════

  describe("swapRepoTokenWithHook", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("reverts InvalidFillAmount when fillAmount == 0", async () => {
      const order = makeSwapOrder({ makerAssetIsPurchaseToken: false });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          0n,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidFillAmount");
    });

    it("reverts RetrieveFundsNotSpecified when retrieveFunds.method == bytes4(0)", async () => {
      const order = makeSwapOrder({ makerAssetIsPurchaseToken: false });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          zeroRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(settlement, "RetrieveFundsNotSpecified");
    });

    it("reverts InvalidRetrieveFundsFunction when method is non-zero but not in diamond", async () => {
      const order = makeSwapOrder({ makerAssetIsPurchaseToken: false });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          invalidRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InvalidRetrieveFundsFunction"
      );
    });

    it("reverts InvalidSwapOrderToFill when makerAssetIsPurchaseToken == true", async () => {
      const order = makeSwapOrder({ makerAssetIsPurchaseToken: true });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidSwapOrderToFill");
    });

    it("reverts InsufficientRemainingCapacity when fillAmount > purchaseTokenAmount", async () => {
      const order = makeSwapOrder({
        makerAssetIsPurchaseToken: false,
        purchaseTokenAmount: FILL_AMOUNT,
      });
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          FILL_AMOUNT + 1n,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.be.revertedWithCustomError(
        settlement,
        "InsufficientRemainingCapacity"
      );
    });

    it("succeeds end-to-end: presigned swap order (makerAssetIsPurchaseToken=false) with mockRetrieveFunds hook", async () => {
      const TestToken = await ethers.getContractFactory("TestToken");
      const purchaseToken = await TestToken.deploy();
      await purchaseToken.waitForDeployment();
      await purchaseToken.initialize("Test USDC", "TUSDC", 6, [], []);
      const purchaseTokenAddr = await purchaseToken.getAddress();

      const repoToken = await deployMockContract(devops, [
        "function config() external view returns (uint256, address, address, uint256)",
        "function redemptionValue() external view returns (uint256)",
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
        "function mint(address,uint256) external",
      ]);
      await repoToken.mock.config.returns(
        MATURITY_TIME,
        purchaseTokenAddr,
        mockRepoServicerAddr,
        0
      );
      await repoToken.mock.redemptionValue.returns(ethers.parseUnits("1", 18));
      await repoToken.mock.transfer.returns(true);
      await repoToken.mock.transferFrom.returns(true);
      await repoToken.mock.mint.returns();

      const order = makeSwapOrder({
        repoToken: await repoToken.getAddress(),
        makerAssetIsPurchaseToken: false,
        maker: maker.address,
        purchaseTokenAmount: FILL_AMOUNT,
        discountRate: ethers.parseUnits("2", 16),
        feeRecipient: approvedFeeRecipient.address,
      });

      // Maker presigns the swap order
      const repoTokenIntent = await ethers.getContractAt(
        "TermRepoTokenIntentFacet",
        await termDiamond.getAddress()
      );
      await repoTokenIntent.connect(maker).setPreSignedSwapHash(order);

      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );

      // Taker calls hook: mockRetrieveFunds mints real purchase tokens to diamond,
      // balance check passes, then swapRepoToken runs with mocked repo token transfers
      await expect(
        settlement.connect(taker)[SWAP_HOOK_SIG](
          order,
          FILL_AMOUNT,
          PRESIGNED_SIG,
          mockRetrieveFunds()
        )
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Reentrancy protection (initiateAtomicTxProtection modifier)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Reentrancy protection", () => {
    it("reverts 'AtomicTx already initiated' when atomicTxInitiatior is already set", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();

      // Pre-set atomicTxInitiatior via the test helper facet
      const atomicTxHelper = await ethers.getContractAt(
        "TestAtomicTxProtectionHelper",
        await termDiamond.getAddress()
      );
      await atomicTxHelper.setAtomicTxInitiator(taker.address);

      const order = makeLendOrder();
      const settlement = await ethers.getContractAt(
        "TermSettlementWithHooksFacet",
        await termDiamond.getAddress()
      );

      await expect(
        settlement.connect(taker)[LEND_HOOK_SIG](
          order,
          FILL_AMOUNT,
          [COLLATERAL_AMOUNT],
          PRESIGNED_SIG,
          [mockRetrieveFunds()]
        )
      ).to.be.revertedWith("AtomicTx already initiated");
    });
  });
});
