/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestTermAaveInterfaceFacetHelper,
  TestMockTermController,
  TestMockPermit2,
  TestMockAavePool,
  TestMockAavePoolAddressesProvider,
  TestMockAavePoolDataProvider,
  TestMockAToken,
  TestMockCreditDelegationToken,
  TestMockAavePriceOracle,
  TestMockRepoServicer,
  TestMockCollateralManager,
  TestMockRepoToken,
  TestToken,
} from "../typechain-types";

const PERMIT2_CANONICAL_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// ABI type strings for order encoding
const LEND_ORDER_TYPE =
  "tuple(address repoServicer, uint256 purchaseTokenAmount, uint256 offerRate, address maker, address taker, uint256 borrowFee, address feeRecipient, uint256 expiry, uint256 salt, tuple(bytes4 method, address target, bytes additionalCalldata) retrieveFunds)";
const BORROW_ORDER_TYPE =
  "tuple(address repoServicer, uint256 purchaseTokenAmount, uint256[] collateralAmounts, uint256 offerRate, address maker, address taker, uint256 borrowFee, address feeRecipient, uint256 expiry, uint256 salt, tuple(bytes4 method, address target, bytes additionalCalldata)[] retrieveFundsList)";
const SWAP_ORDER_TYPE =
  "tuple(address repoToken, bool makerAssetIsPurchaseToken, uint256 purchaseTokenAmount, uint256 discountRate, address maker, address taker, uint256 makerFee, uint256 takerFee, address feeRecipient, uint256 expiry, uint256 salt, tuple(bytes4 method, address target, bytes additionalCalldata) retrieveFunds)";
const SIG_TYPE = "tuple(uint8 sigType, bytes sigData)";

const LEND_FILL_PARAMS_TYPE = `tuple(${LEND_ORDER_TYPE} order, uint256 fillAmount, ${SIG_TYPE} signature)`;
const BORROW_FILL_PARAMS_TYPE = `tuple(${BORROW_ORDER_TYPE} order, ${SIG_TYPE} signature)`;
const SWAP_FILL_PARAMS_TYPE = `tuple(${SWAP_ORDER_TYPE} order, ${SIG_TYPE} signature)`;

