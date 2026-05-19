/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TestToken } from "../typechain-types";

describe("TermLoanIntentHookFacet Unit Tests", () => {
  let hookFacet: any;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let purchaseToken: TestToken;
  let collateralToken: TestToken;
  let mockController: any;
  let mockServicer: any;        // TestMockRepoServicerFull
  let mockCollateralManager: any; // TestMockCollateralManager

  const CURRENT_TIME = Math.floor(Date.now() / 1000);
  const MATURITY_TIME = CURRENT_TIME + 86400 * 30; // 30 days from now

  // ABI type strings for encoding additionalCalldata
  const RETRIEVE_FUNDS_TYPE = "tuple(bytes4,address,bytes)";
  const LEND_ORDER_TYPE = `tuple(address,uint256,uint256,address,address,uint256,address,uint256,uint256,${RETRIEVE_FUNDS_TYPE})`;
  const SIGNATURE_TYPE = "tuple(uint8,bytes)";

  // Returns a positional array matching LimitLendOrder tuple
  function makeOrder(
    servicerAddr: string,
    overrides: { borrowFee?: bigint; repoServicer?: string } = {}
  ): unknown[] {
    return [
      overrides.repoServicer ?? servicerAddr, // repoServicer
      ethers.parseEther("100"),               // purchaseTokenAmount
      0n,                                     // offerRate
      ethers.ZeroAddress,                     // maker
      ethers.ZeroAddress,                     // taker
      overrides.borrowFee ?? 0n,              // borrowFee
      ethers.ZeroAddress,                     // feeRecipient
      BigInt(CURRENT_TIME + 86400),           // expiry
      1n,                                     // salt
      ["0x00000000", ethers.ZeroAddress, "0x"], // retrieveFunds
    ];
  }

  // Returns a positional array matching Signature tuple
  function makeSignature(): unknown[] {
    return [0, "0x"];
  }

  function encodeAdditionalCalldata(
    usePermit2: boolean,
    orders: unknown[][],
    signatures: unknown[][],
    fillAmounts: bigint[]
  ): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bool", `${LEND_ORDER_TYPE}[]`, `${SIGNATURE_TYPE}[]`, "uint256[]"],
      [usePermit2, orders, signatures, fillAmounts]
    );
  }

  beforeEach(async () => {
    [wallet1, wallet2] = await ethers.getSigners();

    // Deploy the hook facet helper (standalone, not diamond)
    const HookFacetFactory = await ethers.getContractFactory(
      "TestTermLoanIntentHookFacetHelper"
    );
    hookFacet = await HookFacetFactory.deploy();
    await hookFacet.waitForDeployment();

    // Deploy real ERC20 tokens
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    purchaseToken = (await upgrades.deployProxy(TestTokenFactory, [
      "Purchase Token",
      "PT",
      18,
      [wallet1.address],
      [ethers.parseEther("1000")],
    ])) as unknown as TestToken;
    await purchaseToken.waitForDeployment();

    collateralToken = (await upgrades.deployProxy(TestTokenFactory, [
      "Collateral Token",
      "COL",
      18,
      [wallet1.address],
      [ethers.parseEther("1000")],
    ])) as unknown as TestToken;
    await collateralToken.waitForDeployment();

    // Deploy concrete mock controller
    mockController = await (
      await ethers.getContractFactory("TestMockTermController")
    ).deploy();
    await mockController.waitForDeployment();

    // Deploy concrete mock collateral manager and servicer
    mockCollateralManager = await (
      await ethers.getContractFactory("TestMockCollateralManager")
    ).deploy();
    await mockCollateralManager.waitForDeployment();

    mockServicer = await (
      await ethers.getContractFactory("TestMockRepoServicerFull")
    ).deploy();
    await mockServicer.waitForDeployment();

    // Wire up the servicer
    await mockServicer.setPurchaseToken(await purchaseToken.getAddress());
    await mockServicer.setTermController(await mockController.getAddress());
    await mockServicer.setCollateralManager(
      await mockCollateralManager.getAddress()
    );
    await mockServicer.setMaturityTimestamp(MATURITY_TIME);

    // Wire up the collateral manager — one accepted collateral token
    await mockCollateralManager.setCollateralTokens([
      await collateralToken.getAddress(),
    ]);

    // Register servicer and approve controller in diamond storage
    await mockController.setTermDeployed(
      await mockServicer.getAddress(),
      true
    );
    await hookFacet.addApprovedTermController(await mockController.getAddress());

    // Install a no-op Permit2 stub so Permit2Lib.PERMIT2.transferFrom() doesn't revert
    await ethers.provider.send("hardhat_setCode", [
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "0x60006000f3",
    ]);
  });

  // ============================================================
  // previewSettleLimitLend
  // ============================================================
  describe("previewSettleLimitLend", () => {
    it("reverts EmptyOrderBatch when orders array is empty", async () => {
      const calldata = encodeAdditionalCalldata(false, [], [], []);
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.previewSettleLimitLend(input)
      ).to.be.revertedWithCustomError(hookFacet, "EmptyOrderBatch");
    });

    it("reverts InputOutputTokenCollision when purchase token equals collateral token", async () => {
      // Make collateral manager report purchaseToken as a valid collateral token
      await mockCollateralManager.setCollateralTokens([
        await purchaseToken.getAddress(),
      ]);
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await purchaseToken.getAddress(), // Use purchaseToken as both input and output to trigger collision
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.previewSettleLimitLend(input)
      ).to.be.revertedWithCustomError(hookFacet, "InputOutputTokenCollision");
    });

    it("returns correct PreviewAction on success", async () => {
      const maxInput = ethers.parseEther("1");
      const minOutput = ethers.parseEther("50");
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: maxInput,
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: minOutput,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      const result = await hookFacet.previewSettleLimitLend(input);
      expect(result.expectedInputToken).to.equal(
        await collateralToken.getAddress()
      );
      expect(result.expectedInputAmount).to.equal(maxInput);
      expect(result.expectedOutputToken).to.equal(
        await purchaseToken.getAddress()
      );
      expect(result.expectedOutputAmount).to.equal(minOutput);
      expect(result.isDeterministic).to.be.true;
    });
  });

  // ============================================================
  // generateActionCalldata
  // ============================================================
  describe("generateActionCalldata", () => {
    it("reverts UnsupportedHookSelector for unknown selector", async () => {
      await expect(
        hookFacet.generateActionCalldata(
          wallet1.address,
          await collateralToken.getAddress(),
          ethers.parseEther("1"),
          await purchaseToken.getAddress(),
          0n,
          "0x12345678",
          await mockServicer.getAddress(),
          "0x"
        )
      ).to.be.revertedWithCustomError(hookFacet, "UnsupportedHookSelector");
    });

    it("succeeds with settleLimitLendHook selector", async () => {
      const hookSelector =
        hookFacet.interface.getFunction("settleLimitLendHook").selector;
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );

      const [previewAction, encodedCalldata] =
        await hookFacet.generateActionCalldata(
          wallet1.address,
          await collateralToken.getAddress(),
          ethers.parseEther("1"),
          await purchaseToken.getAddress(),
          0n,
          hookSelector,
          await mockServicer.getAddress(),
          calldata
        );

      expect(previewAction.isDeterministic).to.be.true;
      expect(previewAction.expectedOutputToken).to.equal(
        await purchaseToken.getAddress()
      );
      expect(encodedCalldata.slice(0, 10)).to.equal(hookSelector);
    });

    it("propagates EmptyOrderBatch error", async () => {
      const hookSelector =
        hookFacet.interface.getFunction("settleLimitLendHook").selector;
      const calldata = encodeAdditionalCalldata(false, [], [], []);

      await expect(
        hookFacet.generateActionCalldata(
          wallet1.address,
          await collateralToken.getAddress(),
          ethers.parseEther("1"),
          await purchaseToken.getAddress(),
          0n,
          hookSelector,
          await mockServicer.getAddress(),
          calldata
        )
      ).to.be.revertedWithCustomError(hookFacet, "EmptyOrderBatch");
    });
  });

  // ============================================================
  // settleLimitLendHook
  // ============================================================
  describe("settleLimitLendHook", () => {
    it("reverts when no flash loan context is set", async () => {
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("reverts when active flash loan borrower does not match user", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet2.address);
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address, // wallet1 != wallet2
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("reverts EmptyOrderBatch when orders array is empty", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const calldata = encodeAdditionalCalldata(false, [], [], []);
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "EmptyOrderBatch");
    });

    it("reverts OrderBatchLengthMismatch when signatures array is too short", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const order = makeOrder(await mockServicer.getAddress());
      // 1 order, 0 signatures
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "OrderBatchLengthMismatch");
    });

    it("reverts OrderBatchLengthMismatch when fillAmounts array is too short", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const order = makeOrder(await mockServicer.getAddress());
      // 1 order, 1 signature, 0 fillAmounts
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        []
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "OrderBatchLengthMismatch");
    });

    it("reverts InvalidTermController when controller is not approved", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      // Point servicer at a fresh unapproved controller
      const unapprovedController = await (
        await ethers.getContractFactory("TestMockTermController")
      ).deploy();
      await unapprovedController.waitForDeployment();
      await mockServicer.setTermController(
        await unapprovedController.getAddress()
      );

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "InvalidTermController");
    });

    it("reverts InvalidRepoId when servicer is not deployed in controller", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      await mockController.setTermDeployed(
        await mockServicer.getAddress(),
        false
      );

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "InvalidRepoId");
    });

    it("reverts AfterMaturity when maturity timestamp is in the past", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      await mockServicer.setMaturityTimestamp(CURRENT_TIME - 86400);

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "AfterMaturity");
    });

    it("reverts InconsistentRepoServicer when second order has a different servicer", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);

      // Deploy a second servicer for this test
      const mockServicer2 = await (
        await ethers.getContractFactory("TestMockRepoServicerFull")
      ).deploy();
      await mockServicer2.waitForDeployment();
      await mockServicer2.setPurchaseToken(await purchaseToken.getAddress());
      await mockServicer2.setTermController(await mockController.getAddress());
      await mockServicer2.setCollateralManager(await mockCollateralManager.getAddress());
      await mockServicer2.setMaturityTimestamp(MATURITY_TIME);
      await mockController.setTermDeployed(await mockServicer2.getAddress(), true);

      const order1 = makeOrder(await mockServicer.getAddress());
      const order2 = makeOrder(await mockServicer2.getAddress()); // different servicer
      const calldata = encodeAdditionalCalldata(
        false,
        [order1, order2],
        [makeSignature(), makeSignature()],
        [ethers.parseEther("50"), ethers.parseEther("50")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "InconsistentRepoServicer");
    });

    it("reverts InvalidFillAmount when a fill amount is zero", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [0n]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "InvalidFillAmount");
    });

    it("reverts BatchOrderInsufficientRemainingCapacity when fillAmount exceeds capacity", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const order = makeOrder(await mockServicer.getAddress());
      const totalAmount = ethers.parseEther("100");
      const excessAmount = totalAmount + ethers.parseEther("1");
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [excessAmount] // Exceeds purchaseTokenAmount
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "BatchOrderInsufficientRemainingCapacity");
    });

    it("reverts BorrowFeeTooHigh when fee exceeds expScale", async () => {
      // feeFactor = borrowFee * timeRemaining / 360days
      // With 30 days remaining: borrowFee must be >= 12e18 to trigger BorrowFeeTooHigh
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      const order = makeOrder(await mockServicer.getAddress(), {
        borrowFee: ethers.parseEther("13"),
      });
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "BorrowFeeTooHigh");
    });

    it("reverts InvalidCollateralToken when input token is not in collateral manager", async () => {
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      // Replace accepted collateral with a different address
      await mockCollateralManager.setCollateralTokens([wallet2.address]);

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [ethers.parseEther("100")]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(), // not wallet2
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.be.revertedWithCustomError(hookFacet, "InvalidCollateralToken");
    });

    it("succeeds with 1 order, borrowFee=0, usePermit2=false", async () => {
      const fillAmount = ethers.parseEther("100");
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      await purchaseToken
        .connect(wallet1)
        .approve(await hookFacet.getAddress(), fillAmount);

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order],
        [makeSignature()],
        [fillAmount]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.not.be.reverted;
    });

    it("succeeds with 2 orders, allocating collateral proportionally", async () => {
      const fillAmount1 = ethers.parseEther("60");
      const fillAmount2 = ethers.parseEther("40");
      const totalFill = fillAmount1 + fillAmount2;
      const maxInputAmount = ethers.parseEther("1");
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);
      await purchaseToken
        .connect(wallet1)
        .approve(await hookFacet.getAddress(), totalFill);

      const order1 = makeOrder(await mockServicer.getAddress());
      const order2 = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        false,
        [order1, order2],
        [makeSignature(), makeSignature()],
        [fillAmount1, fillAmount2]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount,
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.not.be.reverted;

      // Verify proportional collateral allocation:
      // order 0 (non-last): collateral = maxInput * fillAmount1 / totalFill
      // order 1 (last):     collateral = maxInput - allocatedSoFar  (absorbs rounding dust)
      const expectedCollateral0 = (maxInputAmount * fillAmount1) / totalFill;
      const expectedCollateral1 = maxInputAmount - expectedCollateral0;

      const recorded0 = await hookFacet.getRecordedCollateralAmounts(0);
      const recorded1 = await hookFacet.getRecordedCollateralAmounts(1);
      // Index 0 in each collateralAmounts array corresponds to the single accepted token
      expect(recorded0[0]).to.equal(expectedCollateral0);
      expect(recorded1[0]).to.equal(expectedCollateral1);
    });

    it("succeeds with usePermit2=true (no-op Permit2 stub)", async () => {
      const fillAmount = ethers.parseEther("100");
      await hookFacet.setActiveFlashLoanBorrower(wallet1.address);

      const order = makeOrder(await mockServicer.getAddress());
      const calldata = encodeAdditionalCalldata(
        true,
        [order],
        [makeSignature()],
        [fillAmount]
      );
      const input = {
        user: wallet1.address,
        inputToken: await collateralToken.getAddress(),
        maxInputAmount: ethers.parseEther("1"),
        outputToken: await purchaseToken.getAddress(),
        minOutputAmount: 0n,
        targetAddress: await mockServicer.getAddress(),
        additionalCalldata: calldata,
      };
      await expect(
        hookFacet.connect(wallet1).settleLimitLendHook(input)
      ).to.not.be.reverted;
    });
  });
});
