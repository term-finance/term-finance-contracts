/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  TestPermit2FacetHelper,
  TestMockPermit2,
  TestMockTermController,
  TestToken,
} from "../typechain-types";

const PERMIT2_CANONICAL_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

interface PermitSingle {
  details: {
    token: string;
    amount: bigint;
    expiration: number;
    nonce: number;
  };
  spender: string;
  sigDeadline: bigint;
}

function buildPermitSingle(
  token: string,
  amount: bigint,
  expiration: number,
  nonce: number,
  spender: string,
  sigDeadline: bigint,
): PermitSingle {
  return {
    details: {
      token,
      amount,
      expiration,
      nonce,
    },
    spender,
    sigDeadline,
  };
}

describe("Permit2Facet Tests", () => {
  let permit2Facet: TestPermit2FacetHelper;
  let mockPermit2: TestMockPermit2;
  let mockController: TestMockTermController;
  let mockController2: TestMockTermController;
  let asset: TestToken;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let snapshotId: string;

  before(async () => {
    // Deploy a temporary TestMockPermit2 to get its runtime bytecode
    const MockPermit2Factory =
      await ethers.getContractFactory("TestMockPermit2");
    const tempMockPermit2 = await MockPermit2Factory.deploy();
    await tempMockPermit2.waitForDeployment();
    const runtimeCode = await ethers.provider.getCode(
      await tempMockPermit2.getAddress(),
    );

    // Plant mock bytecode at the canonical Permit2 address
    await ethers.provider.send("hardhat_setCode", [
      PERMIT2_CANONICAL_ADDRESS,
      runtimeCode,
    ]);

    // Get a contract handle at the canonical address
    mockPermit2 = (await ethers.getContractAt(
      "TestMockPermit2",
      PERMIT2_CANONICAL_ADDRESS,
    )) as unknown as TestMockPermit2;
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);

    [wallet1, wallet2, wallet3] = await ethers.getSigners();

    // Deploy TestPermit2FacetHelper
    const Permit2FacetFactory = await ethers.getContractFactory(
      "TestPermit2FacetHelper",
    );
    permit2Facet =
      (await Permit2FacetFactory.deploy()) as unknown as TestPermit2FacetHelper;
    await permit2Facet.waitForDeployment();

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
    await permit2Facet.setMulticallInitiator(wallet1.address);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // =========================================================================
  // approve2
  // =========================================================================
  describe("approve2", () => {
    it("should revert when multicall initiator is unset", async () => {
      await permit2Facet.clearMulticallInitiator();

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false),
      ).to.be.revertedWith("uninitialized");
    });

    it("should revert when caller is not multicall initiator", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet.connect(wallet2).approve2(permitSingle, "0x", false),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when expiration is less than block.timestamp", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp - 1, // expired
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false),
      ).to.be.revertedWithCustomError(permit2Facet, "Expired");
    });

    it("should revert when expiration equals block.timestamp (boundary)", async () => {
      // Mine a block to get a known timestamp, then use that exact timestamp as expiration
      const block = await ethers.provider.getBlock("latest");
      // The next transaction will execute at block.timestamp + 1 (or same), so use current timestamp
      // which will be <= the next block's timestamp
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 1, // will equal block.timestamp of the tx
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      // Advance time so block.timestamp matches expiration
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        block!.timestamp + 1,
      ]);

      await expect(
        permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false),
      ).to.be.revertedWithCustomError(permit2Facet, "Expired");
    });

    it("should pass initiator() as owner to Permit2", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false);

      expect(await mockPermit2.lastPermitOwner()).to.equal(wallet1.address);
    });

    it("should forward correct args to Permit2", async () => {
      const block = await ethers.provider.getBlock("latest");
      const tokenAddr = await asset.getAddress();
      const amount = BigInt(5000);
      const permitSingle = buildPermitSingle(
        tokenAddr,
        amount,
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false);

      expect(await mockPermit2.lastPermitToken()).to.equal(tokenAddr);
      expect(await mockPermit2.lastPermitAmount()).to.equal(amount);
      expect(await mockPermit2.lastPermitSpender()).to.equal(wallet2.address);
    });

    it("should revert when permit fails and skipRevert is false", async () => {
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet.connect(wallet1).approve2(permitSingle, "0x", false),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit fails and skipRevert is true", async () => {
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet.connect(wallet1).approve2(permitSingle, "0x", true),
      ).to.not.be.reverted;
    });
  });

  // =========================================================================
  // approve2Diamond
  // =========================================================================
  describe("approve2Diamond", () => {
    it("should revert when caller is not multicall initiator", async () => {
      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet2)
          .approve2Diamond(permitSingle, wallet2.address, "0x", false),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when expiration is expired", async () => {
      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp - 1,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2Diamond(permitSingle, wallet2.address, "0x", false),
      ).to.be.revertedWithCustomError(permit2Facet, "Expired");
    });

    it("should revert when spender is not address(this)", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet2.address, // not address(this)
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2Diamond(permitSingle, wallet2.address, "0x", false),
      ).to.be.revertedWithCustomError(permit2Facet, "InvalidSpender");
    });

    it("should succeed when spender is address(this)", async () => {
      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2Diamond(permitSingle, wallet2.address, "0x", false),
      ).to.not.be.reverted;
    });

    it("should use explicit owner param, not initiator()", async () => {
      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      // wallet1 is the initiator, but wallet2 is the owner param
      await permit2Facet
        .connect(wallet1)
        .approve2Diamond(permitSingle, wallet2.address, "0x", false);

      expect(await mockPermit2.lastPermitOwner()).to.equal(wallet2.address);
    });

    it("should revert when permit fails and skipRevert is false", async () => {
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2Diamond(permitSingle, wallet2.address, "0x", false),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit fails and skipRevert is true", async () => {
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const facetAddr = await permit2Facet.getAddress();
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        facetAddr,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2Diamond(permitSingle, wallet2.address, "0x", true),
      ).to.not.be.reverted;
    });
  });

  // =========================================================================
  // approve2TermContract
  // =========================================================================
  describe("approve2TermContract", () => {
    it("should revert when caller is not multicall initiator", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet2)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when expiration is expired", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp - 1,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.be.revertedWithCustomError(permit2Facet, "Expired");
    });

    it("should revert when owner is address(0)", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            ethers.ZeroAddress,
            "0x",
            false,
          ),
      ).to.be.revertedWithCustomError(permit2Facet, "InvalidOwner");
    });

    it("should revert when controller list is empty", async () => {
      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      // No controllers added
      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.be.revertedWithCustomError(permit2Facet, "InvalidSpender");
    });

    it("should revert when no controller recognizes spender", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      // Don't set wallet3 as deployed term

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.be.revertedWithCustomError(permit2Facet, "InvalidSpender");
    });

    it("should succeed when spender found in first controller", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.not.be.reverted;
    });

    it("should succeed when spender found in second controller", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await permit2Facet.addApprovedTermController(
        await mockController2.getAddress(),
      );
      // Only second controller recognizes the spender
      await mockController2.setTermDeployed(wallet3.address, true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.not.be.reverted;
    });

    it("should succeed when only the last of multiple controllers recognizes spender", async () => {
      // Deploy a third controller
      const MockControllerFactory =
        await ethers.getContractFactory("TestMockTermController");
      const mockController3 =
        (await MockControllerFactory.deploy()) as unknown as TestMockTermController;
      await mockController3.waitForDeployment();

      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await permit2Facet.addApprovedTermController(
        await mockController2.getAddress(),
      );
      await permit2Facet.addApprovedTermController(
        await mockController3.getAddress(),
      );
      // Only third controller recognizes the spender
      await mockController3.setTermDeployed(wallet3.address, true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.not.be.reverted;
    });

    it("should pass owner to Permit2 when spender is valid", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await permit2Facet
        .connect(wallet1)
        .approve2TermContract(
          permitSingle,
          wallet2.address,
          "0x",
          false,
        );

      expect(await mockPermit2.lastPermitOwner()).to.equal(wallet2.address);
    });

    it("should revert when permit fails and skipRevert is false", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            false,
          ),
      ).to.be.revertedWith("Mock permit failed");
    });

    it("should not revert when permit fails and skipRevert is true", async () => {
      await permit2Facet.addApprovedTermController(
        await mockController.getAddress(),
      );
      await mockController.setTermDeployed(wallet3.address, true);
      await mockPermit2.setShouldRevertOnPermit(true);

      const block = await ethers.provider.getBlock("latest");
      const permitSingle = buildPermitSingle(
        await asset.getAddress(),
        BigInt(1000),
        block!.timestamp + 3600,
        0,
        wallet3.address,
        BigInt(block!.timestamp + 3600),
      );

      await expect(
        permit2Facet
          .connect(wallet1)
          .approve2TermContract(
            permitSingle,
            wallet2.address,
            "0x",
            true,
          ),
      ).to.not.be.reverted;
    });
  });

  // =========================================================================
  // transferFrom2
  // =========================================================================
  describe("transferFrom2", () => {
    it("should revert when multicall initiator is unset", async () => {
      await permit2Facet.clearMulticallInitiator();

      await expect(
        permit2Facet
          .connect(wallet1)
          .transferFrom2(await asset.getAddress(), ethers.parseEther("100")),
      ).to.be.revertedWith("uninitialized");
    });

    it("should revert when caller is not multicall initiator", async () => {
      await expect(
        permit2Facet
          .connect(wallet2)
          .transferFrom2(await asset.getAddress(), ethers.parseEther("100")),
      ).to.be.revertedWith("unauthorized");
    });

    it("should revert when amount is zero", async () => {
      await expect(
        permit2Facet
          .connect(wallet1)
          .transferFrom2(await asset.getAddress(), 0),
      ).to.be.revertedWithCustomError(permit2Facet, "ZeroAmount");
    });

    it("should transfer tokens successfully", async () => {
      const amount = ethers.parseEther("100");
      const facetAddr = await permit2Facet.getAddress();

      // Approve Permit2 canonical address to spend wallet1's tokens
      await asset
        .connect(wallet1)
        .approve(PERMIT2_CANONICAL_ADDRESS, amount);

      const balanceBefore = await asset.balanceOf(wallet1.address);
      const facetBalanceBefore = await asset.balanceOf(facetAddr);

      await permit2Facet
        .connect(wallet1)
        .transferFrom2(await asset.getAddress(), amount);

      const balanceAfter = await asset.balanceOf(wallet1.address);
      const facetBalanceAfter = await asset.balanceOf(facetAddr);

      expect(balanceBefore - balanceAfter).to.equal(amount);
      expect(facetBalanceAfter - facetBalanceBefore).to.equal(amount);
    });

    it("should pass correct args to Permit2 transferFrom", async () => {
      const amount = ethers.parseEther("50");
      const tokenAddr = await asset.getAddress();
      const facetAddr = await permit2Facet.getAddress();

      await asset
        .connect(wallet1)
        .approve(PERMIT2_CANONICAL_ADDRESS, amount);

      await permit2Facet
        .connect(wallet1)
        .transferFrom2(tokenAddr, amount);

      expect(await mockPermit2.lastTransferFrom()).to.equal(wallet1.address);
      expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
      expect(await mockPermit2.lastTransferAmount()).to.equal(amount);
      expect(await mockPermit2.lastTransferToken()).to.equal(tokenAddr);
    });

    it("should revert when Permit2 transferFrom fails due to insufficient approval", async () => {
      const amount = ethers.parseEther("100");

      // Don't approve Permit2 → the mock's IERC20.transferFrom will fail
      await expect(
        permit2Facet
          .connect(wallet1)
          .transferFrom2(await asset.getAddress(), amount),
      ).to.be.reverted;
    });

    it("should revert when wallet has insufficient balance", async () => {
      const tooMuch = ethers.parseEther("20000"); // wallet1 only has 10000

      await asset
        .connect(wallet1)
        .approve(PERMIT2_CANONICAL_ADDRESS, tooMuch);

      await expect(
        permit2Facet
          .connect(wallet1)
          .transferFrom2(await asset.getAddress(), tooMuch),
      ).to.be.reverted;
    });

    it("should revert when amount exceeds uint160 max", async () => {
      // uint160 max is 2^160 - 1, so use 2^160
      const overflowAmount = BigInt(2) ** BigInt(160);

      await expect(
        permit2Facet
          .connect(wallet1)
          .transferFrom2(await asset.getAddress(), overflowAmount),
      ).to.be.revertedWithCustomError(
        permit2Facet,
        "SafeCastOverflowedUintDowncast",
      );
    });
  });
});
