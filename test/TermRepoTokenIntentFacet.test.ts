/* eslint-disable no-unused-expressions */
/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
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
  TermRepoTokenIntentFacet,
  TermControllerFacet,
  TermLoanIntentFacet,
} from "../typechain-types";

describe("TermRepoTokenIntentFacet Unit Tests", () => {
  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let maker: SignerWithAddress;
  let taker: SignerWithAddress;
  let approvedFeeRecipient: SignerWithAddress;
  let unapprovedFeeRecipient: SignerWithAddress;

  let termDiamond: TermDiamond;
  let diamondCutFacet: DiamondCutFacet;
  let repoTokenIntentFacet: TermRepoTokenIntentFacet;
  let loanIntentFacet: TermLoanIntentFacet;
  let termControllerFacet: TermControllerFacet;
  let repoTokenIntent: TermRepoTokenIntentFacet;
  let loanIntent: TermLoanIntentFacet;

  let mockTermController: MockContract;
  let mockRepoServicer: MockContract;
  let mockRepoToken: MockContract;
  let mockPurchaseToken: MockContract;
  let mockTermEventEmitter: MockContract;

  let snapshotId: any;

  let CURRENT_TIME: number;
  let MATURITY_TIME: number;
  let ORDER_EXPIRY: number;

  // Selector shortcuts
  const SWAP_4 = "swapRepoToken((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,(uint8,bytes),bool)";
  const SWAP_5 = "swapRepoToken((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,(uint8,bytes))";

  // EIP712 type definitions
  const SWAP_ORDER_TYPES = {
    RetrieveFundsStruct: [
      { name: "method", type: "bytes4" },
      { name: "target", type: "address" },
      { name: "additionalCalldata", type: "bytes" },
    ],
    RepoTokenSwapOrder: [
      { name: "repoToken", type: "address" },
      { name: "makerAssetIsPurchaseToken", type: "bool" },
      { name: "purchaseTokenAmount", type: "uint256" },
      { name: "discountRate", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "taker", type: "address" },
      { name: "makerFee", type: "uint256" },
      { name: "takerFee", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "retrieveFunds", type: "RetrieveFundsStruct" },
    ],
  };

  before(async () => {
    [
      devops,
      admin,
      maker,
      taker,
      approvedFeeRecipient,
      unapprovedFeeRecipient,
    ] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    CURRENT_TIME = latestBlock!.timestamp;
    MATURITY_TIME = CURRENT_TIME + 86400 * 30;
    ORDER_EXPIRY = CURRENT_TIME + 86400 * 365;

    // Deploy diamond once
    const termDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = await termDiamondFactoryFactory.deploy(admin.address, devops.address);
    await termDiamondFactory.waitForDeployment();

    const deployTx = await termDiamondFactory.deployDiamond();
    const receipt = await deployTx.wait();

    const diamondDeployedEvent = receipt?.logs.find(
      log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
    );
    if (!diamondDeployedEvent) throw new Error("DiamondDeployed event not found");

    const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    const diamondAddress = decodedEvent?.args[0];
    const diamondCutFacetAddr = decodedEvent?.args[1];

    termDiamond = await ethers.getContractAt("TermDiamond", diamondAddress) as TermDiamond;
    diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", diamondCutFacetAddr);
    await diamondCutFacet.waitForDeployment();

    // Deploy facet implementations
    const TermLoanIntentFacetFactory = await ethers.getContractFactory("TermLoanIntentFacet");
    loanIntentFacet = await TermLoanIntentFacetFactory.deploy();
    await loanIntentFacet.waitForDeployment();

    const TermRepoTokenIntentFacetFactory = await ethers.getContractFactory("TermRepoTokenIntentFacet");
    repoTokenIntentFacet = await TermRepoTokenIntentFacetFactory.deploy();
    await repoTokenIntentFacet.waitForDeployment();

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
    ];
    const repoTokenABI = [
      "function config() external view returns (uint256, address, address, uint256)",
      "function redemptionValue() external view returns (uint256)",
      "function transfer(address,uint256) external returns (bool)",
      "function transferFrom(address,address,uint256) external returns (bool)",
    ];
    const eventEmitterABI = [
      "function emitSwapOrderTokenPairMinSaltValue(address, address, address, uint256) external",
      "function emitIntentCancelled(bytes32) external",
      "function emitRepoTokenSwapFilled(bytes32, (address,address,address,address,address,address,uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256)) external",
    ];
    const erc20ABI = [
      "function decimals() external view returns (uint8)",
      "function balanceOf(address) external view returns (uint256)",
      "function transfer(address,uint256) external returns (bool)",
      "function transferFrom(address,address,uint256) external returns (bool)",
      "function approve(address,uint256) external returns (bool)",
    ];

    mockTermController = await deployMockContract(devops, termControllerABI);
    mockRepoServicer = await deployMockContract(devops, repoServicerABI);
    mockRepoToken = await deployMockContract(devops, repoTokenABI);
    mockPurchaseToken = await deployMockContract(devops, erc20ABI);
    mockTermEventEmitter = await deployMockContract(devops, eventEmitterABI);

    // Setup default mock behaviors
    await mockTermController.mock.isTermDeployed.returns(true);
    await mockTermController.mock.isFactoryDeployed.returns(true);
    await mockTermController.mock.getProtocolReserveAddress.returns(approvedFeeRecipient.address);

    await mockRepoServicer.mock.termController.returns(await mockTermController.getAddress());
    await mockRepoServicer.mock.termRepoId.returns(ZeroHash);
    await mockRepoServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
    await mockRepoServicer.mock.purchaseToken.returns(await mockPurchaseToken.getAddress());

    await mockRepoToken.mock.config.returns(
      MATURITY_TIME,
      await mockPurchaseToken.getAddress(),
      await mockRepoServicer.getAddress(),
      0
    );
    await mockRepoToken.mock.redemptionValue.returns(ethers.parseUnits("1", 18));
    await mockRepoToken.mock.transfer.returns(true);
    await mockRepoToken.mock.transferFrom.returns(true);

    await mockPurchaseToken.mock.decimals.returns(6);
    await mockPurchaseToken.mock.balanceOf.returns(ethers.parseUnits("1000000", 6));
    await mockPurchaseToken.mock.transfer.returns(true);
    await mockPurchaseToken.mock.transferFrom.returns(true);
    await mockPurchaseToken.mock.approve.returns(true);

    await mockTermEventEmitter.mock.emitSwapOrderTokenPairMinSaltValue.returns();
    await mockTermEventEmitter.mock.emitIntentCancelled.returns();
    await mockTermEventEmitter.mock.emitRepoTokenSwapFilled.returns();
  });

  beforeEach(async () => {
    // Take snapshot BEFORE making any changes
    snapshotId = await network.provider.send("evm_snapshot");

    const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

    const loanIntentSelectors = [
      "initializeTermIntentFacet(address)",
      "DOMAIN_SEPARATOR()",
    ].map(sig => ethers.id(sig).slice(0, 10));

    const repoTokenIntentSelectors = [
      "swapRepoToken((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),uint256,(uint8,bytes),bool)",
      "swapRepoToken((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),address,uint256,(uint8,bytes))",
      "setPreSignedSwapHash((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
      "revokePreSignedSwapOrderHash(bytes32)",
      "setSwapOrderMakerTokenPairMinSaltValue(address,address,uint256)",
      "getSwapOrderMakerTokenPairMinSaltValue(address,address,address)",
      "cancelRepoTokenSwap((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)),(uint8,bytes))",
      "getSwapOrderHash((address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes)))",
    ].map(sig => ethers.id(sig).slice(0, 10));

    const controllerSelectors = [
      "approveTermController(address)",
      "revokeTermController(address)",
      "approveFeeRecipient(address)",
      "revokeFeeRecipient(address)",
      "updateEIP712DomainSeparator(address)",
    ].map(sig => ethers.id(sig).slice(0, 10));

    // Deploy test helper facets fresh each time
    const TestLoanIntentHelperFactory = await ethers.getContractFactory("TestTermLoanIntentFacetHelper");
    const testLoanIntentHelper = await TestLoanIntentHelperFactory.deploy();
    await testLoanIntentHelper.waitForDeployment();
    const helperSelectors = [
      "setMulticallInitiator(address)",
      "clearMulticallInitiator()",
    ].map(sig => ethers.id(sig).slice(0, 10));

    const TestRetrieveFundsFacetFactory = await ethers.getContractFactory("TestRetrieveFundsFacet");
    const testRetrieveFundsFacet = await TestRetrieveFundsFacetFactory.deploy();
    await testRetrieveFundsFacet.waitForDeployment();
    const retrieveFundsSelectors = [
      "noopForRetrieveFunds()",
      "mockRetrieveFunds(address,uint256)",
      "generateCalldata(bytes4,address,address,address,uint256,bool,bytes)",
    ].map(sig => ethers.id(sig).slice(0, 10));

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
        { facetAddress: await loanIntentFacet.getAddress(), action: 0, functionSelectors: loanIntentSelectors },
        { facetAddress: await repoTokenIntentFacet.getAddress(), action: 0, functionSelectors: repoTokenIntentSelectors },
        { facetAddress: await termControllerFacet.getAddress(), action: 0, functionSelectors: controllerSelectors },
        { facetAddress: await testLoanIntentHelper.getAddress(), action: 0, functionSelectors: helperSelectors },
        { facetAddress: await testRetrieveFundsFacet.getAddress(), action: 0, functionSelectors: retrieveFundsSelectors },
        { facetAddress: await diamondLoupeFacet.getAddress(), action: 0, functionSelectors: loupeSelectors },
      ],
      ZeroAddress,
      "0x"
    );

    loanIntent = await ethers.getContractAt("TermLoanIntentFacet", await termDiamond.getAddress());
    repoTokenIntent = await ethers.getContractAt("TermRepoTokenIntentFacet", await termDiamond.getAddress());

    await loanIntent.initializeTermIntentFacet(await mockTermEventEmitter.getAddress());
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function approveTermControllerProper() {
    const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
    await tcf.connect(devops).approveTermController(await mockTermController.getAddress());
  }

  async function approveFeeRecipientProper() {
    const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
    await tcf.connect(devops).approveFeeRecipient(approvedFeeRecipient.address);
  }

  function createRepoTokenSwapOrder(overrides: any = {}) {
    return {
      repoToken: ZeroAddress,
      makerAssetIsPurchaseToken: true,
      purchaseTokenAmount: ethers.parseUnits("1000", 6),
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

  function createSignature(sigType: number = 0, sigData: string = "0x00") {
    return { sigType, sigData };
  }

  async function getEIP712DomainOuter() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return {
      name: "TermFinance",
      version: "development",
      chainId,
      verifyingContract: await termDiamond.getAddress(),
    };
  }

  async function signSwapOrderOuter(signer: SignerWithAddress, order: any) {
    const domain = await getEIP712DomainOuter();
    const signature = await signer.signTypedData(domain, SWAP_ORDER_TYPES, order);
    const sig = ethers.Signature.from(signature);
    const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bytes32"],
      [sig.v, sig.r, sig.s]
    );
    return { sigType: 0, sigData };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Common Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Common Tests", () => {
    describe("Initialization", () => {
      it("should revert with AlreadyInitialized when initializing twice", async () => {
        await expect(
          loanIntent.initializeTermIntentFacet(await mockTermEventEmitter.getAddress())
        ).to.be.revertedWithCustomError(loanIntent, "AlreadyInitialized");
      });

      it("should revert when initializing with zero address emitter", async () => {
        const TermDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
        const freshFactory = await TermDiamondFactoryFactory.deploy(admin.address, devops.address);
        await freshFactory.waitForDeployment();

        const deployTx = await freshFactory.deployDiamond();
        const receipt = await deployTx.wait();

        const diamondDeployedEvent = receipt?.logs.find(
          log => log.topics[0] === freshFactory.interface.getEvent("DiamondDeployed").topicHash
        );
        if (!diamondDeployedEvent) throw new Error("DiamondDeployed event not found");

        const decodedEvent = freshFactory.interface.parseLog(diamondDeployedEvent);
        const freshDiamond = await ethers.getContractAt("TermDiamond", decodedEvent?.args[1]) as TermDiamond;
        const freshCut = await ethers.getContractAt("DiamondCutFacet", await freshDiamond.getAddress());

        const loanIntentSelectors = ["initializeTermIntentFacet(address)"].map(sig => ethers.id(sig).slice(0, 10));
        const initCalldata = loanIntentFacet.interface.encodeFunctionData("initializeTermIntentFacet", [ZeroAddress]);

        await expect(
          freshCut.diamondCut(
            [{ facetAddress: await loanIntentFacet.getAddress(), action: 0, functionSelectors: loanIntentSelectors }],
            await loanIntentFacet.getAddress(),
            initCalldata
          )
        ).to.be.reverted;
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RepoTokenSwapOrder Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("RepoTokenSwapOrder Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    describe("Parameter Validation", () => {
      it("should revert with InvalidPurchaseTokenAmount when amount is 0", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), purchaseTokenAmount: 0n });
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), createSignature(), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidPurchaseTokenAmount");
      });

      it("should revert with OrderExpired when order has expired", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), expiry: BigInt(CURRENT_TIME - 86400) });
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), createSignature(), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "OrderExpired");
      });

      it("should revert with InvalidDiscountRate when rate is 0", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), discountRate: 0n });
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), createSignature(), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidDiscountRate");
      });
    });

    describe("Settlement Validation", () => {
      it("should revert with InvalidFillAmount when fill amount is 0", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress() });
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, 0, createSignature(), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidFillAmount");
      });

      it("should revert with MakerCannotBeTaker when maker equals taker", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), maker: taker.address });
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), createSignature(), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "MakerCannotBeTaker");
      });

      it("should revert with InvalidSignature when signature is invalid", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress() });
        const invalidSigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [28, "0x0000000000000000000000000000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000000000000000000000000001"]
        );
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), createSignature(0, invalidSigData), false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
      });
    });

    describe("Pre-signing", () => {
      it("should revert with InvalidSender when non-maker tries to pre-sign", async () => {
        const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), maker: maker.address });
        await expect(
          repoTokenIntent.connect(taker).setPreSignedSwapHash(order)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSender");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Salt Management Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Salt Management", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("should allow setting minimum salt for swap orders", async () => {
      await expect(
        repoTokenIntent.connect(maker).setSwapOrderMakerTokenPairMinSaltValue(
          await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), 100n
        )
      ).to.not.be.reverted;
    });

    it("should revert when trying to decrease minimum salt", async () => {
      await repoTokenIntent.connect(maker).setSwapOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), 100n
      );
      await expect(
        repoTokenIntent.connect(maker).setSwapOrderMakerTokenPairMinSaltValue(
          await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), 50n
        )
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidMinSalt");
    });

    it("should get minimum salt value for swap orders", async () => {
      await repoTokenIntent.connect(maker).setSwapOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), 100n
      );
      const minSalt = await repoTokenIntent.getSwapOrderMakerTokenPairMinSaltValue(
        maker.address, await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress()
      );
      expect(minSalt).to.equal(100n);
    });

    it("makerToken=0 reverts InvalidParameters", async () => {
      await expect(
        repoTokenIntent.setSwapOrderMakerTokenPairMinSaltValue(ZeroAddress, maker.address, 1n)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidParameters");
    });

    it("takerToken=0 reverts InvalidParameters", async () => {
      await expect(
        repoTokenIntent.setSwapOrderMakerTokenPairMinSaltValue(maker.address, ZeroAddress, 1n)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidParameters");
    });

    it("makerToken==takerToken reverts InvalidParameters", async () => {
      await expect(
        repoTokenIntent.setSwapOrderMakerTokenPairMinSaltValue(maker.address, maker.address, 1n)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidParameters");
    });

    it("minValidSalt=type(uint256).max reverts InvalidParameters", async () => {
      await expect(
        repoTokenIntent.setSwapOrderMakerTokenPairMinSaltValue(
          await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), ethers.MaxUint256
        )
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidParameters");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hash Calculation Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Hash Calculation", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("should calculate swap order hash", async () => {
      const order = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress() });
      const hash = await repoTokenIntent.getSwapOrderHash(order);
      expect(hash).to.not.equal(ZeroHash);
    });

    it("should generate different hashes for different orders", async () => {
      const order1 = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), salt: 1n });
      const order2 = createRepoTokenSwapOrder({ repoToken: await mockRepoToken.getAddress(), salt: 2n });
      const hash1 = await repoTokenIntent.getSwapOrderHash(order1);
      const hash2 = await repoTokenIntent.getSwapOrderHash(order2);
      expect(hash1).to.not.equal(hash2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EIP712 Signature Validation Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("EIP712 Signature Validation", () => {
    const domainName = "TermFinance";
    const domainVersion = "development";

    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    async function getEIP712Domain() {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      return {
        name: domainName,
        version: domainVersion,
        chainId,
        verifyingContract: await termDiamond.getAddress(),
      };
    }

    async function signSwapOrder(signer: SignerWithAddress, order: any) {
      const domain = await getEIP712Domain();
      const signature = await signer.signTypedData(domain, SWAP_ORDER_TYPES, order);
      const sig = ethers.Signature.from(signature);
      const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "bytes32", "bytes32"], [sig.v, sig.r, sig.s]
      );
      return { sigType: 0, sigData };
    }

    describe("RepoTokenSwapOrder EIP712 Signatures", () => {
      it("should validate a correctly signed EIP712 swap order signature (maker offers purchase token)", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
          maker: maker.address,
        });
        const signature = await signSwapOrder(maker, order);
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
        ).to.not.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
      });

      it("should validate a correctly signed EIP712 swap order signature (maker offers repo token)", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: false,
          maker: maker.address,
        });
        const signature = await signSwapOrder(maker, order);
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
        ).to.not.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
      });

      it("should reject an EIP712 swap order signature signed by wrong signer", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
          maker: maker.address,
        });
        const signature = await signSwapOrder(taker, order);
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
        ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
      });

      it("should reject an EIP712 swap order signature with invalid v value", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
          maker: maker.address,
        });
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"], [26, ethers.randomBytes(32), ethers.randomBytes(32)]
        );
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), { sigType: 0, sigData }, false)
        ).to.be.reverted; // ECDSAInvalidSignature or ECDSAInvalidSignatureS depending on s value
      });

      it("should reject an EIP712 swap order signature with tampered r value", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
          maker: maker.address,
        });
        const domain = await getEIP712Domain();
        const rawSig = await maker.signTypedData(domain, SWAP_ORDER_TYPES, order);
        const sig = ethers.Signature.from(rawSig);
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"], [sig.v, ethers.randomBytes(32), sig.s]
        );
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), { sigType: 0, sigData }, false)
        ).to.be.reverted;
      });

      it("should reject an EIP712 swap order signature with tampered s value", async () => {
        const order = createRepoTokenSwapOrder({
          repoToken: await mockRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
          maker: maker.address,
        });
        const domain = await getEIP712Domain();
        const rawSig = await maker.signTypedData(domain, SWAP_ORDER_TYPES, order);
        const sig = ethers.Signature.from(rawSig);
        const sigData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"], [sig.v, sig.r, ethers.randomBytes(32)]
        );
        await expect(
          repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), { sigType: 0, sigData }, false)
        ).to.be.reverted;
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Additional Validation Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Additional Validation Tests", () => {
    it("InvalidTermController - reverts when controller not approved", async () => {
      // Do NOT approve controller
      await approveFeeRecipientProper();
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = createSignature();
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidTermController");
    });

    it("AfterMaturity - reverts AfterMaturity when repo token is past maturity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();

      // Deploy an expired repo servicer mock
      const expiredServicerABI = [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
      ];
      const expiredServicer = await deployMockContract(devops, expiredServicerABI);
      await expiredServicer.mock.termController.returns(await mockTermController.getAddress());
      await expiredServicer.mock.maturityTimestamp.returns(1000); // far in the past

      const expiredRepoTokenABI = [
        "function config() external view returns (uint256, address, address, uint256)",
        "function redemptionValue() external view returns (uint256)",
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
      ];
      const expiredRepoToken = await deployMockContract(devops, expiredRepoTokenABI);
      await expiredRepoToken.mock.config.returns(
        1000,
        await mockPurchaseToken.getAddress(),
        await expiredServicer.getAddress(),
        0
      );
      await expiredRepoToken.mock.redemptionValue.returns(ethers.parseUnits("1", 18));

      const order = createRepoTokenSwapOrder({
        repoToken: await expiredRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = createSignature();
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "AfterMaturity");
    });

    it("InvalidTaker - specific taker set but different address fills", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      // Only approvedFeeRecipient is the allowed taker
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        taker: approvedFeeRecipient.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      // taker (different from approvedFeeRecipient) tries to fill
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidTaker");
    });

    it("OrderCancelled - salt at or below minSalt", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      // Set minSalt = 1 for maker's purchase-token -> repo-token pair
      await repoTokenIntent.connect(maker).setSwapOrderMakerTokenPairMinSaltValue(
        await mockPurchaseToken.getAddress(), await mockRepoToken.getAddress(), 1n
      );
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        salt: 1n, // salt == minSalt → cancelled
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "OrderCancelled");
    });

    it("InvalidFeeRecipient - unapproved fee recipient in swapRepoToken", async () => {
      await approveTermControllerProper();
      // Do NOT approve fee recipient
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        feeRecipient: unapprovedFeeRecipient.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidFeeRecipient");
    });

    it("InvalidOrderStatus FILLED - filling a FILLED order reverts", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("InvalidOrderStatus CANCELLED - filling a CANCELLED order reverts", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const cancelSig = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, cancelSig);
      const fillSig = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), fillSig, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("InvalidRetrieveFundsFunction - non-zero method not in diamond", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        retrieveFunds: {
          method: "0xdeadbeef",
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidRetrieveFundsFunction");
    });

    it("InsufficientRemainingCapacity - fillAmount exceeds remaining capacity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const totalAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, totalAmt + 1n, signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InsufficientRemainingCapacity");
    });

    it("Partial fill succeeds when fillAmount is less than remaining capacity", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const totalAmt = ethers.parseUnits("1000", 6);
      const partialAmt = ethers.parseUnits("500", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, partialAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("InsufficientFundsRetrieved - retrieve funds returns insufficient tokens", async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
      const noopSelector = ethers.id("noopForRetrieveFunds()").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
        feeRecipient: approvedFeeRecipient.address,
        retrieveFunds: {
          method: noopSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InsufficientFundsRetrieved");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Pre-Sign Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Pre-Sign Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("setPreSignedSwapHash success (makerAssetIsPurchaseToken=true)", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        makerAssetIsPurchaseToken: true,
      });
      await expect(repoTokenIntent.connect(maker).setPreSignedSwapHash(order)).to.not.be.reverted;
    });

    it("setPreSignedSwapHash success (makerAssetIsPurchaseToken=false) covers else branch", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        makerAssetIsPurchaseToken: false,
      });
      await expect(repoTokenIntent.connect(maker).setPreSignedSwapHash(order)).to.not.be.reverted;
    });

    it("setPreSignedSwapHash - AlreadyPreSigned when pre-signing same order twice", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      await repoTokenIntent.connect(maker).setPreSignedSwapHash(order);
      await expect(
        repoTokenIntent.connect(maker).setPreSignedSwapHash(order)
      ).to.be.revertedWithCustomError(repoTokenIntent, "AlreadyPreSigned");
    });

    it("setPreSignedSwapHash - InvalidOrderStatus when order already FILLED", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false);
      await expect(
        repoTokenIntent.connect(maker).setPreSignedSwapHash(order)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("setPreSignedSwapHash - InvalidFeeRecipient with unapproved feeRecipient", async () => {
      // Controller approved (from beforeEach), but override feeRecipient to unapproved
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        feeRecipient: unapprovedFeeRecipient.address,
      });
      await expect(
        repoTokenIntent.connect(maker).setPreSignedSwapHash(order)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidFeeRecipient");
    });

    it("setPreSignedSwapHash - InvalidRetrieveFundsFunction with non-zero method not in diamond", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        retrieveFunds: {
          method: "0xdeadbeef",
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      await expect(
        repoTokenIntent.connect(maker).setPreSignedSwapHash(order)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidRetrieveFundsFunction");
    });

    it("revokePreSignedSwapOrderHash - success deletes entry", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      await repoTokenIntent.connect(maker).setPreSignedSwapHash(order);
      const orderHash = await repoTokenIntent.getSwapOrderHash(order);
      await expect(
        repoTokenIntent.connect(maker).revokePreSignedSwapOrderHash(orderHash)
      ).to.not.be.reverted;
    });

    it("revokePreSignedSwapOrderHash - InvalidSender if caller != maker", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      await repoTokenIntent.connect(maker).setPreSignedSwapHash(order);
      const orderHash = await repoTokenIntent.getSwapOrderHash(order);
      await expect(
        repoTokenIntent.connect(taker).revokePreSignedSwapOrderHash(orderHash)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSender");
    });

    it("PRESIGN sig type in swapRepoToken - pre-sign then settle succeeds", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
      });
      await repoTokenIntent.connect(maker).setPreSignedSwapHash(order);
      const presignSig = { sigType: 1, sigData: "0x" };
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, presignSig, false)
      ).to.not.be.reverted;
    });

    it("PRESIGN sig type - unregistered hash returns signer=0 → InvalidSignature", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const presignSig = { sigType: 1, sigData: "0x" };
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), presignSig, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
    });

    it("Unknown sigType (2) reverts InvalidSignature", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const unknownSig = { sigType: 2, sigData: "0x" };
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), unknownSig, false)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cancel Order Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Cancel Order Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("cancelRepoTokenSwap - FILLED order reverts InvalidOrderStatus", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false);
      await expect(
        repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, signature)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("cancelRepoTokenSwap - CANCELLED order reverts InvalidOrderStatus", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, signature);
      await expect(
        repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, signature)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("cancelRepoTokenSwap - wrong signature reverts InvalidSignature", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const wrongSig = await signSwapOrderOuter(taker, order);
      await expect(
        repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, wrongSig)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSignature");
    });

    it("cancelRepoTokenSwap - maker != caller reverts InvalidSender", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker).cancelRepoTokenSwap(order, signature)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidSender");
    });

    it("cancelRepoTokenSwap - success sets CANCELLED status", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(maker).cancelRepoTokenSwap(order, signature)
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Happy Path Settlement — maker offers purchase token (makerAssetIsPurchaseToken=true)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Happy Path Settlement — maker offers purchase token", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("full fill: EIP712, no fee, no permit2", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("partial fill leaves order PARTIALLY_FILLED; second fill completes it", async () => {
      const totalAmt = ethers.parseUnits("1000", 6);
      const halfAmt = totalAmt / 2n;
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        makerAssetIsPurchaseToken: true,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(taker)[SWAP_4](order, halfAmt, signature, false);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, halfAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("after full fill, InvalidOrderStatus on third attempt", async () => {
      const totalAmt = ethers.parseUnits("1000", 6);
      const halfAmt = totalAmt / 2n;
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: totalAmt,
        makerAssetIsPurchaseToken: true,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await repoTokenIntent.connect(taker)[SWAP_4](order, halfAmt, signature, false);
      await repoTokenIntent.connect(taker)[SWAP_4](order, halfAmt, signature, false);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, 1n, signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidOrderStatus");
    });

    it("with makerFee > 0 exercises fee branch for purchase token", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
        makerFee: ethers.parseUnits("1", 16), // 1%
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("with takerFee > 0 exercises fee branch for repo token", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
        takerFee: ethers.parseUnits("1", 16), // 1%
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
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

      // Deploy fresh mocks to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(realAddr);

      const freshRepoToken = await deployMockContract(devops, [
        "function config() external view returns (uint256, address, address, uint256)",
        "function redemptionValue() external view returns (uint256)",
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
      ]);
      await freshRepoToken.mock.config.returns(MATURITY_TIME, realAddr, await freshServicer.getAddress(), ZeroAddress);
      await freshRepoToken.mock.redemptionValue.returns(ethers.parseUnits("1", 18));
      await freshRepoToken.mock.transfer.returns(true);
      await freshRepoToken.mock.transferFrom.returns(true);

      const order = createRepoTokenSwapOrder({
        repoToken: await freshRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
        retrieveFunds: {
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("with retrieveFunds AND makerFee > 0 exercises routed+fee branch", async () => {
      const mockRetrieveSelector = ethers.id("mockRetrieveFunds(address,uint256)").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);

      // Deploy a real ERC20 so balance actually changes after mockRetrieveFunds mints tokens
      const RealToken = await ethers.getContractFactory("TestToken");
      const realPurchaseToken = await RealToken.deploy();
      await realPurchaseToken.waitForDeployment();
      await realPurchaseToken.initialize("Test USDC", "TUSDC", 6, [], []);
      const realAddr = await realPurchaseToken.getAddress();

      // Deploy fresh mocks to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(realAddr);

      const freshRepoToken = await deployMockContract(devops, [
        "function config() external view returns (uint256, address, address, uint256)",
        "function redemptionValue() external view returns (uint256)",
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
      ]);
      await freshRepoToken.mock.config.returns(MATURITY_TIME, realAddr, await freshServicer.getAddress(), ZeroAddress);
      await freshRepoToken.mock.redemptionValue.returns(ethers.parseUnits("1", 18));
      await freshRepoToken.mock.transfer.returns(true);
      await freshRepoToken.mock.transferFrom.returns(true);

      const order = createRepoTokenSwapOrder({
        repoToken: await freshRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: true,
        makerFee: ethers.parseUnits("1", 16),
        retrieveFunds: {
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Happy Path Settlement — maker offers repo token (makerAssetIsPurchaseToken=false)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Happy Path Settlement — maker offers repo token", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("full fill: EIP712, no fee, no permit2", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: false,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("with takerFee > 0 (purchase token fee to fee recipient)", async () => {
      const fillAmt = ethers.parseUnits("1000", 6);
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: false,
        takerFee: ethers.parseUnits("1", 16),
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });

    it("with retrieveFunds.method != 0 exercises routed repo token path", async () => {
      const mockRetrieveSelector = ethers.id("mockRetrieveFunds(address,uint256)").slice(0, 10);
      const fillAmt = ethers.parseUnits("1000", 6);

      // Deploy fresh mock servicer to avoid Waffle state desync after evm_revert
      const freshServicer = await deployMockContract(devops, [
        "function termController() external view returns (address)",
        "function termRepoId() external view returns (bytes32)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
      ]);
      await freshServicer.mock.termController.returns(await mockTermController.getAddress());
      await freshServicer.mock.termRepoId.returns(ZeroHash);
      await freshServicer.mock.maturityTimestamp.returns(MATURITY_TIME);
      await freshServicer.mock.purchaseToken.returns(await mockPurchaseToken.getAddress());

      // Deploy a real ERC20 repo token (has balanceOf + mint) so mockRetrieveFunds can deliver tokens
      const RepoTokenFactory = await ethers.getContractFactory("TestMockRepoTokenFull");
      const realRepoToken = await RepoTokenFactory.deploy("Test Repo", "TRT", ethers.parseUnits("1", 18));
      await realRepoToken.waitForDeployment();
      await realRepoToken.setConfig(MATURITY_TIME, await mockPurchaseToken.getAddress(), await freshServicer.getAddress(), ZeroAddress);

      const order = createRepoTokenSwapOrder({
        repoToken: await realRepoToken.getAddress(),
        maker: maker.address,
        purchaseTokenAmount: fillAmt,
        makerAssetIsPurchaseToken: false,
        retrieveFunds: {
          method: mockRetrieveSelector,
          target: ZeroAddress,
          additionalCalldata: "0x",
        },
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, fillAmt, signature, false)
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Batch Context Tests (5-arg swapRepoToken)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Batch Context Tests", () => {
    beforeEach(async () => {
      await approveTermControllerProper();
      await approveFeeRecipientProper();
    });

    it("5-arg swapRepoToken without batch context reverts", async () => {
      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      await expect(
        repoTokenIntent.connect(taker)[SWAP_5](order, taker.address, ethers.parseUnits("100", 6), signature)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Flash Hook Tests (standalone — previewSwapRepoToken, generateActionCalldata, swapRepoTokenHook)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Flash Hook Tests (standalone)", () => {
    let hookFacet: any;
    let hookRepoToken: MockContract;
    let hookPurchaseToken: MockContract;
    let hookServicer: MockContract;
    let hookController: MockContract;
    let hookEmitter: MockContract;

    let HOOK_MATURITY: number;
    let HOOK_ORDER_EXPIRY: number;
    const FILL_AMT = ethers.parseUnits("100", 6);
    const ORDER_AMT = ethers.parseUnits("1000", 6);
    const DISCOUNT_RATE = ethers.parseUnits("2", 16); // 2%
    const REDEMPTION_VALUE = ethers.parseUnits("1", 18);

    const ORDER_TUPLE = "(address,bool,uint256,uint256,address,address,uint256,uint256,address,uint256,uint256,(bytes4,address,bytes))";
    const SIG_TUPLE = "(uint8,bytes)";

    beforeEach(async () => {
      const latestBlock = await ethers.provider.getBlock("latest");
      HOOK_MATURITY = latestBlock!.timestamp + 86400 * 30;
      HOOK_ORDER_EXPIRY = latestBlock!.timestamp + 86400 * 365;

      // Deploy standalone hook facet helper (constructor sets previewMapping in own storage)
      const HookHelperFactory = await ethers.getContractFactory("TestTermRepoTokenIntentHookFacetHelper");
      hookFacet = await HookHelperFactory.deploy();
      await hookFacet.waitForDeployment();

      // Deploy mock contracts
      const repoTokenABI = [
        "function config() external view returns (uint256, address, address, uint256)",
        "function redemptionValue() external view returns (uint256)",
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
      ];
      const erc20ABI = [
        "function transfer(address,uint256) external returns (bool)",
        "function transferFrom(address,address,uint256) external returns (bool)",
      ];
      const servicerABI = [
        "function termController() external view returns (address)",
        "function maturityTimestamp() external view returns (uint256)",
        "function purchaseToken() external view returns (address)",
      ];
      const controllerABI = [
        "function isTermDeployed(address) external view returns (bool)",
        "function isFactoryDeployed(address) external view returns (bool)",
      ];
      const emitterABI = [
        "function emitRepoTokenSwapFilled(bytes32, (address,address,address,address,address,address,uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256)) external",
      ];

      hookPurchaseToken = await deployMockContract(devops, erc20ABI);
      hookServicer = await deployMockContract(devops, servicerABI);
      hookController = await deployMockContract(devops, controllerABI);
      hookEmitter = await deployMockContract(devops, emitterABI);
      hookRepoToken = await deployMockContract(devops, repoTokenABI);

      await hookPurchaseToken.mock.transfer.returns(true);
      await hookPurchaseToken.mock.transferFrom.returns(true);

      await hookController.mock.isTermDeployed.returns(true);
      await hookController.mock.isFactoryDeployed.returns(true);

      await hookServicer.mock.termController.returns(await hookController.getAddress());
      await hookServicer.mock.maturityTimestamp.returns(HOOK_MATURITY);
      await hookServicer.mock.purchaseToken.returns(await hookPurchaseToken.getAddress());

      await hookRepoToken.mock.config.returns(
        HOOK_MATURITY,
        await hookPurchaseToken.getAddress(),
        await hookServicer.getAddress(),
        0
      );
      await hookRepoToken.mock.redemptionValue.returns(REDEMPTION_VALUE);
      await hookRepoToken.mock.transfer.returns(true);
      await hookRepoToken.mock.transferFrom.returns(true);

      await hookEmitter.mock.emitRepoTokenSwapFilled.returns();

      // Configure facet storage
      await hookFacet.setEmitter(await hookEmitter.getAddress());
      await hookFacet.addApprovedTermController(await hookController.getAddress());
      await hookFacet.addApprovedFeeRecipient(approvedFeeRecipient.address);
    });

    function makeSwapOrder(overrides: any = {}) {
      return {
        repoToken: ZeroAddress,
        makerAssetIsPurchaseToken: true,
        purchaseTokenAmount: ORDER_AMT,
        discountRate: DISCOUNT_RATE,
        maker: maker.address,
        taker: ZeroAddress,
        makerFee: 0n,
        takerFee: 0n,
        feeRecipient: approvedFeeRecipient.address,
        expiry: BigInt(HOOK_ORDER_EXPIRY),
        salt: 1n,
        retrieveFunds: { method: "0x00000000", target: ZeroAddress, additionalCalldata: "0x" },
        ...overrides,
      };
    }

    async function presignOrder(order: any) {
      const orderHash = await hookFacet.getSwapOrderHash(order);
      await hookFacet.setPreSignedSwapOrder(orderHash, order.maker);
      return { sigType: 1, sigData: "0x" };
    }

    function encodeAdditional(usePermit2: boolean, order: any, sig: any) {
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ["bool", ORDER_TUPLE, SIG_TUPLE],
        [
          usePermit2,
          [
            order.repoToken,
            order.makerAssetIsPurchaseToken,
            order.purchaseTokenAmount,
            order.discountRate,
            order.maker,
            order.taker,
            order.makerFee,
            order.takerFee,
            order.feeRecipient,
            order.expiry,
            order.salt,
            [order.retrieveFunds.method, order.retrieveFunds.target, order.retrieveFunds.additionalCalldata],
          ],
          [sig.sigType, sig.sigData],
        ]
      );
    }

    function makeInput(overrides: any = {}) {
      return {
        user: taker.address,
        inputToken: ZeroAddress,
        maxInputAmount: 0n,
        outputToken: ZeroAddress,
        minOutputAmount: FILL_AMT,
        targetAddress: ZeroAddress,
        additionalCalldata: "0x",
        ...overrides,
      };
    }

    // ─── previewSwapRepoToken ──────────────────────────────────────────────

    describe("previewSwapRepoToken", () => {
      it("makerAssetIsPurchaseToken=true: expectedInputToken=repoToken, expectedOutputToken=purchaseToken", async () => {
        const order = makeSwapOrder({ repoToken: await hookRepoToken.getAddress(), makerAssetIsPurchaseToken: true });
        const sig = { sigType: 1, sigData: "0x" };
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        const preview = await hookFacet.previewSwapRepoToken(input);
        expect(preview.expectedInputToken).to.equal(await hookRepoToken.getAddress());
        expect(preview.expectedOutputToken).to.equal(await hookPurchaseToken.getAddress());
        expect(preview.expectedOutputAmount).to.equal(FILL_AMT);
        expect(preview.isDeterministic).to.be.true;
      });

      it("makerAssetIsPurchaseToken=false: expectedInputToken=purchaseToken, expectedOutputToken=repoToken", async () => {
        const order = makeSwapOrder({ repoToken: await hookRepoToken.getAddress(), makerAssetIsPurchaseToken: false });
        const sig = { sigType: 1, sigData: "0x" };
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        const preview = await hookFacet.previewSwapRepoToken(input);
        expect(preview.expectedInputToken).to.equal(await hookPurchaseToken.getAddress());
        expect(preview.expectedOutputToken).to.equal(await hookRepoToken.getAddress());
        expect(preview.expectedOutputAmount).to.equal(FILL_AMT);
        expect(preview.isDeterministic).to.be.true;
      });

      it("InputOutputTokenCollision: reverts when purchaseToken == repoToken address", async () => {
        // Deploy a repo token whose config() returns its own address as purchaseToken
        const collisionRepoToken = await deployMockContract(devops, [
          "function config() external view returns (uint256, address, address, uint256)",
          "function redemptionValue() external view returns (uint256)",
        ]);
        await collisionRepoToken.mock.config.returns(
          HOOK_MATURITY,
          await collisionRepoToken.getAddress(), // purchaseToken == repoToken address
          await hookServicer.getAddress(),
          0
        );
        await collisionRepoToken.mock.redemptionValue.returns(REDEMPTION_VALUE);

        const order = makeSwapOrder({
          repoToken: await collisionRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
        });
        const sig = { sigType: 1, sigData: "0x" };
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.previewSwapRepoToken(input))
          .to.be.revertedWithCustomError(hookFacet, "InputOutputTokenCollision");
      });

      it("InvalidFee: reverts when makerFee >= 1e18", async () => {
        const order = makeSwapOrder({
          repoToken: await hookRepoToken.getAddress(),
          makerFee: ethers.parseUnits("1", 18),
        });
        const sig = { sigType: 1, sigData: "0x" };
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.previewSwapRepoToken(input))
          .to.be.revertedWithCustomError(hookFacet, "InvalidFee");
      });
    });

    // ─── generateActionCalldata ────────────────────────────────────────────

    describe("generateActionCalldata", () => {
      it("UnsupportedHookSelector: reverts for unregistered selector", async () => {
        await expect(
          hookFacet.generateActionCalldata(
            taker.address,
            ZeroAddress,
            0n,
            ZeroAddress,
            FILL_AMT,
            "0x12345678",
            ZeroAddress,
            "0x"
          )
        ).to.be.revertedWithCustomError(hookFacet, "UnsupportedHookSelector");
      });

      it("success: returns valid previewAction and encodedCalldata for swapRepoTokenHook selector", async () => {
        const hookSelector = ethers.id(
          "swapRepoTokenHook((address,address,uint256,address,uint256,address,bytes))"
        ).slice(0, 10);

        const order = makeSwapOrder({ repoToken: await hookRepoToken.getAddress(), makerAssetIsPurchaseToken: true });
        const sig = { sigType: 1, sigData: "0x" };
        const additional = encodeAdditional(false, order, sig);

        const [previewAction, encodedCalldata] = await hookFacet.generateActionCalldata(
          taker.address,
          await hookRepoToken.getAddress(),
          ethers.parseUnits("200", 6),
          await hookPurchaseToken.getAddress(),
          FILL_AMT,
          hookSelector,
          ZeroAddress,
          additional
        );

        expect(previewAction.isDeterministic).to.be.true;
        expect(previewAction.expectedOutputToken).to.equal(await hookPurchaseToken.getAddress());
        expect(encodedCalldata.slice(0, 10)).to.equal(hookSelector);
      });
    });

    // ─── swapRepoTokenHook ─────────────────────────────────────────────────

    describe("swapRepoTokenHook", () => {
      it("no flash loan context: reverts Unauthorized caller", async () => {
        const order = makeSwapOrder({ repoToken: await hookRepoToken.getAddress() });
        const sig = await presignOrder(order);
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.connect(taker).swapRepoTokenHook(input))
          .to.be.revertedWith("Unauthorized caller");
      });

      it("wrong borrower: reverts Unauthorized caller when activeFlashLoanBorrower != input.user", async () => {
        const order = makeSwapOrder({ repoToken: await hookRepoToken.getAddress() });
        const sig = await presignOrder(order);
        const additional = encodeAdditional(false, order, sig);
        // Set borrower to maker but input.user = taker
        await hookFacet.setActiveFlashLoanBorrower(maker.address);
        const input = makeInput({ user: taker.address, additionalCalldata: additional });

        await expect(hookFacet.connect(taker).swapRepoTokenHook(input))
          .to.be.revertedWith("Unauthorized caller");
      });

      it("InvalidFee: reverts when makerFee >= 1e18", async () => {
        await hookFacet.setActiveFlashLoanBorrower(taker.address);
        const order = makeSwapOrder({
          repoToken: await hookRepoToken.getAddress(),
          makerFee: ethers.parseUnits("1", 18),
        });
        const sig = await presignOrder(order);
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.connect(taker).swapRepoTokenHook(input))
          .to.be.revertedWithCustomError(hookFacet, "InvalidFee");
      });

      it("success: makerAssetIsPurchaseToken=true, no fee, no permit2", async () => {
        await hookFacet.setActiveFlashLoanBorrower(taker.address);
        const order = makeSwapOrder({
          repoToken: await hookRepoToken.getAddress(),
          makerAssetIsPurchaseToken: true,
        });
        const sig = await presignOrder(order);
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.connect(taker).swapRepoTokenHook(input)).to.not.be.reverted;
      });

      it("success: makerAssetIsPurchaseToken=false, no fee, no permit2", async () => {
        await hookFacet.setActiveFlashLoanBorrower(taker.address);
        const order = makeSwapOrder({
          repoToken: await hookRepoToken.getAddress(),
          makerAssetIsPurchaseToken: false,
        });
        const sig = await presignOrder(order);
        const additional = encodeAdditional(false, order, sig);
        const input = makeInput({ additionalCalldata: additional });

        await expect(hookFacet.connect(taker).swapRepoTokenHook(input)).to.not.be.reverted;
      });
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

    it("order fulfillment works after update: SwapOrder passes signature validation", async () => {
      const tcf = await ethers.getContractAt("TermControllerFacet", await termDiamond.getAddress());
      await tcf.connect(admin).updateEIP712DomainSeparator(await loanIntentFacet.getAddress());

      const order = createRepoTokenSwapOrder({
        repoToken: await mockRepoToken.getAddress(),
        maker: maker.address,
        taker: approvedFeeRecipient.address,
        feeRecipient: approvedFeeRecipient.address,
      });
      const signature = await signSwapOrderOuter(maker, order);
      // taker (different from approvedFeeRecipient) tries to fill → InvalidTaker proves signature was valid
      await expect(
        repoTokenIntent.connect(taker)[SWAP_4](order, ethers.parseUnits("100", 6), signature, false)
      ).to.be.revertedWithCustomError(repoTokenIntent, "InvalidTaker");
    });
  });
});
