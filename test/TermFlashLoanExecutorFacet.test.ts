import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  TestTermFlashLoanExecutorFacetHelper,
  TestMockFlashLoanAggregator,
  TestMockRepoTokenFull,
} from "../typechain-types";

// ============================================================
// Shared ABI helpers
// ============================================================

const AbiCoder = ethers.AbiCoder.defaultAbiCoder();

const ACTION_TUPLE =
  "(address inputToken,uint256 maxInputAmount,address outputToken,uint256 minOutputAmount,uint256 outputTokenAmountIn,bool usePermit2ForOutputTokenIn,bytes4 method,address targetAddress,bytes additionalCalldata)";

const PLAN_TUPLE = `(address user,address flashLoanToken,uint256 flashLoanAmount,${ACTION_TUPLE}[] actions,bool backPropagate)`;

function actionToArray(a: {
  inputToken: string;
  maxInputAmount: bigint | number;
  outputToken: string;
  minOutputAmount: bigint | number;
  outputTokenAmountIn: bigint | number;
  usePermit2ForOutputTokenIn: boolean;
  method: string;
  targetAddress: string;
  additionalCalldata: string;
}) {
  return [
    a.inputToken,
    a.maxInputAmount,
    a.outputToken,
    a.minOutputAmount,
    a.outputTokenAmountIn,
    a.usePermit2ForOutputTokenIn,
    a.method,
    a.targetAddress,
    a.additionalCalldata,
  ];
}

function buildCallbackData(
  helperAddr: string,
  plan: {
    user: string;
    flashLoanToken: string;
    flashLoanAmount: bigint | number;
    actions: ReturnType<typeof makeAction>[];
    backPropagate: boolean;
  }
): string {
  // flashExecuteCallback selector
  const callbackSel = "0x" +
    Buffer.from(
      ethers.id("flashExecuteCallback(address[],uint256[],uint256[],address,bytes)").slice(2, 10),
      "hex"
    ).toString("hex");

  const planEncoded = AbiCoder.encode(
    [PLAN_TUPLE],
    [
      [
        plan.user,
        plan.flashLoanToken,
        plan.flashLoanAmount,
        plan.actions.map(actionToArray),
        plan.backPropagate,
      ],
    ]
  );
  return AbiCoder.encode(
    ["tuple(address callbackFacet, bytes4 selector)", "bytes"],
    [{ callbackFacet: helperAddr, selector: callbackSel }, planEncoded]
  );
}

function makeAction(overrides: Partial<{
  inputToken: string;
  maxInputAmount: bigint | number;
  outputToken: string;
  minOutputAmount: bigint | number;
  outputTokenAmountIn: bigint | number;
  usePermit2ForOutputTokenIn: boolean;
  method: string;
  targetAddress: string;
  additionalCalldata: string;
}> = {}) {
  return {
    inputToken: overrides.inputToken ?? ethers.ZeroAddress,
    maxInputAmount: overrides.maxInputAmount ?? 0n,
    outputToken: overrides.outputToken ?? ethers.ZeroAddress,
    minOutputAmount: overrides.minOutputAmount ?? 0n,
    outputTokenAmountIn: overrides.outputTokenAmountIn ?? 0n,
    usePermit2ForOutputTokenIn: overrides.usePermit2ForOutputTokenIn ?? false,
    method: overrides.method ?? "0x00000000",
    targetAddress: overrides.targetAddress ?? ethers.ZeroAddress,
    additionalCalldata: overrides.additionalCalldata ?? "0x",
  };
}

function makePreview(overrides: Partial<{
  expectedInputToken: string;
  expectedInputAmount: bigint | number;
  expectedOutputToken: string;
  expectedOutputAmount: bigint | number;
  isDeterministic: boolean;
}> = {}) {
  return {
    expectedInputToken: overrides.expectedInputToken ?? ethers.ZeroAddress,
    expectedInputAmount: overrides.expectedInputAmount ?? 0n,
    expectedOutputToken: overrides.expectedOutputToken ?? ethers.ZeroAddress,
    expectedOutputAmount: overrides.expectedOutputAmount ?? 0n,
    isDeterministic: overrides.isDeterministic ?? false,
  };
}

// ============================================================
// Test Suite
// ============================================================

