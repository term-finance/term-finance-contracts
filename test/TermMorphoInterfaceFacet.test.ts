/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestTermMorphoInterfaceFacetHelper,
  TestMockMorphoPool,
  TestMockMorphoOracle,
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

// MarketParams ABI type
const MARKET_PARAMS_TYPE =
  "tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";

describe("TermMorphoInterfaceFacet Tests", () => {
  let facetHelper: TestTermMorphoInterfaceFacetHelper;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let loanToken: TestToken;
  let collateralToken: TestToken;
  let mockPool: TestMockMorphoPool;
  let mockOracle: TestMockMorphoOracle;
  let mockServicer: TestMockRepoServicer;
  let mockCollateralManager: TestMockCollateralManager;
  let mockRepoToken: TestMockRepoToken;

  // Default market params used in most tests
  let defaultMarketParams: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: bigint;
  };
  let defaultMarketId: string;

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy loan token
    const TokenFactory = await ethers.getContractFactory("TestToken");
    loanToken = (await upgrades.deployProxy(TokenFactory, [
      "Loan Token",
      "LOAN",
      18,
      [wallet1.address],
      [ethers.parseEther("10000")],
    ])) as unknown as TestToken;
    await loanToken.waitForDeployment();

    // Deploy collateral token
    collateralToken = (await upgrades.deployProxy(TokenFactory, [
      "Collateral Token",
      "COLL",
      18,
      [wallet1.address],
      [ethers.parseEther("10000")],
    ])) as unknown as TestToken;
    await collateralToken.waitForDeployment();

    // Deploy mock oracle
    const OracleFactory = await ethers.getContractFactory("TestMockMorphoOracle");
    mockOracle = (await OracleFactory.deploy()) as unknown as TestMockMorphoOracle;
    await mockOracle.waitForDeployment();
    // Default price: 1e36 (MORPHO_ORACLE_PRICE_SCALE) so 1:1 collateral to loan
    await mockOracle.setPrice(ethers.parseUnits("1", 36));

    // Deploy mock pool
    const PoolFactory = await ethers.getContractFactory("TestMockMorphoPool");
    mockPool = (await PoolFactory.deploy()) as unknown as TestMockMorphoPool;
    await mockPool.waitForDeployment();

    // Deploy facet helper (deployed with mockPool address)
    const FacetFactory = await ethers.getContractFactory(
      "TestTermMorphoInterfaceFacetHelper"
    );
    facetHelper = (await FacetFactory.deploy(
      await mockPool.getAddress()
    )) as unknown as TestTermMorphoInterfaceFacetHelper;
    await facetHelper.waitForDeployment();

    // Set up default market params
    defaultMarketParams = {
      loanToken: await loanToken.getAddress(),
      collateralToken: await collateralToken.getAddress(),
      oracle: await mockOracle.getAddress(),
      irm: ethers.ZeroAddress,
      lltv: ethers.parseEther("0.8"), // 80% LTV
    };

    // Compute a market ID (keccak256 of abi-encoded MarketParams)
    defaultMarketId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [MARKET_PARAMS_TYPE],
        [defaultMarketParams]
      )
    );

    // Register market params in mock pool
    await mockPool.setMarketParams(defaultMarketId, defaultMarketParams);

    // Pre-fund pool with tokens for borrow/withdrawCollateral tests
    await loanToken
      .connect(wallet1)
      .transfer(await mockPool.getAddress(), ethers.parseEther("5000"));
    await collateralToken
      .connect(wallet1)
      .transfer(await mockPool.getAddress(), ethers.parseEther("5000"));

    // Deploy supporting mocks for fulfillOrder tests
    const ServicerFactory = await ethers.getContractFactory("TestMockRepoServicer");
    mockServicer = (await ServicerFactory.deploy()) as unknown as TestMockRepoServicer;
    await mockServicer.waitForDeployment();

    const CMFactory = await ethers.getContractFactory("TestMockCollateralManager");
    mockCollateralManager =
      (await CMFactory.deploy()) as unknown as TestMockCollateralManager;
    await mockCollateralManager.waitForDeployment();

    const RTFactory = await ethers.getContractFactory("TestMockRepoToken");
    mockRepoToken = (await RTFactory.deploy()) as unknown as TestMockRepoToken;
    await mockRepoToken.waitForDeployment();

    await mockServicer.setPurchaseToken(await loanToken.getAddress());
    await mockServicer.setCollateralManager(
      await mockCollateralManager.getAddress()
    );
    await mockCollateralManager.setCollateralTokens([
      await collateralToken.getAddress(),
    ]);
    await mockRepoToken.setConfig(
      Math.floor(Date.now() / 1000) + 86400,
      await loanToken.getAddress(),
      await mockServicer.getAddress(),
      await mockCollateralManager.getAddress()
    );
  });

  // ==========================================================================
  // = approvedMorphoPoolOnly modifier ========================================
  // ==========================================================================
  describe("approvedMorphoPoolOnly modifier", () => {
    it("should revert with InvalidMorphoPoolAddress for unapproved pool", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
            wallet2.address, // not approved
            defaultMarketParams,
            ethers.parseEther("100"),
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });
  });

  // ==========================================================================
  // = morphoSetAuthorizationWithSig ==========================================
  // ==========================================================================
  describe("morphoSetAuthorizationWithSig", () => {
    it("should revert when multicallInitiator not set (uninitialized)", async () => {
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          await mockPool.getAddress(),
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWith("uninitialized");
    });

    it("should revert when called by wrong address (unauthorized)", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet2).morphoSetAuthorizationWithSig(
          await mockPool.getAddress(),
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWith("unauthorized");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with InvalidMorphoPoolAddress when pool != deployedMorphoPool", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          wallet2.address, // wrong pool
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with InvalidMorphoPoolAddress when pool arg is zero", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          ethers.ZeroAddress,
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with InvalidUserAddress when authorizer = address(0)", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          await mockPool.getAddress(),
          {
            authorizer: ethers.ZeroAddress,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert with Expired when deadline <= block.timestamp", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          await mockPool.getAddress(),
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: 1n, // always expired
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false
        )
      ).to.be.revertedWithCustomError(facetHelper, "Expired");
      await facetHelper.clearMulticallInitiator();
    });

    it("should call setAuthorizationWithSig successfully when pool does not revert", async () => {
      await facetHelper.setMulticallInitiator(wallet1.address);
      // Should not revert
      await facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
        await mockPool.getAddress(),
        {
          authorizer: wallet1.address,
          authorized: wallet2.address,
          isAuthorized: true,
          nonce: 0n,
          deadline: ethers.MaxUint256,
        },
        { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
        false
      );
      await facetHelper.clearMulticallInitiator();
    });

    it("should not revert when pool reverts and skipRevert=true", async () => {
      await mockPool.setShouldRevertAuth(true);
      await facetHelper.setMulticallInitiator(wallet1.address);
      // Should not revert due to skipRevert=true
      await facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
        await mockPool.getAddress(),
        {
          authorizer: wallet1.address,
          authorized: wallet2.address,
          isAuthorized: true,
          nonce: 0n,
          deadline: ethers.MaxUint256,
        },
        { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
        true // skipRevert
      );
      await mockPool.setShouldRevertAuth(false);
      await facetHelper.clearMulticallInitiator();
    });

    it("should revert when pool reverts and skipRevert=false", async () => {
      await mockPool.setShouldRevertAuth(true);
      await facetHelper.setMulticallInitiator(wallet1.address);
      await expect(
        facetHelper.connect(wallet1).morphoSetAuthorizationWithSig(
          await mockPool.getAddress(),
          {
            authorizer: wallet1.address,
            authorized: wallet2.address,
            isAuthorized: true,
            nonce: 0n,
            deadline: ethers.MaxUint256,
          },
          { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash },
          false // skipRevert
        )
      ).to.be.reverted;
      await mockPool.setShouldRevertAuth(false);
      await facetHelper.clearMulticallInitiator();
    });
  });

  // ==========================================================================
  // = morphoSupplyCollateral (4-arg) =========================================
  // ==========================================================================
  describe("morphoSupplyCollateral (4-arg)", () => {
    it("should revert with InvalidMorphoPoolAddress when pool = address(0)", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
            ethers.ZeroAddress,
            defaultMarketParams,
            ethers.parseEther("100"),
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InvalidAmount when assets = 0", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            0,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InvalidCollateralAsset when collateralToken = address(0)", async () => {
      const badMp = { ...defaultMarketParams, collateralToken: ethers.ZeroAddress };
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            badMp,
            ethers.parseEther("100"),
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidCollateralAsset");
    });

    it("should revert with SupplyAmountMismatch when pool does not consume all assets", async () => {
      const amount = ethers.parseEther("100");
      // Override pool to pull 0 assets (mismatching balance change)
      await mockPool.setSupplyPullOverride(0);
      await collateralToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            amount,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "SupplyAmountMismatch");
      await mockPool.resetSupplyPullOverride();
    });

    it("should successfully supply collateral (4-arg)", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await collateralToken
        .connect(wallet1)
        .approve(facetAddr, amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      const poolBefore = await collateralToken.balanceOf(
        await mockPool.getAddress()
      );
      await facetHelper
        .connect(wallet1)
        ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          false
        );
      const poolAfter = await collateralToken.balanceOf(
        await mockPool.getAddress()
      );
      expect(poolAfter - poolBefore).to.equal(amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoSupplyCollateral (5-arg) =========================================
  // ==========================================================================
  describe("morphoSupplyCollateral (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper
          .connect(wallet2)
          ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            ethers.parseEther("100"),
            wallet1.address,
            false
          )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call", async () => {
      const amount = ethers.parseEther("100");
      await collateralToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      const poolBefore = await collateralToken.balanceOf(
        await mockPool.getAddress()
      );
      await facetHelper
        .connect(wallet1)
        ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          false
        );
      const poolAfter = await collateralToken.balanceOf(
        await mockPool.getAddress()
      );
      expect(poolAfter - poolBefore).to.equal(amount);
    });

    it("should succeed with activeSettlementMaker context", async () => {
      const amount = ethers.parseEther("50");
      await collateralToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      // The onlyUserOrActiveContext modifier now requires msg.sender == address(this)
      // for the activeSettlementMaker branch, so we exercise the code path via a
      // self-call helper that mirrors the retrieveFunds flow in TermLoanIntentFacet /
      // TermRepoTokenIntentFacet.
      await (facetHelper.connect(wallet2) as any).selfCallSupplyCollateral(
        await mockPool.getAddress(),
        defaultMarketParams,
        amount,
        wallet1.address,
        false
      );
    });
  });

  // ==========================================================================
  // = morphoSupplyCollateral Permit2 path ====================================
  // ==========================================================================
  describe("morphoSupplyCollateral Permit2 path", () => {
    before(async () => {
      const P2Factory = await ethers.getContractFactory("TestMockPermit2");
      const tempP2 = await P2Factory.deploy();
      await tempP2.waitForDeployment();
      const runtimeCode = await ethers.provider.getCode(await tempP2.getAddress());
      await ethers.provider.send("hardhat_setCode", [
        PERMIT2_CANONICAL_ADDRESS,
        runtimeCode,
      ]);
    });

    it("should use Permit2 for morphoSupplyCollateral when usePermit2=true", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await collateralToken
        .connect(wallet1)
        .approve(PERMIT2_CANONICAL_ADDRESS, amount);

      const mockPermit2 = await ethers.getContractAt(
        "TestMockPermit2",
        PERMIT2_CANONICAL_ADDRESS
      );

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      await facetHelper
        .connect(wallet1)
        ["morphoSupplyCollateral(address,(address,address,address,address,uint256),uint256,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          true
        );

      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferAmount()).to.equal(amount);
      expect(await mockPermit2.lastTransferToken()).to.equal(
        await collateralToken.getAddress()
      );

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoSupply (4-arg) ===================================================
  // ==========================================================================
  describe("morphoSupply (4-arg)", () => {
    it("should revert with InvalidAmount when assets = 0", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            0,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InvalidAssetAddress when loanToken = address(0)", async () => {
      const badMp = { ...defaultMarketParams, loanToken: ethers.ZeroAddress };
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            badMp,
            ethers.parseEther("100"),
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with SupplyAmountMismatch when pool consumes wrong assets", async () => {
      const amount = ethers.parseEther("100");
      // Pull 0 tokens but return correct amount — balance not changed
      await mockPool.setSupplyPullOverride(0);
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            amount,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "SupplyAmountMismatch");
      await mockPool.resetSupplyPullOverride();
    });

    it("should revert with SupplyAmountMismatch when assetsSupplied != assets", async () => {
      const amount = ethers.parseEther("100");
      // Pool returns different assetsSupplied
      await mockPool.setSupplyReturnAmount(amount - 1n);
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            amount,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "SupplyAmountMismatch");
      await mockPool.resetSupplyReturnAmount();
    });

    it("should successfully supply loan assets (4-arg)", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await loanToken
        .connect(wallet1)
        .approve(facetAddr, amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      const poolBefore = await loanToken.balanceOf(await mockPool.getAddress());
      await facetHelper
        .connect(wallet1)
        ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          false
        );
      const poolAfter = await loanToken.balanceOf(await mockPool.getAddress());
      expect(poolAfter - poolBefore).to.equal(amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoSupply (5-arg) ===================================================
  // ==========================================================================
  describe("morphoSupply (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper
          .connect(wallet2)
          ["morphoSupply(address,(address,address,address,address,uint256),uint256,address,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            ethers.parseEther("100"),
            wallet1.address,
            false
          )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call", async () => {
      const amount = ethers.parseEther("100");
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      await facetHelper
        .connect(wallet1)
        ["morphoSupply(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          false
        );
    });

    it("should succeed with activeSettlementMaker context", async () => {
      const amount = ethers.parseEther("50");
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), amount);

      // The onlyUserOrActiveContext modifier now requires msg.sender == address(this)
      // for the activeSettlementMaker branch, so we exercise the code path via a
      // self-call helper that mirrors the retrieveFunds flow in TermLoanIntentFacet /
      // TermRepoTokenIntentFacet.
      await (facetHelper.connect(wallet2) as any).selfCallSupply(
        await mockPool.getAddress(),
        defaultMarketParams,
        amount,
        wallet1.address,
        false
      );
    });
  });

  // ==========================================================================
  // = morphoSupply Permit2 path ==============================================
  // ==========================================================================
  describe("morphoSupply Permit2 path", () => {
    it("should use Permit2 for morphoSupply when usePermit2=true", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      await loanToken.connect(wallet1).approve(PERMIT2_CANONICAL_ADDRESS, amount);

      const mockPermit2 = await ethers.getContractAt(
        "TestMockPermit2",
        PERMIT2_CANONICAL_ADDRESS
      );

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      await facetHelper
        .connect(wallet1)
        ["morphoSupply(address,(address,address,address,address,uint256),uint256,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          true
        );

      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferToken()).to.equal(
        await loanToken.getAddress()
      );

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoWithdrawCollateral (3-arg) =======================================
  // ==========================================================================
  describe("morphoWithdrawCollateral (3-arg)", () => {
    it("should revert with InvalidAmount when assets = 0", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            0
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InvalidAssetAddress when collateralToken = address(0)", async () => {
      const badMp = { ...defaultMarketParams, collateralToken: ethers.ZeroAddress };
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256)"](
            await mockPool.getAddress(),
            badMp,
            ethers.parseEther("100")
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      // 3-arg sets user = msg.sender which cannot be zero, so test via testWithdrawCollateralInternal
      await expect(
        facetHelper.testWithdrawCollateralInternal(
          await mockPool.getAddress(),
          defaultMarketParams,
          ethers.parseEther("100"),
          ethers.ZeroAddress,
          true
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should successfully withdraw collateral and pay out to user (3-arg)", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      const assetBefore = await collateralToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount
        );
      const assetAfter = await collateralToken.balanceOf(wallet1.address);
      expect(assetAfter - assetBefore).to.equal(amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoWithdrawCollateral (5-arg) =======================================
  // ==========================================================================
  describe("morphoWithdrawCollateral (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper
          .connect(wallet2)
          ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            ethers.parseEther("100"),
            wallet1.address,
            true
          )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call and payout collateral", async () => {
      const amount = ethers.parseEther("100");
      const assetBefore = await collateralToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          true
        );
      expect(
        (await collateralToken.balanceOf(wallet1.address)) - assetBefore
      ).to.equal(amount);
    });

    it("should still pay out collateral with payoutUser=false when no atomic context (direct call)", async () => {
      // atomicTxInitiator == 0 AND msg.sender != address(this) => sends to user_ regardless of payoutUser
      const amount = ethers.parseEther("100");
      const assetBefore = await collateralToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          false
        );
      expect(
        (await collateralToken.balanceOf(wallet1.address)) - assetBefore
      ).to.equal(amount);
    });

    it("should hold collateral in contract with payoutUser=false in atomic context", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      const facetBefore = await collateralToken.balanceOf(facetAddr);

      await facetHelper
        .connect(wallet1)
        .selfCallWithdrawCollateral(
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          false
        );

      const facetAfter = await collateralToken.balanceOf(facetAddr);
      expect(facetAfter - facetBefore).to.equal(amount);
    });
  });


  // ==========================================================================
  // = morphoBorrow (3-arg) ===================================================
  // ==========================================================================
  describe("morphoBorrow (3-arg)", () => {
    it("should revert with InvalidAmount when assets = 0", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoBorrow(address,(address,address,address,address,uint256),uint256)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            0
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InvalidAssetAddress when loanToken = address(0)", async () => {
      const badMp = { ...defaultMarketParams, loanToken: ethers.ZeroAddress };
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoBorrow(address,(address,address,address,address,uint256),uint256)"](
            await mockPool.getAddress(),
            badMp,
            ethers.parseEther("100")
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAssetAddress");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      await expect(
        facetHelper.testBorrowInternal(
          await mockPool.getAddress(),
          defaultMarketParams,
          ethers.parseEther("100"),
          ethers.ZeroAddress,
          true
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should revert with BorrowedAssetsMismatch when pool returns wrong amount", async () => {
      const amount = ethers.parseEther("100");
      await mockPool.setBorrowReturnAmount(amount - 1n);
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoBorrow(address,(address,address,address,address,uint256),uint256)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            amount
          )
      ).to.be.revertedWithCustomError(facetHelper, "BorrowedAssetsMismatch");
      await mockPool.resetBorrowReturnAmount();
    });

    it("should successfully borrow and transfer assets to user (3-arg)", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      const assetBefore = await loanToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoBorrow(address,(address,address,address,address,uint256),uint256)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount
        );
      expect(
        (await loanToken.balanceOf(wallet1.address)) - assetBefore
      ).to.equal(amount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoBorrow (5-arg) ===================================================
  // ==========================================================================
  describe("morphoBorrow (5-arg)", () => {
    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper
          .connect(wallet2)
          ["morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            ethers.parseEther("100"),
            wallet1.address,
            true
          )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call and payout assets", async () => {
      const amount = ethers.parseEther("100");
      const assetBefore = await loanToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          true
        );
      expect(
        (await loanToken.balanceOf(wallet1.address)) - assetBefore
      ).to.equal(amount);
    });

    it("should still pay out assets with payoutUser=false when no atomic context (direct call)", async () => {
      const amount = ethers.parseEther("100");
      const assetBefore = await loanToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          amount,
          wallet1.address,
          false
        );
      expect(
        (await loanToken.balanceOf(wallet1.address)) - assetBefore
      ).to.equal(amount);
    });

    it("should hold assets in contract with payoutUser=false in atomic context", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await facetHelper.getAddress();
      const facetBefore = await loanToken.balanceOf(facetAddr);

      await facetHelper.connect(wallet1).selfCallBorrow(
        await mockPool.getAddress(),
        defaultMarketParams,
        amount,
        wallet1.address,
        false
      );

      expect((await loanToken.balanceOf(facetAddr)) - facetBefore).to.equal(
        amount
      );
    });
  });

  // ==========================================================================
  // = morphoRepay (4-arg) ====================================================
  // ==========================================================================
  describe("morphoRepay (4-arg)", () => {
    const repayAmount = ethers.parseEther("100");

    beforeEach(async () => {
      // Approve the facet to pull repay funds from wallet1
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), repayAmount * 2n);
    });

    it("should revert with InvalidAmount when assets = 0", async () => {
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoRepay(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            0,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidAmount");
    });

    it("should revert with InvalidLoanToken when loanToken = address(0)", async () => {
      const badMp = { ...defaultMarketParams, loanToken: ethers.ZeroAddress };
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoRepay(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            badMp,
            repayAmount,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidLoanToken");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      await expect(
        facetHelper.testRepayInternal(
          await mockPool.getAddress(),
          defaultMarketParams,
          repayAmount,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should revert with RepaidAssetsMismatch when pool returns wrong amount", async () => {
      await mockPool.setRepayReturnAmount(repayAmount - 2n);
      await expect(
        facetHelper
          .connect(wallet1)
          ["morphoRepay(address,(address,address,address,address,uint256),uint256,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            repayAmount,
            false
          )
      ).to.be.revertedWithCustomError(facetHelper, "RepaidAssetsMismatch");
      await mockPool.resetRepayReturnAmount();
    });

    it("should successfully repay (4-arg)", async () => {
      const facetAddr = await facetHelper.getAddress();
      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);

      const wallet1Before = await loanToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoRepay(address,(address,address,address,address,uint256),uint256,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          repayAmount,
          false
        );
      const wallet1After = await loanToken.balanceOf(wallet1.address);
      expect(wallet1Before - wallet1After).to.equal(repayAmount);

      expect(await loanToken.balanceOf(facetAddr)).to.equal(0);
      expect(await collateralToken.balanceOf(facetAddr)).to.equal(0);
    });
  });

  // ==========================================================================
  // = morphoRepay (5-arg) ====================================================
  // ==========================================================================
  describe("morphoRepay (5-arg)", () => {
    const repayAmount = ethers.parseEther("50");

    beforeEach(async () => {
      // Approve the facet to pull repay funds from wallet1
      await loanToken
        .connect(wallet1)
        .approve(await facetHelper.getAddress(), repayAmount * 2n);
    });

    it("should revert with Unauthorized caller for unauthorized caller", async () => {
      await expect(
        facetHelper
          .connect(wallet2)
          ["morphoRepay(address,(address,address,address,address,uint256),uint256,address,bool)"](
            await mockPool.getAddress(),
            defaultMarketParams,
            repayAmount,
            wallet1.address,
            false
          )
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should succeed with direct user call", async () => {
      const wallet1Before = await loanToken.balanceOf(wallet1.address);
      await facetHelper
        .connect(wallet1)
        ["morphoRepay(address,(address,address,address,address,uint256),uint256,address,bool)"](
          await mockPool.getAddress(),
          defaultMarketParams,
          repayAmount,
          wallet1.address,
          false
        );
      const wallet1After = await loanToken.balanceOf(wallet1.address);
      expect(wallet1Before - wallet1After).to.equal(repayAmount);
    });

    it("should succeed with activeSettlementMaker context", async () => {
      const wallet1Before = await loanToken.balanceOf(wallet1.address);
      // The onlyUserOrActiveContext modifier now requires msg.sender == address(this)
      // for the activeSettlementMaker branch, so we exercise the code path via a
      // self-call helper that mirrors the retrieveFunds flow in TermLoanIntentFacet /
      // TermRepoTokenIntentFacet.
      await (facetHelper.connect(wallet2) as any).selfCallRepay(
        await mockPool.getAddress(),
        defaultMarketParams,
        repayAmount,
        wallet1.address,
        false
      );
      const wallet1After = await loanToken.balanceOf(wallet1.address);
      expect(wallet1Before - wallet1After).to.equal(repayAmount);
    });
  });

  // ==========================================================================
  // = availableFunds =========================================================
  // ==========================================================================
  describe("availableFunds", () => {
    it("should revert with InvalidMorphoPoolAddress when morphoPool = address(0)", async () => {
      await expect(
        facetHelper.availableFunds(
          ethers.ZeroAddress,
          wallet1.address,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      await expect(
        facetHelper.availableFunds(
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should revert with InvalidMarketId when marketId = bytes32(0)", async () => {
      await expect(
        facetHelper.availableFunds(
          await mockPool.getAddress(),
          wallet1.address,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMarketId");
    });

    it("should return full collateral when borrowShares = 0", async () => {
      const collateralAmount = ethers.parseEther("500");
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: 0n,
        collateral: collateralAmount,
      });

      const available = await facetHelper.availableFunds(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(available).to.equal(collateralAmount);
    });

    it("should return 0 when collateral < requiredCollateral", async () => {
      // Set up a position where the required collateral exceeds what's deposited
      const collateralAmount = ethers.parseEther("100");
      const borrowShares = ethers.parseEther("200"); // large borrow

      // Market with totalBorrowAssets=1000, totalBorrowShares=1 (large per-share value)
      const market: {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      } = {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("1000"),
        totalBorrowShares: ethers.parseEther("1"),
        lastUpdate: 0n,
        fee: 0n,
      };
      await mockPool.setMarket(defaultMarketId, market);
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: borrowShares,
        collateral: collateralAmount,
      });

      const available = await facetHelper.availableFunds(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(available).to.equal(0n);
    });

    it("should return excess collateral when collateral > requiredCollateral", async () => {
      // oracle price = 1e36 (1:1), lltv = 0.8e18
      // collateral = 1000 ETH, borrow = 100 ETH worth
      // requiredCollateral = borrowedAssets * 1e36 / (price * lltv / 1e18)
      //   = 100e18 * 1e36 / (1e36 * 0.8) = 125e18
      // available = 1000e18 - 125e18 = 875e18
      const collateralAmount = ethers.parseEther("1000");
      const borrowShares = ethers.parseEther("100"); // 100 shares

      const market: {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      } = {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"), // 1:1 shares:assets
        lastUpdate: 0n,
        fee: 0n,
      };
      await mockPool.setMarket(defaultMarketId, market);
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: borrowShares,
        collateral: collateralAmount,
      });

      const available = await facetHelper.availableFunds(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      // VIRTUAL_SHARES=1e6 in SharesMathLib causes slight rounding:
      // borrowedAssets = mulDivUp(100e18, 100e18+1, 100e18+1e6) = 99999999999999000002
      // requiredCollateral = mulDivUp(borrowedAssets, 1e36, 8e35) = 124999999999998750003
      // available = 1000e18 - 124999999999998750003 = 875000000000001249997
      expect(available).to.equal(875000000000001249997n);
    });

    it("should revert when oracle address = address(0) and borrowShares > 0", async () => {
      const noOracleParams = { ...defaultMarketParams, oracle: ethers.ZeroAddress };
      const noOracleId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode([MARKET_PARAMS_TYPE], [noOracleParams])
      );
      await mockPool.setMarketParams(noOracleId, noOracleParams);
      await mockPool.setMarket(noOracleId, {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"),
        lastUpdate: 0n,
        fee: 0n,
      });
      await mockPool.setPosition(noOracleId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: ethers.parseEther("100"),
        collateral: ethers.parseEther("1000"),
      });
      await expect(
        facetHelper.availableFunds(await mockPool.getAddress(), wallet1.address, noOracleId)
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("should revert when price * lltv rounds to zero (lltv = 0)", async () => {
      const zeroLltvParams = { ...defaultMarketParams, lltv: 0n };
      const zeroLltvId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode([MARKET_PARAMS_TYPE], [zeroLltvParams])
      );
      await mockPool.setMarketParams(zeroLltvId, zeroLltvParams);
      await mockPool.setMarket(zeroLltvId, {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"),
        lastUpdate: 0n,
        fee: 0n,
      });
      await mockPool.setPosition(zeroLltvId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: ethers.parseEther("100"),
        collateral: ethers.parseEther("1000"),
      });
      await expect(
        facetHelper.availableFunds(await mockPool.getAddress(), wallet1.address, zeroLltvId)
      ).to.be.revertedWith("Price*LTV rounds to zero");
    });

    it("should revert when oracle price = 0", async () => {
      await mockOracle.setPrice(0);

      const market: {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      } = {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"),
        lastUpdate: 0n,
        fee: 0n,
      };
      await mockPool.setMarket(defaultMarketId, market);
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: ethers.parseEther("100"),
        collateral: ethers.parseEther("1000"),
      });

      await expect(
        facetHelper.availableFunds(
          await mockPool.getAddress(),
          wallet1.address,
          defaultMarketId
        )
      ).to.be.revertedWith("Invalid price");

      await mockOracle.setPrice(ethers.parseUnits("1", 36));
    });
  });

  // ==========================================================================
  // = availableBorrow ========================================================
  // ==========================================================================
  describe("availableBorrow", () => {
    it("should revert when oracle address = zero in market params", async () => {
      const badMpId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [MARKET_PARAMS_TYPE],
          [{ ...defaultMarketParams, oracle: ethers.ZeroAddress }]
        )
      );
      await mockPool.setMarketParams(badMpId, {
        ...defaultMarketParams,
        oracle: ethers.ZeroAddress,
      });

      await expect(
        facetHelper.availableBorrow(
          await mockPool.getAddress(),
          wallet1.address,
          badMpId
        )
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("should revert when oracle price = 0", async () => {
      await mockOracle.setPrice(0);

      await expect(
        facetHelper.availableBorrow(
          await mockPool.getAddress(),
          wallet1.address,
          defaultMarketId
        )
      ).to.be.revertedWith("Invalid price");

      await mockOracle.setPrice(ethers.parseUnits("1", 36));
    });

    it("should return 0 when collateral = 0", async () => {
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: 0n,
        collateral: 0n,
      });

      const result = await facetHelper.availableBorrow(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(result).to.equal(0n);
    });

    it("should return correct available borrow when collateral > 0", async () => {
      // price = 1e36, lltv = 0.8e18, collateral = 1000 ETH
      // available = 1000e18 * 1e36 / 1e36 * 0.8 = 800e18
      const collateralAmount = ethers.parseEther("1000");
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: 0n,
        collateral: collateralAmount,
      });

      const result = await facetHelper.availableBorrow(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      // 1000 * 1e36/1e36 * 0.8 = 800 ETH
      expect(result).to.equal(ethers.parseEther("800"));
    });

    it("should revert with InvalidMorphoPoolAddress when morphoPool = address(0)", async () => {
      await expect(
        facetHelper.availableBorrow(
          ethers.ZeroAddress,
          wallet1.address,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      await expect(
        facetHelper.availableBorrow(
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should revert with InvalidMarketId when marketId = bytes32(0)", async () => {
      await expect(
        facetHelper.availableBorrow(
          await mockPool.getAddress(),
          wallet1.address,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMarketId");
    });

    it("should return 0 when borrowedAssets exceed borrow capacity", async () => {
      // collateral=100 ETH, price=1e36, lltv=0.8 → borrowCapacity=80 ETH
      // borrowShares=90, totalBorrowAssets=100, totalBorrowShares=100
      // → borrowedAssets≈90 ETH > 80 ETH → return 0
      await mockPool.setMarket(defaultMarketId, {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"),
        lastUpdate: 0n,
        fee: 0n,
      });
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: ethers.parseEther("90"),
        collateral: ethers.parseEther("100"),
      });
      const result = await facetHelper.availableBorrow(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(result).to.equal(0n);
    });
  });

  // ==========================================================================
  // = currentBorrow ==========================================================
  // ==========================================================================
  describe("currentBorrow", () => {
    it("should revert with InvalidMorphoPoolAddress when morphoPool = address(0)", async () => {
      await expect(
        facetHelper.currentBorrow(
          ethers.ZeroAddress,
          wallet1.address,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InvalidUserAddress when user = address(0)", async () => {
      await expect(
        facetHelper.currentBorrow(
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          defaultMarketId
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidUserAddress");
    });

    it("should revert with InvalidMarketId when marketId = bytes32(0)", async () => {
      await expect(
        facetHelper.currentBorrow(
          await mockPool.getAddress(),
          wallet1.address,
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMarketId");
    });

    it("should return 0 when borrowShares = 0", async () => {
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: 0n,
        collateral: ethers.parseEther("100"),
      });
      const result = await facetHelper.currentBorrow(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(result).to.equal(0n);
    });

    it("should return correct borrowed assets", async () => {
      // borrowShares=50, totalBorrowAssets=100, totalBorrowShares=100
      // VIRTUAL_SHARES=1e6: mulDivUp(50e18, 100e18+1, 100e18+1e6) = 49999999999999500001
      await mockPool.setMarket(defaultMarketId, {
        totalSupplyAssets: ethers.parseEther("1000"),
        totalSupplyShares: ethers.parseEther("1000"),
        totalBorrowAssets: ethers.parseEther("100"),
        totalBorrowShares: ethers.parseEther("100"),
        lastUpdate: 0n,
        fee: 0n,
      });
      await mockPool.setPosition(defaultMarketId, wallet1.address, {
        supplyShares: 0n,
        borrowShares: ethers.parseEther("50"),
        collateral: 0n,
      });
      const result = await facetHelper.currentBorrow(
        await mockPool.getAddress(),
        wallet1.address,
        defaultMarketId
      );
      expect(result).to.equal(49999999999999500001n);
    });
  });

  // ==========================================================================
  // = generateCalldata =======================================================
  // ==========================================================================
  describe("generateCalldata", () => {
    const WITHDRAW_COLLATERAL_SELECTOR = ethers.dataSlice(
      ethers.id(
        "morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"
      ),
      0,
      4
    );
    const BORROW_SELECTOR = ethers.dataSlice(
      ethers.id(
        "morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)"
      ),
      0,
      4
    );

    it("should generate calldata for WITHDRAW_COLLATERAL_SELECTOR", async () => {
      const amount = ethers.parseEther("100");
      const marketIdData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );

      const calldata = await facetHelper.generateCalldata(
        WITHDRAW_COLLATERAL_SELECTOR,
        await mockPool.getAddress(),
        await collateralToken.getAddress(), // asset (unused)
        wallet1.address,
        amount,
        true,
        marketIdData
      );

      // Should encode: (morphoPool, marketParams, amount, user, payoutUser)
      const expectedCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", MARKET_PARAMS_TYPE, "uint256", "address", "bool"],
        [await mockPool.getAddress(), defaultMarketParams, amount, wallet1.address, true]
      );
      const expected = WITHDRAW_COLLATERAL_SELECTOR + expectedCalldata.slice(2);
      expect(calldata).to.equal(expected);
    });

    it("should generate calldata for BORROW_SELECTOR", async () => {
      const amount = ethers.parseEther("50");
      const marketIdData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );

      const calldata = await facetHelper.generateCalldata(
        BORROW_SELECTOR,
        await mockPool.getAddress(),
        await loanToken.getAddress(), // asset (unused)
        wallet1.address,
        amount,
        false,
        marketIdData
      );

      const expectedCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", MARKET_PARAMS_TYPE, "uint256", "address", "bool"],
        [await mockPool.getAddress(), defaultMarketParams, amount, wallet1.address, false]
      );
      const expected = BORROW_SELECTOR + expectedCalldata.slice(2);
      expect(calldata).to.equal(expected);
    });

    it("should revert with UnsupportedSelector for unknown selector", async () => {
      const marketIdData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.generateCalldata(
          "0x12345678",
          await mockPool.getAddress(),
          await loanToken.getAddress(),
          wallet1.address,
          ethers.parseEther("100"),
          true,
          marketIdData
        )
      ).to.be.revertedWithCustomError(facetHelper, "UnsupportedSelector");
    });
  });

  // ==========================================================================
  // = previewMorphoRefinanceIn ===============================================
  // ==========================================================================
  describe("previewMorphoRefinanceIn", () => {
    it("should revert with InvalidMorphoPoolAddress when pool not approved", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.previewMorphoRefinanceIn({
          user: wallet1.address,
          inputToken: await collateralToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: wallet2.address,
          additionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InputOutputTokenCollision when loan and collateral tokens are the same", async () => {
      const collisionMarketParams = {
        loanToken: await loanToken.getAddress(),
        collateralToken: await loanToken.getAddress(),
        oracle: await mockOracle.getAddress(),
        irm: ethers.ZeroAddress,
        lltv: ethers.parseEther("0.8"),
      };
      const collisionMarketId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [MARKET_PARAMS_TYPE],
          [collisionMarketParams]
        )
      );
      await mockPool.setMarketParams(collisionMarketId, collisionMarketParams);
      const collisionAdditionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [collisionMarketId]
      );
      await expect(
        facetHelper.previewMorphoRefinanceIn({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: collisionAdditionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });

    it("should return PreviewAction with collateral as input and loan as output", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      const inputAmount = ethers.parseEther("100");
      const outputAmount = ethers.parseEther("50");
      const result = await facetHelper.previewMorphoRefinanceIn({
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: inputAmount,
        outputToken: await loanToken.getAddress(),
        minOutputAmount: outputAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata,
      });
      expect(result.expectedInputToken).to.equal(await collateralToken.getAddress());
      expect(result.expectedOutputToken).to.equal(await loanToken.getAddress());
      expect(result.expectedInputAmount).to.equal(inputAmount);
      expect(result.expectedOutputAmount).to.equal(outputAmount);
      expect(result.isDeterministic).to.equal(true);
    });
  });

  // ==========================================================================
  // = previewMorphoRefinanceOut ==============================================
  // ==========================================================================
  describe("previewMorphoRefinanceOut", () => {
    it("should revert with InvalidMorphoPoolAddress when pool not approved", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.previewMorphoRefinanceOut({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await collateralToken.getAddress(),
          minOutputAmount: ethers.parseEther("100"),
          targetAddress: wallet2.address,
          additionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
    });

    it("should revert with InputOutputTokenCollision when loan and collateral tokens are the same", async () => {
      const collisionMarketParams = {
        loanToken: await loanToken.getAddress(),
        collateralToken: await loanToken.getAddress(),
        oracle: await mockOracle.getAddress(),
        irm: ethers.ZeroAddress,
        lltv: ethers.parseEther("0.8"),
      };
      const collisionMarketId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [MARKET_PARAMS_TYPE],
          [collisionMarketParams]
        )
      );
      await mockPool.setMarketParams(collisionMarketId, collisionMarketParams);
      const collisionAdditionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [collisionMarketId]
      );
      await expect(
        facetHelper.previewMorphoRefinanceOut({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("100"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata: collisionAdditionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });

    it("should return PreviewAction with loan as input and collateral as output", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      const inputAmount = ethers.parseEther("100");
      const outputAmount = ethers.parseEther("100");
      const result = await facetHelper.previewMorphoRefinanceOut({
        user: wallet1.address,
        inputToken: await loanToken.getAddress(),
        maxInputAmount: inputAmount,
        outputToken: await collateralToken.getAddress(),
        minOutputAmount: outputAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata,
      });
      expect(result.expectedInputToken).to.equal(await loanToken.getAddress());
      expect(result.expectedOutputToken).to.equal(await collateralToken.getAddress());
      expect(result.expectedInputAmount).to.equal(inputAmount);
      expect(result.expectedOutputAmount).to.equal(outputAmount);
      expect(result.isDeterministic).to.equal(true);
    });
  });

  // ==========================================================================
  // = generateActionCalldata (TermFlashHookFacet) ============================
  // ==========================================================================
  describe("generateActionCalldata", () => {
    it("should revert with UnsupportedHookSelector for unknown selector", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.generateActionCalldata(
          wallet1.address,
          await collateralToken.getAddress(),
          ethers.parseEther("100"),
          await loanToken.getAddress(),
          ethers.parseEther("50"),
          "0x12345678",
          await mockPool.getAddress(),
          additionalCalldata
        )
      ).to.be.revertedWithCustomError(facetHelper, "UnsupportedHookSelector");
    });

    it("should return preview and calldata for morphoRefinanceInHook selector", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      const inSelector = facetHelper.interface.getFunction("morphoRefinanceInHook").selector;
      const inputAmount = ethers.parseEther("100");
      const outputAmount = ethers.parseEther("50");
      const [previewAction, encodedCalldata] = await facetHelper.generateActionCalldata(
        wallet1.address,
        await collateralToken.getAddress(),
        inputAmount,
        await loanToken.getAddress(),
        outputAmount,
        inSelector,
        await mockPool.getAddress(),
        additionalCalldata
      );
      expect(previewAction.isDeterministic).to.equal(true);
      expect(previewAction.expectedInputToken).to.equal(await collateralToken.getAddress());
      expect(previewAction.expectedOutputToken).to.equal(await loanToken.getAddress());
      expect(encodedCalldata.slice(0, 10)).to.equal(inSelector);
    });

    it("should return preview and calldata for morphoRefinanceOutHook selector", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      const outSelector = facetHelper.interface.getFunction("morphoRefinanceOutHook").selector;
      const inputAmount = ethers.parseEther("100");
      const outputAmount = ethers.parseEther("100");
      const [previewAction, encodedCalldata] = await facetHelper.generateActionCalldata(
        wallet1.address,
        await loanToken.getAddress(),
        inputAmount,
        await collateralToken.getAddress(),
        outputAmount,
        outSelector,
        await mockPool.getAddress(),
        additionalCalldata
      );
      expect(previewAction.isDeterministic).to.equal(true);
      expect(previewAction.expectedInputToken).to.equal(await loanToken.getAddress());
      expect(previewAction.expectedOutputToken).to.equal(await collateralToken.getAddress());
      expect(encodedCalldata.slice(0, 10)).to.equal(outSelector);
    });

    it("should propagate InputOutputTokenCollision from morphoRefinanceInHook selector", async () => {
      const collisionMarketParams = {
        loanToken: await loanToken.getAddress(),
        collateralToken: await loanToken.getAddress(),
        oracle: await mockOracle.getAddress(),
        irm: ethers.ZeroAddress,
        lltv: ethers.parseEther("0.8"),
      };
      const collisionMarketId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [MARKET_PARAMS_TYPE],
          [collisionMarketParams]
        )
      );
      await mockPool.setMarketParams(collisionMarketId, collisionMarketParams);
      const collisionAdditionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [collisionMarketId]
      );
      const inSelector = facetHelper.interface.getFunction("morphoRefinanceInHook").selector;
      await expect(
        facetHelper.generateActionCalldata(
          wallet1.address,
          await loanToken.getAddress(),
          ethers.parseEther("100"),
          await loanToken.getAddress(),
          ethers.parseEther("50"),
          inSelector,
          await mockPool.getAddress(),
          collisionAdditionalCalldata
        )
      ).to.be.revertedWithCustomError(facetHelper, "InputOutputTokenCollision");
    });
  });

  // ==========================================================================
  // = morphoRefinanceInHook ==================================================
  // ==========================================================================
  describe("morphoRefinanceInHook", () => {
    it("should revert with Unauthorized caller when no flash loan context is active", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceInHook({
          user: wallet1.address,
          inputToken: await collateralToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should revert with Unauthorized caller when flash loan borrower does not match user", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet2.address);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceInHook({
          user: wallet1.address,
          inputToken: await collateralToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");
      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should revert with InvalidMorphoPoolAddress when pool not approved", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceInHook({
          user: wallet1.address,
          inputToken: await collateralToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await loanToken.getAddress(),
          minOutputAmount: ethers.parseEther("50"),
          targetAddress: wallet2.address,
          additionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should succeed when flash loan context is set and pool is approved", async () => {
      const collateralAmount = ethers.parseEther("100");
      const borrowAmount = ethers.parseEther("50");
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);
      // Transfer collateral to facetHelper so it can supply
      await collateralToken
        .connect(wallet1)
        .transfer(await facetHelper.getAddress(), collateralAmount);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await facetHelper.morphoRefinanceInHook({
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: collateralAmount,
        outputToken: await loanToken.getAddress(),
        minOutputAmount: borrowAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata,
      });
      await facetHelper.clearActiveFlashLoanBorrower();
    });
  });

  // ==========================================================================
  // = morphoRefinanceOutHook =================================================
  // ==========================================================================
  describe("morphoRefinanceOutHook", () => {
    it("should revert with Unauthorized caller when no flash loan context is active", async () => {
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceOutHook({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await collateralToken.getAddress(),
          minOutputAmount: ethers.parseEther("100"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should revert with Unauthorized caller when flash loan borrower does not match user", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet2.address);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceOutHook({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await collateralToken.getAddress(),
          minOutputAmount: ethers.parseEther("100"),
          targetAddress: await mockPool.getAddress(),
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");
      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should revert with InvalidMorphoPoolAddress when pool not approved", async () => {
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await expect(
        facetHelper.morphoRefinanceOutHook({
          user: wallet1.address,
          inputToken: await loanToken.getAddress(),
          maxInputAmount: ethers.parseEther("100"),
          outputToken: await collateralToken.getAddress(),
          minOutputAmount: ethers.parseEther("100"),
          targetAddress: wallet2.address,
          additionalCalldata,
        })
      ).to.be.revertedWithCustomError(facetHelper, "InvalidMorphoPoolAddress");
      await facetHelper.clearActiveFlashLoanBorrower();
    });

    it("should succeed when flash loan context is set and pool is approved", async () => {
      const repayAmount = ethers.parseEther("100");
      const collateralAmount = ethers.parseEther("100");
      await facetHelper.setActiveFlashLoanBorrower(wallet1.address);
      // Transfer loan tokens to facetHelper so it can repay
      await loanToken
        .connect(wallet1)
        .transfer(await facetHelper.getAddress(), repayAmount);
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [defaultMarketId]
      );
      await facetHelper.morphoRefinanceOutHook({
        user: wallet1.address,
        inputToken: await loanToken.getAddress(),
        maxInputAmount: repayAmount,
        outputToken: await collateralToken.getAddress(),
        minOutputAmount: collateralAmount,
        targetAddress: await mockPool.getAddress(),
        additionalCalldata,
      });
      await facetHelper.clearActiveFlashLoanBorrower();
    });
  });
});
