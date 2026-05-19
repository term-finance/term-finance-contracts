/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestTransferFacetHelper,
  TestToken,
} from "../typechain-types";

describe("TransferFacet Tests", () => {
  let transferFacet: TestTransferFacetHelper;
  let asset: TestToken;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let snapshotId: string;

  before(async () => {
    [wallet1, wallet2, wallet3] = await ethers.getSigners();

    // Deploy TestTransferFacetHelper
    const TransferFacetFactory = await ethers.getContractFactory(
      "TestTransferFacetHelper",
    );
    transferFacet =
      (await TransferFacetFactory.deploy()) as unknown as TestTransferFacetHelper;
    await transferFacet.waitForDeployment();

    // Deploy test token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    asset = (await upgrades.deployProxy(TestTokenFactory, [
      "Test Token",
      "TT",
      18,
      [wallet1.address, wallet2.address],
      [ethers.parseEther("10000"), ethers.parseEther("10000")],
    ])) as unknown as TestToken;
    await asset.waitForDeployment();

    // Grant ADMIN_ROLE to wallet1
    await transferFacet.grantAdminRole(wallet1.address);
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // ===========================================================================
  // erc20Transfer
  // ===========================================================================
  describe("erc20Transfer", () => {
    describe("access control", () => {
      it("should succeed when caller has ADMIN_ROLE", async () => {
        const amount = ethers.parseEther("100");
        const facetAddr = await transferFacet.getAddress();

        // Fund the facet contract with tokens
        await asset.connect(wallet1).transfer(facetAddr, amount);

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20Transfer(await asset.getAddress(), wallet2.address, amount),
        ).to.not.be.reverted;
      });

      it("should revert when caller lacks ADMIN_ROLE", async () => {
        const amount = ethers.parseEther("100");

        await expect(
          transferFacet
            .connect(wallet2)
            .erc20Transfer(await asset.getAddress(), wallet3.address, amount),
        ).to.be.reverted;
      });
    });

    describe("input validation", () => {
      it("should revert with ZeroAddress when recipient is address(0)", async () => {
        const amount = ethers.parseEther("100");

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20Transfer(await asset.getAddress(), ethers.ZeroAddress, amount),
        ).to.be.revertedWithCustomError(transferFacet, "ZeroAddress");
      });

      it("should revert with SelfTransferNotAllowed when recipient is contract itself", async () => {
        const amount = ethers.parseEther("100");
        const facetAddr = await transferFacet.getAddress();

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20Transfer(await asset.getAddress(), facetAddr, amount),
        ).to.be.revertedWithCustomError(
          transferFacet,
          "SelfTransferNotAllowed",
        );
      });

      it("should revert with ZeroAmount when amount is 0", async () => {
        await expect(
          transferFacet
            .connect(wallet1)
            .erc20Transfer(await asset.getAddress(), wallet2.address, 0),
        ).to.be.revertedWithCustomError(transferFacet, "ZeroAmount");
      });
    });

    describe("token transfer", () => {
      it("should transfer tokens to recipient and update balances", async () => {
        const amount = ethers.parseEther("100");
        const facetAddr = await transferFacet.getAddress();

        // Fund the facet contract
        await asset.connect(wallet1).transfer(facetAddr, amount);

        const recipientBefore = await asset.balanceOf(wallet2.address);
        const facetBefore = await asset.balanceOf(facetAddr);

        await transferFacet
          .connect(wallet1)
          .erc20Transfer(await asset.getAddress(), wallet2.address, amount);

        const recipientAfter = await asset.balanceOf(wallet2.address);
        const facetAfter = await asset.balanceOf(facetAddr);

        expect(recipientAfter - recipientBefore).to.equal(amount);
        expect(facetBefore - facetAfter).to.equal(amount);
      });

      it("should revert when contract has insufficient token balance", async () => {
        const amount = ethers.parseEther("100");

        // Don't fund the facet — it has 0 balance
        await expect(
          transferFacet
            .connect(wallet1)
            .erc20Transfer(await asset.getAddress(), wallet2.address, amount),
        ).to.be.reverted;
      });

      it("should work with different token amounts", async () => {
        const facetAddr = await transferFacet.getAddress();

        // Fund the facet with a large amount
        await asset
          .connect(wallet1)
          .transfer(facetAddr, ethers.parseEther("5000"));

        // Transfer a small amount
        const smallAmount = ethers.parseEther("1");
        await transferFacet
          .connect(wallet1)
          .erc20Transfer(await asset.getAddress(), wallet2.address, smallAmount);

        // Transfer a large amount
        const largeAmount = ethers.parseEther("4999");
        await transferFacet
          .connect(wallet1)
          .erc20Transfer(
            await asset.getAddress(),
            wallet2.address,
            largeAmount,
          );

        // Facet should have 0 left
        expect(await asset.balanceOf(facetAddr)).to.equal(0);
      });
    });
  });

  // ===========================================================================
  // erc20TransferFrom
  // ===========================================================================
  describe("erc20TransferFrom", () => {
    describe("access control", () => {
      it("should revert with 'uninitialized' when multicallInitiator is not set", async () => {
        // multicallInitiator is not set by default (address(0))
        await expect(
          transferFacet
            .connect(wallet1)
            .erc20TransferFrom(await asset.getAddress(), ethers.parseEther("100")),
        ).to.be.revertedWith("uninitialized");
      });

      it("should revert with 'unauthorized' when caller is not the multicall initiator", async () => {
        // Set wallet1 as multicall initiator
        await transferFacet.setMulticallInitiator(wallet1.address);

        // wallet2 tries to call — should fail
        await expect(
          transferFacet
            .connect(wallet2)
            .erc20TransferFrom(await asset.getAddress(), ethers.parseEther("100")),
        ).to.be.revertedWith("unauthorized");
      });

      it("should succeed when caller is the multicall initiator", async () => {
        const amount = ethers.parseEther("100");
        const facetAddr = await transferFacet.getAddress();

        // Set wallet1 as multicall initiator
        await transferFacet.setMulticallInitiator(wallet1.address);

        // Approve the facet to pull tokens
        await asset.connect(wallet1).approve(facetAddr, amount);

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20TransferFrom(await asset.getAddress(), amount),
        ).to.not.be.reverted;
      });
    });

    describe("input validation", () => {
      it("should revert with ZeroAmount when amount is 0", async () => {
        await transferFacet.setMulticallInitiator(wallet1.address);

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20TransferFrom(await asset.getAddress(), 0),
        ).to.be.revertedWithCustomError(transferFacet, "ZeroAmount");
      });
    });

    describe("token transfer", () => {
      it("should pull tokens from initiator to the contract", async () => {
        const amount = ethers.parseEther("100");
        const facetAddr = await transferFacet.getAddress();

        await transferFacet.setMulticallInitiator(wallet1.address);
        await asset.connect(wallet1).approve(facetAddr, amount);

        const initiatorBefore = await asset.balanceOf(wallet1.address);
        const facetBefore = await asset.balanceOf(facetAddr);

        await transferFacet
          .connect(wallet1)
          .erc20TransferFrom(await asset.getAddress(), amount);

        const initiatorAfter = await asset.balanceOf(wallet1.address);
        const facetAfter = await asset.balanceOf(facetAddr);

        expect(initiatorBefore - initiatorAfter).to.equal(amount);
        expect(facetAfter - facetBefore).to.equal(amount);
      });

      it("should revert when initiator has insufficient allowance", async () => {
        const amount = ethers.parseEther("100");

        await transferFacet.setMulticallInitiator(wallet1.address);
        // Don't approve — allowance is 0

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20TransferFrom(await asset.getAddress(), amount),
        ).to.be.reverted;
      });

      it("should revert when initiator has insufficient balance", async () => {
        const tooMuch = ethers.parseEther("20000"); // wallet1 only has 10000
        const facetAddr = await transferFacet.getAddress();

        await transferFacet.setMulticallInitiator(wallet1.address);
        await asset.connect(wallet1).approve(facetAddr, tooMuch);

        await expect(
          transferFacet
            .connect(wallet1)
            .erc20TransferFrom(await asset.getAddress(), tooMuch),
        ).to.be.reverted;
      });
    });
  });
});
