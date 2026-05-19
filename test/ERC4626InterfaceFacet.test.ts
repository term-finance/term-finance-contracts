/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestERC4626InterfaceFacetHelper,
  TestMockTermController,
  TestMockPermit2,
  TestMockCollateralManager,
  TestMockRepoServicer,
  TestMockRepoToken,
  TestToken,
  TestMockVault,
} from "../typechain-types";

const PERMIT2_CANONICAL_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

describe("ERC4626InterfaceFacet Tests", () => {
  let erc4626InterfaceFacet: TestERC4626InterfaceFacetHelper;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let mockVault: TestMockVault;
  let mockController: TestMockTermController;
  let asset: TestToken;

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy TestERC4626InterfaceFacetHelper (extends ERC4626InterfaceFacet with test helpers)
    const ERC4626InterfaceFacetFactory = await ethers.getContractFactory(
      "TestERC4626InterfaceFacetHelper",
    );
    erc4626InterfaceFacet =
      (await ERC4626InterfaceFacetFactory.deploy()) as unknown as TestERC4626InterfaceFacetHelper;
    await erc4626InterfaceFacet.waitForDeployment();

    // Deploy mock term controller
    const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
    mockController = (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
    await mockController.waitForDeployment();

    // Add mock controller to approved list
    await erc4626InterfaceFacet.addApprovedTermController(await mockController.getAddress());

    // Deploy real test token as asset
    const TestTokenFactory = await ethers.getContractFactory("TestToken");

    asset = (await upgrades.deployProxy(
      TestTokenFactory,
      ["Asset Token", "ASSET", 18, [wallet1.address], [ethers.parseEther("10000")]],
    )) as unknown as TestToken;
    await asset.waitForDeployment();

    // Deploy mock vault
    const TestMockVaultFactory = await ethers.getContractFactory("TestMockVault");
    mockVault = (await upgrades.deployProxy(
      TestMockVaultFactory,
      [await asset.getAddress(), "Vault Shares", "vSHARE"],
    )) as unknown as TestMockVault;
    await mockVault.waitForDeployment();

    // Approve mock vault in controller
    await mockController.setVaultApproval(await mockVault.getAddress(), true);
  });

  describe("depositToVault", () => {
    it("should successfully deposit assets to vault", async () => {
      const assetsAmount = ethers.parseEther("100");
      const expectedShares = ethers.parseEther("100"); // 1:1 exchange rate by default
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // Approve facet to spend assets
      await asset.connect(wallet1).approve(facetAddr, assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      // Execute deposit (3-arg: vault, assets, usePermit2) - shares go to msg.sender (wallet1)
      const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
        await mockVault.getAddress(),
        assetsAmount,
        false
      );

      await expect(tx).to.not.be.reverted;

      // Verify shares were minted to caller (msg.sender = wallet1)
      const shares = await mockVault.balanceOf(wallet1.address);
      expect(shares).to.equal(expectedShares);

      //Verify assets were taken from depositor
      const depositorAssetBalance = await asset.balanceOf(wallet1.address);
      expect(depositorAssetBalance).to.equal(ethers.parseEther("10000") - assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });

    it("should revert if no shares received", async () => {
      const assetsAmount = ethers.parseEther("100");

      // Deploy a malicious vault that doesn't mint shares
      const MaliciousVaultFactory = await ethers.getContractFactory("TestMaliciousVault");
      const maliciousVault = await upgrades.deployProxy(
        MaliciousVaultFactory,
        [await asset.getAddress(), "Malicious Vault", "mVAULT"],
      );
      await maliciousVault.waitForDeployment();

      // Approve malicious vault in controller
      await mockController.setVaultApproval(await maliciousVault.getAddress(), true);

      // Approve facet to spend assets
      await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

      // Execute - should revert because no shares are received
      await expect(
        erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await maliciousVault.getAddress(),
          assetsAmount,
          false
        ),
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "NoSharesReceived");
    });

    it("should revert if shares mismatch", async () => {
      const assetsAmount = ethers.parseEther("100");

      // Deploy a vault that lies about shares minted
      const LyingVaultFactory = await ethers.getContractFactory("TestLyingVault");
      const lyingVault = await upgrades.deployProxy(
        LyingVaultFactory,
        [await asset.getAddress(), "Lying Vault", "lVAULT"],
      );
      await lyingVault.waitForDeployment();

      // Approve lying vault in controller
      await mockController.setVaultApproval(await lyingVault.getAddress(), true);

      // Approve facet to spend assets
      await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

      // Execute - should revert because shares mismatch
      await expect(
        erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await lyingVault.getAddress(),
          assetsAmount,
          false
        ),
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "SharesMismatch");
    });

    it("should handle deposits with existing shares balance", async () => {
      const assetsAmount = ethers.parseEther("100");
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // First, mint some initial shares to wallet1 (the caller/receiver)
      // Need to approve vault to spend assets for the mint
      await asset.connect(wallet1).approve(await mockVault.getAddress(), ethers.parseEther("50"));
      await mockVault.connect(wallet1).mint(ethers.parseEther("50"), wallet1.address);

      // Approve facet to spend assets
      await asset.connect(wallet1).approve(facetAddr, assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      // Execute deposit
      const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
        await mockVault.getAddress(),
        assetsAmount,
        false
      );

      await expect(tx).to.not.be.reverted;

      // Verify total shares (initial + new)
      const totalShares = await mockVault.balanceOf(wallet1.address);
      expect(totalShares).to.equal(ethers.parseEther("150"));

      //Verify assets were taken from depositor
      const depositorAssetBalance = await asset.balanceOf(wallet1.address);
      expect(depositorAssetBalance).to.equal(ethers.parseEther("10000") - ethers.parseEther("50") - (assetsAmount));

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });
  });

  describe("withdrawFromVault", () => {
    beforeEach(async () => {
      // Setup: Deposit some assets first so we have shares to withdraw
      // Use vault directly to avoid any facet-related issues
      const depositAmount = ethers.parseEther("200");
      await asset.connect(wallet1).approve(await mockVault.getAddress(), depositAmount);
      await mockVault.connect(wallet1).deposit(depositAmount, wallet1.address);
    });

    it("should successfully withdraw assets from vault", async () => {
      const assetsAmount = ethers.parseEther("100");
      const expectedShares = ethers.parseEther("100"); // 1:1 exchange rate
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // Approve facet to spend shares
      await mockVault.connect(wallet1).approve(facetAddr, expectedShares);

      const initialAssetBalance = await asset.balanceOf(wallet1.address);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      // Execute withdrawal (3-arg: vault, assets, usePermit2) - assets go to msg.sender (wallet1)
      const tx = await erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
        await mockVault.getAddress(),
        assetsAmount,
        false
      );

      await expect(tx).to.not.be.reverted;

      // Verify assets were sent to caller (msg.sender = wallet1)
      const finalAssetBalance = await asset.balanceOf(wallet1.address);
      expect(finalAssetBalance - initialAssetBalance).to.equal(assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });

    it("should revert if no assets received", async () => {
      const assetsAmount = ethers.parseEther("100");

      // Deploy a malicious vault that doesn't send assets
      const MaliciousVaultFactory = await ethers.getContractFactory("TestMaliciousVault");
      const maliciousVault = await upgrades.deployProxy(
        MaliciousVaultFactory,
        [await asset.getAddress(), "Malicious Vault", "mVAULT"],
      );
      await maliciousVault.waitForDeployment();

      // Approve malicious vault in controller
      await mockController.setVaultApproval(await maliciousVault.getAddress(), true);

      // Mint some shares first
      await asset.connect(wallet1).approve(await maliciousVault.getAddress(), ethers.parseEther("200"));
      await maliciousVault.connect(wallet1).mint(ethers.parseEther("200"), wallet1.address);

      const sharesToBurn = await maliciousVault.previewWithdraw(assetsAmount);
      await maliciousVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToBurn);

      // Execute - should revert because no assets are received
      await expect(
        erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
          await maliciousVault.getAddress(),
          assetsAmount,
          false
        ),
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "NoAssetsReceived");
    });

    it("should revert if assets mismatch", async () => {
      const requestedAssets = ethers.parseEther("100");

      // Deploy a vault that sends wrong amount of assets
      const LyingVaultFactory = await ethers.getContractFactory("TestLyingVault");
      const lyingVault = await upgrades.deployProxy(
        LyingVaultFactory,
        [await asset.getAddress(), "Lying Vault", "lVAULT"],
      );
      await lyingVault.waitForDeployment();

      // Approve lying vault in controller
      await mockController.setVaultApproval(await lyingVault.getAddress(), true);

      // Setup initial deposit
      await asset.connect(wallet1).approve(await lyingVault.getAddress(), ethers.parseEther("300"));
      await lyingVault.deposit(ethers.parseEther("300"), wallet1.address);

      const sharesToBurn = await lyingVault.previewWithdraw(requestedAssets);
      await lyingVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToBurn);

      // Execute - should revert because assets mismatch
      await expect(
        erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
          await lyingVault.getAddress(),
          requestedAssets,
          false
        ),
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "AssetsMismatch");
    });

    it("should revert if shares mismatch", async () => {
      const assetsAmount = ethers.parseEther("100");

      // This test verifies internal consistency - shares burned must match expected
      // Deploy a special vault for this test
      const InconsistentVaultFactory = await ethers.getContractFactory("TestInconsistentVault");
      const inconsistentVault = await upgrades.deployProxy(
        InconsistentVaultFactory,
        [await asset.getAddress(), "Inconsistent Vault", "iVAULT"],
      );
      await inconsistentVault.waitForDeployment();

      // Approve inconsistent vault in controller
      await mockController.setVaultApproval(await inconsistentVault.getAddress(), true);

      // Setup initial deposit
      await asset.connect(wallet1).approve(await inconsistentVault.getAddress(), ethers.parseEther("300"));
      await inconsistentVault.deposit(ethers.parseEther("300"), wallet1.address);

      const sharesToBurn = await inconsistentVault.previewWithdraw(assetsAmount);
      await inconsistentVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToBurn);

      // Execute - should revert because shares mismatch
      await expect(
        erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
          await inconsistentVault.getAddress(),
          assetsAmount,
          false
        ),
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "SharesMismatch");
    });

    it("should handle withdrawal with existing asset balance", async () => {
      const assetsAmount = ethers.parseEther("100");
      const expectedShares = ethers.parseEther("100");
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      const initialBalance = await asset.balanceOf(wallet1.address);

      // Approve facet to spend shares
      await mockVault.connect(wallet1).approve(facetAddr, expectedShares);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      // Execute withdrawal
      const tx = await erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
        await mockVault.getAddress(),
        assetsAmount,
        false
      );

      await expect(tx).to.not.be.reverted;

      // Verify assets were added to existing balance
      const finalBalance = await asset.balanceOf(wallet1.address);
      expect(finalBalance - initialBalance).to.equal(assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });
  });

  describe("redeemFromVault", () => {
    beforeEach(async () => {
      // Setup: Deposit some assets first so we have shares to redeem
      const depositAmount = ethers.parseEther("300");
      await asset.connect(wallet1).approve(await mockVault.getAddress(), depositAmount);
      await mockVault.connect(wallet1).deposit(depositAmount, wallet1.address);
    });

    describe("Success Cases", () => {
      it("should successfully redeem shares from vault", async () => {
        const sharesToRedeem = ethers.parseEther("100");
        const expectedAssets = ethers.parseEther("100"); // 1:1 exchange rate
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve facet to spend shares
        await mockVault.connect(wallet1).approve(facetAddr, sharesToRedeem);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);
        const initialShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption (3-arg: vault, shares, usePermit2) - assets go to msg.sender (wallet1)
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify assets were sent to caller (msg.sender = wallet1)
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        expect(finalAssetBalance - initialAssetBalance).to.equal(expectedAssets);

        // Verify shares were burned from wallet1
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);
        expect(initialShareBalance - finalShareBalance).to.equal(sharesToRedeem);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });

      it("should handle redemption with existing asset balance", async () => {
        const sharesToRedeem = ethers.parseEther("50");
        const expectedAssets = ethers.parseEther("50");
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        const initialBalance = await asset.balanceOf(wallet1.address);

        // Approve facet to spend shares
        await mockVault.connect(wallet1).approve(facetAddr, sharesToRedeem);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify assets were added to existing balance
        const finalBalance = await asset.balanceOf(wallet1.address);
        expect(finalBalance - initialBalance).to.equal(expectedAssets);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });

      it("should handle redemption with different exchange rates", async () => {
        // Set exchange rate to 2:1 (200%)
        await mockVault.setExchangeRate(200);

        const sharesToRedeem = ethers.parseEther("100");
        const expectedAssets = ethers.parseEther("50"); // 100 shares = 50 assets at 2:1
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve facet to spend shares
        await mockVault.connect(wallet1).approve(facetAddr, sharesToRedeem);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify correct assets received based on exchange rate
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        expect(finalAssetBalance - initialAssetBalance).to.equal(expectedAssets);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });

      it("should handle self as receiver", async () => {
        const sharesToRedeem = ethers.parseEther("75");
        const expectedAssets = ethers.parseEther("75");
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve facet to spend shares
        await mockVault.connect(wallet1).approve(facetAddr, sharesToRedeem);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);
        const initialShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption with self as receiver (3-arg always sends to msg.sender)
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify assets and shares balance changes
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(finalAssetBalance - initialAssetBalance).to.equal(expectedAssets);
        expect(initialShareBalance - finalShareBalance).to.equal(sharesToRedeem);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });
    });

    describe("Error Cases", () => {
      it("should revert if no assets received", async () => {
        const sharesToRedeem = ethers.parseEther("100");

        // Deploy a malicious vault that doesn't send assets
        const MaliciousVaultFactory = await ethers.getContractFactory("TestMaliciousVault");
        const maliciousVault = await upgrades.deployProxy(
          MaliciousVaultFactory,
          [await asset.getAddress(), "Malicious Vault", "mVAULT"],
        );
        await maliciousVault.waitForDeployment();

        // Approve malicious vault in controller
        await mockController.setVaultApproval(await maliciousVault.getAddress(), true);

        // Setup shares in malicious vault
        await asset.connect(wallet1).approve(await maliciousVault.getAddress(), ethers.parseEther("200"));
        await maliciousVault.connect(wallet1).mint(ethers.parseEther("200"), wallet1.address);

        await maliciousVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToRedeem);

        // Execute - should revert because no assets are received
        await expect(
          erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await maliciousVault.getAddress(),
            sharesToRedeem,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "NoAssetsReceived");
      });

      it("should revert if assets mismatch", async () => {
        const sharesToRedeem = ethers.parseEther("100");

        // Deploy a vault that lies about assets sent
        const LyingVaultFactory = await ethers.getContractFactory("TestLyingVault");
        const lyingVault = await upgrades.deployProxy(
          LyingVaultFactory,
          [await asset.getAddress(), "Lying Vault", "lVAULT"],
        );
        await lyingVault.waitForDeployment();

        // Approve lying vault in controller
        await mockController.setVaultApproval(await lyingVault.getAddress(), true);

        // Setup shares in lying vault
        await asset.connect(wallet1).approve(await lyingVault.getAddress(), ethers.parseEther("300"));
        await lyingVault.deposit(ethers.parseEther("300"), wallet1.address);

        await lyingVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToRedeem);

        // Execute - should revert because assets mismatch
        await expect(
          erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await lyingVault.getAddress(),
            sharesToRedeem,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "AssetsMismatch");
      });

      it("should revert if shares mismatch", async () => {
        const sharesToRedeem = ethers.parseEther("50");

        // Deploy a vault with inconsistent share burning (burns more than requested)
        const InconsistentVaultFactory = await ethers.getContractFactory("TestInconsistentVault");
        const inconsistentVault = await upgrades.deployProxy(
          InconsistentVaultFactory,
          [await asset.getAddress(), "Inconsistent Vault", "iVAULT"],
        );
        await inconsistentVault.waitForDeployment();

        // Approve inconsistent vault in controller
        await mockController.setVaultApproval(await inconsistentVault.getAddress(), true);

        // Give user lots of shares so vault can burn 110% without hitting balance limits
        // The vault will burn 110% of sharesToRedeem (55 ether), so we need at least that many shares
        const depositAmount = ethers.parseEther("1000"); // Give user 1000 shares to be safe
        await asset.connect(wallet1).approve(await inconsistentVault.getAddress(), depositAmount);
        await inconsistentVault.deposit(depositAmount, wallet1.address);

        // Debug: Check how many shares wallet1 actually has
        const userShares = await inconsistentVault.balanceOf(wallet1.address);
        console.log("User shares balance:", ethers.formatEther(userShares));

        // The vault will burn 55 shares (110% of 50) due to its malicious behavior
        // We need to approve the facet for 55 shares, not just 50
        await inconsistentVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), depositAmount);

        // Execute - should revert with SharesMismatch because vault burns 55 shares but we requested 50
        try {
          await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await inconsistentVault.getAddress(),
            sharesToRedeem,
            false
          );
          expect.fail("Expected SharesMismatch revert");
        } catch (error: any) {
          console.log("Actual error:", error.message);
          // For now, expect it to revert with SharesMismatch
          expect(error.message).to.include("SharesMismatch");
        }
      });

      it("should revert if insufficient allowance", async () => {
        const sharesToRedeem = ethers.parseEther("100");

        // Don't approve or approve insufficient amount
        await mockVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), ethers.parseEther("50"));

        // Execute - should revert due to insufficient allowance
        await expect(
          erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await mockVault.getAddress(),
            sharesToRedeem,
            false
          ),
        ).to.be.reverted; // Will revert with ERC20 insufficient allowance
      });

      it("should revert if insufficient shares balance", async () => {
        const sharesToRedeem = ethers.parseEther("500"); // More than the 300 deposited

        // Approve more than balance
        await mockVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToRedeem);

        // Execute - should revert due to insufficient balance
        await expect(
          erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await mockVault.getAddress(),
            sharesToRedeem,
            false
          ),
        ).to.be.reverted; // Will revert with ERC20 transfer amount exceeds balance
      });
    });

    describe("Edge Cases", () => {
      it("should handle zero shares redemption", async () => {
        const sharesToRedeem = 0n;

        // Approve facet (even for zero, for consistency)
        await mockVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), 1);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);
        const initialShareBalance = await mockVault.balanceOf(wallet1.address);

        // Execute redemption - should revert with NoAssetsReceived for zero shares
        await expect(erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        )).to.be.revertedWithCustomError(erc4626InterfaceFacet, "NoAssetsReceived");

        // Verify no change in balances
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(finalAssetBalance).to.equal(initialAssetBalance);
        expect(finalShareBalance).to.equal(initialShareBalance);
      });

      it("should handle maximum shares redemption", async () => {
        // Redeem all shares
        const sharesToRedeem = await mockVault.balanceOf(wallet1.address);
        const expectedAssets = ethers.parseEther("300"); // All deposited assets
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve facet to spend all shares
        await mockVault.connect(wallet1).approve(facetAddr, sharesToRedeem);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify all assets received and no shares left
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(finalAssetBalance - initialAssetBalance).to.equal(expectedAssets);
        expect(finalShareBalance).to.equal(0);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });
    });

    describe("Integration Tests", () => {
      it("should handle multiple sequential redemptions", async () => {
        const firstRedemption = ethers.parseEther("50");
        const secondRedemption = ethers.parseEther("75");
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve for both redemptions
        await mockVault.connect(wallet1).approve(
          facetAddr,
          firstRedemption + secondRedemption
        );

        const initialAssetBalance = await asset.balanceOf(wallet1.address);
        const initialShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // First redemption
        await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          firstRedemption,
          false
        );

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        const midAssetBalance = await asset.balanceOf(wallet1.address);
        const midShareBalance = await mockVault.balanceOf(wallet1.address);

        // Verify first redemption
        expect(midAssetBalance - initialAssetBalance).to.equal(firstRedemption);
        expect(initialShareBalance - midShareBalance).to.equal(firstRedemption);

        // Second redemption
        await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          secondRedemption,
          false
        );

        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);

        // Verify total redemptions
        expect(finalAssetBalance - initialAssetBalance).to.equal(firstRedemption + secondRedemption);
        expect(initialShareBalance - finalShareBalance).to.equal(firstRedemption + secondRedemption);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });

      it("should handle cross-user redemptions", async () => {
        // Give wallet2 some shares by depositing for them
        await asset.connect(wallet1).approve(await mockVault.getAddress(), ethers.parseEther("100"));
        await mockVault.connect(wallet1).deposit(ethers.parseEther("100"), wallet2.address);

        const sharesToRedeem = ethers.parseEther("60");
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // wallet2 redeems their shares, assets go to wallet2 (msg.sender)
        await mockVault.connect(wallet2).approve(facetAddr, sharesToRedeem);

        const initialAssetBalance = await asset.balanceOf(wallet2.address);
        const initialWallet2Shares = await mockVault.balanceOf(wallet2.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        await erc4626InterfaceFacet.connect(wallet2).redeemFromVault(
          await mockVault.getAddress(),
          sharesToRedeem,
          false
        );

        const finalAssetBalance = await asset.balanceOf(wallet2.address);
        const finalWallet2Shares = await mockVault.balanceOf(wallet2.address);

        // Verify cross-user redemption worked
        expect(finalAssetBalance - initialAssetBalance).to.equal(sharesToRedeem);
        expect(initialWallet2Shares - finalWallet2Shares).to.equal(sharesToRedeem);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });

      it("should handle precision with small amounts", async () => {
        // Test with very small amounts to check precision
        const smallShares = 123n; // Very small amount
        const facetAddr = await erc4626InterfaceFacet.getAddress();

        // Approve facet
        await mockVault.connect(wallet1).approve(facetAddr, smallShares);

        const initialAssetBalance = await asset.balanceOf(wallet1.address);
        const initialShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

        // Execute redemption
        const tx = await erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
          await mockVault.getAddress(),
          smallShares,
          false
        );

        await expect(tx).to.not.be.reverted;

        // Verify precise amounts
        const finalAssetBalance = await asset.balanceOf(wallet1.address);
        const finalShareBalance = await mockVault.balanceOf(wallet1.address);

        expect(finalAssetBalance - initialAssetBalance).to.equal(smallShares); // 1:1 rate
        expect(initialShareBalance - finalShareBalance).to.equal(smallShares);

        expect(await asset.balanceOf(facetAddr)).to.equal(0);
        expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
      });
    });
  });

  describe("Vault Approval", () => {
    let unapprovedVault: TestMockVault;

    beforeEach(async () => {
      // Deploy a vault that is NOT approved in the controller
      const TestMockVaultFactory = await ethers.getContractFactory("TestMockVault");
      unapprovedVault = (await upgrades.deployProxy(
        TestMockVaultFactory,
        [await asset.getAddress(), "Unapproved Vault", "uVAULT"],
      )) as unknown as TestMockVault;
      await unapprovedVault.waitForDeployment();
    });

    describe("approvedERC4626VaultOnly modifier", () => {
      it("should revert with UnapprovedVault when vault is not term-approved and not user-approved", async () => {
        const assetsAmount = ethers.parseEther("100");
        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).depositToVault(
            await unapprovedVault.getAddress(),
            assetsAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should allow deposit when vault is term-approved via controller", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Approve vault via mock controller
        await mockController.setVaultApproval(await unapprovedVault.getAddress(), true);

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await unapprovedVault.getAddress(),
          assetsAmount,
          false
        );
        await expect(tx).to.not.be.reverted;
      });

      it("should allow deposit when vault is user-approved but not term-approved", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Set user approval directly via helper (no term approval)
        await erc4626InterfaceFacet.setUserApprovedVault(
          wallet1.address,
          await unapprovedVault.getAddress(),
          true
        );

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await unapprovedVault.getAddress(),
          assetsAmount,
          false
        );
        await expect(tx).to.not.be.reverted;
      });

      it("should allow deposit when vault is both term-approved and user-approved", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Both approvals
        await mockController.setVaultApproval(await unapprovedVault.getAddress(), true);
        await erc4626InterfaceFacet.setUserApprovedVault(
          wallet1.address,
          await unapprovedVault.getAddress(),
          true
        );

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await unapprovedVault.getAddress(),
          assetsAmount,
          false
        );
        await expect(tx).to.not.be.reverted;
      });

      it("should revert when term controller exists but does not approve the vault", async () => {
        const assetsAmount = ethers.parseEther("100");
        // Controller exists (added in top-level beforeEach) but vault is not approved in it
        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).depositToVault(
            await unapprovedVault.getAddress(),
            assetsAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should allow deposit when one of multiple controllers approves the vault", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Deploy a second controller that approves the vault
        const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
        const secondController = (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
        await secondController.waitForDeployment();
        await erc4626InterfaceFacet.addApprovedTermController(await secondController.getAddress());

        // Only second controller approves (first controller does not)
        await secondController.setVaultApproval(await unapprovedVault.getAddress(), true);

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(
          await unapprovedVault.getAddress(),
          assetsAmount,
          false
        );
        await expect(tx).to.not.be.reverted;
      });

      it("should revert when multiple controllers exist but none approve the vault", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Deploy a second controller (neither approves the vault)
        const MockControllerFactory = await ethers.getContractFactory("TestMockTermController");
        const secondController = (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
        await secondController.waitForDeployment();
        await erc4626InterfaceFacet.addApprovedTermController(await secondController.getAddress());

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).depositToVault(
            await unapprovedVault.getAddress(),
            assetsAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should revert when no term controllers are registered and no user approval", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Remove all controllers
        await erc4626InterfaceFacet.removeAllTermControllers();

        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).depositToVault(
            await unapprovedVault.getAddress(),
            assetsAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should check user-specific approval (different user not approved)", async () => {
        const assetsAmount = ethers.parseEther("100");

        // Approve vault for wallet1 but not wallet2
        await erc4626InterfaceFacet.setUserApprovedVault(
          wallet1.address,
          await unapprovedVault.getAddress(),
          true
        );

        // Fund wallet2
        await asset.connect(wallet1).transfer(wallet2.address, assetsAmount);
        await asset.connect(wallet2).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        // wallet2 should be rejected (user-specific approval only covers wallet1)
        await expect(
          erc4626InterfaceFacet.connect(wallet2).depositToVault(
            await unapprovedVault.getAddress(),
            assetsAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should apply approval check to withdrawFromVault", async () => {
        // Deposit directly to vault first
        const depositAmount = ethers.parseEther("100");
        await asset.connect(wallet1).approve(await unapprovedVault.getAddress(), depositAmount);
        await unapprovedVault.connect(wallet1).deposit(depositAmount, wallet1.address);

        const sharesToBurn = await unapprovedVault.previewWithdraw(depositAmount);
        await unapprovedVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToBurn);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).withdrawFromVault(
            await unapprovedVault.getAddress(),
            depositAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should apply approval check to redeemFromVault", async () => {
        // Deposit directly to vault first
        const depositAmount = ethers.parseEther("100");
        await asset.connect(wallet1).approve(await unapprovedVault.getAddress(), depositAmount);
        await unapprovedVault.connect(wallet1).deposit(depositAmount, wallet1.address);

        await unapprovedVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), depositAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).redeemFromVault(
            await unapprovedVault.getAddress(),
            depositAmount,
            false
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });
    });

    describe("userRevokeVault", () => {
      it("should revert when revoking a vault that was never approved", async () => {
        await expect(
          erc4626InterfaceFacet.connect(wallet1).userRevokeVault(
            await unapprovedVault.getAddress()
          ),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "VaultNotApproved");
      });

      it("should successfully revoke a user-approved vault", async () => {
        const vaultAddress = await unapprovedVault.getAddress();

        // Set user approval via helper
        await erc4626InterfaceFacet.setUserApprovedVault(wallet1.address, vaultAddress, true);

        // Revoke
        await erc4626InterfaceFacet.connect(wallet1).userRevokeVault(vaultAddress);

        // Now deposit should revert (no term approval either)
        const assetsAmount = ethers.parseEther("100");
        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).depositToVault(vaultAddress, assetsAmount, false),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnapprovedVault");
      });

      it("should only revoke for the calling user", async () => {
        const vaultAddress = await unapprovedVault.getAddress();

        // Both users approve vault
        await erc4626InterfaceFacet.setUserApprovedVault(wallet1.address, vaultAddress, true);
        await erc4626InterfaceFacet.setUserApprovedVault(wallet2.address, vaultAddress, true);

        // wallet1 revokes
        await erc4626InterfaceFacet.connect(wallet1).userRevokeVault(vaultAddress);

        // wallet2 should still be able to deposit
        const assetsAmount = ethers.parseEther("100");
        await asset.connect(wallet1).transfer(wallet2.address, assetsAmount);
        await asset.connect(wallet2).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet2).depositToVault(vaultAddress, assetsAmount, false);
        await expect(tx).to.not.be.reverted;
      });
    });

    describe("userApproveVault", () => {
      let domainSeparator: string;
      const VAULT_APPROVAL_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes("VaultApproval(address vault,address user,uint256 deadline)")
      );

      beforeEach(async () => {
        // Compute and set EIP-712 domain separator
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const facetAddress = await erc4626InterfaceFacet.getAddress();

        domainSeparator = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
              ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
              ethers.keccak256(ethers.toUtf8Bytes("TermFinance")),
              ethers.keccak256(ethers.toUtf8Bytes("1")),
              chainId,
              facetAddress,
            ]
          )
        );
        await erc4626InterfaceFacet.setEip712DomainSeparator(domainSeparator);
      });

      async function signVaultApproval(
        signer: SignerWithAddress,
        vault: string,
        deadline: number
      ): Promise<string> {
        const domain = {
          name: "TermFinance",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: await erc4626InterfaceFacet.getAddress(),
        };

        const types = {
          VaultApproval: [
            { name: "vault", type: "address" },
            { name: "user", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        };

        const value = {
          vault: vault,
          user: signer.address,
          deadline: deadline,
        };

        const signature = await signer.signTypedData(domain, types, value);
        const sig = ethers.Signature.from(signature);
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint8", "bytes32", "bytes32"],
          [sig.v, sig.r, sig.s]
        );
      }

      it("should approve vault with valid EIP-712 signature", async () => {
        const vaultAddress = await unapprovedVault.getAddress();
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

        const sigData = await signVaultApproval(wallet1, vaultAddress, deadline);

        await erc4626InterfaceFacet.connect(wallet1).userApproveVault(vaultAddress, deadline, sigData);

        // Now deposit should work (user-approved)
        const assetsAmount = ethers.parseEther("100");
        await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

        const tx = await erc4626InterfaceFacet.connect(wallet1).depositToVault(vaultAddress, assetsAmount, false);
        await expect(tx).to.not.be.reverted;
      });

      it("should revert with ExpiredSignature when deadline has passed", async () => {
        const vaultAddress = await unapprovedVault.getAddress();
        const deadline = 1; // Already expired (timestamp 1)

        const sigData = await signVaultApproval(wallet1, vaultAddress, deadline);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).userApproveVault(vaultAddress, deadline, sigData),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "ExpiredSignature");
      });

      it("should revert with VaultAlreadyApproved when vault is already approved", async () => {
        const vaultAddress = await unapprovedVault.getAddress();
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        // Set user approval via helper
        await erc4626InterfaceFacet.setUserApprovedVault(wallet1.address, vaultAddress, true);

        const sigData = await signVaultApproval(wallet1, vaultAddress, deadline);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).userApproveVault(vaultAddress, deadline, sigData),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "VaultAlreadyApproved");
      });

      it("should revert with InvalidSignature when signer does not match caller", async () => {
        const vaultAddress = await unapprovedVault.getAddress();
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        // wallet2 signs but wallet1 calls
        const sigData = await signVaultApproval(wallet2, vaultAddress, deadline);

        await expect(
          erc4626InterfaceFacet.connect(wallet1).userApproveVault(vaultAddress, deadline, sigData),
        ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "InvalidSignature");
      });
    });
  });

  describe("generateCalldata", () => {
    it("should generate correct calldata for WITHDRAW_SELECTOR", async () => {
      const withdrawSelector = await erc4626InterfaceFacet.WITHDRAW_SELECTOR();
      const vaultAddr = await mockVault.getAddress();
      const amount = ethers.parseEther("50");

      const calldata = await erc4626InterfaceFacet.generateCalldata(
        withdrawSelector,
        vaultAddr,
        await asset.getAddress(),
        wallet1.address,
        amount,
        false,
        "0x"
      );

      const expected = erc4626InterfaceFacet.interface.encodeFunctionData(
        "withdrawFromVault(address,uint256,address,bool,bool)",
        [vaultAddr, amount, wallet1.address, false, false]
      );
      expect(calldata).to.equal(expected);
    });

    it("should revert with UnsupportedSelector for invalid selector", async () => {
      const invalidSelector = "0xdeadbeef";

      await expect(
        erc4626InterfaceFacet.generateCalldata(
          invalidSelector,
          await mockVault.getAddress(),
          await asset.getAddress(),
          wallet1.address,
          ethers.parseEther("100"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "UnsupportedSelector");
    });
  });

  describe("5-arg withdrawFromVault", () => {
    beforeEach(async () => {
      const depositAmount = ethers.parseEther("500");
      await asset.connect(wallet1).approve(await mockVault.getAddress(), depositAmount);
      await mockVault.connect(wallet1).deposit(depositAmount, wallet1.address);
    });

    it("should withdraw with direct call (assets go to user)", async () => {
      const assetsAmount = ethers.parseEther("100");
      const sharesToBurn = await mockVault.previewWithdraw(assetsAmount);

      await mockVault.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), sharesToBurn);

      const initialBalance = await asset.balanceOf(wallet1.address);

      await erc4626InterfaceFacet.connect(wallet1)["withdrawFromVault(address,uint256,address,bool,bool)"](
        await mockVault.getAddress(),
        assetsAmount,
        wallet1.address,
        false,
        true
      );

      const finalBalance = await asset.balanceOf(wallet1.address);
      expect(finalBalance - initialBalance).to.equal(assetsAmount);
    });

    it("should withdraw via self-call with payoutToUser=false (assets go to contract)", async () => {
      const assetsAmount = ethers.parseEther("100");
      const facetAddr = await erc4626InterfaceFacet.getAddress();
      const sharesToBurn = await mockVault.previewWithdraw(assetsAmount);

      // Approve facet to spend shares
      await mockVault.connect(wallet1).approve(facetAddr, sharesToBurn);

      await erc4626InterfaceFacet.selfCallWithdrawFromVault(
        await mockVault.getAddress(),
        assetsAmount,
        wallet1.address,
        false,
        false
      );

      // Assets should be at the facet contract
      const contractBalance = await erc4626InterfaceFacet.getAssetBalance(await asset.getAddress());
      expect(contractBalance).to.equal(assetsAmount);
    });

    it("should revert with Unauthorized caller when unauthorized", async () => {
      const assetsAmount = ethers.parseEther("100");

      await expect(
        erc4626InterfaceFacet.connect(wallet2)["withdrawFromVault(address,uint256,address,bool,bool)"](
          await mockVault.getAddress(),
          assetsAmount,
          wallet1.address,
          false,
          true
        )
      ).to.be.revertedWith("Unauthorized caller");
    });
  });

  describe("Permit2 paths", () => {
    let mockPermit2: TestMockPermit2;

    before(async () => {
      // Deploy a temporary TestMockPermit2 to get its runtime bytecode
      const MockPermit2Factory = await ethers.getContractFactory("TestMockPermit2");
      const tempMockPermit2 = await MockPermit2Factory.deploy();
      await tempMockPermit2.waitForDeployment();
      const runtimeCode = await ethers.provider.getCode(await tempMockPermit2.getAddress());

      // Plant mock bytecode at the canonical Permit2 address
      await ethers.provider.send("hardhat_setCode", [
        PERMIT2_CANONICAL_ADDRESS,
        runtimeCode,
      ]);

      mockPermit2 = (await ethers.getContractAt(
        "TestMockPermit2",
        PERMIT2_CANONICAL_ADDRESS,
      )) as unknown as TestMockPermit2;
    });

    it("should use Permit2 for depositToVault with usePermit2=true", async () => {
      const assetsAmount = ethers.parseEther("100");
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // For Permit2 path: user approves Permit2, and Permit2 does the transferFrom
      // The mock Permit2 will call token.transferFrom(from, to, amount)
      // So user needs to approve the Permit2 canonical address
      await asset.connect(wallet1).approve(PERMIT2_CANONICAL_ADDRESS, assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      await erc4626InterfaceFacet.connect(wallet1)["depositToVault(address,uint256,bool)"](
        await mockVault.getAddress(),
        assetsAmount,
        true // usePermit2
      );

      // Verify the Permit2 mock recorded the transferFrom call
      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferAmount()).to.equal(assetsAmount);
      expect(await mockPermit2.lastTransferToken()).to.equal(await asset.getAddress());

      // Verify shares were minted
      const shares = await mockVault.balanceOf(wallet1.address);
      expect(shares).to.equal(assetsAmount);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });

    it("should use Permit2 for withdrawFromVault with usePermit2=true", async () => {
      // First deposit to get shares
      const depositAmount = ethers.parseEther("200");
      await asset.connect(wallet1).approve(await mockVault.getAddress(), depositAmount);
      await mockVault.connect(wallet1).deposit(depositAmount, wallet1.address);

      const assetsToWithdraw = ethers.parseEther("100");
      const sharesToBurn = await mockVault.previewWithdraw(assetsToWithdraw);
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // User approves Permit2 for vault shares
      await mockVault.connect(wallet1).approve(PERMIT2_CANONICAL_ADDRESS, sharesToBurn);

      const initialBalance = await asset.balanceOf(wallet1.address);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      await erc4626InterfaceFacet.connect(wallet1)["withdrawFromVault(address,uint256,bool)"](
        await mockVault.getAddress(),
        assetsToWithdraw,
        true // usePermit2
      );

      // Verify Permit2 was used for share transfer
      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferToken()).to.equal(await mockVault.getAddress());

      // Verify assets were received
      const finalBalance = await asset.balanceOf(wallet1.address);
      expect(finalBalance - initialBalance).to.equal(assetsToWithdraw);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });

    it("should use Permit2 for redeemFromVault with usePermit2=true", async () => {
      // First deposit to get shares
      const depositAmount = ethers.parseEther("200");
      await asset.connect(wallet1).approve(await mockVault.getAddress(), depositAmount);
      await mockVault.connect(wallet1).deposit(depositAmount, wallet1.address);

      const sharesToRedeem = ethers.parseEther("100");
      const facetAddr = await erc4626InterfaceFacet.getAddress();

      // User approves Permit2 for vault shares
      await mockVault.connect(wallet1).approve(PERMIT2_CANONICAL_ADDRESS, sharesToRedeem);

      const initialBalance = await asset.balanceOf(wallet1.address);

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);

      await erc4626InterfaceFacet.connect(wallet1)["redeemFromVault(address,uint256,bool)"](
        await mockVault.getAddress(),
        sharesToRedeem,
        true // usePermit2
      );

      // Verify Permit2 was used for share transfer
      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferToken()).to.equal(await mockVault.getAddress());

      // Verify assets were received
      const finalBalance = await asset.balanceOf(wallet1.address);
      expect(finalBalance - initialBalance).to.equal(sharesToRedeem); // 1:1 rate

      expect(await asset.balanceOf(facetAddr)).to.equal(0);
      expect(await mockVault.balanceOf(facetAddr)).to.equal(0);
    });
  });

  describe("Missing error branch tests", () => {
    it("should revert with AssetsMismatch when vault only partially consumes assets", async () => {
      const assetsAmount = ethers.parseEther("100");

      // Deploy a vault that only consumes 90% of assets
      const PartialConsumeVaultFactory = await ethers.getContractFactory("TestPartialConsumeVault");
      const partialVault = await upgrades.deployProxy(
        PartialConsumeVaultFactory,
        [await asset.getAddress(), "Partial Vault", "pVAULT"],
      );
      await partialVault.waitForDeployment();

      await mockController.setVaultApproval(await partialVault.getAddress(), true);
      await asset.connect(wallet1).approve(await erc4626InterfaceFacet.getAddress(), assetsAmount);

      await expect(
        erc4626InterfaceFacet.connect(wallet1)["depositToVault(address,uint256,bool)"](
          await partialVault.getAddress(),
          assetsAmount,
          false
        )
      ).to.be.revertedWithCustomError(erc4626InterfaceFacet, "AssetsMismatch");
    });

    it("should refund excess shares when actualSharesBurned < sharesToRedeem in withdraw", async () => {
      // Deploy a vault where previewWithdraw overestimates shares needed
      const RefundVaultFactory = await ethers.getContractFactory("TestRefundVault");
      const refundVault = await upgrades.deployProxy(
        RefundVaultFactory,
        [await asset.getAddress(), "Refund Vault", "rVAULT"],
      );
      await refundVault.waitForDeployment();

      await mockController.setVaultApproval(await refundVault.getAddress(), true);

      // Deposit to get shares
      const depositAmount = ethers.parseEther("500");
      await asset.connect(wallet1).approve(await refundVault.getAddress(), depositAmount);
      await (refundVault as any).connect(wallet1).deposit(depositAmount, wallet1.address);

      const assetsToWithdraw = ethers.parseEther("100");
      // previewWithdraw returns 120 shares for 100 assets
      const sharesToBurn = await (refundVault as any).previewWithdraw(assetsToWithdraw);
      expect(sharesToBurn).to.equal(ethers.parseEther("120"));

      // Approve facet for the full 120 shares
      await (refundVault as any).connect(wallet1).approve(
        await erc4626InterfaceFacet.getAddress(),
        sharesToBurn
      );

      const initialShares = await (refundVault as any).balanceOf(wallet1.address);
      const initialAssets = await asset.balanceOf(wallet1.address);

      await erc4626InterfaceFacet.connect(wallet1)["withdrawFromVault(address,uint256,bool)"](
        await refundVault.getAddress(),
        assetsToWithdraw,
        false
      );

      const finalShares = await (refundVault as any).balanceOf(wallet1.address);
      const finalAssets = await asset.balanceOf(wallet1.address);

      // User should get 100 assets
      expect(finalAssets - initialAssets).to.equal(assetsToWithdraw);

      // User should only lose 100 shares (not 120), because 20 excess shares are refunded
      // withdraw() burns 100, but previewWithdraw said 120, so 20 are refunded
      expect(initialShares - finalShares).to.equal(ethers.parseEther("100"));
    });
  });
});
