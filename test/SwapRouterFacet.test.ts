import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  SwapRouterFacet,
} from "../typechain-types";
import {
  deployMockContract,
  MockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";

// Use compiled Pendle ABIs so function selectors exactly match what the contract generates
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IPActionSwapPTV3Artifact = require("@pendle/core-v2/build/artifacts/contracts/interfaces/IPActionSwapPTV3.sol/IPActionSwapPTV3.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IPActionMiscV3Artifact = require("@pendle/core-v2/build/artifacts/contracts/interfaces/IPActionMiscV3.sol/IPActionMiscV3.json");

// ─── ABI type strings that match Pendle's actual on-chain structs ─────────────
const SWAP_DATA_TYPE =
  "tuple(uint8 swapType, address extRouter, bytes extCalldata, bool needScale)";
const TOKEN_OUTPUT_TYPE =
  `tuple(address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, ${SWAP_DATA_TYPE} swapData)`;
const TOKEN_INPUT_TYPE =
  `tuple(address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, ${SWAP_DATA_TYPE} swapData)`;
const APPROX_PARAMS_TYPE =
  "tuple(uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps)";
const ORDER_TYPE =
  "tuple(uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit)";
const FILL_ORDER_PARAMS_TYPE =
  `tuple(${ORDER_TYPE} order, bytes signature, uint256 makingAmount)`;
const LIMIT_ORDER_DATA_TYPE =
  `tuple(address limitRouter, uint256 epsSkipMarket, ${FILL_ORDER_PARAMS_TYPE}[] normalFills, ${FILL_ORDER_PARAMS_TYPE}[] flashFills, bytes optData)`;

// Default zero values for complex structs used in encoded swap data
const ZERO_SWAP_DATA = { swapType: 0, extRouter: ethers.ZeroAddress, extCalldata: "0x", needScale: false };
const ZERO_TOKEN_OUTPUT = (tokenOut: string) => ({
  tokenOut,
  minTokenOut: 0,
  tokenRedeemSy: ethers.ZeroAddress,
  pendleSwap: ethers.ZeroAddress,
  swapData: ZERO_SWAP_DATA,
});
const ZERO_LIMIT_ORDER_DATA = {
  limitRouter: ethers.ZeroAddress,
  epsSkipMarket: 0,
  normalFills: [],
  flashFills: [],
  optData: "0x",
};

// Zero return value for exitPostExpToToken (returns uint256 + ExitPostExpReturnParams)
const ZERO_EXIT_PARAMS = {
  netPtFromRemove: BigInt(0),
  netSyFromRemove: BigInt(0),
  netPtRedeem: BigInt(0),
  netSyFromRedeem: BigInt(0),
  totalSyOut: BigInt(0),
};

describe("SwapRouterFacet Tests", () => {
  let swapRouterFacet: SwapRouterFacet;
  let mockPendleRouter: MockContract<any>;
  let mockPendleSwap: MockContract<any>;
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;

  // Use the real Pendle compiled ABIs so mock selectors match what the contract calls
  const pendleRouterAbi = [
    ...IPActionSwapPTV3Artifact.abi,
    ...IPActionMiscV3Artifact.abi,
  ].filter((x: any) =>
    x.type === "function" &&
    ["swapExactPtForToken", "swapExactTokenForPt", "exitPostExpToToken"].includes(x.name)
  );

  const pendleSwapAbi = [
    "function swap(address tokenIn, uint256 amountIn, tuple(uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) external returns (uint256)",
  ];

  const ptAbi = [
    "function expiry() external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  ];

  before(async () => {
    [wallet1, wallet2] = await ethers.getSigners();
    mockPendleRouter = await deployMockContract(wallet1, pendleRouterAbi);
    mockPendleSwap = await deployMockContract(wallet1, pendleSwapAbi);
  });

  beforeEach(async () => {
    const SwapRouterFacetFactory = await ethers.getContractFactory("SwapRouterFacet");
    swapRouterFacet = await SwapRouterFacetFactory.deploy(
      await mockPendleRouter.getAddress(),
      await mockPendleSwap.getAddress()
    ) as SwapRouterFacet;
    await swapRouterFacet.waitForDeployment();
  });

  describe("Constructor", () => {
    it("should revert if pendleRouter address is zero", async () => {
      const SwapRouterFacetFactory = await ethers.getContractFactory("SwapRouterFacet");
      await expect(
        SwapRouterFacetFactory.deploy(ethers.ZeroAddress, await mockPendleSwap.getAddress())
      ).to.be.revertedWithCustomError(SwapRouterFacetFactory, "InvalidPendleRouterAddress");
    });

    it("should revert if pendleSwap address is zero", async () => {
      const SwapRouterFacetFactory = await ethers.getContractFactory("SwapRouterFacet");
      await expect(
        SwapRouterFacetFactory.deploy(await mockPendleRouter.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(SwapRouterFacetFactory, "InvalidPendleSwapAddress");
    });

    it("should deploy successfully with valid addresses", async () => {
      expect(await swapRouterFacet.getAddress()).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("swap function", () => {
    it("should revert BothTokensCannotBePendlePT when both flags are true", async () => {
      // The new `swap` flow pulls tokens via safeTransferFrom before entering
      // _swapInternal, so tokenIn must be a contract with transferFrom mocked.
      const mockPT = await deployMockContract(wallet1, ptAbi);
      await (mockPT.mock as any).transferFrom.returns(true);
      await expect(
        swapRouterFacet.swap(await mockPT.getAddress(), 1000, false, {
          swapData: "0x",
          isTokenInPendlePT: true,
          isTokenOutPendlePT: true,
        })
      ).to.be.revertedWithCustomError(swapRouterFacet, "BothTokensCannotBePendlePT");
    });

    // ── PT input post-expiry ─────────────────────────────────────────────────

    it("PT input post-expiry: InputAmountMismatch when netPtIn != amountIn", async () => {
      const mockPT = await deployMockContract(wallet1, ptAbi);
      await mockPT.mock.expiry.returns(Math.floor(Date.now() / 1000) - 86400); // past
      await mockPT.mock.approve.returns(true);
      await (mockPT.mock as any).transferFrom.returns(true);

      const netPtIn = 50n;
      const amountIn = 100n;
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256", TOKEN_OUTPUT_TYPE],
        [wallet1.address, wallet2.address, netPtIn, 0, ZERO_TOKEN_OUTPUT(wallet2.address)]
      );

      await expect(
        swapRouterFacet.swap(await mockPT.getAddress(), amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: true,
          isTokenOutPendlePT: false,
        })
      ).to.be.revertedWithCustomError(swapRouterFacet, "InputAmountMismatch");
    });

    it("PT input post-expiry: success when netPtIn == amountIn", async () => {
      const mockPT = await deployMockContract(wallet1, ptAbi);
      await mockPT.mock.expiry.returns(Math.floor(Date.now() / 1000) - 86400); // past
      await mockPT.mock.approve.returns(true);
      await (mockPT.mock as any).transferFrom.returns(true);
      await mockPendleRouter.mock.exitPostExpToToken.returns(BigInt(0), ZERO_EXIT_PARAMS);

      const amountIn = 100n;
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256", TOKEN_OUTPUT_TYPE],
        [wallet1.address, wallet2.address, amountIn, 0, ZERO_TOKEN_OUTPUT(wallet2.address)]
      );

      await expect(
        swapRouterFacet.swap(await mockPT.getAddress(), amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: true,
          isTokenOutPendlePT: false,
        })
      ).to.not.be.reverted;
    });

    // ── PT input pre-expiry ──────────────────────────────────────────────────

    it("PT input pre-expiry: InputAmountMismatch when exactPtIn != amountIn", async () => {
      const mockPT = await deployMockContract(wallet1, ptAbi);
      await mockPT.mock.expiry.returns(Math.floor(Date.now() / 1000) + 86400); // future
      await mockPT.mock.approve.returns(true);
      await (mockPT.mock as any).transferFrom.returns(true);

      const exactPtIn = 50n;
      const amountIn = 100n;
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", TOKEN_OUTPUT_TYPE, LIMIT_ORDER_DATA_TYPE],
        [wallet1.address, wallet2.address, exactPtIn, ZERO_TOKEN_OUTPUT(wallet2.address), ZERO_LIMIT_ORDER_DATA]
      );

      await expect(
        swapRouterFacet.swap(await mockPT.getAddress(), amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: true,
          isTokenOutPendlePT: false,
        })
      ).to.be.revertedWithCustomError(swapRouterFacet, "InputAmountMismatch");
    });

    it("PT input pre-expiry: success when exactPtIn == amountIn", async () => {
      const mockPT = await deployMockContract(wallet1, ptAbi);
      await mockPT.mock.expiry.returns(Math.floor(Date.now() / 1000) + 86400); // future
      await mockPT.mock.approve.returns(true);
      await (mockPT.mock as any).transferFrom.returns(true);
      await mockPendleRouter.mock.swapExactPtForToken.returns(BigInt(0), BigInt(0), BigInt(0));

      const amountIn = 100n;
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", TOKEN_OUTPUT_TYPE, LIMIT_ORDER_DATA_TYPE],
        [wallet1.address, wallet2.address, amountIn, ZERO_TOKEN_OUTPUT(wallet2.address), ZERO_LIMIT_ORDER_DATA]
      );

      await expect(
        swapRouterFacet.swap(await mockPT.getAddress(), amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: true,
          isTokenOutPendlePT: false,
        })
      ).to.not.be.reverted;
    });

    // ── PT output ────────────────────────────────────────────────────────────

    it("PT output: success", async () => {
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const tokenIn = await upgrades.deployProxy(TestTokenFactory, [
        "Input Token", "IN", 18, [], [],
      ], { initializer: "initialize" });
      await tokenIn.waitForDeployment();

      await mockPendleRouter.mock.swapExactTokenForPt.returns(BigInt(0), BigInt(0), BigInt(0));

      const amountIn = ethers.parseEther("100");
      const tokenInAddr = await tokenIn.getAddress();

      // New swap flow pulls tokens from msg.sender (wallet1) into the facet.
      await (tokenIn as any).mint(wallet1.address, amountIn);
      await (tokenIn as any).connect(wallet1).approve(await swapRouterFacet.getAddress(), amountIn);
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", APPROX_PARAMS_TYPE, TOKEN_INPUT_TYPE, LIMIT_ORDER_DATA_TYPE],
        [
          wallet1.address,
          wallet2.address,
          0,
          { guessMin: 0, guessMax: ethers.MaxUint256, guessOffchain: 0, maxIteration: 256, eps: 1e14 },
          { tokenIn: tokenInAddr, netTokenIn: amountIn, tokenMintSy: tokenInAddr, pendleSwap: ethers.ZeroAddress, swapData: ZERO_SWAP_DATA },
          ZERO_LIMIT_ORDER_DATA,
        ]
      );

      await expect(
        swapRouterFacet.swap(tokenInAddr, amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: false,
          isTokenOutPendlePT: true,
        })
      ).to.not.be.reverted;
    });

    // ── Regular ERC20 via aggregator ─────────────────────────────────────────

    it("Regular ERC20 swap: success via Pendle aggregator", async () => {
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const tokenIn = await upgrades.deployProxy(TestTokenFactory, [
        "Swap Token", "ST", 18, [], [],
      ], { initializer: "initialize" });
      await tokenIn.waitForDeployment();

      const amountIn = ethers.parseEther("100");
      // New swap flow pulls tokens from msg.sender (wallet1) into the facet,
      // which then safeTransfers them onward to pendleSwap.
      await (tokenIn as any).mint(wallet1.address, amountIn);
      await (tokenIn as any).connect(wallet1).approve(await swapRouterFacet.getAddress(), amountIn);

      await mockPendleSwap.mock.swap.returns(BigInt(0));

      const pendleSwapData = {
        swapType: 1,
        extRouter: wallet2.address,
        extCalldata: "0x1234",
        needScale: false,
      };
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        [`tuple(uint8,address,bytes,bool)`],
        [[pendleSwapData.swapType, pendleSwapData.extRouter, pendleSwapData.extCalldata, pendleSwapData.needScale]]
      );

      await expect(
        swapRouterFacet.swap(await tokenIn.getAddress(), amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: false,
          isTokenOutPendlePT: false,
        })
      ).to.not.be.reverted;
    });

    it("PT output: InputAmountMismatch when input.netTokenIn != amountIn", async () => {
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const tokenIn = await upgrades.deployProxy(TestTokenFactory, [
        "Input Token", "IN", 18, [], [],
      ], { initializer: "initialize" });
      await tokenIn.waitForDeployment();

      const amountIn = ethers.parseEther("100");
      const wrongNetTokenIn = ethers.parseEther("50"); // mismatch
      const tokenInAddr = await tokenIn.getAddress();

      // New swap flow pulls tokens from msg.sender (wallet1) before reaching
      // the InputAmountMismatch check inside _swapInternal.
      await (tokenIn as any).mint(wallet1.address, amountIn);
      await (tokenIn as any).connect(wallet1).approve(await swapRouterFacet.getAddress(), amountIn);
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", APPROX_PARAMS_TYPE, TOKEN_INPUT_TYPE, LIMIT_ORDER_DATA_TYPE],
        [
          wallet1.address,
          wallet2.address,
          0,
          { guessMin: 0, guessMax: ethers.MaxUint256, guessOffchain: 0, maxIteration: 256, eps: 1e14 },
          { tokenIn: tokenInAddr, netTokenIn: wrongNetTokenIn, tokenMintSy: tokenInAddr, pendleSwap: ethers.ZeroAddress, swapData: ZERO_SWAP_DATA },
          ZERO_LIMIT_ORDER_DATA,
        ]
      );

      await expect(
        swapRouterFacet.swap(tokenInAddr, amountIn, false, {
          swapData: swapDataEncoded,
          isTokenInPendlePT: false,
          isTokenOutPendlePT: true,
        })
      ).to.be.revertedWithCustomError(swapRouterFacet, "InputAmountMismatch");
    });
  });

  // ─── previewSwap ─────────────────────────────────────────────────────────────

  describe("previewSwap", () => {
    it("should revert InputOutputTokenCollision when inputToken equals outputToken", async () => {
      const tokenAddr = wallet1.address; // reuse any address for both sides
      await expect(
        (swapRouterFacet as any).previewSwap({
          user: wallet1.address,
          inputToken: tokenAddr,
          maxInputAmount: ethers.parseEther("100"),
          outputToken: tokenAddr,
          minOutputAmount: ethers.parseEther("90"),
          targetAddress: ethers.ZeroAddress,
          additionalCalldata: "0x",
        })
      ).to.be.revertedWithCustomError(swapRouterFacet, "InputOutputTokenCollision");
    });

    it("should return correct PreviewAction with isDeterministic=false", async () => {
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInput = ethers.parseEther("100");
      const minOutput = ethers.parseEther("95");

      const preview = await (swapRouterFacet as any).previewSwap({
        user: wallet1.address,
        inputToken,
        maxInputAmount: maxInput,
        outputToken,
        minOutputAmount: minOutput,
        targetAddress: ethers.ZeroAddress,
        additionalCalldata: "0x",
      });

      expect(preview.expectedInputToken).to.equal(inputToken);
      expect(preview.expectedInputAmount).to.equal(maxInput);
      expect(preview.expectedOutputToken).to.equal(outputToken);
      expect(preview.expectedOutputAmount).to.equal(minOutput);
      expect(preview.isDeterministic).to.equal(false);
    });
  });

  // ─── generateActionCalldata ───────────────────────────────────────────────────

  describe("generateActionCalldata", () => {
    it("should revert UnsupportedHookSelector for unknown selector", async () => {
      await expect(
        (swapRouterFacet as any).generateActionCalldata(
          wallet1.address,
          wallet1.address,
          ethers.parseEther("100"),
          wallet2.address,
          ethers.parseEther("95"),
          "0x12345678",
          ethers.ZeroAddress,
          "0x",
        )
      ).to.be.revertedWithCustomError(swapRouterFacet, "UnsupportedHookSelector");
    });

    it("should return valid previewAction and encodedCalldata for swapHook selector", async () => {
      const hookSelector = (swapRouterFacet as any).interface.getFunction("swapHook").selector;
      const inputToken = wallet1.address;
      const outputToken = wallet2.address;
      const maxInput = ethers.parseEther("100");
      const minOutput = ethers.parseEther("95");

      const [previewAction, encodedCalldata] = await (swapRouterFacet as any).generateActionCalldata(
        wallet1.address,
        inputToken,
        maxInput,
        outputToken,
        minOutput,
        hookSelector,
        ethers.ZeroAddress,
        "0x",
      );

      expect(previewAction.isDeterministic).to.equal(false);
      expect(previewAction.expectedInputToken).to.equal(inputToken);
      expect(previewAction.expectedOutputToken).to.equal(outputToken);
      expect(previewAction.expectedInputAmount).to.equal(maxInput);
      expect(previewAction.expectedOutputAmount).to.equal(minOutput);
      expect(encodedCalldata.slice(0, 10)).to.equal(hookSelector);
    });

    it("should propagate InputOutputTokenCollision when inputToken equals outputToken", async () => {
      const hookSelector = (swapRouterFacet as any).interface.getFunction("swapHook").selector;
      const sameToken = wallet1.address;

      await expect(
        (swapRouterFacet as any).generateActionCalldata(
          wallet1.address,
          sameToken,
          ethers.parseEther("100"),
          sameToken, // same as inputToken → collision in preview
          ethers.parseEther("95"),
          hookSelector,
          ethers.ZeroAddress,
          "0x",
        )
      ).to.be.reverted;
    });
  });

  // ─── swapHook ─────────────────────────────────────────────────────────────────

  describe("swapHook", () => {
    let swapHelper: any;

    beforeEach(async () => {
      const HelperFactory = await ethers.getContractFactory("TestSwapRouterFacetHelper");
      swapHelper = await HelperFactory.deploy(
        await mockPendleRouter.getAddress(),
        await mockPendleSwap.getAddress(),
      );
      await swapHelper.waitForDeployment();
    });

    it("should revert Unauthorized caller when no flash loan context is active", async () => {
      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        [`tuple(uint8,address,bytes,bool)`],
        [[0, ethers.ZeroAddress, "0x", false]]
      );
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes,bool,bool)"],
        [[swapDataEncoded, false, false]]
      );

      await expect(
        swapHelper.connect(wallet1).swapHook({
          user: wallet1.address,
          inputToken: wallet1.address,
          maxInputAmount: ethers.parseEther("1"),
          outputToken: wallet2.address,
          minOutputAmount: 0,
          targetAddress: ethers.ZeroAddress,
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");
    });

    it("should revert Unauthorized caller when flash loan borrower does not match input user", async () => {
      await swapHelper.setActiveFlashLoanBorrower(wallet2.address);

      const swapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        [`tuple(uint8,address,bytes,bool)`],
        [[0, ethers.ZeroAddress, "0x", false]]
      );
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes,bool,bool)"],
        [[swapDataEncoded, false, false]]
      );

      await expect(
        swapHelper.connect(wallet1).swapHook({
          user: wallet1.address, // wallet1 is user but context is for wallet2
          inputToken: wallet1.address,
          maxInputAmount: ethers.parseEther("1"),
          outputToken: wallet2.address,
          minOutputAmount: 0,
          targetAddress: ethers.ZeroAddress,
          additionalCalldata,
        })
      ).to.be.revertedWith("Unauthorized caller");

      await swapHelper.clearActiveFlashLoanBorrower();
    });

    it("should successfully execute hook via regular ERC20 aggregator path", async () => {
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const tokenIn = await upgrades.deployProxy(TestTokenFactory, [
        "Hook Token", "HT", 18, [], [],
      ], { initializer: "initialize" });
      await tokenIn.waitForDeployment();

      const amountIn = ethers.parseEther("10");
      await (tokenIn as any).mint(await swapHelper.getAddress(), amountIn);

      await mockPendleSwap.mock.swap.returns(BigInt(0));

      await swapHelper.setActiveFlashLoanBorrower(wallet1.address);

      const pendleSwapData = { swapType: 1, extRouter: wallet2.address, extCalldata: "0x", needScale: false };
      const innerSwapDataEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        [`tuple(uint8,address,bytes,bool)`],
        [[pendleSwapData.swapType, pendleSwapData.extRouter, pendleSwapData.extCalldata, pendleSwapData.needScale]]
      );
      const additionalCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes,bool,bool)"],
        [[innerSwapDataEncoded, false, false]]
      );

      await expect(
        swapHelper.connect(wallet1).swapHook({
          user: wallet1.address,
          inputToken: await tokenIn.getAddress(),
          maxInputAmount: amountIn,
          outputToken: wallet2.address,
          minOutputAmount: 0,
          targetAddress: ethers.ZeroAddress,
          additionalCalldata,
        })
      ).to.not.be.reverted;

      await swapHelper.clearActiveFlashLoanBorrower();
    });
  });
});