describe("TermFlashLoanExecutorFacet Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;

  before(async () => {
    [wallet1, wallet2, wallet3] = await ethers.getSigners();
  });

  // ============================================================
  // describe: flashExecute
  // ============================================================

  describe("flashExecute", () => {
    let helper: TestTermFlashLoanExecutorFacetHelper;
    let mockAgg: TestMockFlashLoanAggregator;
    let tokenA: TestMockRepoTokenFull;
    let tokenB: TestMockRepoTokenFull;
    let helperAddr: string;
    let METHOD_1: string;

    beforeEach(async () => {
      const AggFactory = await ethers.getContractFactory(
        "TestMockFlashLoanAggregator"
      );
      mockAgg = (await AggFactory.deploy()) as TestMockFlashLoanAggregator;
      await mockAgg.waitForDeployment();

      const HelperFactory = await ethers.getContractFactory(
        "TestTermFlashLoanExecutorFacetHelper"
      );
      helper = (await HelperFactory.deploy(
        await mockAgg.getAddress()
      )) as TestTermFlashLoanExecutorFacetHelper;
      await helper.waitForDeployment();
      helperAddr = await helper.getAddress();

      const TokenFactory = await ethers.getContractFactory(
        "TestMockRepoTokenFull"
      );
      tokenA = (await TokenFactory.deploy("TokenA", "TKA", 0)) as TestMockRepoTokenFull;
      tokenB = (await TokenFactory.deploy("TokenB", "TKB", 0)) as TestMockRepoTokenFull;
      await tokenA.waitForDeployment();
      await tokenB.waitForDeployment();

      // METHOD_1 = mockSwap selector
      METHOD_1 = helper.interface.getFunction("mockSwap").selector;

      // Register facet address for METHOD_1
      await helper.setFacetAddress(METHOD_1 as `0x${string}`, helperAddr);
    });

    it("1. should revert with EmptyActions when actions array is empty", async () => {
      const req = {
        flashLoanRoute: 1n,
        flashLoanInstaData: "0x",
        flashLoanToken: await tokenA.getAddress(),
        actions: [],
        backPropagate: false,
      };
      await expect(
        helper.connect(wallet1).flashExecute(req)
      ).to.be.revertedWithCustomError(helper, "EmptyActions");
    });

    it("2. should revert with SelectorNotFound when facetAddress returns zero", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Don't register facetAddress for METHOD_1 - create fresh helper without registration
      const HelperFactory = await ethers.getContractFactory(
        "TestTermFlashLoanExecutorFacetHelper"
      );
      const helper2 = (await HelperFactory.deploy(
        await mockAgg.getAddress()
      )) as TestTermFlashLoanExecutorFacetHelper;
      await helper2.waitForDeployment();
      const h2Addr = await helper2.getAddress();

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper2.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper2.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const action = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
        targetAddress: h2Addr,
      });

      const req = {
        flashLoanRoute: 1n,
        flashLoanInstaData: "0x",
        flashLoanToken: tokenAAddr,
        actions: [action],
        backPropagate: false,
      };

      await expect(
        helper2.connect(wallet1).flashExecute(req)
      ).to.be.revertedWithCustomError(helper2, "SelectorNotFound");
    });

    it("3. should revert with InvalidInputToken(0) when preview input token mismatches flashLoanToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Preview returns tokenB as input, but flashLoanToken = tokenA
      const preview = makePreview({
        expectedInputToken: tokenBAddr, // mismatch
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const action = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
        targetAddress: helperAddr,
      });

      const req = {
        flashLoanRoute: 1n,
        flashLoanInstaData: "0x",
        flashLoanToken: tokenAAddr, // flash loan is tokenA
        actions: [action],
        backPropagate: false,
      };

      await expect(
        helper.connect(wallet1).flashExecute(req)
      ).to.be.revertedWithCustomError(helper, "InvalidInputToken");
    });

    it("4. should revert with FinalOutputTokenMismatch when last action output token mismatches flashLoanToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      // Last action outputs tokenB, but flashLoanToken = tokenA
      const action = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr, // mismatch: should match flashLoanToken
        minOutputAmount: 0n,
        method: METHOD_1,
        targetAddress: helperAddr,
      });

      const req = {
        flashLoanRoute: 1n,
        flashLoanInstaData: "0x",
        flashLoanToken: tokenAAddr,
        actions: [action],
        backPropagate: false,
      };

      await expect(
        helper.connect(wallet1).flashExecute(req)
      ).to.be.revertedWithCustomError(helper, "FinalOutputTokenMismatch");
    });

    it("5. Full success: 2-action pipeline with mock aggregator", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const METHOD_2 =
        "0x" + Buffer.from(ethers.id("mockSwap2()").slice(2, 10), "hex").toString("hex");

      // Action 0: tokenA -> tokenB
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);
      await helper.setFacetAddress(METHOD_1 as `0x${string}`, helperAddr);

      // Action 1: tokenB -> tokenA
      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1050n,
        isDeterministic: true,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1050n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);
      await helper.setFacetAddress(METHOD_2 as `0x${string}`, helperAddr);

      // Register flashExecuteCallback selector
      const cbSel = helper.interface.getFunction("flashExecuteCallback").selector;
      await helper.setFacetAddress(cbSel as `0x${string}`, helperAddr);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
        targetAddress: helperAddr,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
        targetAddress: helperAddr,
      });

      // Pre-mint 1000 tokenA to mock aggregator (simulates flash loan receipt)
      await tokenA.mint(await mockAgg.getAddress(), 1000n);

      const req = {
        flashLoanRoute: 1n,
        flashLoanInstaData: "0x",
        flashLoanToken: tokenAAddr,
        actions: [action0, action1],
        backPropagate: false,
      };

      await expect(helper.connect(wallet1).flashExecute(req)).to.not.be.reverted;
    });
  });

  // ============================================================
  // describe: flashExecuteCallback (direct unit tests)
  // ============================================================

  describe("flashExecuteCallback", () => {
    let helper: TestTermFlashLoanExecutorFacetHelper;
    let mockAgg: TestMockFlashLoanAggregator;
    let tokenA: TestMockRepoTokenFull;
    let tokenB: TestMockRepoTokenFull;
    let helperAddr: string;
    let METHOD_1: string;
    let METHOD_2: string;

    // Builds a minimal valid callback invocation for wallet1 as aggregator
    async function callCallback(
      caller: SignerWithAddress,
      assets: string[],
      amounts: bigint[],
      premiums: bigint[],
      initiator: string,
      data: string
    ) {
      return helper
        .connect(caller)
        .flashExecuteCallback(assets, amounts, premiums, initiator, data);
    }

    beforeEach(async () => {
      const AggFactory = await ethers.getContractFactory(
        "TestMockFlashLoanAggregator"
      );
      mockAgg = (await AggFactory.deploy()) as TestMockFlashLoanAggregator;
      await mockAgg.waitForDeployment();

      // Use wallet1 as the aggregator so we can call callback directly
      const HelperFactory = await ethers.getContractFactory(
        "TestTermFlashLoanExecutorFacetHelper"
      );
      helper = (await HelperFactory.deploy(
        wallet1.address
      )) as TestTermFlashLoanExecutorFacetHelper;
      await helper.waitForDeployment();
      helperAddr = await helper.getAddress();

      const TokenFactory = await ethers.getContractFactory(
        "TestMockRepoTokenFull"
      );
      tokenA = (await TokenFactory.deploy("TokenA", "TKA", 0)) as TestMockRepoTokenFull;
      tokenB = (await TokenFactory.deploy("TokenB", "TKB", 0)) as TestMockRepoTokenFull;
      await tokenA.waitForDeployment();
      await tokenB.waitForDeployment();

      METHOD_1 = helper.interface.getFunction("mockSwap").selector;
      METHOD_2 =
        "0x" + Buffer.from(ethers.id("mockSwap2()").slice(2, 10), "hex").toString("hex");

      // Register selectors
      await helper.setFacetAddress(METHOD_1 as `0x${string}`, helperAddr);
      await helper.setFacetAddress(METHOD_2 as `0x${string}`, helperAddr);
    });

    // Helper to build a complete plan and data for single-action callback
    async function buildSingleActionCallbackData(
      user: string,
      action: ReturnType<typeof makeAction>,
      flashLoanToken: string,
      flashLoanAmount: bigint,
      backPropagate = false
    ) {
      const plan = {
        user,
        flashLoanToken,
        flashLoanAmount,
        actions: [action],
        backPropagate,
      };
      return buildCallbackData(helperAddr, plan);
    }

    // Build a 2-action pipeline data
    async function build2ActionCallbackData(
      user: string,
      action0: ReturnType<typeof makeAction>,
      action1: ReturnType<typeof makeAction>,
      flashLoanToken: string,
      flashLoanAmount: bigint,
      backPropagate = false
    ) {
      const plan = {
        user,
        flashLoanToken,
        flashLoanAmount,
        actions: [action0, action1],
        backPropagate,
      };
      return buildCallbackData(helperAddr, plan);
    }

    // ---- modifier tests ----

    it("6. should revert with InvalidCaller when msg.sender is not the aggregator", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet2, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InvalidCaller");
    });

    it("7. should revert with InvalidInitiator when initiator is not address(this)", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      // Call from wallet1 (aggregator) but pass wallet2 as initiator
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], wallet2.address, data)
      ).to.be.revertedWithCustomError(helper, "InvalidInitiator");
    });

    // ---- parameter validation ----

    it("8. should revert with UserNotFlashLoanInitiator when borrower != plan.user", async () => {
      const tokenAAddr = await tokenA.getAddress();
      // Set borrower to wallet2
      await helper.setFlashLoanBorrower(wallet2.address);

      // Plan says user = wallet1
      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "UserNotFlashLoanInitiator");

      // cleanup
      await helper.clearFlashLoanBorrower();
    });

    it("9. should revert with InvalidFlashLoanReceived when assets.length != 1", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(
          wallet1,
          [tokenAAddr, tokenBAddr],
          [1000n, 2000n],
          [0n, 0n],
          helperAddr,
          data
        )
      ).to.be.revertedWithCustomError(helper, "InvalidFlashLoanReceived");

      await helper.clearFlashLoanBorrower();
    });

    it("10. should revert with InvalidFlashLoanReceived when amounts.length != 1", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(
          wallet1,
          [tokenAAddr],
          [1000n, 2000n],
          [0n],
          helperAddr,
          data
        )
      ).to.be.revertedWithCustomError(helper, "InvalidFlashLoanReceived");

      await helper.clearFlashLoanBorrower();
    });

    it("11. should revert with InvalidFlashLoanReceived when premiums.length != 1", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(
          wallet1,
          [tokenAAddr],
          [1000n],
          [0n, 0n],
          helperAddr,
          data
        )
      ).to.be.revertedWithCustomError(helper, "InvalidFlashLoanReceived");

      await helper.clearFlashLoanBorrower();
    });

    it("12. should revert with InvalidFlashloanAsset when assets[0] mismatches flashLoanToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // plan.flashLoanToken = tokenA, but pass tokenB in assets
      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenBAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InvalidFlashloanAsset");

      await helper.clearFlashLoanBorrower();
    });

    it("13. should revert with IncorrectFlashLoanAmount when amounts[0] != flashLoanAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({ inputToken: tokenAAddr, outputToken: tokenAAddr }),
        tokenAAddr,
        1000n // plan expects 1000
      );
      // pass 999
      await expect(
        callCallback(wallet1, [tokenAAddr], [999n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "IncorrectFlashLoanAmount");

      await helper.clearFlashLoanBorrower();
    });

    // ---- pipeline loop ----

    it("14. should revert with ZeroInputToken(0) when action.inputToken is zero", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: ethers.ZeroAddress, // zero
          outputToken: tokenAAddr,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "ZeroInputToken");

      await helper.clearFlashLoanBorrower();
    });

    it("15. should revert with ZeroOutputToken(0) when action.outputToken is zero", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          outputToken: ethers.ZeroAddress, // zero
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "ZeroOutputToken");

      await helper.clearFlashLoanBorrower();
    });

    it("16. should revert with InputTokenMatchesOutputToken(0) when input==output", async () => {
      const tokenAAddr = await tokenA.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          outputToken: tokenAAddr, // same
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InputTokenMatchesOutputToken");

      await helper.clearFlashLoanBorrower();
    });

    it("17. should revert with InvalidInputToken(0) when action.inputToken != currentInputToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // currentInputToken starts as tokenA (from flash loan), but action says tokenB
      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenBAddr, // mismatch
          outputToken: tokenAAddr,
          method: METHOD_1,
        }),
        tokenAAddr, // flashLoanToken = tokenA
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InvalidInputToken");

      await helper.clearFlashLoanBorrower();
    });

    it("18. should cap maxInputAmount when currentInputAmount < maxInputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // maxInputAmount = 2000 > currentInputAmount = 1000 → capped to 1000
      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1050n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1050n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      // Also set preview/calldata for the second step (tokenB -> tokenA)
      const preview2 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1050n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: true,
      });
      const calldata2 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview2, calldata2);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n, // > 1000, will be capped
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
        targetAddress: helperAddr,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
        targetAddress: helperAddr,
      });

      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );

      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("19. should revert with InputTokenMismatch(0) when preview.expectedInputToken != action.inputToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // preview returns tokenB as expectedInputToken but action.inputToken = tokenA
      const preview = makePreview({
        expectedInputToken: tokenBAddr, // mismatch
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InputTokenMismatch");

      await helper.clearFlashLoanBorrower();
    });

    it("20. should revert with ExpectedInputExceedsMax(0) when preview.expectedInputAmount > maxInputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 500n, // > maxInputAmount=100
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 100n, // less than preview's 500
          outputToken: tokenBAddr,
          method: METHOD_1,
        }),
        tokenAAddr,
        100n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [100n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "ExpectedInputExceedsMax");

      await helper.clearFlashLoanBorrower();
    });

    it("21. should revert with OutputTokenMismatch(0) when preview.expectedOutputToken != action.outputToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const TokenFactory = await ethers.getContractFactory("TestMockRepoTokenFull");
      const tokenC = (await TokenFactory.deploy("TokenC", "TKC", 0)) as TestMockRepoTokenFull;
      await tokenC.waitForDeployment();
      const tokenCAddr = await tokenC.getAddress();

      await helper.setFlashLoanBorrower(wallet1.address);

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenCAddr, // mismatch: action.outputToken = tokenB
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "OutputTokenMismatch");

      await helper.clearFlashLoanBorrower();
    });

    it("22. should revert with ExpectedOutputBelowMin(0) when isDeterministic and minOutput > expectedOutput", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 200n, // below minOutput=500
        isDeterministic: true,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 200n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          minOutputAmount: 500n,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "ExpectedOutputBelowMin");

      await helper.clearFlashLoanBorrower();
    });

    it("23. should revert with NoTokensReceived when mockSwap mints 0 tokens", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      // calldata mints 0 tokenB
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 0n, // mints 0
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      await tokenA.mint(helperAddr, 1000n);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          minOutputAmount: 0n,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "NoTokensReceived");

      await helper.clearFlashLoanBorrower();
    });

    it("24. should revert with InputAmountExceeded(0) when actual burn > maxInputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // maxInputAmount=100, but mockSwap burns 500
      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 100n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 100n,
        isDeterministic: false,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 500n, tokenBAddr, 100n, // burns 500
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      await tokenA.mint(helperAddr, 500n);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 100n,
          outputToken: tokenBAddr,
          minOutputAmount: 0n,
          method: METHOD_1,
        }),
        tokenAAddr,
        500n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [500n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "InputAmountExceeded");

      await helper.clearFlashLoanBorrower();
    });

    it("25. should revert with OutputAmountInsufficient(0) when output < minOutputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // minOutput=100, but only mints 10
      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 10n,
        isDeterministic: false,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 10n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      await tokenA.mint(helperAddr, 1000n);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          minOutputAmount: 100n,
          method: METHOD_1,
        }),
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "OutputAmountInsufficient");

      await helper.clearFlashLoanBorrower();
    });

    it("26. should revert with FlashloanRepayIncompatible when final token != flashLoanToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // 1-action plan: tokenA->tokenB; ends in tokenB ≠ flashLoanToken=tokenA
      const preview = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview, calldata);

      await tokenA.mint(helperAddr, 1000n);

      const data = await buildSingleActionCallbackData(
        wallet1.address,
        makeAction({
          inputToken: tokenAAddr,
          maxInputAmount: 2000n,
          outputToken: tokenBAddr,
          minOutputAmount: 0n,
          method: METHOD_1,
        }),
        tokenAAddr, // flashLoanToken = tokenA
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "FlashloanRepayIncompatible");

      await helper.clearFlashLoanBorrower();
    });

    it("27. should revert with FlashloanRepayIncompatible when final token != flashLoanToken (2-action, direct callback)", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      // Deploy a third token as the final output
      const TokenFactory = await ethers.getContractFactory("TestMockRepoTokenFull");
      const tokenC = (await TokenFactory.deploy("TokenC", "TKC", 0)) as TestMockRepoTokenFull;
      await tokenC.waitForDeployment();
      const tokenCAddr = await tokenC.getAddress();

      await helper.setFlashLoanBorrower(wallet1.address);

      // 2-action plan:
      //   action0: tokenA → tokenB  (ok)
      //   action1: tokenB → tokenC  (wrong: tokenC ≠ flashLoanToken=tokenA)
      // backPropagate=false sets action1.minOutputAmount = amountOwing = 1000,
      // mockSwap mints exactly 1000 tokenC → passes OutputAmountInsufficient,
      // but currentInputToken=tokenC ≠ flashLoanToken=tokenA → FlashloanRepayIncompatible
      const METHOD_3 =
        "0x" + Buffer.from(ethers.id("mockSwap3()").slice(2, 10), "hex").toString("hex");
      await helper.setFacetAddress(METHOD_3 as `0x${string}`, helperAddr);

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenCAddr, // wrong final token
        expectedOutputAmount: 1000n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenCAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_3 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenCAddr, // ends in tokenC, not tokenA
        minOutputAmount: 0n,
        method: METHOD_3,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr, // flashLoanToken = tokenA
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "FlashloanRepayIncompatible");

      await helper.clearFlashLoanBorrower();
    });

    // ---- success paths ----

    it("28. 2-action success: exact repay, refund triggered per-action", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // Action 0: tokenA->tokenB, burn 0, mint 1100
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      // Action 1: tokenB->tokenA, burn 0, mint 1000
      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: true,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("29. surplus refund: final output > amountOwing, surplus sent to user", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1050n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1050n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);
      const userBalBefore = await tokenA.balanceOf(wallet1.address);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );
      await callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data);

      const userBalAfter = await tokenA.balanceOf(wallet1.address);
      // surplus = 1050 - 1000 = 50; plus refund from action 0 unspent input (1000-0=1000)
      // wallet1 gets back 1000 refund (from unspent action0 input) + 50 surplus
      expect(userBalAfter - userBalBefore).to.be.gt(0n);

      await helper.clearFlashLoanBorrower();
    });

    it("30. actualInputSpent = full input (no per-action refund)", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // mockSwap burns all 1000 tokenA
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 1000n, tokenBAddr, 1100n, // burns 1000
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 1100n, tokenAAddr, 1000n, // burns all 1100
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("31. outputTokenAmountIn > 0, usePermit2=false: transfers extra tokens from user", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // action0: tokenA→tokenB, mints 500 tokenB → currentInputAmount=500 after step
      //   unspent 1000 tokenA refunded to user during action0 iteration
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 500n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 500n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      // action1: tokenB→tokenA
      //   maxInputAmount capped to 500 (currentInputAmount after action0)
      //   preview.expectedInputAmount must be ≤ 500
      //   mints 400 tokenA; outputTokenAmountIn=600 tokenA from user
      //   backPropagate=false: requiredFinalOutput = 1000 - 600 = 400 → minOutputAmount=400
      //   actual output 400 ≥ 400 ✓; + 600 from user = 1000 = amountOwing ✓
      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 500n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 400n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 400n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      // Pre-mint 1000 tokenA to helper (flash loan receipt)
      await tokenA.mint(helperAddr, 1000n);
      // User pre-approves tokenA to helper (will receive 1000 tokenA as refund during action0)
      await tokenA.connect(wallet1).approve(helperAddr, ethers.MaxUint256);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        outputTokenAmountIn: 600n, // extra 600 tokenA from user (outputToken=tokenA)
        usePermit2ForOutputTokenIn: false,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("32. outputTokenAmountIn > 0, usePermit2=true: uses Permit2 transferFrom", async () => {
      const PERMIT2_ADDR = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
      // hardhat_setCode requires runtime bytecode, not creation bytecode;
      // deploy first then read the deployed code
      const Permit2Factory = await ethers.getContractFactory("TestMockPermit2");
      const permit2Deployed = await Permit2Factory.deploy();
      await permit2Deployed.waitForDeployment();
      const permit2RuntimeCode = await ethers.provider.getCode(
        await permit2Deployed.getAddress()
      );
      await ethers.provider.send("hardhat_setCode", [
        PERMIT2_ADDR,
        permit2RuntimeCode,
      ]);

      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 500n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 500n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      // action1: tokenB→tokenA
      //   maxInputAmount capped to 500 (currentInputAmount after action0)
      //   preview.expectedInputAmount must be ≤ 500
      //   mints 400 tokenA; outputTokenAmountIn=600 tokenA from user via Permit2
      //   requiredFinalOutput = 1000 - 600 = 400 → minOutputAmount=400
      //   actual output 400 ≥ 400 ✓; + 600 from user = 1000 = amountOwing ✓
      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 500n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 400n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 400n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      // Pre-mint 1000 tokenA to helper (flash loan receipt)
      await tokenA.mint(helperAddr, 1000n);
      // User pre-approves tokenA to Permit2 (will receive 1000 tokenA refund during action0)
      await tokenA.connect(wallet1).approve(PERMIT2_ADDR, ethers.MaxUint256);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        outputTokenAmountIn: 600n, // 600 tokenA from user via Permit2
        usePermit2ForOutputTokenIn: true,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("33. backPropagate=false, outputTokenAmountIn >= amountOwing → requiredFinalOutput = 0", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // 1-action: tokenA->tokenB->tokenA via 2 steps; easier: direct 1 action back to tokenA
      // Use 2-action: action0: tokenA->tokenB, action1: tokenB->tokenA
      // outputTokenAmountIn on last action = 2000 >= amountOwing = 1000 → requiredFinalOutput = 0
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 500n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 500n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      // action1: outputTokenAmountIn = 2000 (user deposits), minOutputAmount = 0 (no required min)
      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 500n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1n, // very small but non-zero
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);
      // User deposits 2000 tokenA for outputTokenAmountIn
      await tokenA.mint(wallet1.address, 2000n);
      await tokenA.connect(wallet1).approve(helperAddr, 2000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n, // requiredFinalOutput=0 and 0>0 is false, so no override; stays 0
        outputTokenAmountIn: 2000n,
        usePermit2ForOutputTokenIn: false,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n,
        false // backPropagate = false
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("33b. backPropagate=true, outputTokenAmountIn >= amountOwing → backprop sets minOutputAmount = 0", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // Identical to test 33 except backPropagate=true and minOutputAmount=500n.
      // backprop computes: requiredFinalOutput = max(1000 - 2000, 0) = 0 → action1.minOutputAmount = 0
      // Floor protection only fires when !isDeterministic; use isDeterministic=true so the computed
      // value (0) is kept and maxInputAmount is pinned to expectedInputAmount.
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 500n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 500n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 500n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1n,
        isDeterministic: true, // must be true so floor-protection doesn't restore 500 over computed 0
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);
      await tokenA.mint(wallet1.address, 2000n);
      await tokenA.connect(wallet1).approve(helperAddr, 2000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 500n, // backprop reduces this to 0; actual output of 1 then passes
        outputTokenAmountIn: 2000n,
        usePermit2ForOutputTokenIn: false,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n,
        true // backPropagate = true
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("34. backPropagate=false, last action minOutput already >= amountOwing: no update", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 2000n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 2000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 2000n, // already >= amountOwing=1000, so no update needed
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n,
        false
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("35. backPropagate=true success: tightens minOutputAmounts, pins maxInputAmount for deterministic", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: true,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n,
        true // backPropagate = true
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.not.be.reverted;

      await helper.clearFlashLoanBorrower();
    });

    it("36. backPropagate=true, non-deterministic floor protection: originalMinOutput restored if higher", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      await helper.setFlashLoanBorrower(wallet1.address);

      // isDeterministic=false means floor protection applies
      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1200n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1200n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      await tokenA.mint(helperAddr, 1000n);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 5000n, // higher than computed 1000 → floor restored
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });

      // With floor protection, action0 should use minOutputAmount=5000 but actual output is 1100.
      // That will trigger OutputAmountInsufficient, proving the floor was restored.
      const data = await build2ActionCallbackData(
        wallet1.address,
        action0,
        action1,
        tokenAAddr,
        1000n,
        true // backPropagate = true
      );
      await expect(
        callCallback(wallet1, [tokenAAddr], [1000n], [0n], helperAddr, data)
      ).to.be.revertedWithCustomError(helper, "OutputAmountInsufficient");

      await helper.clearFlashLoanBorrower();
    });
  });

  // ============================================================
  // describe: quoteExecutionPlan
  // ============================================================

  describe("quoteExecutionPlan", () => {
    let helper: TestTermFlashLoanExecutorFacetHelper;
    let tokenA: TestMockRepoTokenFull;
    let tokenB: TestMockRepoTokenFull;
    let helperAddr: string;
    let METHOD_1: string;
    let METHOD_2: string;

    beforeEach(async () => {
      const HelperFactory = await ethers.getContractFactory(
        "TestTermFlashLoanExecutorFacetHelper"
      );
      helper = (await HelperFactory.deploy(
        wallet1.address
      )) as TestTermFlashLoanExecutorFacetHelper;
      await helper.waitForDeployment();
      helperAddr = await helper.getAddress();

      const TokenFactory = await ethers.getContractFactory(
        "TestMockRepoTokenFull"
      );
      tokenA = (await TokenFactory.deploy("TokenA", "TKA", 0)) as TestMockRepoTokenFull;
      tokenB = (await TokenFactory.deploy("TokenB", "TKB", 0)) as TestMockRepoTokenFull;
      await tokenA.waitForDeployment();
      await tokenB.waitForDeployment();

      METHOD_1 = helper.interface.getFunction("mockSwap").selector;
      METHOD_2 =
        "0x" + Buffer.from(ethers.id("mockSwap2()").slice(2, 10), "hex").toString("hex");

      await helper.setFacetAddress(METHOD_1 as `0x${string}`, helperAddr);
      await helper.setFacetAddress(METHOD_2 as `0x${string}`, helperAddr);
    });

    function buildPlan(
      user: string,
      flashLoanToken: string,
      flashLoanAmount: bigint,
      actions: ReturnType<typeof makeAction>[],
      backPropagate: boolean
    ) {
      return [
        user,
        flashLoanToken,
        flashLoanAmount,
        actions.map(actionToArray),
        backPropagate,
      ];
    }

    it("37. Success: deterministic, returns plan with pinned maxInputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: true,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        1000n,
        [action0, action1],
        true
      );

      const result = await helper.quoteExecutionPlan(plan as any, 1000n);
      // Backprop (reverse):
      //   action[1]: requiredOut=1000 → minOutputAmount=1000; deterministic pin → maxInputAmount=1100; propagates requiredOut=1100
      //   action[0]: requiredOut=1100 → minOutputAmount=1100; deterministic pin → maxInputAmount=1000
      expect(result.actions[0].maxInputAmount).to.equal(1000n);
      expect(result.actions[0].minOutputAmount).to.equal(1100n);
      expect(result.actions[1].maxInputAmount).to.equal(1100n);
      expect(result.actions[1].minOutputAmount).to.equal(1000n);
    });

    it("38. Success: non-deterministic floor restored when originalMinOutput > computed", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: false,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const preview1 = makePreview({
        expectedInputToken: tokenBAddr,
        expectedInputAmount: 1100n,
        expectedOutputToken: tokenAAddr,
        expectedOutputAmount: 1000n,
        isDeterministic: false,
      });
      const calldata1 = helper.interface.encodeFunctionData("mockSwap", [
        tokenBAddr, 0n, tokenAAddr, 1000n,
      ]);
      await helper.setMockAction(METHOD_2 as `0x${string}`, preview1, calldata1);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 9999n, // high floor, should be restored
        method: METHOD_1,
      });
      const action1 = makeAction({
        inputToken: tokenBAddr,
        maxInputAmount: 2000n,
        outputToken: tokenAAddr,
        minOutputAmount: 0n,
        method: METHOD_2,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        1000n,
        [action0, action1],
        true
      );

      const result = await helper.quoteExecutionPlan(plan as any, 1000n);
      // Floor should be restored: originalMinOutput 9999 > computed 1000
      expect(result.actions[0].minOutputAmount).to.equal(9999n);
    });

    it("39. InputTokenMismatch in backPropagate: preview.expectedInputToken != action.inputToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenBAddr, // mismatch: action.inputToken = tokenA
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        1000n,
        [action0],
        true
      );

      await expect(
        helper.quoteExecutionPlan(plan as any, 1000n)
      ).to.be.revertedWithCustomError(helper, "InputTokenMismatch");
    });

    it("40. OutputTokenMismatch in backPropagate: preview.expectedOutputToken != action.outputToken", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const TokenFactory = await ethers.getContractFactory("TestMockRepoTokenFull");
      const tokenC = (await TokenFactory.deploy("TokenC", "TKC", 0)) as TestMockRepoTokenFull;
      await tokenC.waitForDeployment();
      const tokenCAddr = await tokenC.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenCAddr, // mismatch: action.outputToken = tokenB
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        1000n,
        [action0],
        true
      );

      await expect(
        helper.quoteExecutionPlan(plan as any, 1000n)
      ).to.be.revertedWithCustomError(helper, "OutputTokenMismatch");
    });

    it("41. ExpectedInputExceedsMax in backPropagate: maxInputAmount < preview.expectedInputAmount", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 5000n, // exceeds maxInputAmount=100
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 100n,
        outputToken: tokenBAddr,
        minOutputAmount: 0n,
        method: METHOD_1,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        100n,
        [action0],
        true
      );

      await expect(
        helper.quoteExecutionPlan(plan as any, 100n)
      ).to.be.revertedWithCustomError(helper, "ExpectedInputExceedsMax");
    });

    it("42. amountOwing <= outputTokenAmountIn: minOutputAmount = 0 (ternary false branch)", async () => {
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();

      const preview0 = makePreview({
        expectedInputToken: tokenAAddr,
        expectedInputAmount: 1000n,
        expectedOutputToken: tokenBAddr,
        expectedOutputAmount: 1100n,
        isDeterministic: true,
      });
      const calldata0 = helper.interface.encodeFunctionData("mockSwap", [
        tokenAAddr, 0n, tokenBAddr, 1100n,
      ]);
      await helper.setMockAction(METHOD_1 as `0x${string}`, preview0, calldata0);

      // outputTokenAmountIn >= amountOwing → requiredOut = 0
      const action0 = makeAction({
        inputToken: tokenAAddr,
        maxInputAmount: 2000n,
        outputToken: tokenBAddr,
        minOutputAmount: 500n,
        outputTokenAmountIn: 2000n, // >= amountOwing=1000
        method: METHOD_1,
      });

      const plan = buildPlan(
        wallet1.address,
        tokenAAddr,
        1000n,
        [action0],
        true
      );

      const result = await helper.quoteExecutionPlan(plan as any, 1000n);
      // minOutputAmount should be 0 since requiredOut = 0 < originalMinOutput = 500
      // but isDeterministic=true, so it won't be floor-restored
      expect(result.actions[0].minOutputAmount).to.equal(0n);
    });
  });
});
