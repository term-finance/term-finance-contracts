/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  TestWETHWrappingFacetHelper,
  TestMockWETH,
  TestMockPermit2,
  TestETHRejecter,
} from "../typechain-types";

const PERMIT2_CANONICAL_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

describe("WETHWrappingFacet Tests", () => {
  let facet: TestWETHWrappingFacetHelper;
  let mockWETH: TestMockWETH;
  let mockPermit2: TestMockPermit2;
  let ethRejecter: TestETHRejecter;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let snapshotId: string;

  before(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy mock Permit2 and plant at canonical address
    const MockPermit2Factory =
      await ethers.getContractFactory("TestMockPermit2");
    const tempMockPermit2 = await MockPermit2Factory.deploy();
    await tempMockPermit2.waitForDeployment();
    const runtimeCode = await ethers.provider.getCode(
      await tempMockPermit2.getAddress(),
    );
    await ethers.provider.send("hardhat_setCode", [
      PERMIT2_CANONICAL_ADDRESS,
      runtimeCode,
    ]);
    mockPermit2 = (await ethers.getContractAt(
      "TestMockPermit2",
      PERMIT2_CANONICAL_ADDRESS,
    )) as unknown as TestMockPermit2;

    // Deploy mock WETH
    const MockWETHFactory = await ethers.getContractFactory("TestMockWETH");
    mockWETH = (await MockWETHFactory.deploy()) as unknown as TestMockWETH;
    await mockWETH.waitForDeployment();

    // Deploy facet helper (standalone, not through diamond)
    const FacetFactory = await ethers.getContractFactory(
      "TestWETHWrappingFacetHelper",
    );
    facet =
      (await FacetFactory.deploy()) as unknown as TestWETHWrappingFacetHelper;
    await facet.waitForDeployment();

    // Deploy ETH rejecter
    const RejecterFactory =
      await ethers.getContractFactory("TestETHRejecter");
    ethRejecter =
      (await RejecterFactory.deploy()) as unknown as TestETHRejecter;
    await ethRejecter.waitForDeployment();
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // ===========================================================================
  // wrapETH
  // ===========================================================================
  describe("wrapETH", () => {
    it("should wrap ETH and return WETH to caller", async () => {
      const amount = ethers.parseEther("1");
      const wethAddr = await mockWETH.getAddress();

      await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

      const wethBalance = await mockWETH.balanceOf(wallet1.address);
      expect(wethBalance).to.equal(amount);
    });

    it("should send correct WETH amount equal to msg.value", async () => {
      const amount = ethers.parseEther("2.5");
      const wethAddr = await mockWETH.getAddress();

      const ethBefore = await ethers.provider.getBalance(wallet1.address);
      await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

      const wethBalance = await mockWETH.balanceOf(wallet1.address);
      expect(wethBalance).to.equal(amount);

      const ethAfter = await ethers.provider.getBalance(wallet1.address);
      // ETH decreased by at least `amount` (gas makes it slightly more)
      expect(ethBefore - ethAfter).to.be.gte(amount);
    });

    it("should leave zero WETH balance on the facet after wrapping", async () => {
      const amount = ethers.parseEther("1");
      const wethAddr = await mockWETH.getAddress();
      const facetAddr = await facet.getAddress();

      await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

      const facetWethBalance = await mockWETH.balanceOf(facetAddr);
      expect(facetWethBalance).to.equal(0);
    });

    it("should work with msg.value = 0 (no-op)", async () => {
      const wethAddr = await mockWETH.getAddress();

      await expect(
        facet.connect(wallet1).wrapETH(wethAddr, { value: 0 }),
      ).to.not.be.reverted;

      const wethBalance = await mockWETH.balanceOf(wallet1.address);
      expect(wethBalance).to.equal(0);
    });

    it("should revert when wrappedTokenAddr is not a contract (EOA)", async () => {
      const amount = ethers.parseEther("1");

      await expect(
        facet.connect(wallet1).wrapETH(wallet2.address, { value: amount }),
      ).to.be.reverted;
    });

    it("should revert when wrappedTokenAddr is address(0)", async () => {
      const amount = ethers.parseEther("1");

      await expect(
        facet
          .connect(wallet1)
          .wrapETH(ethers.ZeroAddress, { value: amount }),
      ).to.be.reverted;
    });
  });

  // ===========================================================================
  // unwrapETH — standard ERC20 transfer (usePermit2=false)
  // ===========================================================================
  describe("unwrapETH", () => {
    describe("standard ERC20 transfer (usePermit2=false)", () => {
      it("should unwrap WETH and return ETH to caller", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        // Give wallet1 WETH by wrapping
        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

        // Approve facet to pull WETH
        await mockWETH.connect(wallet1).approve(facetAddr, amount);

        const ethBefore = await ethers.provider.getBalance(wallet1.address);
        await facet
          .connect(wallet1)
          .unwrapETH(amount, wethAddr, false);
        const ethAfter = await ethers.provider.getBalance(wallet1.address);

        // ETH increased (minus gas), WETH decreased
        // We use a rough check because gas cost makes exact match hard
        expect(ethAfter).to.be.gt(ethBefore - ethers.parseEther("0.01"));
        expect(await mockWETH.balanceOf(wallet1.address)).to.equal(0);
      });

      it("should deduct WETH from caller, credit ETH to caller", async () => {
        const amount = ethers.parseEther("3");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH.connect(wallet1).approve(facetAddr, amount);

        const wethBefore = await mockWETH.balanceOf(wallet1.address);
        expect(wethBefore).to.equal(amount);

        const ethBefore = await ethers.provider.getBalance(wallet1.address);
        await facet
          .connect(wallet1)
          .unwrapETH(amount, wethAddr, false);
        const ethAfter = await ethers.provider.getBalance(wallet1.address);

        expect(await mockWETH.balanceOf(wallet1.address)).to.equal(0);
        // ETH gained should be close to `amount` (minus gas)
        const ethGain = ethAfter - ethBefore;
        expect(ethGain).to.be.gt(amount - ethers.parseEther("0.01"));
      });

      it("should leave zero WETH and zero extra ETH on facet", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH.connect(wallet1).approve(facetAddr, amount);

        await facet
          .connect(wallet1)
          .unwrapETH(amount, wethAddr, false);

        expect(await mockWETH.balanceOf(facetAddr)).to.equal(0);
        expect(await ethers.provider.getBalance(facetAddr)).to.equal(0);
      });

      it("should revert when caller has no WETH balance", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        // Approve but have no balance
        await mockWETH.connect(wallet1).approve(facetAddr, amount);

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(amount, wethAddr, false),
        ).to.be.reverted;
      });

      it("should revert when caller has not approved facet", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();

        // Give wallet1 WETH but don't approve
        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(amount, wethAddr, false),
        ).to.be.reverted;
      });

      it("should work with amount = 0 (no-op)", async () => {
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(0, wethAddr, false),
        ).to.not.be.reverted;
      });
    });

    // =========================================================================
    // Permit2 transfer (usePermit2=true)
    // =========================================================================
    describe("Permit2 transfer (usePermit2=true)", () => {
      it("should unwrap WETH via Permit2 and return ETH", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        // Give wallet1 WETH
        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });

        // Approve Permit2 (the mock at canonical address) to pull WETH
        await mockWETH
          .connect(wallet1)
          .approve(PERMIT2_CANONICAL_ADDRESS, amount);

        const ethBefore = await ethers.provider.getBalance(wallet1.address);
        await facet
          .connect(wallet1)
          .unwrapETH(amount, wethAddr, true);
        const ethAfter = await ethers.provider.getBalance(wallet1.address);

        expect(await mockWETH.balanceOf(wallet1.address)).to.equal(0);
        const ethGain = ethAfter - ethBefore;
        expect(ethGain).to.be.gt(amount - ethers.parseEther("0.01"));
      });

      it("should call Permit2.transferFrom with correct args", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH
          .connect(wallet1)
          .approve(PERMIT2_CANONICAL_ADDRESS, amount);

        await facet
          .connect(wallet1)
          .unwrapETH(amount, wethAddr, true);

        expect(await mockPermit2.lastTransferFrom()).to.equal(
          wallet1.address,
        );
        expect(await mockPermit2.lastTransferTo()).to.equal(facetAddr);
        expect(await mockPermit2.lastTransferAmount()).to.equal(amount);
        expect(await mockPermit2.lastTransferToken()).to.equal(wethAddr);
      });

      it("should revert when amount > uint160 max (SafeCast overflow)", async () => {
        const wethAddr = await mockWETH.getAddress();
        // uint160 max = 2^160 - 1; use 2^160
        const overflowAmount = 2n ** 160n;

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(overflowAmount, wethAddr, true),
        ).to.be.revertedWithCustomError(
          { interface: new ethers.Interface(["error SafeCastOverflowedUintDowncast(uint8 bits, uint256 value)"]) },
          "SafeCastOverflowedUintDowncast",
        );
      });

      it("should revert when Permit2 transferFrom fails", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();

        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH
          .connect(wallet1)
          .approve(PERMIT2_CANONICAL_ADDRESS, amount);

        // Make Permit2 revert
        await mockPermit2.setShouldRevertOnTransferFrom(true);

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(amount, wethAddr, true),
        ).to.be.revertedWith("Mock transferFrom failed");
      });
    });

    // =========================================================================
    // ETH transfer failure
    // =========================================================================
    describe("ETH transfer failure", () => {
      it('should revert with "ETH transfer failed" when recipient rejects ETH', async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const rejecterAddr = await ethRejecter.getAddress();
        const facetAddr = await facet.getAddress();

        // Give the ETH rejecter WETH: wallet1 wraps, then transfers WETH to rejecter
        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH.connect(wallet1).transfer(rejecterAddr, amount);

        // The rejecter contract calls unwrapETH — facet sends ETH back to rejecter
        // which has no receive/fallback, so the ETH transfer fails
        await expect(
          ethRejecter.callUnwrapETH(facetAddr, amount, wethAddr, false),
        ).to.be.revertedWith("ETH transfer failed");
      });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================
    describe("edge cases", () => {
      it("should revert when wrappedTokenAddr is invalid (EOA)", async () => {
        const amount = ethers.parseEther("1");

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(amount, wallet2.address, false),
        ).to.be.reverted;
      });

      it("should revert when WETH withdraw fails", async () => {
        const amount = ethers.parseEther("1");
        const wethAddr = await mockWETH.getAddress();
        const facetAddr = await facet.getAddress();

        // Give wallet1 WETH and approve
        await facet.connect(wallet1).wrapETH(wethAddr, { value: amount });
        await mockWETH.connect(wallet1).approve(facetAddr, amount);

        // Make withdraw revert
        await mockWETH.setShouldRevertOnWithdraw(true);

        await expect(
          facet
            .connect(wallet1)
            .unwrapETH(amount, wethAddr, false),
        ).to.be.revertedWith("MockWETH: withdraw reverted");
      });
    });
  });
});
