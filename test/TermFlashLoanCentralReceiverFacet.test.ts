import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { TestTermFlashLoanCentralReceiverFacetHelper } from "../typechain-types";

describe("TermFlashLoanCentralReceiverFacet Tests", () => {
  let helper: TestTermFlashLoanCentralReceiverFacetHelper;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let helperAddress: string;
  let mockCallbackSelector: string;

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    const HelperFactory = await ethers.getContractFactory(
      "TestTermFlashLoanCentralReceiverFacetHelper"
    );
    helper = (await HelperFactory.deploy(
      wallet1.address
    )) as TestTermFlashLoanCentralReceiverFacetHelper;
    await helper.waitForDeployment();

    helperAddress = await helper.getAddress();
    mockCallbackSelector = await helper.getMockCallbackSelector();
  });

  function encodeOperationData(
    callbackFacet: string,
    selector: string,
    extraData = "0x"
  ): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address callbackFacet, bytes4 selector)", "bytes"],
      [{ callbackFacet, selector }, extraData]
    );
  }

  describe("validateCallback modifier", () => {
    it("should revert with InvalidCaller when msg.sender is not the aggregator", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet2).executeOperation(
          [wallet2.address],
          [1000],
          [10],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "InvalidCaller");
    });

    it("should revert with InvalidInitiator when initiator is not address(this)", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [10],
          wallet2.address, // wrong initiator
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "InvalidInitiator");
    });
  });

  describe("executeOperation — array validation", () => {
    it("should revert with ArrayLengthMismatch when assets.length != amounts.length", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [],
          [],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "ArrayLengthMismatch");
    });

    it("should revert with ArrayLengthMismatch when amounts.length != premiums.length", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "ArrayLengthMismatch");
    });
  });

  describe("executeOperation — per-asset validation", () => {
    it("should revert with InvalidAssetAddress when an asset is the zero address", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [ethers.ZeroAddress],
          [1000],
          [10],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "InvalidAssetAddress");
    });

    it("should revert with ZeroAmount when an amount is 0", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [0],
          [0],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "ZeroAmount");
    });

    it("should revert with ExcessivePremium when premium exceeds 10% of amount", async () => {
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      // 101 > 1000 * 1000 / 10000 = 100
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [101],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "ExcessivePremium");
    });

    it("should not revert ExcessivePremium at the exact 10% boundary", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      // 100 == 1000 * 1000 / 10000 = 100 — exactly at boundary, condition is strictly greater-than
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [100],
          helperAddress,
          operationData
        )
      ).to.not.be.reverted;
    });
  });

  describe("executeOperation — calldata size and diamond loupe checks", () => {
    it("should revert with CalldataTooLarge when data exceeds 32768 bytes", async () => {
      const largeInnerData = "0x" + "ff".repeat(32769);
      const operationData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address callbackFacet, bytes4 selector)", "bytes"],
        [{ callbackFacet: helperAddress, selector: mockCallbackSelector }, largeInnerData]
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [10],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "CalldataTooLarge");
    });

    it("should revert with SelectorNotFound when no facet is mapped for the selector", async () => {
      // No setFacetAddress call — facetAddress returns address(0)
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [10],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "SelectorNotFound");
    });

    it("should revert with CallbackFacetSelectorMismatch when callbackFacet does not match mapped facet", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      // callbackFacet = wallet2.address but facetAddress returns helperAddress
      const operationData = encodeOperationData(
        wallet2.address,
        mockCallbackSelector
      );
      await expect(
        helper.connect(wallet1).executeOperation(
          [wallet2.address],
          [1000],
          [10],
          helperAddress,
          operationData
        )
      ).to.be.revertedWithCustomError(helper, "CallbackFacetSelectorMismatch");
    });
  });

  describe("executeOperation — success paths", () => {
    it("should return true when all validations pass and delegatecall succeeds", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      const result = await helper
        .connect(wallet1)
        .executeOperation.staticCall(
          [wallet2.address],
          [1000],
          [10],
          helperAddress,
          operationData
        );
      expect(result).to.be.true;
    });

    it("should invoke the callback via delegatecall and set mockCallbackCalled", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      await helper.connect(wallet1).executeOperation(
        [wallet2.address],
        [1000],
        [10],
        helperAddress,
        operationData
      );
      expect(await helper.mockCallbackCalled()).to.be.true;
    });

    it("should succeed with multiple assets covering full loop iterations", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      const result = await helper
        .connect(wallet1)
        .executeOperation.staticCall(
          [wallet2.address, wallet1.address],
          [1000, 2000],
          [10, 20],
          helperAddress,
          operationData
        );
      expect(result).to.be.true;
    });

    it("should succeed with an empty assets array (loop not entered)", async () => {
      await helper.setFacetAddress(mockCallbackSelector as `0x${string}`, helperAddress);
      const operationData = encodeOperationData(
        helperAddress,
        mockCallbackSelector
      );
      const result = await helper
        .connect(wallet1)
        .executeOperation.staticCall([], [], [], helperAddress, operationData);
      expect(result).to.be.true;
    });
  });

  describe("Constants", () => {
    it("should expose MAX_OPERATION_DATA = 32768", async () => {
      expect(await helper.MAX_OPERATION_DATA()).to.equal(32768n);
    });

    it("should expose MAX_PREMIUM_PERCENTAGE = 1000", async () => {
      expect(await helper.MAX_PREMIUM_PERCENTAGE()).to.equal(1000n);
    });
  });
});
