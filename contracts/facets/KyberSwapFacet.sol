//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {Versionable} from "../lib/Versionable.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";

/// @author TermLabs
/// @title KyberSwapFacet
/// @notice This facet enables token swaps via the Kyber Meta Aggregation Router V2 during Term contract operations
contract KyberSwapFacet is
    ReentrancyGuard,
    TermFlashHookFacet,
    TermMultiContextAuth,
    Versionable
{
    using SafeERC20 for ERC20;
    using Address for address;

    // ========================================================================

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when input amount doesn't match expected PT amount
    error InputAmountMismatch();

    /// @notice Thrown when Kyber Meta Aggregation Router V2 address is zero
    error InvalidKyberMetaAggregationRouterV2Address();

    address immutable kyberMetaAggregationRouterV2;

    /// @notice Initializes the swap router with Kyber Meta Aggregation Router V2 address
    /// @param kyberMetaAggregationRouterV2_ Address of the Kyber Meta Aggregation Router V2 contract
    constructor(address kyberMetaAggregationRouterV2_) {
        if (kyberMetaAggregationRouterV2_ == address(0))
            revert InvalidKyberMetaAggregationRouterV2Address();
        kyberMetaAggregationRouterV2 = kyberMetaAggregationRouterV2_;

        previewMapping[this.kyberSwapHook.selector] = this
            .previewKyberSwap
            .selector;
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Executes a token swap via Kyber Meta Aggregation Router V2
    /// @dev This function is called as a flash hook during a Term contract operation
    /// @param input Struct containing the input token address, maximum input amount, output token address
    function kyberSwapHook(
        ActionHookInput calldata input
    ) external nonReentrant onlyFlashLoanContext(input.user) {
        address tokenIn = input.inputToken;
        uint256 amountIn = input.maxInputAmount;
        bytes memory swapCalldata = abi.decode(
            input.additionalCalldata,
            (bytes)
        );
        _kyberSwapInternal(tokenIn, amountIn, swapCalldata);
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /// @notice Previews the expected outcome of a token swap without executing it.
    /// @dev Returns a PreviewAction struct containing expected input and output tokens and amounts.
    /// @param actionHookInput Struct containing the input token address, maximum input amount, output token address, minimum output amount, and additional calldata for the swap.
    /// @return preview A PreviewAction struct containing expected input and output tokens and amounts, and a flag indicating if the outcome is deterministic.
    function previewKyberSwap(
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

    /// @notice Internal function that executes the swap via Kyber Meta Aggregation Router V2
    /// @dev Approves the router, calls it with the calldata, then revokes the approval
    /// @param tokenIn The address of the input token
    /// @param amountIn The amount of input tokens to swap
    /// @param swapCalldata The encoded calldata for the swap
    function _kyberSwapInternal(
        address tokenIn,
        uint256 amountIn,
        bytes memory swapCalldata
    ) internal {
        // Approve Kyber Meta Aggregation Router V2 to spend input tokens
        ERC20(tokenIn).forceApprove(kyberMetaAggregationRouterV2, amountIn);

        // Execute the swap via Kyber Meta Aggregation Router V2
        kyberMetaAggregationRouterV2.functionCall(swapCalldata);
        // Revoke approval after swap
        ERC20(tokenIn).forceApprove(kyberMetaAggregationRouterV2, 0);
    }
}