describe("TermAaveInterfaceFacet Tests", () => {
  let facetHelper: TestTermAaveInterfaceFacetHelper;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let mockController: TestMockTermController;
  let asset: TestToken;
  let aToken: TestMockAToken;
  let debtToken: TestMockCreditDelegationToken;
  let dataProvider: TestMockAavePoolDataProvider;
  let addressesProvider: TestMockAavePoolAddressesProvider;
  let oracle: TestMockAavePriceOracle;
  let mockPool: TestMockAavePool;
  let mockServicer: TestMockRepoServicer;
  let mockCollateralManager: TestMockCollateralManager;
  let mockRepoToken: TestMockRepoToken;

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy facet helper
    const FacetFactory = await ethers.getContractFactory("TestTermAaveInterfaceFacetHelper");
    facetHelper = (await FacetFactory.deploy()) as unknown as TestTermAaveInterfaceFacetHelper;
    await facetHelper.waitForDeployment();

    // Deploy mock term controller and register
    const ControllerFactory = await ethers.getContractFactory("TestMockTermController");
    mockController = (await ControllerFactory.deploy()) as unknown as TestMockTermController;
    await mockController.waitForDeployment();
    await facetHelper.addApprovedTermController(await mockController.getAddress());

    // Deploy real asset token (18 decimals)
    const TokenFactory = await ethers.getContractFactory("TestToken");
    asset = (await upgrades.deployProxy(TokenFactory, [
      "Asset Token",
      "ASSET",
      18,
      [wallet1.address],
      [ethers.parseEther("10000")],
    ])) as unknown as TestToken;
    await asset.waitForDeployment();

    // Deploy mock aToken and debt token
    const ATokenFactory = await ethers.getContractFactory("TestMockAToken");
    aToken = (await ATokenFactory.deploy()) as unknown as TestMockAToken;
    await aToken.waitForDeployment();

    const DebtTokenFactory = await ethers.getContractFactory("TestMockCreditDelegationToken");
    debtToken = (await DebtTokenFactory.deploy()) as unknown as TestMockCreditDelegationToken;
    await debtToken.waitForDeployment();

    // Deploy mock data provider
    const DataProviderFactory = await ethers.getContractFactory("TestMockAavePoolDataProvider");
    dataProvider = (await DataProviderFactory.deploy()) as unknown as TestMockAavePoolDataProvider;
    await dataProvider.waitForDeployment();
    await dataProvider.setReserveTokensAddresses(
      await asset.getAddress(),
      await aToken.getAddress(),
      await debtToken.getAddress(),
      await debtToken.getAddress()
    );

    // Deploy mock price oracle
    const OracleFactory = await ethers.getContractFactory("TestMockAavePriceOracle");
    oracle = (await OracleFactory.deploy()) as unknown as TestMockAavePriceOracle;
    await oracle.waitForDeployment();

    // Deploy mock addresses provider
    const APFactory = await ethers.getContractFactory("TestMockAavePoolAddressesProvider");
    addressesProvider = (await APFactory.deploy()) as unknown as TestMockAavePoolAddressesProvider;
    await addressesProvider.waitForDeployment();
    await addressesProvider.setPoolDataProvider(await dataProvider.getAddress());
    await addressesProvider.setPriceOracle(await oracle.getAddress());

    // Deploy mock pool
    const PoolFactory = await ethers.getContractFactory("TestMockAavePool");
    mockPool = (await PoolFactory.deploy()) as unknown as TestMockAavePool;
    await mockPool.waitForDeployment();
    await mockPool.setAddressesProvider(await addressesProvider.getAddress());
    await mockPool.setReserveTokens(
      await asset.getAddress(),
      await aToken.getAddress(),
      await debtToken.getAddress(),
      await debtToken.getAddress()
    );

    // Approve pool in controller
    await mockController.setVaultApproval(await mockPool.getAddress(), true);

    // Pre-fund pool with assets for borrow/withdraw tests
    await asset.connect(wallet1).transfer(await mockPool.getAddress(), ethers.parseEther("5000"));

    // Set up credit delegation allowance for borrow tests (large default)
    await debtToken.setBorrowAllowance(
      wallet1.address,
      await facetHelper.getAddress(),
      ethers.MaxUint256
    );

    // Deploy supporting mocks for fulfillOrder tests
    const ServicerFactory = await ethers.getContractFactory("TestMockRepoServicer");
    mockServicer = (await ServicerFactory.deploy()) as unknown as TestMockRepoServicer;
    await mockServicer.waitForDeployment();

    const CMFactory = await ethers.getContractFactory("TestMockCollateralManager");
    mockCollateralManager = (await CMFactory.deploy()) as unknown as TestMockCollateralManager;
    await mockCollateralManager.waitForDeployment();

    const RTFactory = await ethers.getContractFactory("TestMockRepoToken");
    mockRepoToken = (await RTFactory.deploy()) as unknown as TestMockRepoToken;
    await mockRepoToken.waitForDeployment();

    await mockServicer.setPurchaseToken(await asset.getAddress());
    await mockServicer.setCollateralManager(await mockCollateralManager.getAddress());
    await mockCollateralManager.setCollateralTokens([await asset.getAddress()]);
    await mockRepoToken.setConfig(
      Math.floor(Date.now() / 1000) + 86400,
      await asset.getAddress(),
      await mockServicer.getAddress(),
      await mockCollateralManager.getAddress()
    );
  });

  // ==========================================================================
  // = approvedAavePoolOnly modifier ==========================================
  // ==========================================================================
  describe("approvedAavePoolOnly modifier", () => {
    it("should revert with InvalidAavePoolAddress for unapproved pool", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
          wallet2.address, // not approved
          await asset.getAddress(),
          ethers.parseEther("100"),
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAavePoolAddress");
    });
  });

  // ==========================================================================
  // = aaveApproveDelegationWithSig ===========================================
  // ==========================================================================
  describe("aaveApproveDelegationWithSig", () => {
    it("should revert when multicallInitiator not set (uninitialized)", async () => {
      await expect(
        facetHelper.connect(wallet1).aaveApproveDelegationWithSig(
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100"),
          Math.floor(Date.now() / 1000) + 3600,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWith("uninitialized");
    });

    it("should revert when called by wrong address (unauthorized)", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet2).aaveApproveDelegationWithSig(
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100"),
          Math.floor(Date.now() / 1000) + 3600,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWith("unauthorized");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with Expired when deadline <= block.timestamp", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      const pastDeadline = 1; // Unix timestamp 1 is always <= any real block.timestamp
      await expect(
        facetHelper.connect(wallet1).aaveApproveDelegationWithSig(
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100"),
          pastDeadline,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "Expired");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).aaveApproveDelegationWithSig(
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          ethers.parseEther("100"),
          Math.floor(Date.now() / 1000) + 3600,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with InvalidAmount when amount = 0", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).aaveApproveDelegationWithSig(
          await mockPool.getAddress(),
          await asset.getAddress(),
          0,
          Math.floor(Date.now() / 1000) + 3600,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
      await facetHelper.clearMulticallInitiator();
    });

    it("should call delegationWithSig successfully and emit event", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      const amount = ethers.parseEther("100");
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const tx = await facetHelper.connect(wallet1).aaveApproveDelegationWithSig(
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        deadline,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash
      );

      await expect(tx)
        .to.emit(debtToken, "DelegationWithSigCalled")
        .withArgs(wallet1.address, await facetHelper.getAddress(), amount, deadline);
      await facetHelper.clearMulticallInitiator();
    });
  });

  // ==========================================================================
  // = aaveSupply (3-arg) =====================================================
  // ==========================================================================
  describe("aaveSupply (3-arg)", () => {
    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          ethers.parseEther("100"),
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidAmount when amount = 0", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          0,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with SupplyAmountMismatch when pool mints wrong aToken amount", async () => {
      const amount = ethers.parseEther("100");
      await mockPool.setSupplyMintAmount(0); // mint 0 aTokens instead of amount
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), amount);

      await expect(
        facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          amount,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "SupplyAmountMismatch");

      await mockPool.resetSupplyMintAmount();
    });

    it("should revert with SupplyAssetMismatch when pool does not consume assets", async () => {
      const amount = ethers.parseEther("100");
      // Mint correct aTokens but pull 0 assets
      await mockPool.setSupplyPullAmount(0);
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), amount);

      await expect(
        facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          amount,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "SupplyAssetMismatch");

      await mockPool.resetSupplyPullAmount();
    });

    it("should successfully supply and credit aTokens to user", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await asset.connect(wallet1).approve(facetAddr, amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      const aTokenBefore = await aToken.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        false
      );
      const aTokenAfter = await aToken.balanceOf(wallet1.address);
      expect(aTokenAfter - aTokenBefore).to.equal(amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = aaveSupply (5-arg) =====================================================
  // ==========================================================================
  describe("aaveSupply (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper.connect(wallet2)["aaveSupply(address,address,uint256,address,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100"),
          wallet1.address,
          false
        )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call", async () => {
      const amount = ethers.parseEther("100");
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), amount);

      await facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );
      expect(await aToken.balanceOf(wallet1.address)).to.equal(amount);
    });

    it("should succeed with activeSettlementMaker context", async () => {
      const amount = ethers.parseEther("50");
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), amount);

      // The onlyUserOrActiveContext modifier now requires msg.sender == address(this)
      // for the activeSettlementMaker branch, so we exercise the code path via a
      // self-call helper that mirrors the retrieveFunds flow in TermLoanIntentFacet /
      // TermRepoTokenIntentFacet.
      await (facetHelper.connect(wallet2) as any).selfCallSupply(
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );
      expect(await aToken.balanceOf(wallet1.address)).to.equal(amount);
    });
  });

  // ==========================================================================
  // = aaveSupply Permit2 =====================================================
  // ==========================================================================
  describe("aaveSupply Permit2 path", () => {
    let mockPermit2: TestMockPermit2;

    before(async () => {
      const P2Factory = await ethers.getContractFactory("TestMockPermit2");
      const tempP2 = await P2Factory.deploy();
      await tempP2.waitForDeployment();
      const runtimeCode = await ethers.provider.getCode(await tempP2.getAddress());
      await ethers.provider.send("hardhat_setCode", [PERMIT2_CANONICAL_ADDRESS, runtimeCode]);
      mockPermit2 = (await ethers.getContractAt(
        "TestMockPermit2",
        PERMIT2_CANONICAL_ADDRESS
      )) as unknown as TestMockPermit2;
    });

    it("should use Permit2 for aaveSupply when usePermit2=true", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await asset.connect(wallet1).approve(PERMIT2_CANONICAL_ADDRESS, amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      await facetHelper.connect(wallet1)["aaveSupply(address,address,uint256,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        true
      );

      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferAmount()).to.equal(amount);
      expect(await mockPermit2.lastTransferToken()).to.equal(await asset.getAddress());

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = aaveWithdrawOnBehalfOf (3-arg) =========================================
  // ==========================================================================
  describe("aaveWithdrawOnBehalfOf (3-arg)", () => {
    const amount = ethers.parseEther("100");

    beforeEach(async () => {
      // Mint aTokens to wallet1 and approve facet
      await aToken.mint(wallet1.address, amount * 2n);
      await aToken.connect(wallet1).approve(await facetHelper.getAddress(), ethers.MaxUint256);
    });

    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          amount
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidAmount when amount = 0", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          0
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with WithdrawalAmountMismatch when pool returns wrong amount", async () => {
      await mockPool.setWithdrawReturnAmount(amount + 1n);
      await expect(
        facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          amount
        )
      ).to.be.revertedWithCustomError(facetHelper, "WithdrawalAmountMismatch");
      await mockPool.resetWithdrawReturnAmount();
    });

    it("should revert with WithdrawalAmountMismatch when pool sends wrong asset amount", async () => {
      // Return correct amount but only send partial assets
      await mockPool.setWithdrawSendAmount(0n);
      await expect(
        facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          amount
        )
      ).to.be.revertedWithCustomError(facetHelper, "WithdrawalAmountMismatch");
      await mockPool.resetWithdrawSendAmount();
    });

    it("should return surplus aTokens to user when pool burns fewer aTokens", async () => {
      // Pool burns 0 aTokens but sends correct assets; aTokens transferred from user are returned
      await mockPool.setWithdrawBurnAmount(0n);
      const facetAddr = await facetHelper.getAddress();
      const aTokenBefore = await aToken.balanceOf(wallet1.address);
      const assetBefore = await asset.balanceOf(wallet1.address);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      await facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount
      );

      const aTokenAfter = await aToken.balanceOf(wallet1.address);
      const assetAfter = await asset.balanceOf(wallet1.address);
      // aTokens net unchanged (pulled then returned)
      expect(aTokenAfter).to.equal(aTokenBefore);
      // assets received
      expect(assetAfter - assetBefore).to.equal(amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
      await mockPool.resetWithdrawBurnAmount();
    });

    it("should successfully withdraw and pay out assets to user", async () => {
      const facetAddr = await facetHelper.getAddress();
      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount
      );
      const assetAfter = await asset.balanceOf(wallet1.address);
      expect(assetAfter - assetBefore).to.equal(amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = aaveWithdrawOnBehalfOf (5-arg) =========================================
  // ==========================================================================
  describe("aaveWithdrawOnBehalfOf (5-arg)", () => {
    const amount = ethers.parseEther("100");

    beforeEach(async () => {
      await aToken.mint(wallet1.address, amount * 4n);
      await aToken.connect(wallet1).approve(await facetHelper.getAddress(), ethers.MaxUint256);
    });

    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper.connect(wallet2)["aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          amount,
          wallet1.address,
          true
        )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call and payout assets", async () => {
      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        true
      );
      expect((await asset.balanceOf(wallet1.address)) - assetBefore).to.equal(amount);
    });

    it("should still pay out assets with payoutToUser=false when no atomic context (direct call)", async () => {
      // atomicTxInitiator == 0 AND msg.sender != address(this) => payout regardless of payoutToUser flag
      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );
      expect((await asset.balanceOf(wallet1.address)) - assetBefore).to.equal(amount);
    });

    it("should hold assets in contract with payoutToUser=false in atomic context", async () => {
      const facetAddr = await facetHelper.getAddress();
      const assetBefore = await asset.balanceOf(facetAddr);

      // selfCallWithdraw sets atomicTxInitiator = user and calls 5-arg withdraw
      await facetHelper.connect(wallet1).selfCallWithdraw(
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );

      const assetAfter = await asset.balanceOf(facetAddr);
      expect(assetAfter - assetBefore).to.equal(amount);
    });
  });

  // ==========================================================================
  // = aaveBorrow (3-arg) =====================================================
  // ==========================================================================
  describe("aaveBorrow (3-arg)", () => {
    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256)"](
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidAmount when amount = 0", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          0
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InsufficientCreditDelegationAllowance when allowance too low", async () => {
      await debtToken.setBorrowAllowance(wallet1.address, await facetHelper.getAddress(), 0);
      await expect(
        facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(facetHelper, "InsufficientCreditDelegationAllowance");
      // Restore
      await debtToken.setBorrowAllowance(wallet1.address, await facetHelper.getAddress(), ethers.MaxUint256);
    });

    it("should successfully borrow and transfer assets to user", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount
      );
      expect((await asset.balanceOf(wallet1.address)) - assetBefore).to.equal(amount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = aaveBorrow (5-arg) =====================================================
  // ==========================================================================
  describe("aaveBorrow (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper.connect(wallet2)["aaveBorrow(address,address,uint256,address,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          ethers.parseEther("100"),
          wallet1.address,
          true
        )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call and payout assets", async () => {
      const amount = ethers.parseEther("100");
      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        true
      );
      expect((await asset.balanceOf(wallet1.address)) - assetBefore).to.equal(amount);
    });

    it("should still pay out assets with payoutToUser=false when no atomic context (direct call)", async () => {
      const amount = ethers.parseEther("100");
      const assetBefore = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveBorrow(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );
      expect((await asset.balanceOf(wallet1.address)) - assetBefore).to.equal(amount);
    });

    it("should hold assets in contract with payoutToUser=false in atomic context", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      const assetBefore = await asset.balanceOf(facetAddr);

      await facetHelper.connect(wallet1).selfCallBorrow(
        await mockPool.getAddress(),
        await asset.getAddress(),
        amount,
        wallet1.address,
        false
      );

      expect((await asset.balanceOf(facetAddr)) - assetBefore).to.equal(amount);
    });
  });


  // ==========================================================================
  // = aaveRepay (4-arg) ======================================================
  // ==========================================================================
  describe("aaveRepay (4-arg)", () => {
    const repayAmount = ethers.parseEther("100");

    beforeEach(async () => {
      // Approve the facet to pull repay funds from wallet1
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), repayAmount * 2n);
    });

    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveRepay(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          repayAmount,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidAmount when amount = 0", async () => {
      await expect(
        facetHelper.connect(wallet1)["aaveRepay(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          0,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with RepaidAssetsMismatch when pool returns wrong repaid amount", async () => {
      await mockPool.setRepayReturnAmount(repayAmount - 1n);
      await expect(
        facetHelper.connect(wallet1)["aaveRepay(address,address,uint256,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          repayAmount,
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "RepaidAssetsMismatch");
      await mockPool.resetRepayReturnAmount();
    });

    it("should successfully repay", async () => {
      const facetAddr = await facetHelper.getAddress();
      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);

      const wallet1Before = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveRepay(address,address,uint256,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        repayAmount,
        false
      );
      const wallet1After = await asset.balanceOf(wallet1.address);
      expect(wallet1Before - wallet1After).to.equal(repayAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await aToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = aaveRepay (5-arg) ======================================================
  // ==========================================================================
  describe("aaveRepay (5-arg)", () => {
    const repayAmount = ethers.parseEther("50");

    beforeEach(async () => {
      // Approve the facet to pull repay funds from wallet1
      await asset.connect(wallet1).approve(await facetHelper.getAddress(), repayAmount * 2n);
    });

    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper.connect(wallet2)["aaveRepay(address,address,uint256,address,bool)"](
          await mockPool.getAddress(),
          await asset.getAddress(),
          repayAmount,
          wallet1.address,
          false
        )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call", async () => {
      const wallet1Before = await asset.balanceOf(wallet1.address);
      await facetHelper.connect(wallet1)["aaveRepay(address,address,uint256,address,bool)"](
        await mockPool.getAddress(),
        await asset.getAddress(),
        repayAmount,
        wallet1.address,
        false
      );
      const wallet1After = await asset.balanceOf(wallet1.address);
      expect(wallet1Before - wallet1After).to.equal(repayAmount);
    });
  });

  // ==========================================================================
  // = _aaveCheckBorrowAllowance (via testCheckBorrowAllowance helper) ========
  // ==========================================================================
  describe("_aaveCheckBorrowAllowance", () => {
    it("should revert with InvalidRateMode for rateMode = 3", async () => {
      await expect(
        facetHelper.testCheckBorrowAllowance(
          await mockPool.getAddress(),
          await asset.getAddress(),
          3,
          wallet1.address
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidRateMode");
    });

    it("should revert with InvalidRateMode for rateMode = 0", async () => {
      await expect(
        facetHelper.testCheckBorrowAllowance(
          await mockPool.getAddress(),
          await asset.getAddress(),
          0,
          wallet1.address
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidRateMode");
    });

    it("should check stable debt token allowance for rateMode = 1", async () => {
      // debtToken is set as both stable and variable in the mock pool
      await debtToken.setBorrowAllowance(wallet1.address, await facetHelper.getAddress(), 999n);
      const allowance = await facetHelper.testCheckBorrowAllowance(
        await mockPool.getAddress(),
        await asset.getAddress(),
        1, // stable
        wallet1.address
      );
      expect(allowance).to.equal(999n);
    });

    it("should check variable debt token allowance for rateMode = 2", async () => {
      await debtToken.setBorrowAllowance(wallet1.address, await facetHelper.getAddress(), 12345n);
      const allowance = await facetHelper.testCheckBorrowAllowance(
        await mockPool.getAddress(),
        await asset.getAddress(),
        2, // variable
        wallet1.address
      );
      expect(allowance).to.equal(12345n);
    });

    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.testCheckBorrowAllowance(
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          2,
          wallet1.address
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidDelegatorAddress when delegator = address(0)", async () => {
      await expect(
        facetHelper.testCheckBorrowAllowance(
          await mockPool.getAddress(),
          await asset.getAddress(),
          2,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidDelegatorAddress");
    });
  });

  // ==========================================================================
  // = availableFunds =========================================================
  // ==========================================================================
  describe("availableFunds", () => {
    it("should revert with InvalidAavePoolAddress when aavePool = address(0)", async () => {
      await expect(
        facetHelper.availableFunds(ethers.ZeroAddress, await asset.getAddress(), wallet1.address)
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAavePoolAddress");
    });

    it("should revert with InvalidAssetAddress when asset = address(0)", async () => {
      await expect(
        facetHelper.availableFunds(await mockPool.getAddress(), ethers.ZeroAddress, wallet1.address)
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should return user aToken balance", async () => {
      const mintAmount = ethers.parseEther("250");
      await aToken.mint(wallet1.address, mintAmount);

      const balance = await facetHelper.availableFunds(
        await mockPool.getAddress(),
        await asset.getAddress(),
        wallet1.address
      );
      expect(balance).to.be.gte(mintAmount);
    });
  });

  // ==========================================================================
  // = availableBorrow ========================================================
  // ==========================================================================
  describe("availableBorrow", () => {
    it("should return 0 when assetPrice = 0", async () => {
      await oracle.setAssetPrice(await asset.getAddress(), 0);
      await mockPool.setAvailableBorrowsBase(1000n);

      const result = await facetHelper.availableBorrow(
        await mockPool.getAddress(),
        await asset.getAddress(),
        wallet1.address
      );
      expect(result).to.equal(0n);
    });

    it("should return correct available borrow amount when assetPrice > 0", async () => {
      await mockPool.setAvailableBorrowsBase(1000n);
      await oracle.setAssetPrice(await asset.getAddress(), 100n);
      // asset.decimals() = 18 → (1000 * 1e18) / 100 = 10e18
      const result = await facetHelper.availableBorrow(
        await mockPool.getAddress(),
        await asset.getAddress(),
        wallet1.address
      );
      expect(result).to.equal(ethers.parseEther("10"));
    });
  });

  // ==========================================================================
  // = generateCalldata =======================================================
  // ==========================================================================
  describe("generateCalldata", () => {
    const WITHDRAW_SELECTOR = ethers.dataSlice(
      ethers.id("aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)"),
      0,
      4
    );
    const BORROW_SELECTOR = ethers.dataSlice(
      ethers.id("aaveBorrow(address,address,uint256,address,bool)"),
      0,
      4
    );

    it("should generate calldata for WITHDRAW_SELECTOR", async () => {
      const amount = ethers.parseEther("100");
      const calldata = await facetHelper.generateCalldata(
        WITHDRAW_SELECTOR,
        await mockPool.getAddress(),
        await asset.getAddress(),
        wallet1.address,
        amount,
        true,
        "0x"
      );

      const expectedCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "bool"],
        [await mockPool.getAddress(), await asset.getAddress(), amount, wallet1.address, true]
      );
      const expected = WITHDRAW_SELECTOR + expectedCalldata.slice(2);
      expect(calldata).to.equal(expected);
    });

    it("should generate calldata for BORROW_SELECTOR", async () => {
      const amount = ethers.parseEther("50");
      const calldata = await facetHelper.generateCalldata(
        BORROW_SELECTOR,
        await mockPool.getAddress(),
        await asset.getAddress(),
        wallet1.address,
        amount,
        false,
        "0x"
      );

      const expectedCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "bool"],
        [await mockPool.getAddress(), await asset.getAddress(), amount, wallet1.address, false]
      );
      const expected = BORROW_SELECTOR + expectedCalldata.slice(2);
      expect(calldata).to.equal(expected);
    });

    it("should revert with UnsupportedSelector for unknown selector", async () => {
      await expect(
        facetHelper.generateCalldata(
          "0x12345678",
          await mockPool.getAddress(),
          await asset.getAddress(),
          wallet1.address,
          ethers.parseEther("100"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(facetHelper, "UnsupportedSelector");
    });
  });

  // ==========================================================================
  // = previewAaveRefinanceIn =================================================
  // ==========================================================================
  describe("previewAaveRefinanceIn", () => {
    const ACTION_HOOK_INPUT_TYPE =
      "tuple(address user, address inputToken, uint256 maxInputAmount, address outputToken, uint256 minOutputAmount, address targetAddress, bytes additionalCalldata)";

    it("should revert with InputOutputTokenCollision when inputToken == outputToken", async () => {
      await expect(
        facetHelper.previewAaveRefinanceIn({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await asset.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });

    it("should return correct PreviewAction for distinct inputToken/outputToken", async () => {
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInputAmount = ethers.parseEther("100");
      const minOutputAmount = ethers.parseEther("50");

      const result = await facetHelper.previewAaveRefinanceIn({
        user: wallet1.address,
        inputToken,
        maxInputAmount,
        outputToken,
        minOutputAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata: "0x",
      });

      expect(result.expectedInputToken).to.equal(inputToken);
      expect(result.expectedInputAmount).to.equal(maxInputAmount);
      expect(result.expectedOutputToken).to.equal(outputToken);
      expect(result.expectedOutputAmount).to.equal(minOutputAmount);
      expect(result.isDeterministic).to.be.true;
    });
  });

  // ==========================================================================
  // = previewAaveRefinanceOut ================================================
  // ==========================================================================
  describe("previewAaveRefinanceOut", () => {
    it("should revert with InputOutputTokenCollision when inputToken == outputToken", async () => {
      await expect(
        facetHelper.previewAaveRefinanceOut({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await asset.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });

    it("should return correct PreviewAction for distinct inputToken/outputToken", async () => {
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInputAmount = ethers.parseEther("100");
      const minOutputAmount = ethers.parseEther("50");

      const result = await facetHelper.previewAaveRefinanceOut({
        user: wallet1.address,
        inputToken,
        maxInputAmount,
        outputToken,
        minOutputAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata: "0x",
      });

      expect(result.expectedInputToken).to.equal(inputToken);
      expect(result.expectedInputAmount).to.equal(maxInputAmount);
      expect(result.expectedOutputToken).to.equal(outputToken);
      expect(result.expectedOutputAmount).to.equal(minOutputAmount);
      expect(result.isDeterministic).to.be.true;
    });
  });

  // ==========================================================================
  // = generateActionCalldata =================================================
  // ==========================================================================
  describe("generateActionCalldata", () => {
    it("should revert with UnsupportedHookSelector for unknown selector", async () => {
      await expect(
        facetHelper.generateActionCalldata(
          wallet1.address,
          wallet1.address,
          ethers.parseEther("100"),
          wallet2.address,
          ethers.parseEther("50"),
          "0x12345678",
          await mockPool.getAddress(),
          "0x"
        )
      ).to.be.revertedWithCustomError(facetHelper, "UnsupportedHookSelector");
    });

    it("should return previewAction and encodedCalldata for aaveRefinanceInHook selector", async () => {
      const refinanceInSelector = facetHelper.interface.getFunction("aaveRefinanceInHook").selector;
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInputAmount = ethers.parseEther("100");
      const minOutputAmount = ethers.parseEther("50");

      const [previewAction, encodedCalldata] = await facetHelper.generateActionCalldata(
        wallet1.address,
        inputToken,
        maxInputAmount,
        outputToken,
        minOutputAmount,
        refinanceInSelector,
        await mockPool.getAddress(),
        "0x"
      );

      expect(previewAction.expectedInputToken).to.equal(inputToken);
      expect(previewAction.expectedInputAmount).to.equal(maxInputAmount);
      expect(previewAction.isDeterministic).to.be.true;
      expect(encodedCalldata.slice(0, 10)).to.equal(refinanceInSelector);
    });

    it("should return previewAction and encodedCalldata for aaveRefinanceOutHook selector", async () => {
      const refinanceOutSelector = facetHelper.interface.getFunction("aaveRefinanceOutHook").selector;
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInputAmount = ethers.parseEther("100");
      const minOutputAmount = ethers.parseEther("50");

      const [previewAction, encodedCalldata] = await facetHelper.generateActionCalldata(
        wallet1.address,
        inputToken,
        maxInputAmount,
        outputToken,
        minOutputAmount,
        refinanceOutSelector,
        await mockPool.getAddress(),
        "0x"
      );

      expect(previewAction.expectedInputToken).to.equal(inputToken);
      expect(previewAction.expectedInputAmount).to.equal(maxInputAmount);
      expect(previewAction.isDeterministic).to.be.true;
      expect(encodedCalldata.slice(0, 10)).to.equal(refinanceOutSelector);
    });

    it("should propagate InputOutputTokenCollision from previewAaveRefinanceIn when tokens collide", async () => {
      const refinanceInSelector = facetHelper.interface.getFunction("aaveRefinanceInHook").selector;
      const sameToken = await asset.getAddress();

      await expect(
        facetHelper.generateActionCalldata(
          wallet1.address,
          sameToken,
          ethers.parseEther("100"),
          sameToken,
          ethers.parseEther("50"),
          refinanceInSelector,
          await mockPool.getAddress(),
          "0x"
        )
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });
  });

  // ==========================================================================
  // = aaveRefinanceInHook ====================================================
  // ==========================================================================
  describe("aaveRefinanceInHook", () => {
    const collateralAmount = ethers.parseEther("100");
    const borrowAmount = ethers.parseEther("50");

    it("should revert with Unauthorized caller when flash loan context is not set", async () => {
      await expect(
        facetHelper.aaveRefinanceInHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: collateralAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: borrowAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should revert with Unauthorized caller when flash loan borrower does not match user", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet2.address);

      await expect(
        facetHelper.aaveRefinanceInHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: collateralAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: borrowAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWith("Unauthorized caller");

      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should revert with InvalidAavePoolAddress when pool is not approved", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);

      await expect(
        facetHelper.aaveRefinanceInHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: collateralAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: borrowAmount,
          targetAddress: wallet2.address,
          additionalCalldata: "0x",
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAavePoolAddress");

      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should succeed with valid flash loan context and approved pool", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);

      // Fund the facet with collateral to supply
      await asset.connect(wallet1).transfer(await facetHelper.getAddress(), collateralAmount);

      // Use distinct collateral and loan tokens (same asset for mock simplicity, since mock allows same token)
      // collateralToken = asset (inputToken), loanAsset = asset (outputToken)
      // Note: same token is OK here since we're testing hook execution, not preview collision
      await expect(
        facetHelper.connect(wallet1).aaveRefinanceInHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),   // collateral
          maxInputAmount: collateralAmount,
          outputToken: await asset.getAddress(),  // loan asset
          minOutputAmount: borrowAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.not.be.reverted;

      await facetHelper.clearActiveFlashLoanBorrower();
    });
  });

  // ==========================================================================
  // = aaveRefinanceOutHook ===================================================
  // ==========================================================================
  describe("aaveRefinanceOutHook", () => {
    const repayAmount = ethers.parseEther("100");
    const withdrawAmount = ethers.parseEther("100");

    it("should revert with Unauthorized caller when flash loan context is not set", async () => {
      await expect(
        facetHelper.aaveRefinanceOutHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: repayAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: withdrawAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should revert with Unauthorized caller when flash loan borrower does not match user", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet2.address);

      await expect(
        facetHelper.aaveRefinanceOutHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: repayAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: withdrawAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.be.revertedWith("Unauthorized caller");

      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should revert with InvalidAavePoolAddress when pool is not approved", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);

      await expect(
        facetHelper.aaveRefinanceOutHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),
          maxInputAmount: repayAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: withdrawAmount,
          targetAddress: wallet2.address,
          additionalCalldata: "0x",
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAavePoolAddress");

      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should succeed with valid flash loan context, repay funds, and approved pool", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);

      // Fund the facet with assets to repay
      await asset.connect(wallet1).transfer(await facetHelper.getAddress(), repayAmount);

      // Mint aTokens to wallet1 and approve facet to spend them (for withdraw)
      await aToken.mint(wallet1.address, withdrawAmount);
      await aToken.connect(wallet1).approve(await facetHelper.getAddress(), withdrawAmount);

      await expect(
        facetHelper.connect(wallet1).aaveRefinanceOutHook({
          user: wallet1.address,
          inputToken: await asset.getAddress(),   // loan asset to repay
          maxInputAmount: repayAmount,
          outputToken: await asset.getAddress(),  // collateral to withdraw
          minOutputAmount: withdrawAmount,
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: "0x",
        })
      ).to.not.be.reverted;

      await facetHelper.clearActiveFlashLoanBorrower();
    });
  });
});
