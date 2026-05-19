//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IPSwapAggregator, SwapData} from "@pendle/core-v2/contracts/router/swap-aggregator/IPSwapAggregator.sol";
import {IPActionMiscV3} from "@pendle/core-v2/contracts/interfaces/IPActionMiscV3.sol";
import {IPActionSwapPTV3} from "@pendle/core-v2/contracts/interfaces/IPActionSwapPTV3.sol";
import {ApproxParams, TokenInput, TokenOutput, LimitOrderData} from "@pendle/core-v2/contracts/interfaces/IPAllActionTypeV3.sol";
import {IPPrincipalToken} from "@pendle/core-v2/contracts/interfaces/IPPrincipalToken.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";

/// @author TermLabs
/// @title SwapRouterFacet
/// @notice Provides token swap functionality through Pendle protocol
/// @dev Handles swaps involving Pendle Principal Tokens (PT) and regular tokens via Pendle router and aggregator
/// @dev Supports pre-expiry and post-expiry PT operations
contract SwapRouterFacet is ReentrancyGuard, TermFlashHookFacet, TermMultiContextAuth {
    using SafeERC20 for ERC20;
    using SafeCast for uint256;

     // ========================================================================

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when both input and output tokens are Pendle Principal Tokens
    error BothTokensCannotBePendlePT();

    /// @notice Thrown when input amount doesn't match expected PT amount
    error InputAmountMismatch();

    /// @notice Thrown when Pendle router address is zero
    error InvalidPendleRouterAddress();

    /// @notice Thrown when Pendle swap aggregator address is zero
    error InvalidPendleSwapAddress();

    /// @notice Parameters for swap operations
    /// @param swapData Encoded swap parameters specific to the swap type
    /// @param isTokenInPendlePT Whether the input token is a Pendle Principal Token
    /// @param isTokenOutPendlePT Whether the output token is a Pendle Principal Token
    struct SwapRouterData {
        bytes swapData;
        bool isTokenInPendlePT;
        bool isTokenOutPendlePT;
    }

    address immutable pendleRouter;
    address immutable pendleSwap;

    /// @notice Initializes the swap router with Pendle protocol addresses
    /// @param pendleRouter_ Address of the Pendle router contract
    /// @param pendleSwap_ Address of the Pendle swap aggregator contract
    constructor(address pendleRouter_, address pendleSwap_) {
        if (pendleRouter_ == address(0)) revert InvalidPendleRouterAddress();
        if (pendleSwap_ == address(0)) revert InvalidPendleSwapAddress();
        pendleRouter = pendleRouter_;
        pendleSwap = pendleSwap_;

        previewMapping[this.swapHook.selector] = this.previewSwap.selector;
    }

    /// @notice Executes a token swap based on the provided parameters
    /// @dev Routes swaps through different Pendle functions based on token types and PT expiry status
    /// @dev Reverts if both input and output tokens are Pendle PTs
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of input tokens to swap
    /// @param data Swap routing data containing swap parameters and token type flags
    function swap(address tokenIn, uint256 amountIn, bool usePermit2, SwapRouterData calldata data) external{
        if (usePermit2){
            Permit2Lib.PERMIT2.transferFrom(msg.sender, address(this), amountIn.toUint160(), tokenIn);

        } else {
            ERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        
        _swapInternal(tokenIn, amountIn, data);
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Executes a token swap using the provided input parameters and additional swap data.
    /// @dev Decodes the additional calldata into SwapRouterData and calls the internal swap function.
    /// @param input Struct containing the input token address, maximum input amount, and additional calldata for the swap.
    function swapHook(
        ActionHookInput calldata input
    ) external nonReentrant onlyFlashLoanContext(input.user) {
        address tokenIn = input.inputToken;
        uint256 amountIn = input.maxInputAmount;
        SwapRouterData memory data = abi.decode(input.additionalCalldata, (SwapRouterData));
        _swapInternal(tokenIn, amountIn, data);
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /// @notice Previews a token swap operation without executing it
    /// @dev Returns expected input/output tokens and amounts for the swap
    /// @dev Marks the operation as non-deterministic since actual swap output depends on market conditions
    /// @dev Reverts if input and output tokens are the same
    /// @param actionHookInput The swap parameters containing input/output token addresses and amounts
    /// @return preview A PreviewAction struct containing expected input token, input amount, output token, output amount, and determinism flag
    function previewSwap(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {

        if (actionHookInput.inputToken == actionHookInput.outputToken) {
            revert InputOutputTokenCollision();
        }

        PreviewAction memory preview = PreviewAction({
            expectedInputToken: actionHookInput.inputToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: actionHookInput.outputToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: false
        });
        return preview;
    }

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    function _swapInternal(address tokenIn, uint256 amountIn, SwapRouterData memory data) internal {
        if (data.isTokenInPendlePT && data.isTokenOutPendlePT){
            revert BothTokensCannotBePendlePT();
        }
        if(data.isTokenInPendlePT){
            ERC20(tokenIn).forceApprove(
                address(pendleRouter),
                amountIn
            );
            uint256 expiry = IPPrincipalToken(tokenIn).expiry();
            if (block.timestamp >= expiry) {
                (address receiver, address market, uint256 netPtIn, uint256 netLpIn, TokenOutput memory output) = abi.decode(data.swapData, (address, address, uint256, uint256, TokenOutput));
                if (netPtIn != amountIn) revert InputAmountMismatch();
                IPActionMiscV3(pendleRouter).exitPostExpToToken(
                    receiver,
                    market,
                    netPtIn,
                    netLpIn,
                    output
                );

            }
            else {
                (address receiver, address market, uint256 exactPtIn, TokenOutput memory output, LimitOrderData memory limit) = abi.decode(data.swapData, (address, address, uint256, TokenOutput, LimitOrderData));
                if (exactPtIn != amountIn) revert InputAmountMismatch();
                IPActionSwapPTV3(pendleRouter).swapExactPtForToken(
                    receiver,
                    market,
                    exactPtIn,
                    output,
                    limit
                );
            }
            ERC20(tokenIn).forceApprove(
                address(pendleRouter),
                0
            );
        } else if (data.isTokenOutPendlePT){
            ERC20(tokenIn).forceApprove(
                address(pendleRouter),
                amountIn
            );
            (address receiver, address market, uint256 minPtOut, ApproxParams memory guessPtOut, TokenInput memory input, LimitOrderData memory limit) = abi.decode(data.swapData, (address, address, uint256, ApproxParams, TokenInput, LimitOrderData));
            if (input.netTokenIn != amountIn) {
                revert InputAmountMismatch();
            }
            IPActionSwapPTV3(pendleRouter).swapExactTokenForPt(
                receiver,
                market,
                minPtOut,
                guessPtOut,
                input,
                limit
            );
            ERC20(tokenIn).forceApprove(
                address(pendleRouter),
                0
            );
        } else {
            ERC20(tokenIn).safeTransfer(pendleSwap, amountIn);
            SwapData memory swapData = abi.decode(data.swapData, (SwapData));
            IPSwapAggregator(pendleSwap).swap(tokenIn, amountIn, swapData);
        }
    }
}
