/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestPermitFacetHelper,
  TestMockPermitToken,
  TestMockTermController,
} from "../typechain-types";

describe("PermitFacet Tests", () => {
  let permitFacet: TestPermitFacetHelper;
  let mockToken: TestMockPermitToken;
  let mockController: TestMockTermController;
  let mockController2: TestMockTermController;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let snapshotId: string;

  // Dummy signature constants
  const VALID_V = 27;
  const VALID_R =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const VALID_S =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const ZERO_BYTES32 = ethers.ZeroHash;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);

    [wallet1, wallet2, wallet3] = await ethers.getSigners();

    // Deploy TestPermitFacetHelper
    const PermitFacetFactory = await ethers.getContractFactory(
      "TestPermitFacetHelper",
    );
    permitFacet =
      (await PermitFacetFactory.deploy()) as unknown as TestPermitFacetHelper;
    await permitFacet.waitForDeployment();

    // Deploy mock permit token
    const MockTokenFactory =
      await ethers.getContractFactory("TestMockPermitToken");
    mockToken = (await upgrades.deployProxy(MockTokenFactory, [
      "Mock Permit Token",
      "MPT",
      18,
      [wallet1.address, wallet2.address],
      [ethers.parseEther("10000"), ethers.parseEther("10000")],
    ])) as unknown as TestMockPermitToken;
    await mockToken.waitForDeployment();

    // Deploy mock term controllers
    const MockControllerFactory =
      await ethers.getContractFactory("TestMockTermController");
    mockController =
      (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
    await mockController.waitForDeployment();
    mockController2 =
      (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
    await mockController2.waitForDeployment();

    // Set wallet1 as multicall initiator
    await permitFacet.setMulticallInitiator(wallet1.address);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // Helper to get a future deadline
  async function futureDeadline(): Promise<number> {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp + 3600;
  }

  // =========================================================================
  // permit
  // =========================================================================
  describe("permit", () => {
    it("should revert when multicall initiator is unset", async () => {
      await permitFacet.clearMulticallInitiator();
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("uninitialized");
    });

    it("should revert when caller is not multicall initiator", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet2)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when deadline is less than block.timestamp", async () => {
      const block = await ethers.provider.getBlock("latest");
      const pastDeadline = block!.timestamp - 1;

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            pastDeadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "Expired");
    });

    it("should revert when deadline equals block.timestamp (boundary)", async () => {
      const block = await ethers.provider.getBlock("latest");
      const exactDeadline = block!.timestamp + 1;

      // Set next block timestamp to match the deadline exactly
      await ethers.provider.send("evm_setNextBlockTimestamp", [exactDeadline]);

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            exactDeadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "Expired");
    });

    it("should revert when asset is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            ethers.ZeroAddress,
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidAsset");
    });

    it("should revert when spender is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            ethers.ZeroAddress,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSpender");
    });

    it("should revert when r is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            ZERO_BYTES32,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when s is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            ZERO_BYTES32,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when v is not 27 or 28", async () => {
      const deadline = await futureDeadline();

      // Test v = 26
      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            26,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");

      // Test v = 29
      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            29,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should succeed and forward correct args using initiator as owner", async () => {
      const deadline = await futureDeadline();
      const amount = BigInt(5000);
      const tokenAddr = await mockToken.getAddress();

      await permitFacet
        .connect(wallet1)
        .permit(
          tokenAddr,
          amount,
          wallet2.address,
          deadline,
          VALID_V,
          VALID_R,
          VALID_S,
          false,
        );

      // Owner should be wallet1 (the multicall initiator), not msg.sender
      expect(await mockToken.lastPermitOwner()).to.equal(wallet1.address);
      expect(await mockToken.lastPermitSpender()).to.equal(wallet2.address);
      expect(await mockToken.lastPermitAmount()).to.equal(amount);
      expect(await mockToken.lastPermitDeadline()).to.equal(deadline);
      expect(await mockToken.lastPermitV()).to.equal(VALID_V);
      expect(await mockToken.lastPermitR()).to.equal(VALID_R);
      expect(await mockToken.lastPermitS()).to.equal(VALID_S);
    });

    it("should revert when permit call fails and skipRevert is false", async () => {
      await mockToken.setShouldRevertOnPermit(true);
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit call fails and skipRevert is true", async () => {
      await mockToken.setShouldRevertOnPermit(true);
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permit(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            true,
          ),
      ).to.not.be.reverted;
    });
  });

  // =========================================================================
  // permitDiamond
  // =========================================================================
  describe("permitDiamond", () => {
    it("should revert when caller is not multicall initiator", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet2)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when deadline is expired", async () => {
      const block = await ethers.provider.getBlock("latest");
      const pastDeadline = block!.timestamp - 1;

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            pastDeadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "Expired");
    });

    it("should revert when asset is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            ethers.ZeroAddress,
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidAsset");
    });

    it("should revert when owner is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            ethers.ZeroAddress,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidOwner");
    });

    it("should revert when r is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            ZERO_BYTES32,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when s is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            ZERO_BYTES32,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when v is not 27 or 28", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            26,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should succeed with spender as address(this) and explicit owner", async () => {
      const deadline = await futureDeadline();
      const amount = BigInt(5000);
      const facetAddr = await permitFacet.getAddress();

      // wallet2 is the explicit owner, wallet1 is the multicall initiator
      await permitFacet
        .connect(wallet1)
        .permitDiamond(
          await mockToken.getAddress(),
          amount,
          wallet2.address,
          deadline,
          VALID_V,
          VALID_R,
          VALID_S,
          false,
        );

      expect(await mockToken.lastPermitOwner()).to.equal(wallet2.address);
      expect(await mockToken.lastPermitSpender()).to.equal(facetAddr);
      expect(await mockToken.lastPermitAmount()).to.equal(amount);
      expect(await mockToken.lastPermitDeadline()).to.equal(deadline);
      expect(await mockToken.lastPermitV()).to.equal(VALID_V);
      expect(await mockToken.lastPermitR()).to.equal(VALID_R);
      expect(await mockToken.lastPermitS()).to.equal(VALID_S);
    });

    it("should revert when permit call fails and skipRevert is false", async () => {
      await mockToken.setShouldRevertOnPermit(true);
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit call fails and skipRevert is true", async () => {
      await mockToken.setShouldRevertOnPermit(true);
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitDiamond(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            true,
          ),
      ).to.not.be.reverted;
    });
  });

  // =========================================================================
  // permitTermContract
  // =========================================================================
  describe("permitTermContract", () => {
    it("should revert when caller is not multicall initiator", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet2)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when deadline is expired", async () => {
      const block = await ethers.provider.getBlock("latest");
      const pastDeadline = block!.timestamp - 1;

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            pastDeadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "Expired");
    });

    it("should revert when asset is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            ethers.ZeroAddress,
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidAsset");
    });

    it("should revert when owner is address(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            ethers.ZeroAddress,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidOwner");
    });

    it("should revert when r is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            ZERO_BYTES32,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when s is bytes32(0)", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            ZERO_BYTES32,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when v is not 27 or 28", async () => {
      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            29,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSignature");
    });

    it("should revert when controller list is empty", async () => {
      const deadline = await futureDeadline();

      // No controllers added → loop iterates 0 times → InvalidSpender
      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSpender");
    });

    it("should revert when no controller recognizes spender", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      // Don't set any term as deployed

      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWithCustomError(permitFacet, "InvalidSpender");
    });

    it("should succeed when spender found in first controller", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);

      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.not.be.reverted;
    });

    it("should succeed when spender found in second controller", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await permitFacet.addApprovedTermController(
        await mockController2.getAddress(),
      );
      // Only second controller recognizes the spender
      await mockController2.setTermDeployed(wallet3.address, true);

      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.not.be.reverted;
    });

    it("should pass owner and termContractAddress to permit call", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);

      const deadline = await futureDeadline();
      const amount = BigInt(7777);

      await permitFacet
        .connect(wallet1)
        .permitTermContract(
          await mockToken.getAddress(),
          amount,
          wallet2.address,
          wallet3.address,
          deadline,
          VALID_V,
          VALID_R,
          VALID_S,
          false,
        );

      expect(await mockToken.lastPermitOwner()).to.equal(wallet2.address);
      expect(await mockToken.lastPermitSpender()).to.equal(wallet3.address);
      expect(await mockToken.lastPermitAmount()).to.equal(amount);
      expect(await mockToken.lastPermitDeadline()).to.equal(deadline);
      expect(await mockToken.lastPermitV()).to.equal(VALID_V);
      expect(await mockToken.lastPermitR()).to.equal(VALID_R);
      expect(await mockToken.lastPermitS()).to.equal(VALID_S);
    });

    it("should revert when permit call fails and skipRevert is false", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);
      await mockToken.setShouldRevertOnPermit(true);

      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            false,
          ),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit call fails and skipRevert is true", async () => {
      await permitFacet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);
      await mockToken.setShouldRevertOnPermit(true);

      const deadline = await futureDeadline();

      await expect(
        permitFacet
          .connect(wallet1)
          .permitTermContract(
            await mockToken.getAddress(),
            1000,
            wallet2.address,
            wallet3.address,
            deadline,
            VALID_V,
            VALID_R,
            VALID_S,
            true,
          ),
      ).to.not.be.reverted;
    });
  });
});
