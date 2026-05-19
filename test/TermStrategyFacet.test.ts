/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestToken,
} from "../typechain-types";

describe("TermStrategyFacet Tests", () => {
  let termStrategyFacet: any;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let repoToken: TestToken;
  let asset: TestToken;
  let mockStrategy: any;
  let mockController: any;

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy mock controller
    const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
    mockController = await MockControllerFactory.deploy();
    await mockController.waitForDeployment();

    // Deploy TermStrategyFacet via test helper (for storage manipulation)
    const TermStrategyFacetFactory =
      await ethers.getContractFactory("TestTermStrategyFacetHelper");
    termStrategyFacet = await TermStrategyFacetFactory.deploy();
    await termStrategyFacet.waitForDeployment();

    // Add mock controller to approved list in diamond storage
    await termStrategyFacet.addApprovedTermController(await mockController.getAddress());

    // Deploy real test tokens
    const TestTokenFactory = await ethers.getContractFactory("TestToken");

    repoToken = (await upgrades.deployProxy(
      TestTokenFactory,
      ["Repo Token", "REPO", 18, [wallet1.address], [ethers.parseEther("1000")]],
    )) as unknown as TestToken;
    await repoToken.waitForDeployment();

    asset = (await upgrades.deployProxy(
      TestTokenFactory,
      ["Asset Token", "ASSET", 18, [wallet2.address], [ethers.parseEther("1000")]],
    )) as unknown as TestToken;
    await asset.waitForDeployment();

    // Deploy a simple strategy mock that will transfer assets
    const MockStrategyFactory = await ethers.getContractFactory("TestMockStrategy");
    mockStrategy = await MockStrategyFactory.deploy(
      await asset.getAddress(),
      await mockController.getAddress(),
    );
    await mockStrategy.waitForDeployment();

    // Register strategy as a deployed term in the controller
    await mockController.setTermDeployed(await mockStrategy.getAddress(), true);
  });

  describe("sellRepoToken", () => {
    it("should successfully sell repo tokens through strategy", async () => {
      const repoTokenAmount = ethers.parseEther("100");
      const expectedProceeds = ethers.parseEther("95"); // 95% exchange rate

      // Give strategy some assets to work with
      await asset.connect(wallet2).transfer(await mockStrategy.getAddress(), ethers.parseEther("200"));

      // Approve facet to spend repo tokens
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      // Execute
      const tx = await termStrategyFacet.connect(wallet1).sellRepoToken(
        await mockStrategy.getAddress(),
        await repoToken.getAddress(),
        repoTokenAmount,
      );

      await expect(tx).to.not.be.reverted;

      // Verify proceeds were received
      const assetBalance = await asset.balanceOf(wallet1.address);
      expect(assetBalance).to.equal(expectedProceeds);
    });

    it("should revert if no proceeds received", async () => {
      const repoTokenAmount = ethers.parseEther("100");

      // Set exchange rate to 0 so no proceeds are returned
      await mockStrategy.setExchangeRate(0);

      // Approve facet to spend repo tokens
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      // Execute - should revert
      await expect(
        termStrategyFacet.connect(wallet1).sellRepoToken(
          await mockStrategy.getAddress(),
          await repoToken.getAddress(),
          repoTokenAmount,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "NoProceedsReceived");
    });

    it("should revert if balance decreases (theft)", async () => {
      const repoTokenAmount = ethers.parseEther("100");

      // Deploy a malicious strategy that steals assets
      const MaliciousStrategyFactory = await ethers.getContractFactory("TestMaliciousStrategy");
      const maliciousStrategy = await MaliciousStrategyFactory.deploy(
        await asset.getAddress(),
        await termStrategyFacet.getAddress(),
        await mockController.getAddress(),
      );
      await maliciousStrategy.waitForDeployment();

      // Register malicious strategy as deployed term
      await mockController.setTermDeployed(await maliciousStrategy.getAddress(), true);

      // Give the facet some initial assets
      await asset.connect(wallet2).transfer(await termStrategyFacet.getAddress(), ethers.parseEther("50"));

      // Approve facet to spend repo tokens
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      // Execute - should revert because malicious strategy steals assets
      await expect(
        termStrategyFacet.connect(wallet1).sellRepoToken(
          await maliciousStrategy.getAddress(),
          await repoToken.getAddress(),
          repoTokenAmount,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "NoProceedsReceived");
    });

    it("should handle reentrancy protection", async () => {
      const repoTokenAmount = ethers.parseEther("100");

      // Give strategy some assets
      await asset.connect(wallet2).transfer(await mockStrategy.getAddress(), ethers.parseEther("200"));

      // Approve facet to spend repo tokens
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      // First call should work
      const tx1 = await termStrategyFacet.connect(wallet1).sellRepoToken(
        await mockStrategy.getAddress(),
        await repoToken.getAddress(),
        repoTokenAmount,
      );

      await expect(tx1).to.not.be.reverted;

      // Second call should also work (not blocked by reentrancy guard)
      await repoToken.connect(wallet1).mint(wallet1.address, repoTokenAmount);
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      const tx2 = await termStrategyFacet.connect(wallet1).sellRepoToken(
        await mockStrategy.getAddress(),
        await repoToken.getAddress(),
        repoTokenAmount,
      );

      await expect(tx2).to.not.be.reverted;
    });

    it("should revert InvalidTermController when strategy controller is not approved", async () => {
      const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
      const unapprovedController = await MockControllerFactory.deploy();
      await unapprovedController.waitForDeployment();

      const MockStrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      const strategyWithUnapprovedController = await MockStrategyFullFactory.deploy(
        await asset.getAddress(),
        await unapprovedController.getAddress(),
        ethers.ZeroAddress,
      );
      await strategyWithUnapprovedController.waitForDeployment();

      const repoTokenAmount = ethers.parseEther("100");
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      await expect(
        termStrategyFacet.connect(wallet1).sellRepoToken(
          await strategyWithUnapprovedController.getAddress(),
          await repoToken.getAddress(),
          repoTokenAmount,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidTermController");
    });

    it("should revert InvalidStrategy when strategy is not deployed by controller", async () => {
      const MockStrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      const unregisteredStrategy = await MockStrategyFullFactory.deploy(
        await asset.getAddress(),
        await mockController.getAddress(), // approved controller
        ethers.ZeroAddress,
      );
      await unregisteredStrategy.waitForDeployment();
      // NOT calling mockController.setTermDeployed

      const repoTokenAmount = ethers.parseEther("100");
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      await expect(
        termStrategyFacet.connect(wallet1).sellRepoToken(
          await unregisteredStrategy.getAddress(),
          await repoToken.getAddress(),
          repoTokenAmount,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidStrategy");
    });

    it("should revert RepoTokensNotFullyConsumed when strategy only partially consumes tokens", async () => {
      const MockStrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      const partialStrategy = await MockStrategyFullFactory.deploy(
        await asset.getAddress(),
        await mockController.getAddress(),
        ethers.ZeroAddress,
      );
      await partialStrategy.waitForDeployment();
      await mockController.setTermDeployed(await partialStrategy.getAddress(), true);
      await partialStrategy.setPartialConsume(true);

      // Give strategy some assets for the partial proceeds it will pay
      await asset.connect(wallet2).transfer(await partialStrategy.getAddress(), ethers.parseEther("100"));

      const repoTokenAmount = ethers.parseEther("100");
      await repoToken.connect(wallet1).approve(await termStrategyFacet.getAddress(), repoTokenAmount);

      await expect(
        termStrategyFacet.connect(wallet1).sellRepoToken(
          await partialStrategy.getAddress(),
          await repoToken.getAddress(),
          repoTokenAmount,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "RepoTokensNotFullyConsumed");
    });
  });

  describe("mintAndSellRepoToken", () => {
    let mockController2: any;
    let mockServicerController: any;
    let mockDiscountRateAdapter: any;
    let mockRepoToken: any;
    let mockCollateralManager: any;
    let mockServicer: any;
    let mockStrategyFull: any;
    let collateralToken: TestToken;

    const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    beforeEach(async () => {
      const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
      mockController2 = await MockControllerFactory.deploy();
      await mockController2.waitForDeployment();

      mockServicerController = await MockControllerFactory.deploy();
      await mockServicerController.waitForDeployment();

      const AdapterFactory = await ethers.getContractFactory("TestMockDiscountRateAdapter");
      mockDiscountRateAdapter = await AdapterFactory.deploy();
      await mockDiscountRateAdapter.waitForDeployment();

      // Repo token minted by the servicer; redemptionValue = 1e18
      const RepoTokenFactory = await ethers.getContractFactory("TestMockRepoTokenFull");
      mockRepoToken = await RepoTokenFactory.deploy(
        "Mock Repo",
        "MREPO",
        ethers.parseEther("1"),
      );
      await mockRepoToken.waitForDeployment();

      // Collateral token given to wallet1
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      collateralToken = (await upgrades.deployProxy(
        TestTokenFactory,
        ["Collateral Token", "COL", 18, [wallet1.address], [ethers.parseEther("100")]],
      )) as unknown as TestToken;
      await collateralToken.waitForDeployment();

      const CollateralManagerFactory = await ethers.getContractFactory("TestMockCollateralManager");
      mockCollateralManager = await CollateralManagerFactory.deploy();
      await mockCollateralManager.waitForDeployment();
      await mockCollateralManager.setCollateralTokens([await collateralToken.getAddress()]);

      const ServicerFactory = await ethers.getContractFactory("TestMockRepoServicerFull");
      mockServicer = await ServicerFactory.deploy();
      await mockServicer.waitForDeployment();

      const latestBlock = await ethers.provider.getBlock("latest");
      const futureMaturity = latestBlock!.timestamp + 365 * 24 * 3600;
      const futureRedemption = latestBlock!.timestamp + 360 * 24 * 3600 + 100;

      await mockServicer.setPurchaseToken(await asset.getAddress());
      await mockServicer.setTermController(await mockServicerController.getAddress());
      await mockServicer.setCollateralManager(await mockCollateralManager.getAddress());
      await mockServicer.setTermRepoLocker(wallet2.address); // dummy locker address
      await mockServicer.setTermRepoToken(await mockRepoToken.getAddress());
      await mockServicer.setMaturityTimestamp(futureMaturity);
      await mockServicer.setRedemptionTimestamp(futureRedemption);
      await mockServicer.setServicingFee(0);

      const StrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      mockStrategyFull = await StrategyFullFactory.deploy(
        await asset.getAddress(),
        await mockController2.getAddress(),
        await mockDiscountRateAdapter.getAddress(),
      );
      await mockStrategyFull.waitForDeployment();

      // Register contracts as deployed in their respective controllers
      await mockController2.setTermDeployed(await mockStrategyFull.getAddress(), true);
      await mockServicerController.setTermDeployed(await mockServicer.getAddress(), true);

      // Add controllers to approved list
      await termStrategyFacet.addApprovedTermController(await mockController2.getAddress());
      await termStrategyFacet.addApprovedTermController(await mockServicerController.getAddress());

      // Discount rate: 50% (5e17), haircut: 0
      await mockDiscountRateAdapter.setDiscountRate(
        await mockRepoToken.getAddress(),
        ethers.parseEther("0.5"),
      );

      // Give strategy ample assets to pay proceeds
      await asset.connect(wallet2).transfer(
        await mockStrategyFull.getAddress(),
        ethers.parseEther("500"),
      );
    });

    it("should revert InvalidTermController when strategy controller is not approved", async () => {
      const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
      const unapprovedCtrl = await MockControllerFactory.deploy();
      await unapprovedCtrl.waitForDeployment();

      const StrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      const badStrategy = await StrategyFullFactory.deploy(
        await asset.getAddress(),
        await unapprovedCtrl.getAddress(),
        await mockDiscountRateAdapter.getAddress(),
      );
      await badStrategy.waitForDeployment();

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await badStrategy.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidTermController");
    });

    it("should revert InvalidStrategy when strategy is not deployed by controller", async () => {
      const StrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
      const unregisteredStrategy = await StrategyFullFactory.deploy(
        await asset.getAddress(),
        await mockController2.getAddress(), // approved controller
        await mockDiscountRateAdapter.getAddress(),
      );
      await unregisteredStrategy.waitForDeployment();
      // NOT registering with mockController2

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await unregisteredStrategy.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidStrategy");
    });

    it("should revert InvalidTermController when servicer controller is not approved", async () => {
      const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
      const unapprovedCtrl = await MockControllerFactory.deploy();
      await unapprovedCtrl.waitForDeployment();

      const ServicerFactory = await ethers.getContractFactory("TestMockRepoServicerFull");
      const badServicer = await ServicerFactory.deploy();
      await badServicer.waitForDeployment();
      await badServicer.setTermController(await unapprovedCtrl.getAddress());

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await badServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidTermController");
    });

    it("should revert InvalidRepoId when servicer is not deployed by its controller", async () => {
      const ServicerFactory = await ethers.getContractFactory("TestMockRepoServicerFull");
      const unregisteredServicer = await ServicerFactory.deploy();
      await unregisteredServicer.waitForDeployment();
      // Controller is approved but servicer NOT registered
      await unregisteredServicer.setTermController(await mockServicerController.getAddress());

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await unregisteredServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "InvalidRepoId");
    });

    it("should revert AfterMaturity when maturity timestamp is in the past", async () => {
      await mockServicer.setMaturityTimestamp(1); // far in the past

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "AfterMaturity");
    });

    it("should revert PurchaseTokenMismatch when servicer purchaseToken does not match strategy asset", async () => {
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const wrongToken = (await upgrades.deployProxy(
        TestTokenFactory,
        ["Wrong Token", "WRONG", 18, [], []],
      )) as unknown as TestToken;
      await wrongToken.waitForDeployment();

      await mockServicer.setPurchaseToken(await wrongToken.getAddress());

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "PurchaseTokenMismatch");
    });

    it("should revert RepoRedemptionHaircutNotSupported when haircut is non-zero", async () => {
      await mockDiscountRateAdapter.setHaircut(
        await mockRepoToken.getAddress(),
        ethers.parseEther("0.1"), // 10% haircut
      );

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "RepoRedemptionHaircutNotSupported");
    });

    it("should revert NoProceedsReceived when strategy pays zero proceeds", async () => {
      await mockStrategyFull.setExchangeRate(0); // strategy takes tokens but pays nothing

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "NoProceedsReceived");
    });

    it("should revert NotEnoughProceedsReceived when proceeds are less than borrowAmount", async () => {
      // 50% exchange rate: strategy returns 50% of repo token value as asset proceeds.
      // With discountRate=50%, repurchaseFactor≈1.5, borrowAmount=100e18:
      //   minAmountOfRepoTokensToSell ≈ 150e18
      //   proceeds = 150e18 * 0.5 = 75e18 < 100e18 = borrowAmount
      await mockStrategyFull.setExchangeRate(ethers.parseEther("0.5"));

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("100"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "NotEnoughProceedsReceived");
    });

    it("should revert RepoTokensNotFullyConsumed when strategy only partially consumes minted repo tokens", async () => {
      await mockStrategyFull.setPartialConsume(true);

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          ethers.parseEther("1"),
          [],
          false,
        ),
      ).to.be.revertedWithCustomError(termStrategyFacet, "RepoTokensNotFullyConsumed");
    });

    it("should apply rounding adjustment when estimated proceeds are less than borrowAmount", async () => {
      // Setup: borrowAmount=3 wei, discountRate=50%, redemptionTimestamp ≈ block.timestamp + 360 days
      // Math: repurchaseFactor≈1.5, minTokens=floor(3*1.5/1)=4,
      //       estimatedProceeds=floor(4/1.5)=2 < 3 → minTokens becomes 5
      const latestBlock = await ethers.provider.getBlock("latest");
      const redemptionTs = latestBlock!.timestamp + 360 * 24 * 3600 + 10;
      await mockServicer.setRedemptionTimestamp(redemptionTs);
      await mockServicer.setMaturityTimestamp(redemptionTs + 1000);

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          3n, // borrowAmount = 3 wei
          [],
          false,
        ),
      ).to.not.be.reverted;
    });

    it("should successfully mint and sell with usePermit2=false and transfer proceeds to borrower", async () => {
      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");

      // Borrower approves facet to spend collateral
      await collateralToken.connect(wallet1).approve(
        await termStrategyFacet.getAddress(),
        collateralAmount,
      );

      const wallet1AssetBefore = await asset.balanceOf(wallet1.address);

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          borrowAmount,
          [collateralAmount],
          false,
        ),
      ).to.not.be.reverted;

      const wallet1AssetAfter = await asset.balanceOf(wallet1.address);
      expect(wallet1AssetAfter).to.be.gt(wallet1AssetBefore);
      expect(wallet1AssetAfter - wallet1AssetBefore).to.be.gte(borrowAmount);
    });

    it("should successfully mint and sell using Permit2 for collateral transfer (usePermit2=true)", async () => {
      // Plant TestMockPermit2 bytecode at the canonical Permit2 address
      const MockPermit2Factory = await ethers.getContractFactory("TestMockPermit2");
      const tempMockPermit2 = await MockPermit2Factory.deploy();
      await tempMockPermit2.waitForDeployment();

      const runtimeCode = await ethers.provider.getCode(await tempMockPermit2.getAddress());
      await ethers.provider.send("hardhat_setCode", [PERMIT2_ADDRESS, runtimeCode]);

      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("100");

      // Borrower approves canonical Permit2 to spend collateral
      await collateralToken.connect(wallet1).approve(PERMIT2_ADDRESS, collateralAmount);

      await expect(
        termStrategyFacet.connect(wallet1).mintAndSellRepoToken(
          await mockStrategyFull.getAddress(),
          await mockServicer.getAddress(),
          borrowAmount,
          [collateralAmount],
          true, // usePermit2
        ),
      ).to.not.be.reverted;
    });

    it("should not transfer proceeds to borrower when payoutToUser=false", async () => {
      const borrowAmount = ethers.parseEther("100");

      const wallet1AssetBefore = await asset.balanceOf(wallet1.address);
      const facetAssetBefore = await asset.balanceOf(await termStrategyFacet.getAddress());

      // Call the internal function directly with payoutToUser=false
      await termStrategyFacet.connect(wallet1).mintAndSellRepoTokenInternalExposed(
        await mockStrategyFull.getAddress(),
        await mockServicer.getAddress(),
        wallet1.address, // borrower
        borrowAmount,
        [],
        false, // payoutToUser = false
      );

      const wallet1AssetAfter = await asset.balanceOf(wallet1.address);
      const facetAssetAfter = await asset.balanceOf(await termStrategyFacet.getAddress());

      // Borrower should NOT have received proceeds
      expect(wallet1AssetAfter).to.equal(wallet1AssetBefore);
      // Facet should hold the proceeds
      expect(facetAssetAfter).to.be.gt(facetAssetBefore);
    });

    describe("previewMintAndSellRepoToken", () => {
      it("should revert PurchaseTokenMismatch when strategy asset does not match servicer purchaseToken", async () => {
        // Deploy a strategy whose asset is collateralToken (not asset/purchaseToken)
        const StrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
        const mismatchedStrategy = await StrategyFullFactory.deploy(
          await collateralToken.getAddress(), // asset = collateralToken ≠ servicer's purchaseToken
          await mockController2.getAddress(),
          await mockDiscountRateAdapter.getAddress(),
        );
        await mismatchedStrategy.waitForDeployment();
        await mockController2.setTermDeployed(await mismatchedStrategy.getAddress(), true);

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mismatchedStrategy.getAddress()],
        );

        await expect(
          termStrategyFacet.previewMintAndSellRepoToken({
            user: wallet1.address,
            inputToken: await collateralToken.getAddress(),
            maxInputAmount: ethers.parseEther("1"),
            outputToken: await asset.getAddress(),
            minOutputAmount: ethers.parseEther("100"),
            targetAddress: await mockServicer.getAddress(),
            additionalCalldata,
          }),
        ).to.be.revertedWithCustomError(termStrategyFacet, "PurchaseTokenMismatch");
      });

      it("should return correct PreviewAction when tokens match", async () => {
        const collateralAmount = ethers.parseEther("1");
        const borrowAmount = ethers.parseEther("100");

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        const previewAction = await termStrategyFacet.previewMintAndSellRepoToken({
          user: wallet1.address,
          inputToken: await collateralToken.getAddress(),
          maxInputAmount: collateralAmount,
          outputToken: await asset.getAddress(),
          minOutputAmount: borrowAmount,
          targetAddress: await mockServicer.getAddress(),
          additionalCalldata,
        });

        expect(previewAction.expectedInputToken).to.equal(await collateralToken.getAddress());
        expect(previewAction.expectedOutputToken).to.equal(await asset.getAddress());
        expect(previewAction.expectedInputAmount).to.equal(collateralAmount);
        expect(previewAction.expectedOutputAmount).to.equal(borrowAmount);
        expect(previewAction.isDeterministic).to.equal(true);
      });
    });

    describe("generateActionCalldata", () => {
      it("should revert UnsupportedHookSelector for unknown selector", async () => {
        await expect(
          termStrategyFacet.generateActionCalldata(
            wallet1.address,
            await collateralToken.getAddress(),
            ethers.parseEther("1"),
            await asset.getAddress(),
            ethers.parseEther("100"),
            "0x12345678",
            await mockServicer.getAddress(),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await mockStrategyFull.getAddress()]),
          ),
        ).to.be.revertedWithCustomError(termStrategyFacet, "UnsupportedHookSelector");
      });

      it("should return valid previewAction and encodedCalldata for mintAndSellRepoTokenHook selector", async () => {
        const hookSelector = termStrategyFacet.interface.getFunction("mintAndSellRepoTokenHook").selector;
        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        const [previewAction, encodedCalldata] = await termStrategyFacet.generateActionCalldata(
          wallet1.address,
          await collateralToken.getAddress(),
          ethers.parseEther("1"),
          await asset.getAddress(),
          ethers.parseEther("100"),
          hookSelector,
          await mockServicer.getAddress(),
          additionalCalldata,
        );

        expect(previewAction.isDeterministic).to.equal(true);
        expect(previewAction.expectedOutputToken).to.equal(await asset.getAddress());
        expect(encodedCalldata.slice(0, 10)).to.equal(hookSelector);
      });

      it("should propagate PurchaseTokenMismatch from preview when strategy asset mismatches", async () => {
        const hookSelector = termStrategyFacet.interface.getFunction("mintAndSellRepoTokenHook").selector;

        const StrategyFullFactory = await ethers.getContractFactory("TestMockStrategyFull");
        const mismatchedStrategy = await StrategyFullFactory.deploy(
          await collateralToken.getAddress(),
          await mockController2.getAddress(),
          await mockDiscountRateAdapter.getAddress(),
        );
        await mismatchedStrategy.waitForDeployment();
        await mockController2.setTermDeployed(await mismatchedStrategy.getAddress(), true);

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mismatchedStrategy.getAddress()],
        );

        await expect(
          termStrategyFacet.generateActionCalldata(
            wallet1.address,
            await collateralToken.getAddress(),
            ethers.parseEther("1"),
            await asset.getAddress(),
            ethers.parseEther("100"),
            hookSelector,
            await mockServicer.getAddress(),
            additionalCalldata,
          ),
        ).to.be.reverted;
      });
    });

    describe("mintAndSellRepoTokenHook", () => {
      it("should revert Unauthorized caller when no flash loan context is active", async () => {
        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        await expect(
          termStrategyFacet.connect(wallet1).mintAndSellRepoTokenHook({
            user: wallet1.address,
            inputToken: await collateralToken.getAddress(),
            maxInputAmount: ethers.parseEther("1"),
            outputToken: await asset.getAddress(),
            minOutputAmount: ethers.parseEther("100"),
            targetAddress: await mockServicer.getAddress(),
            additionalCalldata,
          }),
        ).to.be.revertedWith("Unauthorized caller");
      });

      it("should revert Unauthorized caller when flash loan borrower does not match input user", async () => {
        await termStrategyFacet.setActiveFlashLoanBorrower(wallet2.address);

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        await expect(
          termStrategyFacet.connect(wallet1).mintAndSellRepoTokenHook({
            user: wallet1.address, // wallet1 is user but borrower is wallet2
            inputToken: await collateralToken.getAddress(),
            maxInputAmount: ethers.parseEther("1"),
            outputToken: await asset.getAddress(),
            minOutputAmount: ethers.parseEther("100"),
            targetAddress: await mockServicer.getAddress(),
            additionalCalldata,
          }),
        ).to.be.revertedWith("Unauthorized caller");

        await termStrategyFacet.clearActiveFlashLoanBorrower();
      });

      it("should revert PurchaseTokenMismatch when outputToken does not match servicer purchaseToken", async () => {
        await termStrategyFacet.setActiveFlashLoanBorrower(wallet1.address);

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        await expect(
          termStrategyFacet.connect(wallet1).mintAndSellRepoTokenHook({
            user: wallet1.address,
            inputToken: await collateralToken.getAddress(),
            maxInputAmount: ethers.parseEther("1"),
            outputToken: await collateralToken.getAddress(), // wrong: not purchaseToken/asset
            minOutputAmount: ethers.parseEther("100"),
            targetAddress: await mockServicer.getAddress(),
            additionalCalldata,
          }),
        ).to.be.revertedWithCustomError(termStrategyFacet, "PurchaseTokenMismatch");

        await termStrategyFacet.clearActiveFlashLoanBorrower();
      });

      it("should successfully execute hook when flash loan context is valid and collateral is pre-funded", async () => {
        const collateralAmount = ethers.parseEther("1");
        const borrowAmount = ethers.parseEther("100");

        // Set flash loan context to wallet1
        await termStrategyFacet.setActiveFlashLoanBorrower(wallet1.address);

        // Pre-fund the facet with collateral (hook does NOT pull collateral from user)
        await collateralToken.connect(wallet1).transfer(
          await termStrategyFacet.getAddress(),
          collateralAmount,
        );

        const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [await mockStrategyFull.getAddress()],
        );

        await expect(
          termStrategyFacet.connect(wallet1).mintAndSellRepoTokenHook({
            user: wallet1.address,
            inputToken: await collateralToken.getAddress(),
            maxInputAmount: collateralAmount,
            outputToken: await asset.getAddress(),
            minOutputAmount: borrowAmount,
            targetAddress: await mockServicer.getAddress(),
            additionalCalldata,
          }),
        ).to.not.be.reverted;

        await termStrategyFacet.clearActiveFlashLoanBorrower();
      });
    });
  });
});
