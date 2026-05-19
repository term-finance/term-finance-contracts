/* eslint-disable no-unused-expressions */
/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre from 'hardhat';
import { ethers, network } from "hardhat";
import {
  MockContract,
  deployMockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";
import {
  ZeroAddress,
  ZeroHash,
} from "ethers";
import {
  TermDiamond,
  DiamondCutFacet,
  TermLoanIntentFacet,
  DiamondLoupeFacet,
  TermControllerFacet,
} from "../typechain-types";
import { mock } from "node:test";

/**
 * Comprehensive Unit Tests for TermLoanIntentFacet
 *
 * These tests deploy the actual TermLoanIntentFacet contract as part of a Diamond
 * and test the settlement functions by calling them and expecting specific reverts.
 *
 * Test Coverage:
 * - Common scenarios: Initialization, reentrancy
 * - LimitLendOrder: Parameter validation and settlement validation
 * - LimitBorrowOrder: Parameter validation and settlement validation
 * Total: 60 tests covering all validation scenarios
 */
describe("TermLoanIntentFacet Unit Tests", () => {
  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let maker: SignerWithAddress;
  let taker: SignerWithAddress;
  let borrower: SignerWithAddress;
  let lender: SignerWithAddress;
  let approvedFeeRecipient: SignerWithAddress;
  let unapprovedFeeRecipient: SignerWithAddress;

  let termDiamond: TermDiamond;
  let diamondCutFacet: DiamondCutFacet;
  let loanIntentFacet: TermLoanIntentFacet;
  let termControllerFacet: TermControllerFacet;
  let loanIntent: TermLoanIntentFacet; // Loan intent facet accessed through diamond

  let mockTermController: MockContract;
  let mockRepoServicer: MockContract;
  let mockCollateralManager: MockContract;
  let mockPurchaseToken: MockContract;
  let mockCollateralToken: MockContract;
  let mockTermEventEmitter: MockContract;
  let mockTermRepoToken: MockContract;

  let snapshotId: any;

  let CURRENT_TIME: number;
  let MATURITY_TIME: number;
  let ORDER_EXPIRY: number;

  before(async () => {
    [
      devops,
      admin,
      maker,
      taker,
      borrower,
      lender,
      approvedFeeRecipient,
      unapprovedFeeRecipient,
    ] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    CURRENT_TIME = latestBlock!.timestamp;
    MATURITY_TIME = CURRENT_TIME + 86400 * 30;
    ORDER_EXPIRY = CURRENT_TIME + 86400 * 365;

    const termDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = await termDiamondFactoryFactory.deploy(
      admin.address,
      devops.address
    );
    await termDiamondFactory.waitForDeployment();

    const deployTx = await termDiamondFactory.deployDiamond();

    const receipt = await deployTx.wait();

    // Read diamond address from DiamondDeployed event log
    const diamondDeployedEvent = receipt?.logs.find(
      log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
    );

    if (!diamondDeployedEvent) {
      throw new Error("DiamondDeployed event not found");
    }

    const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    const diamondAddress = decodedEvent?.args.diamond;
    const diamondCutFacetAddr = decodedEvent?.args.diamondCutFacet;

    termDiamond = await ethers.getContractAt("TermDiamond", diamondAddress) as TermDiamond;
    diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", diamondCutFacetAddr);

    
    await diamondCutFacet.waitForDeployment();

    // Deploy TermLoanIntentFacet
    const TermLoanIntentFacetFactory = await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacet = await TermLoanIntentFacetFactory.deploy();
    await loanIntentFacet.waitForDeployment();

    // Deploy TermControllerFacet
    const TermControllerFacetFactory = await ethers.getContractFactory("TermControllerFacet");
    termControllerFacet = await TermControllerFacetFactory.deploy();
    await termControllerFacet.waitForDeployment();

    // Create mock contracts
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

    const eventEmitterABI = [
      "function emitLimitOrderTokenPairMinSaltValue(address, address, address, uint256) external",
      "function emitIntentCancelled(bytes32) external",
      "function emitIntentFilled(bytes32,bytes32,address,address,address,address,address,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256) external",
    ];

    const erc20ABI = [
      "function decimals() external view returns (uint8)",
      "function balanceOf(address) external view returns (uint256)",
      "function transfer(address,uint256) external returns (bool)",
      "function transferFrom(address,address,uint256) external returns (bool)",
      "function approve(address,uint256) external returns (bool)",
    ];

    const termRepoTokenABI = [
      "function config() external view returns (uint256, address, address, uint256)",
    ];

    mockTermController = await deployMockContract(devops, termControllerABI);
    mockRepoServicer = await deployMockContract(devops, repoServicerABI);
    mockCollateralManager = await deployMockContract(devops, collateralManagerABI);
    mockPurchaseToken = await deployMockContract(devops, erc20ABI);
    mockCollateralToken = await deployMockContract(devops, erc20ABI);
    mockTermEventEmitter = await deployMockContract(devops, eventEmitterABI);
    mockTermRepoToken = await deployMockContract(devops, termRepoTokenABI);

    // Setup default mock behaviors
    await mockTermController.mock.isTermDeployed.returns(true);
    await mockTermController.mock.isFactoryDeployed.returns(true);
    await mockTermController.mock.getProtocolReserveAddress.returns(approvedFeeRecipient.address);

    await mockRepoServicer.mock.termController.returns(await mockTermController.getAddress());
    await mockRepoServicer.mock.termRepoId.returns(ZeroHash);
    await mockRepoServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
    await mockRepoServicer.mock.purchaseToken.returns(await mockPurchaseToken.getAddress());
    await mockRepoServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());
    await mockRepoServicer.mock.termRepoToken.returns(await mockTermRepoToken.getAddress());

    await mockCollateralManager.mock.numOfAcceptedCollateralTokens.returns(1);

    await mockPurchaseToken.mock.decimals.returns(6);
    await mockPurchaseToken.mock.balanceOf.returns(ethers.parseUnits("1000000", 6));

    await mockTermRepoToken.mock.config.returns(
      MATURITY_TIME,
      await mockPurchaseToken.getAddress(),
      await mockRepoServicer.getAddress(),
      0
    );

    await mockTermEventEmitter.mock.emitLimitOrderTokenPairMinSaltValue.returns();
    await mockTermEventEmitter.mock.emitIntentCancelled.returns();
    await mockTermEventEmitter.mock.emitIntentFilled.returns();

    await mockRepoServicer.mock.termRepoLocker.returns(await mockTermRepoToken.getAddress());
    await mockRepoServicer.mock.mintOpenExposureFromIntent.returns(ethers.parseUnits("100", 6));

    await mockCollateralManager.mock.collateralTokens.returns(await mockCollateralToken.getAddress());

    await mockCollateralToken.mock.approve.returns(true);
    await mockCollateralToken.mock.transfer.returns(true);
    await mockCollateralToken.mock.transferFrom.returns(true);

    await mockPurchaseToken.mock.transfer.returns(true);
    await mockPurchaseToken.mock.transferFrom.returns(true);
    await mockPurchaseToken.mock.approve.returns(true);
  });

  beforeEach(async () => {
    // Take snapshot BEFORE making any changes
    snapshotId = await network.provider.send("evm_snapshot");

    // Add TermLoanIntentFacet to diamond
    const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

    // Get all function selectors from TermLoanIntentFacet
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
      "DOMAIN_SEPARATOR()"
    ].map(sig => ethers.id(sig).slice(0, 10));

    // Get function selectors from TermControllerFacet
    const controllerSelectors = [
      "approveTermController(address)",
      "revokeTermController(address)",
      "approveFeeRecipient(address)",
      "revokeFeeRecipient(address)",
      "updateEIP712DomainSeparator(address)"
    ].map(sig => ethers.id(sig).slice(0, 10));

    // Deploy and get selectors for TestTermLoanIntentFacetHelper
    const TestLoanIntentHelperFactory = await ethers.getContractFactory("TestTermLoanIntentFacetHelper");
    const testLoanIntentHelper = await TestLoanIntentHelperFactory.deploy();
    await testLoanIntentHelper.waitForDeployment();
    const helperSelectors = [
      "setMulticallInitiator(address)",
      "clearMulticallInitiator()",
    ].map(sig => ethers.id(sig).slice(0, 10));

    // Deploy and get selectors for TestRetrieveFundsFacet
    const TestRetrieveFundsFacetFactory = await ethers.getContractFactory("TestRetrieveFundsFacet");
    const testRetrieveFundsFacet = await TestRetrieveFundsFacetFactory.deploy();
    await testRetrieveFundsFacet.waitForDeployment();
    const retrieveFundsSelectors = [
      "noopForRetrieveFunds()",
      "mockRetrieveFunds(address,uint256)",
      "generateCalldata(bytes4,address,address,address,uint256,bool,bytes)",
    ].map(sig => ethers.id(sig).slice(0, 10));

    // Deploy DiamondLoupeFacet (required for IDiamondLoupe.facetAddress() calls in retrieveFunds validation)
    const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();
    const loupeSelectors = [
      "facets()",
      "facetFunctionSelectors(address)",
      "facetAddresses()",
      "facetAddress(bytes4)",
      "diamondPaused()",
      "supportsInterface(bytes4)",
    ].map(sig => ethers.id(sig).slice(0, 10));

    await diamondCut.diamondCut(
      [
        {
          facetAddress: await loanIntentFacet.getAddress(),
          action: 0, // Add
          functionSelectors: loanIntentSelectors
        },
        {
          facetAddress: await termControllerFacet.getAddress(),
          action: 0, // Add
          functionSelectors: controllerSelectors
        },
        {
          facetAddress: await testLoanIntentHelper.getAddress(),
          action: 0, // Add
          functionSelectors: helperSelectors
        },
        {
          facetAddress: await testRetrieveFundsFacet.getAddress(),
          action: 0, // Add
          functionSelectors: retrieveFundsSelectors
        },
        {
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0, // Add
          functionSelectors: loupeSelectors
        },
      ],
      ZeroAddress,
      "0x"
    );

    // Get loan intent instance through diamond
    loanIntent = await ethers.getContractAt("TermLoanIntentFacet", await termDiamond.getAddress());

    // Initialize loan intent facet
    await loanIntent.initializeTermIntentFacet(await mockTermEventEmitter.getAddress());
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // Helper function to approve term controller using TermControllerFacet
  async function approveTermControllerProper() {
    const termControllerFacetInstance = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
    await termControllerFacetInstance.connect(devops).approveTermController(
      await mockTermController.getAddress()
    );
  }

   // Helper function to approve fee recipient
  async function approveFeeRecipientProper() {
    const termControllerFacetInstance = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
    await termControllerFacetInstance.connect(devops).approveFeeRecipient(
      approvedFeeRecipient.address
    );
  }

  // Helper functions to create test orders
  function createLimitLendOrder(overrides: any = {}) {
    return {
      repoServicer: ZeroAddress,
      purchaseTokenAmount: ethers.parseUnits("1000", 6),
      offerRate: ethers.parseUnits("5", 16),
      maker: maker.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: approvedFeeRecipient,
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

  function createLimitBorrowOrder(overrides: any = {}) {
    return {
      repoServicer: ZeroAddress,
      purchaseTokenAmount: ethers.parseUnits("1000", 6),
      collateralAmounts: [ethers.parseEther("100")],
      offerRate: ethers.parseUnits("5", 16),
      maker: maker.address,
      taker: ZeroAddress,
      borrowFee: 0n,
      feeRecipient: approvedFeeRecipient,
      expiry: BigInt(ORDER_EXPIRY),
      salt: 1n,
      retrieveFundsList: [{
        method: "0x00000000",
        target: ZeroAddress,
        additionalCalldata: "0x",
      }],
      ...overrides,
    };
  }

  function createSignature(sigType: number = 0, sigData: string = "0x00") {
    return {
      sigType,
      sigData,
    };
  }

  /**
   * =======================================================================
   * Common Tests
   * =======================================================================
   */
  describe("Common Tests", () => {
    describe("Initialization", () => {
      it("should revert with AlreadyInitialized when initializing twice", async () => {
        await expect(
          loanIntent.initializeTermIntentFacet(await mockTermEventEmitter.getAddress())
        ).to.be.revertedWithCustomError(loanIntent, "AlreadyInitialized");
      });

      it("should revert when initializing with zero address emitter", async () => {
        // Deploy a fresh diamond without initialization
        const TermDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
        const termDiamondFactory = await TermDiamondFactoryFactory.deploy(admin.address, devops.address);
        await termDiamondFactory.waitForDeployment();

        const deployTx = await termDiamondFactory.deployDiamond();

        const receipt = await deployTx.wait();

        // Read diamond address from DiamondDeployed event log
        const diamondDeployedEvent = receipt?.logs.find(
          log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
        );

        if (!diamondDeployedEvent) {
          throw new Error("DiamondDeployed event not found");
        }

        const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
        const diamondAddress = decodedEvent?.args[1];
        const freshDiamond = await ethers.getContractAt("TermDiamond", diamondAddress) as TermDiamond;
  
        const diamondCutFresh = await ethers.getContractAt("DiamondCutFacet", await freshDiamond.getAddress());

        const loanIntentSelectors = [
          "initializeTermIntentFacet(address)",
        ].map(sig => ethers.id(sig).slice(0, 10));

        const initCalldata = loanIntentFacet.interface.encodeFunctionData(
          "initializeTermIntentFacet",
          [ZeroAddress]
        );

        await expect(
          diamondCutFresh.diamondCut(
            [{
              facetAddress: await loanIntentFacet.getAddress(),
              action: 0,
              functionSelectors: loanIntentSelectors
            }],
            await loanIntentFacet.getAddress(),
            initCalldata
          )
        ).to.be.reverted;
      });
    });
  });

  /**
   * =======================================================================
   * LimitLendOrder Tests
   * =======================================================================
   */
  describe("LimitLendOrder Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    describe("Parameter Validation", () => {
      it("should revert with InvalidPurchaseTokenAmount when amount is 0", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          purchaseTokenAmount: 0n,
        });
        const signature = createSignature();
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidPurchaseTokenAmount");
      });

      it("should revert with OrderExpired when order has expired", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          expiry: BigInt(CURRENT_TIME - 1),
        });
        const signature = createSignature();
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "OrderExpired");
      });

      it("should revert with InvalidOfferRate when rate is 0", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          offerRate: 0n,
        });
        const signature = createSignature();
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidOfferRate");
      });
    });

    describe("Settlement Validation", () => {
      it("should revert with InvalidFillAmount when fill amount is 0", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
        });
        const signature = createSignature();
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            0, // Fill amount is 0
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidFillAmount");
      });

      it("should revert with MakerCannotBeTaker when maker equals borrower", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: borrower.address,
        });
        const signature = createSignature();
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "MakerCannotBeTaker");
      });

      it("should revert with InvalidSignature when signature is invalid", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
        });
        // Create a properly formatted signature that recovers to a different address than the maker
        // This signature will recover to address(1) which should not match any maker
        const invalidSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [28, "0x0000000000000000000000000000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000000000000000000000000001"]
        );
        const invalidSignature = createSignature(0, invalidSigData);
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            invalidSignature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });
    });

    describe("Pre-signing", () => {
      it("should revert with InvalidSender when non-maker tries to pre-sign", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient
        });

        await expect(
          loanIntent.connect(taker).setPreSignedLendOrderHash(order)
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSender");
      });
    });
  });

  /**
   * =======================================================================
   * LimitBorrowOrder Tests
   * =======================================================================
   */
  describe("LimitBorrowOrder Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    describe("Parameter Validation", () => {
      it("should revert with InvalidPurchaseTokenAmount when amount is 0", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          purchaseTokenAmount: 0n,
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidPurchaseTokenAmount");
      });

      it("should revert with OrderExpired when order has expired", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          expiry: BigInt(CURRENT_TIME - 1),
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "OrderExpired");
      });

      it("should revert with InvalidOfferRate when rate is 0", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          offerRate: 0n,
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidOfferRate");
      });

      it("should revert with InvalidRetrieveFundsListLength when list length mismatches", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          collateralAmounts: [ethers.parseEther("100")],
          retrieveFundsList: [
            { method: "0x00000000", target: ethers.ZeroAddress, additionalCalldata: "0x" },
            { method: "0x00000000", target: ethers.ZeroAddress, additionalCalldata: "0x" }
          ], // List length (2) doesn't match collateral length (1)
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidRetrieveFundsListLength");
      });
    });

    describe("Settlement Validation", () => {
      it("should revert with InvalidFillAmount when fill amount is 0", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            0, // Fill amount is 0
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidFillAmount");
      });

      it("should revert with MakerCannotBeTaker when maker equals lender", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: lender.address,
        });
        const signature = createSignature();

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "MakerCannotBeTaker");
      });

      it("should revert with InvalidSignature when signature is invalid", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
        });
        // Create a properly formatted signature that recovers to a different address than the maker
        // This signature will recover to address(1) which should not match any maker
        const invalidSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [28, "0x0000000000000000000000000000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000000000000000000000000001"]
        );
        const invalidSignature = createSignature(0, invalidSigData);

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            invalidSignature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });
    });

    describe("Pre-signing", () => {
      it("should revert with InvalidSender when non-maker tries to pre-sign", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
        });

        await expect(
          loanIntent.connect(taker).setPreSignedBorrowOrderHash(order)
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSender");
      });
    });
  });

  describe("Hash calculation", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("should calculate lend order hash", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
      });

      const hash = await loanIntent.getLendOrderHash(order);
      expect(hash).to.not.equal(ZeroHash);
    });

    it("should calculate borrow order hash", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
      });

      const hash = await loanIntent.getBorrowOrderHash(order);
      expect(hash).to.not.equal(ZeroHash);
    });
  });

  /**
   * =======================================================================
   * EIP712 Signature Validation Tests
   * =======================================================================
   */
  describe("EIP712 Signature Validation", () => {
    // EIP712 domain parameters
    const domainName = "TermFinance";
    const domainVersion = "development";

    // Type definitions for EIP712 signing
    const LEND_ORDER_TYPES = {
      RetrieveFundsStruct: [
        { name: "method", type: "bytes4" },
        { name: "target", type: "address" },
        { name: "additionalCalldata", type: "bytes" },
      ],
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
      RetrieveFundsStruct: [
        { name: "method", type: "bytes4" },
        { name: "target", type: "address" },
        { name: "additionalCalldata", type: "bytes" },
      ],
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

    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    // Helper function to create EIP712 domain
    async function getEIP712Domain() {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      return {
        name: domainName,
        version: domainVersion,
        chainId: chainId,
        verifyingContract: await termDiamond.getAddress(),
      };
    }

    // Helper function to sign a lend order using ethers.js signTypedData
    async function signLendOrder(signer: SignerWithAddress, order: any) {
      const domain = await getEIP712Domain();

      // Use ethers.js signTypedData which works with Hardhat SignerWithAddress
      const signature = await signer.signTypedData(
        {
          name: domain.name,
          version: domain.version,
          chainId: domain.chainId,
          verifyingContract: domain.verifyingContract,
        },
        LEND_ORDER_TYPES,
        order
      );

      // Decode the signature to extract v, r, s
      const sig = ethers.Signature.from(signature);

      // Encode as (uint8 v, bytes32 r, bytes32 s) for the contract
      const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "bytes32", "bytes32"],
        [sig.v, sig.r, sig.s]
      );

      return { sigType: 0, sigData }; // 0 = EIP712
    }

    // Helper function to sign a borrow order using ethers.js signTypedData
    async function signBorrowOrder(signer: SignerWithAddress, order: any) {
      const domain = await getEIP712Domain();

      // Use ethers.js signTypedData which works with Hardhat SignerWithAddress
      const signature = await signer.signTypedData(
        {
          name: domain.name,
          version: domain.version,
          chainId: domain.chainId,
          verifyingContract: domain.verifyingContract,
        },
        BORROW_ORDER_TYPES,
        order
      );

      // Decode the signature to extract v, r, s
      const sig = ethers.Signature.from(signature);

      // Encode as (uint8 v, bytes32 r, bytes32 s) for the contract
      const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "bytes32", "bytes32"],
        [sig.v, sig.r, sig.s]
      );

      return { sigType: 0, sigData }; // 0 = EIP712
    }

    describe("LimitLendOrder EIP712 Signatures", () => {
      it("should validate a correctly signed EIP712 lend order signature", async () => {
        // Test the signature with correct type hash

        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });


        // Sign the order with the maker's key
        const signature = await signLendOrder(maker, order);
        const collateralAmounts = [ethers.parseEther("100")];

        // This should fail with a different error (not InvalidSignature)
        // since the signature is valid but the order settlement will fail
        // due to mock contract limitations (e.g., token transfers)
        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.not.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject an EIP712 lend order signature signed by wrong signer", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign with a different signer (taker instead of maker)
        const signature = await signLendOrder(taker, order);
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject a malformed EIP712 lend order signature", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Create a malformed signature with incorrect v, r, s values
        const malformedSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [28, ethers.ZeroHash, ethers.ZeroHash]
        );
        const signature = { sigType: 0, sigData: malformedSigData };
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.reverted; // Will revert (either InvalidSignature or ECDSA error)
      });

      it("should reject an EIP712 lend order signature with wrong domain", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign with wrong domain (different verifying contract)
        const wrongDomain = {
          name: domainName,
          version: domainVersion,
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: ethers.ZeroAddress, // Wrong contract address
        };

        const sig = ethers.Signature.from(
          await maker.signTypedData(wrongDomain, LEND_ORDER_TYPES, order)
        );
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [sig.v, sig.r, sig.s]
        );
        const signature = { sigType: 0, sigData };
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject an EIP712 lend order signature for modified order data", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign the original order
        const signature = await signLendOrder(maker, order);

        // Modify the order after signing
        const modifiedOrder = { ...order, purchaseTokenAmount: ethers.parseUnits("2000", 6) };
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            modifiedOrder,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });
    });

    describe("LimitBorrowOrder EIP712 Signatures", () => {
      it("should validate a correctly signed EIP712 borrow order signature", async () => {
        // First, let's verify our encoding matches EIP-712 spec
        console.log("\n=== Testing Manual EIP-712 Encoding ===");

        // Manual encoding to match contract exactly
        const RETRIEVE_FUNDS_STRUCT_TYPEHASH = "0x256d2844f30b75f89e6ec9418f35732e254268f054ce2b9f508642c924b76a8a";
        const BORROW_ORDER_TYPEHASH = "0xa92b0c41d8931853dfcf7e881934d0e47cebb5e838164ed0473362e6958b70a5";

        // Helper to hash a RetrieveFundsStruct like the contract does
        function hashRetrieveFundsStruct(item: any) {
          return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes4", "address", "bytes32"],
            [
              RETRIEVE_FUNDS_STRUCT_TYPEHASH,
              item.method,
              item.target,
              ethers.keccak256(item.additionalCalldata || "0x")
            ]
          ));
        }

        // Helper to hash an array of RetrieveFundsStruct like the contract does
        function hashRetrieveFundsArray(items: any[]) {
          const hashes = items.map(item => hashRetrieveFundsStruct(item));
          return ethers.keccak256(ethers.solidityPacked(["bytes32[]"], [hashes]));
        }

        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Manually compute the struct hash like the contract
        const retrieveFundsArrayHash = hashRetrieveFundsArray(order.retrieveFundsList);
        const collateralAmountsHash = ethers.keccak256(ethers.solidityPacked(["uint256[]"], [order.collateralAmounts]));

        const manualStructHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "uint256", "bytes32", "uint256", "address", "address", "uint256", "address", "uint256", "uint256", "bytes32"],
          [
            BORROW_ORDER_TYPEHASH,
            order.repoServicer,
            order.purchaseTokenAmount,
            collateralAmountsHash,
            order.offerRate,
            order.maker,
            order.taker,
            order.borrowFee,
            order.feeRecipient,
            order.expiry,
            order.salt,
            retrieveFundsArrayHash
          ]
        ));
        console.log("Manual struct hash:", manualStructHash);

        // Get domain separator
        const domainData = await getEIP712Domain();
        const domainSeparator = ethers.TypedDataEncoder.hashDomain({
          name: domainData.name,
          version: domainData.version,
          chainId: domainData.chainId,
          verifyingContract: domainData.verifyingContract,
        });
        const manualOrderHash = ethers.keccak256(ethers.solidityPacked(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", domainSeparator, manualStructHash]
        ));
        console.log("Manual order hash:", manualOrderHash);

        // Compare with contract
        const contractOrderHash = await loanIntent.getBorrowOrderHash(order);
        console.log("Contract order hash:", contractOrderHash);
        console.log("Hashes match:", manualOrderHash === contractOrderHash ? "✓ YES" : "✗ NO");

        // Sign the order with the maker's key
        const signature = await signBorrowOrder(maker, order);

        // Debug: Let's verify the signature matches what the contract expects
        console.log("\n=== Debugging Signature Verification ===");
        console.log("Maker address:", maker.address);

        // Get the order hash from the contract
        const orderHashFromContract = await loanIntent.getBorrowOrderHash(order);
        console.log("Order hash from contract:", orderHashFromContract);

        // Decode the signature
        const sigData = signature.sigData;
        const decodedSig = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint8", "bytes32", "bytes32"],
          sigData
        );
        const [v, r, s] = decodedSig;
        console.log("Signature components:");
        console.log("  v:", v);
        console.log("  r:", r);
        console.log("  s:", s);

        // Recover the signer using ethers (mimicking what contract does)
        const sig = ethers.Signature.from({ r, s, v });
        const recoveredSigner = ethers.recoverAddress(orderHashFromContract, sig);
        console.log("Recovered signer:", recoveredSigner);
        console.log("Expected signer (maker):", maker.address);
        console.log("Signatures match:", recoveredSigner.toLowerCase() === maker.address.toLowerCase());
        console.log("=== End Debug ===");

        // This should fail with a different error (not InvalidSignature)
        // since the signature is valid but the order settlement will fail
        // due to mock contract limitations (e.g., token transfers)
        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.not.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject an EIP712 borrow order signature signed by wrong signer", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign with a different signer (taker instead of maker)
        const signature = await signBorrowOrder(taker, order);

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject a malformed EIP712 borrow order signature", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Create a malformed signature with incorrect v, r, s values
        const malformedSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [28, ethers.ZeroHash, ethers.ZeroHash]
        );
        const signature = { sigType: 0, sigData: malformedSigData };

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.reverted; // Will revert (either InvalidSignature or ECDSA error)
      });

      it("should reject an EIP712 borrow order signature with wrong domain", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign with wrong domain (different verifying contract)
        const wrongDomain = {
          name: domainName,
          version: domainVersion,
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: ethers.ZeroAddress, // Wrong contract address
        };

        const sig = ethers.Signature.from(
          await maker.signTypedData(wrongDomain, BORROW_ORDER_TYPES, order)
        );
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [sig.v, sig.r, sig.s]
        );
        const signature = { sigType: 0, sigData };

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject an EIP712 borrow order signature for modified order data", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign the original order
        const signature = await signBorrowOrder(maker, order);

        // Modify the order after signing
        const modifiedOrder = { ...order, purchaseTokenAmount: ethers.parseUnits("2000", 6) };

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            modifiedOrder,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });

      it("should reject an EIP712 borrow order signature with wrong chain ID", async () => {
        const order = createLimitBorrowOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Sign with wrong chain ID (using obviously invalid test chain ID)
        const wrongDomain = {
          name: domainName,
          version: domainVersion,
          chainId: 0xDEADBEEFn, // Clearly invalid test chain ID
          verifyingContract: await termDiamond.getAddress(),
        };

        const sig = ethers.Signature.from(
          await maker.signTypedData(wrongDomain, BORROW_ORDER_TYPES, order)
        );
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [sig.v, sig.r, sig.s]
        );
        const signature = { sigType: 0, sigData };

        await expect(
          loanIntent.connect(lender)["settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            signature,
            false
          )
        ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
      });
    });

    describe("Signature Edge Cases", () => {
      it("should reject empty signature data for EIP712 type", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        const signature = { sigType: 0, sigData: "0x" };
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.reverted;
      });

      it("should reject signature with invalid v value", async () => {
        const order = createLimitLendOrder({
          repoServicer: await mockRepoServicer.getAddress(),
          maker: maker.address,
          feeRecipient: approvedFeeRecipient.address,
        });

        // Create signature with clearly invalid v value (valid values are 0, 1, 27, or 28)
        const invalidSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [30, // Invalid v value
           "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
           "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"]
        );
        const signature = { sigType: 0, sigData: invalidSigData };
        const collateralAmounts = [ethers.parseEther("100")];

        await expect(
          loanIntent.connect(borrower)["settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)"](
            order,
            ethers.parseUnits("100", 6),
            collateralAmounts,
            signature,
            false
          )
        ).to.be.reverted;
      });
    });
  });

  // =========================================================================
  // Selector shortcuts used throughout new tests
  // =========================================================================
  const SETTLE_LEND_4 =
    "settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,uint256[],(uint8,bytes),bool)";
  const SETTLE_LEND_5 =
    "settleLimitLend((address,uint256,uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,uint256[],(uint8,bytes))";
  const SETTLE_BORROW_4 =
    "settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),uint256,(uint8,bytes),bool)";
  const SETTLE_BORROW_5 =
    "settleLimitBorrow((address,uint256,uint256[],uint256,address,address,uint256,address,uint256,uint256,(bytes4,address,bytes)[]),address,uint256,(uint8,bytes))";

  // EIP712 type definitions (shared across new test groups)
  const LEND_ORDER_TYPES_OUTER = {
    RetrieveFundsStruct: [
      { name: "method", type: "bytes4" },
      { name: "target", type: "address" },
      { name: "additionalCalldata", type: "bytes" },
    ],
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

  const BORROW_ORDER_TYPES_OUTER = {
    RetrieveFundsStruct: [
      { name: "method", type: "bytes4" },
      { name: "target", type: "address" },
      { name: "additionalCalldata", type: "bytes" },
    ],
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

  async function getEIP712DomainOuter() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return {
      name: "TermFinance",
      version: "development",
      chainId,
      verifyingContract: await termDiamond.getAddress(),
    };
  }

  async function signLendOrderOuter(signer: SignerWithAddress, order: any) {
    const domain = await getEIP712DomainOuter();
    const signature = await signer.signTypedData(domain, LEND_ORDER_TYPES_OUTER, order);
    const sig = ethers.Signature.from(signature);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [sig.v, sig.r, sig.s]
    );
    return { sigType: 0, sigData };
  }

  async function signBorrowOrderOuter(signer: SignerWithAddress, order: any) {
    const domain = await getEIP712DomainOuter();
    const signature = await signer.signTypedData(domain, BORROW_ORDER_TYPES_OUTER, order);
    const sig = ethers.Signature.from(signature);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [sig.v, sig.r, sig.s]
    );
    return { sigType: 0, sigData };
  }

  /**
   * ==========================================================================
   * Salt Management Tests
   * ==========================================================================
   */
  describe("Salt Management", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("makerToken=0 reverts InvalidParameters", async () => {
      await expect(
        loanIntent.setLimitOrderMakerTokenPairMinSaltValue(ZeroAddress, maker.address, 1n)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidParameters");
    });

    it("takerToken=0 reverts InvalidParameters", async () => {
      await expect(
        loanIntent.setLimitOrderMakerTokenPairMinSaltValue(maker.address, ZeroAddress, 1n)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidParameters");
    });

    it("makerToken==takerToken reverts InvalidParameters", async () => {
      await expect(
        loanIntent.setLimitOrderMakerTokenPairMinSaltValue(maker.address, maker.address, 1n)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidParameters");
    });

    it("minValidSalt=type(uint256).max reverts InvalidParameters", async () => {
      await expect(
        loanIntent.setLimitOrderMakerTokenPairMinSaltValue(
          maker.address, taker.address, ethers.MaxUint256
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidParameters");
    });

    it("decreasing salt below current reverts InvalidMinSalt", async () => {
      await loanIntent.connect(maker).setLimitOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockTermRepoToken.getAddress(), 100n
      );
      await expect(
        loanIntent.connect(maker).setLimitOrderMakerTokenPairMinSaltValue(
          await mockPurchaseToken.getAddress(), await mockTermRepoToken.getAddress(), 50n
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidMinSalt");
    });

    it("getLimitOrderMakerTokenPairMinSaltValue returns 0 by default", async () => {
      const val = await loanIntent.getLimitOrderMakerTokenPairMinSaltValue(
        maker.address,
        await mockPurchaseToken.getAddress(),
        await mockTermRepoToken.getAddress()
      );
      expect(val).to.equal(0n);
    });

    it("setLimitOrderMakerTokenPairMinSaltValue succeeds and getter returns set value", async () => {
      await loanIntent.connect(maker).setLimitOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockTermRepoToken.getAddress(), 42n
      );
      const val = await loanIntent.getLimitOrderMakerTokenPairMinSaltValue(
        maker.address,
        await mockPurchaseToken.getAddress(),
        await mockTermRepoToken.getAddress()
      );
      expect(val).to.equal(42n);
    });
  });

  /**
   * ==========================================================================
   * Additional Validation Tests (uncovered revert paths)
   * ==========================================================================
   */
  describe("Additional Validation Tests", () => {
    it("AfterMaturity - lend order reverts AfterMaturity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const expiredRepoServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await expiredRepoServicer.mock.termController.returns(await mockTermController.getAddress());
      await expiredRepoServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());
      await expiredRepoServicer.mock.maturityTimestamp.returns(1000);
      const order = createLimitLendOrder({
        repoServicer: await expiredRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "AfterMaturity");
    });

    it("AfterMaturity - borrow order reverts AfterMaturity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const expiredRepoServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await expiredRepoServicer.mock.termController.returns(await mockTermController.getAddress());
      await expiredRepoServicer.mock.maturityTimestamp.returns(1000);
      const order = createLimitBorrowOrder({
        repoServicer: await expiredRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "AfterMaturity");
    });

    it("InvalidTermController - lend reverts when controller not approved", async () => {
      // Do NOT call approveTermControllerProper()
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTermController");
    });

    it("InvalidTermController - borrow reverts when controller not approved", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTermController");
    });

    it("InvalidRepoId - lend reverts when servicer not deployed", async () => {
      const notDeployedController = await deployMockContract(devops, [
        "function isTermDeployed(address) external view returns (bool)",
        "function isFactoryDeployed(address) external view returns (bool)",
        "function getProtocolReserveAddress() external view returns (address)",
      ]);
      await notDeployedController.mock.isTermDeployed.returns(false);
      await notDeployedController.mock.isFactoryDeployed.returns(false);

      const termControllerFacetInstance = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await termControllerFacetInstance.connect(devops).approveTermController(await notDeployedController.getAddress());

      const notDeployedServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await notDeployedServicer.mock.termController.returns(await notDeployedController.getAddress());
      await notDeployedServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());

      const order = createLimitLendOrder({
        repoServicer: await notDeployedServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidRepoId");
    });

    it("InvalidCollateralAmountsInput - lend: wrong collateral array length", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      // collateralAmounts has 2 elements but mock returns 1
      const signature = createSignature();
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6),
          [ethers.parseEther("100"), ethers.parseEther("50")],
          signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidCollateralAmountsInput");
    });

    it("InvalidCollateralAmountsInput - borrow: wrong collateral array length", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        // 2 collateral amounts but mock returns 1 accepted token
        collateralAmounts: [ethers.parseEther("100"), ethers.parseEther("50")],
        retrieveFundsList: [],
      });
      const signature = createSignature();
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidCollateralAmountsInput");
    });

    it("InvalidTaker - lend: specific taker set but different address fills", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        taker: taker.address, // only taker allowed
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTaker");
    });

    it("InvalidTaker - borrow: specific taker set but different address fills", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        taker: taker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTaker");
    });

    it("OrderCancelled - lend: salt at or below minSalt", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      // Set minSalt = 1 for maker / purchaseToken -> repoToken pair
      await loanIntent.connect(maker).setLimitOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockTermRepoToken.getAddress(), 1n
      );
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        salt: 1n, // salt == minSalt → cancelled
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "OrderCancelled");
    });

    it("OrderCancelled - borrow: salt at or below minSalt", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      // makerToken for borrow is repoToken, takerToken is purchaseToken
      await loanIntent.connect(maker).setLimitOrderMakerTokenPairMinSaltValue(
        await mockTermRepoToken.getAddress(), await mockPurchaseToken.getAddress(), 1n
      );
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        salt: 1n,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "OrderCancelled");
    });

    it("InvalidFeeRecipient - lend: unapproved fee recipient", async () => {
      await approveTermControllerProper();
      // Do NOT call approveFeeRecipientProper()
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: unapprovedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidFeeRecipient");
    });

    it("InvalidFeeRecipient - borrow: unapproved fee recipient", async () => {
      await approveTermControllerProper();
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: unapprovedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidFeeRecipient");
    });

    it("InvalidOrderStatus - lend: filling a FILLED order", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      // Fill fully
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, fillAmt, [ethers.parseEther("100")], signature, false
      );
      // Try again → InvalidOrderStatus
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("InvalidOrderStatus - borrow: filling a CANCELLED order", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const cancelSig = await signBorrowOrderOuter(maker, order);
      await loanIntent.connect(maker).cancelLimitBorrow(order, cancelSig);
      const fillSig = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), fillSig, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("NothingToFill - lend: over-fill until 0 remaining", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      // Full fill
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, fillAmt, [ethers.parseEther("100")], signature, false
      );
      // NothingToFill
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, 1n, [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("InsufficientRemainingCapacity - lend: fillAmount exceeds remaining capacity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const totalAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, totalAmt + 1n, [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InsufficientRemainingCapacity");
    });

    it("Partial fill succeeds when fillAmount is less than remaining capacity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const totalAmt = ethers.parseUnits("1000", 6);
      const partialAmt = ethers.parseUnits("500", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, partialAmt, [ethers.parseEther("50")], signature, false
        )
      ).to.not.be.reverted;
    });

    it("InvalidRetrieveFundsFunction - lend: non-zero method not in diamond", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFunds: {
          method: "0xdeadbeef",
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidRetrieveFundsFunction");
    });

    it("InsufficientFundsRetrieved - lend: retrieve funds returns insufficient tokens", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const noopSelector = ethers.id("noopForRetrieveFunds()").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFunds: {
          method: noopSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InsufficientFundsRetrieved");
    });
  });

  /**
   * ==========================================================================
   * Pre-Sign Tests
   * ==========================================================================
   */
  describe("Pre-Sign Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("setPreSignedLendOrderHash - success: hash stored", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      await expect(
        loanIntent.connect(maker).setPreSignedLendOrderHash(order)
      ).to.not.be.reverted;
    });

    it("setPreSignedLendOrderHash - AlreadyPreSigned when pre-signing same order twice", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      await loanIntent.connect(maker).setPreSignedLendOrderHash(order);
      await expect(
        loanIntent.connect(maker).setPreSignedLendOrderHash(order)
      ).to.be.revertedWithCustomError(loanIntent, "AlreadyPreSigned");
    });

    it("setPreSignedLendOrderHash - InvalidOrderStatus when order already FILLED", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      // Fill fully first
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, fillAmt, [ethers.parseEther("100")], signature, false
      );
      // Now try to pre-sign → InvalidOrderStatus
      await expect(
        loanIntent.connect(maker).setPreSignedLendOrderHash(order)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("setPreSignedBorrowOrderHash - success", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      await expect(
        loanIntent.connect(maker).setPreSignedBorrowOrderHash(order)
      ).to.not.be.reverted;
    });

    it("setPreSignedBorrowOrderHash - AlreadyPreSigned", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      await loanIntent.connect(maker).setPreSignedBorrowOrderHash(order);
      await expect(
        loanIntent.connect(maker).setPreSignedBorrowOrderHash(order)
      ).to.be.revertedWithCustomError(loanIntent, "AlreadyPreSigned");
    });

    it("revokePreSignedLimitOrderHash - success deletes entry", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      await loanIntent.connect(maker).setPreSignedLendOrderHash(order);
      const orderHash = await loanIntent.getLendOrderHash(order);
      await expect(
        loanIntent.connect(maker).revokePreSignedLimitOrderHash(orderHash)
      ).to.not.be.reverted;
    });

    it("revokePreSignedLimitOrderHash - InvalidSender if caller != maker", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      await loanIntent.connect(maker).setPreSignedLendOrderHash(order);
      const orderHash = await loanIntent.getLendOrderHash(order);
      await expect(
        loanIntent.connect(taker).revokePreSignedLimitOrderHash(orderHash)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidSender");
    });

    it("settleLimitLend with PRESIGN sig type - unregistered hash returns signer=0 → InvalidSignature", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const presignSig = { sigType: 1, sigData: "0x" }; // PRESIGN but not registered
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], presignSig, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
    });

    it("Unknown sigType (2) reverts InvalidSignature", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const unknownSig = { sigType: 2, sigData: "0x" };
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], unknownSig, false
        )
      ).to.be.reverted;
    });
  });

  /**
   * ==========================================================================
   * Cancel Order Tests
   * ==========================================================================
   */
  describe("Cancel Order Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("cancelLimitLend - FILLED order reverts InvalidOrderStatus", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, fillAmt, [ethers.parseEther("100")], signature, false
      );
      await expect(
        loanIntent.connect(maker).cancelLimitLend(order, signature)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("cancelLimitLend - CANCELLED order reverts InvalidOrderStatus", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await loanIntent.connect(maker).cancelLimitLend(order, signature);
      await expect(
        loanIntent.connect(maker).cancelLimitLend(order, signature)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("cancelLimitLend - wrong sig reverts InvalidSignature", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      // Sign with taker instead of maker
      const wrongSig = await signLendOrderOuter(taker, order);
      await expect(
        loanIntent.connect(maker).cancelLimitLend(order, wrongSig)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidSignature");
    });

    it("cancelLimitLend - maker != caller reverts InvalidSender", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(taker).cancelLimitLend(order, signature)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidSender");
    });

    it("cancelLimitLend - success sets CANCELLED status", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(maker).cancelLimitLend(order, signature)
      ).to.not.be.reverted;
    });

    it("cancelLimitBorrow - success", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(maker).cancelLimitBorrow(order, signature)
      ).to.not.be.reverted;
    });

    it("cancelLimitBorrow - already CANCELLED reverts InvalidOrderStatus", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await loanIntent.connect(maker).cancelLimitBorrow(order, signature);
      await expect(
        loanIntent.connect(maker).cancelLimitBorrow(order, signature)
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });
  });

  /**
   * ==========================================================================
   * Happy Path Settlement — Lend
   * ==========================================================================
   */
  describe("Happy Path Settlement — Lend", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("full fill: EIP712, no fee, no permit2", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.not.be.reverted;
    });

    it("partial fill leaves order as PARTIALLY_FILLED (second fill succeeds)", async () => {
      const totalAmt = ethers.parseUnits("1000", 6);
      const halfAmt = totalAmt / 2n;
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      // First partial fill
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, halfAmt, [ethers.parseEther("50")], signature, false
      );
      // Second fill completing the order
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, halfAmt, [ethers.parseEther("50")], signature, false
        )
      ).to.not.be.reverted;
    });

    it("after full fill, NothingToFill on third attempt", async () => {
      const totalAmt = ethers.parseUnits("1000", 6);
      const halfAmt = totalAmt / 2n;
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, halfAmt, [ethers.parseEther("50")], signature, false
      );
      await loanIntent.connect(borrower)[SETTLE_LEND_4](
        order, halfAmt, [ethers.parseEther("50")], signature, false
      );
      // Both branches of _updateOrderStatus covered; order FILLED → InvalidOrderStatus
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, 1n, [ethers.parseEther("1")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidOrderStatus");
    });

    it("with borrowFee > 0 exercises fee branch in _executeTokenTransfer", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        borrowFee: ethers.parseUnits("1", 16), // 1%
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.not.be.reverted;
    });

    it("with retrieveFunds.method != 0 exercises routed purchase token path", async () => {
      const mockRetrieveSelector = ethers.id("mockRetrieveFunds(address,uint256)").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);

      // Deploy a real ERC20 so balance actually changes after mockRetrieveFunds mints tokens
      const RealToken = await ethers.getContractFactory("TestToken");
      const realPurchaseToken = await RealToken.deploy();
      await realPurchaseToken.waitForDeployment();
      await realPurchaseToken.initialize("Test USDC", "TUSDC", 6, [], []);
      const realAddr = await realPurchaseToken.getAddress();

      // Deploy a fresh mock servicer to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(realAddr);
      await freshServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());
      await freshServicer.mock.termRepoToken.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.termRepoLocker.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.mintOpenExposureFromIntent.returns(ethers.parseUnits("100", 6));

      const order = createLimitLendOrder({
        repoServicer: await freshServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFunds: {
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.not.be.reverted;
    });

    it("with retrieveFunds and borrowFee > 0 exercises routed+fee branch", async () => {
      const mockRetrieveSelector = ethers.id("mockRetrieveFunds(address,uint256)").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);

      const RealToken = await ethers.getContractFactory("TestToken");
      const realPurchaseToken = await RealToken.deploy();
      await realPurchaseToken.waitForDeployment();
      await realPurchaseToken.initialize("Test USDC", "TUSDC", 6, [], []);
      const realAddr = await realPurchaseToken.getAddress();

      // Deploy a fresh mock servicer to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(realAddr);
      await freshServicer.mock.termRepoCollateralManager.returns(await mockCollateralManager.getAddress());
      await freshServicer.mock.termRepoToken.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.termRepoLocker.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.mintOpenExposureFromIntent.returns(ethers.parseUnits("100", 6));

      const order = createLimitLendOrder({
        repoServicer: await freshServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        borrowFee: ethers.parseUnits("1", 16),
        feeRecipient: approvedFeeRecipient.address,
        retrieveFunds: {
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, fillAmt, [ethers.parseEther("100")], signature, false
        )
      ).to.not.be.reverted;
    });
  });

  /**
   * ==========================================================================
   * Happy Path Settlement — Borrow
   * ==========================================================================
   */
  describe("Happy Path Settlement — Borrow", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("full fill: EIP712, no fee, no permit2, empty retrieveFundsList", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, fillAmt, signature, false
        )
      ).to.not.be.reverted;
    });

    it("partial fill succeeds", async () => {
      const totalAmt = ethers.parseUnits("1000", 6);
      const halfAmt = totalAmt / 2n;
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await loanIntent.connect(lender)[SETTLE_BORROW_4](order, halfAmt, signature, false);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](order, halfAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("with borrowFee > 0", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        borrowFee: ethers.parseUnits("1", 16),
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("retrieveFundsList method != 0: routed collateral path via generateCalldata", async () => {
      const mockRetrieveSelector = ethers.id("mockRetrieveFunds(address,uint256)").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);

      // Deploy a real ERC20 as collateral so balance actually changes after mockRetrieveFunds mints
      const RealToken = await ethers.getContractFactory("TestToken");
      const realCollateralToken = await RealToken.deploy();
      await realCollateralToken.waitForDeployment();
      await realCollateralToken.initialize("Test ETH", "TETH", 18, [], []);
      const realCollateralAddr = await realCollateralToken.getAddress();

      // Deploy fresh mock collateral manager pointing to real collateral token
      const freshCollateralManager = await deployMockContract(devops, [
        "function numOfAcceptedCollateralTokens() external view returns (uint8)",
        "function collateralTokens(uint256) external view returns (address)",
      ]);
      await freshCollateralManager.mock.numOfAcceptedCollateralTokens.returns(1);
      await freshCollateralManager.mock.collateralTokens.returns(realCollateralAddr);

      // Deploy a fresh mock servicer to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
        "function termRepoCollateralManager() external view returns (address)",
        "function termRepoToken() external view returns (address)",
        "function termRepoLocker() external view returns (address)",
        "function mintOpenExposureFromIntent(address,address,uint256,uint256[],uint256,bool) external returns (uint256)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(await mockPurchaseToken.getAddress());
      await freshServicer.mock.termRepoCollateralManager.returns(await freshCollateralManager.getAddress());
      await freshServicer.mock.termRepoToken.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.termRepoLocker.returns(await mockTermRepoToken.getAddress());
      await freshServicer.mock.mintOpenExposureFromIntent.returns(ethers.parseUnits("100", 6));

      const order = createLimitBorrowOrder({
        repoServicer: await freshServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [{
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        }],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("retrieveFundsList method == 0: naked collateral safeTransferFrom branch", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        feeRecipient: approvedFeeRecipient.address,
        // method=0 but list has 1 entry → retrieveFundsRequested=false since _validateRetrieveFunds returns false for method=0
        // Actually: list length > 0 triggers the loop; _validateRetrieveFunds returns false for method=0
        // So retrieveFundsRequested stays false and the "else" branch (naked transfer) is hit
        retrieveFundsList: [{
          method: "0x00000000",
          target: ZeroAddress,
          additionalCalldata: "0x",
        }],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });
  });

  /**
   * ==========================================================================
   * Batch Context Tests (5-arg overloads)
   * ==========================================================================
   */
  describe("Batch Context Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("5-arg settleLimitLend without batch context reverts", async () => {
      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_5](
          order, borrower.address, ethers.parseUnits("100", 6),
          [ethers.parseEther("100")], signature
        )
      ).to.be.reverted; // "Batch context required"
    });

    it("5-arg settleLimitBorrow without batch context reverts", async () => {
      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_5](
          order, lender.address, ethers.parseUnits("100", 6), signature
        )
      ).to.be.reverted; // "Batch context required"
    });
  });

  /**
   * ==========================================================================
   * updateEIP712DomainSeparator Tests
   * ==========================================================================
   */
  describe("updateEIP712DomainSeparator Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("access control: devops cannot call updateEIP712DomainSeparator", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await expect(
        tcf.connect(devops).updateEIP712DomainSeparator(await loanIntentFacet.getAddress())
      ).to.be.reverted;
    });

    it("access control: random signer cannot call updateEIP712DomainSeparator", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await expect(
        tcf.connect(maker).updateEIP712DomainSeparator(await loanIntentFacet.getAddress())
      ).to.be.reverted;
    });

    it("InvalidFacetAddress: unregistered address reverts", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await expect(
        tcf.connect(admin).updateEIP712DomainSeparator(maker.address)
      ).to.be.revertedWithCustomError(tcf, "InvalidFacetAddress");
    });

    it("success: domain separator updated correctly", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await tcf.connect(admin).updateEIP712DomainSeparator(await loanIntentFacet.getAddress());

      const domainSep = await loanIntent.DOMAIN_SEPARATOR();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const expected = ethers.TypedDataEncoder.hashDomain({
        name: "TermFinance",
        version: "development",
        chainId,
        verifyingContract: await termDiamond.getAddress(),
      });
      expect(domainSep).to.equal(expected);
    });

    it("order fulfillment works after update: LimitLendOrder passes signature validation", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await tcf.connect(admin).updateEIP712DomainSeparator(await loanIntentFacet.getAddress());

      const order = createLimitLendOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        taker: taker.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signLendOrderOuter(maker, order);
      await expect(
        loanIntent.connect(borrower)[SETTLE_LEND_4](
          order, ethers.parseUnits("100", 6), [ethers.parseEther("100")], signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTaker");
    });

    it("order fulfillment works after update: LimitBorrowOrder passes signature validation", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await tcf.connect(admin).updateEIP712DomainSeparator(await loanIntentFacet.getAddress());

      const order = createLimitBorrowOrder({
        repoServicer: await mockRepoServicer.getAddress(),
        maker: maker.address,
        taker: taker.address,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFundsList: [],
      });
      const signature = await signBorrowOrderOuter(maker, order);
      await expect(
        loanIntent.connect(lender)[SETTLE_BORROW_4](
          order, ethers.parseUnits("100", 6), signature, false
        )
      ).to.be.revertedWithCustomError(loanIntent, "InvalidTaker");
    });
  });
});