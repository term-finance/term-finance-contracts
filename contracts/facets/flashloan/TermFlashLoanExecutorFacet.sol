//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IDiamondLoupe} from "../DiamondLoupeFacet.sol";
import {ITermFlashLoan} from "../../interfaces/ITermFlashLoan.sol";
import {PreviewAction} from "../../lib/PreviewAction.sol";

import {TermFlashBase} from "../base/TermFlashBase.sol";
import {TermFlashHookFacet} from "../base/TermFlashHookFacet.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

interface IFlashLoanAggregator {
    function flashLoan(
        address[] memory _tokens,
        uint256[] memory _amounts,
        uint256 _route,
        bytes calldata _data,
        bytes calldata // kept for future use by instadapp. Currently not used anywhere.
    ) external;
}

/// @title TermFlashLoanExecutorFacet
/// @notice Diamond facet that orchestrates multi-step flash-loan-funded action pipelines.
/// @dev Users submit a `FlashExecuteRequest` containing an ordered list of actions (e.g. repay
///      debt, withdraw collateral, deposit into a vault, borrow on another protocol). The facet:
///      1. Previews the first action to determine the required flash loan amount.
///      2. Borrows that amount from the flash loan aggregator (Instadapp).
///      3. In the callback, sequentially executes each action via `delegatecall`-style routing
///         through the diamond, snapshotting token balances before/after each step.
///      4. Optionally back-propagates minimum output requirements from the final repayment
///         amount through the pipeline to tighten intermediate limits.
///      5. Repays the flash loan (principal + premium) and refunds any surplus to the user.
contract TermFlashLoanExecutorFacet is
    ITermFlashLoan,
    TermFlashBase
{
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when actions array in the flash execute request is empty
    error EmptyActions();

    /// @notice Thrown when the preview expected input amount exceeds the user's max input amount
    error ExpectedInputExceedsMax(uint256 actionIndex);

    /// @notice Thrown when the preview expected output amount is below the user's min output amount
    error ExpectedOutputBelowMin(uint256 actionIndex);

    /// @notice Thrown when the final token does not match the expected token during flash loan execution.
    error FinalOutputTokenMismatch();

    /// @notice Thrown when the final output token or amount is incompatible with flash loan repayment
    error FlashloanRepayIncompatible();

    /// @notice Thrown when flash loan amount is insufficient to cover the debt repayment
    error IncorrectFlashLoanAmount();

    /// @notice Thrown when actual input spent exceeds the max input amount for a pipeline step
    error InputAmountExceeded(uint256 actionIndex);

    /// @notice Thrown when the input token and output token for a pipeline step are the same
    error InputTokenMatchesOutputToken(uint256 actionIndex);

    /// @notice Thrown when the current token doesn't match the expected input token for a pipeline step
    error InputTokenMismatch(uint256 actionIndex);

    /// @notice Thrown when flash loan asset doesn't match expected asset
    error InvalidFlashloanAsset();

    /// @notice Thrown when flash loan received doesn't match expected parameters
    error InvalidFlashLoanReceived();

    /// @notice Thrown when the current token doesn't match the user-defined input token at a pipeline step
    error InvalidInputToken(uint256 actionIndex);

    /// @notice Thrown when no tokens are received from a pipeline step
    error NoTokensReceived();

    /// @notice Thrown when actual output gained is below the minimum output amount for a pipeline step
    error OutputAmountInsufficient(uint256 actionIndex);

    /// @notice Thrown when the actual output token doesn't match the user-defined output token
    error OutputTokenMismatch(uint256 actionIndex);

    /// @notice Thrown when a facet selector is not found in the diamond
    error SelectorNotFound();

    /// @notice Thrown when flashloan execute user is not the authorized caller
    error UserNotFlashLoanInitiator();

    /// @notice Thrown when a pipeline step has a zero address as input token
    error ZeroInputToken(uint256 actionIndex);

    /// @notice Thrown when a pipeline step has a zero address as output token
    error ZeroOutputToken(uint256 actionIndex);

    // ========================================================================
    // = Structs  =============================================================
    // ========================================================================

    /// @notice A single step in the flash loan execution pipeline.
    /// @param inputToken The token consumed by this step.
    /// @param maxInputAmount The maximum amount of `inputToken` this step is allowed to spend.
    /// @param outputToken The token produced by this step.
    /// @param minOutputAmount The minimum amount of `outputToken` this step must produce.
    /// @param outputTokenAmountIn Optional extra amount of `outputToken` that is transferred in and added to this step's output after it executes (and before the next step).
    /// @param usePermit2ForOutputTokenIn Whether to use Permit2 for the `outputTokenAmountIn` transfer.
    /// @param method The function selector on the target facet to call for this step.
    /// @param targetAddress The external protocol or contract address the action interacts with.
    /// @param additionalCalldata Extra calldata forwarded to the action (e.g. Permit2 flag, market ID).
    struct Action {
        address inputToken;
        uint256 maxInputAmount;
        address outputToken;
        uint256 minOutputAmount;
        uint256 outputTokenAmountIn; // optional extra outputToken added to this step's output after execution
        bool usePermit2ForOutputTokenIn;
        bytes4 method;
        address targetAddress;
        bytes additionalCalldata;
    }

    /// @notice User-facing request to initiate a flash-loan-funded action pipeline.
    /// @param flashLoanRoute The Instadapp aggregator route ID for sourcing the flash loan.
    /// @param flashLoanInstaData Extra data passed to the Instadapp aggregator (reserved for future use).
    /// @param flashLoanToken The token to borrow via flash loan (must match the first action's input and last action's output).
    /// @param actions The ordered list of pipeline steps to execute within the flash loan callback. Must contain at least 2 actions.
    /// @param backPropagate Whether to back-propagate the flash loan repayment amount through the pipeline to tighten intermediate limits.
    struct FlashExecuteRequest {
        uint256 flashLoanRoute;
        bytes flashLoanInstaData;
        address flashLoanToken;
        Action[] actions;
        bool backPropagate;
    }

    /// @notice Internal execution plan constructed from a `FlashExecuteRequest` after previewing the first action.
    /// @param user The address that initiated the flash loan pipeline.
    /// @param flashLoanToken The token borrowed via flash loan.
    /// @param flashLoanAmount The amount borrowed, determined by previewing the first action.
    /// @param actions The ordered list of pipeline steps to execute.
    /// @param backPropagate Whether to back-propagate minimum output requirements from the repayment amount.
    struct ExecutionPlan {
        address user;
        address flashLoanToken;
        uint256 flashLoanAmount;
        Action[] actions;
        bool backPropagate;
    }

    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================

    address immutable flashLoanAggregatorContract;

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    constructor(address flashLoanAggregator_) {
        flashLoanAggregatorContract = flashLoanAggregator_;
    }

    // ========================================================================
    // = Interface/API ========================================================
    // ========================================================================

    /// @notice Entry point for executing a multi-step action pipeline funded by a flash loan.
    /// @dev Sets the caller as the flash loan borrower context, previews the first action to
    ///      determine the required flash loan amount, validates that the first action's input
    ///      token and the last action's output token both match the flash loan token, then
    ///      initiates the flash loan via the aggregator. Execution of the action pipeline
    ///      continues in `flashExecuteCallback`.
    /// @param flashExecuteRequest The request containing the flash loan route, token, ordered
    ///        list of actions, and whether to back-propagate minimum output requirements.
    function flashExecute(
        FlashExecuteRequest memory flashExecuteRequest
    ) external {

        if (flashExecuteRequest.actions.length == 0) {
             revert EmptyActions();
         }

        // Set flashloan context for the borrower who initiated this operation
        _setFlashLoanBorrower(msg.sender);

        TermFlashLoanCallback memory termFlashLoanCallback = TermFlashLoanCallback({
                callbackFacet: IDiamondLoupe(address(this)).facetAddress(this.flashExecuteCallback.selector),
                selector: this.flashExecuteCallback.selector
        });

        /// @dev Generate preview of the first action to validate the flash loan input token and amount before initiating the flash loan
        (
            PreviewAction memory previewAction,
            
        ) = _generateActionCalldata(
            msg.sender,
            flashExecuteRequest.actions[0]
        );

        if (previewAction.expectedInputToken != flashExecuteRequest.flashLoanToken) {
            revert InvalidInputToken(0);
        }

        if (flashExecuteRequest.actions[flashExecuteRequest.actions.length - 1].outputToken != flashExecuteRequest.flashLoanToken){
            revert FinalOutputTokenMismatch();
        }

        ExecutionPlan memory executionPlan = ExecutionPlan({
            user: msg.sender,
            flashLoanToken: flashExecuteRequest.flashLoanToken,
            flashLoanAmount: previewAction.expectedInputAmount,
            actions: flashExecuteRequest.actions,
            backPropagate: flashExecuteRequest.backPropagate
        });

        bytes memory executionPlanData = abi.encode(executionPlan);
        bytes memory flashLoanData = abi.encode(termFlashLoanCallback, executionPlanData);

        IFlashLoanAggregator(flashLoanAggregatorContract).flashLoan(
            _getTokens(flashExecuteRequest.flashLoanToken),
            _getAmounts(previewAction.expectedInputAmount),
            flashExecuteRequest.flashLoanRoute,
            flashLoanData,
            flashExecuteRequest.flashLoanInstaData
        );
    }


    /// @notice Callback invoked by the flash loan aggregator after flash-loaned funds are received
    /// @dev Decodes the execution plan from `data`, validates the flash loan parameters, then
    ///      sequentially executes each action in the pipeline. After all actions complete, repays
    ///      the flash loan (principal + premium) and refunds any surplus to the user. Clears the
    ///      flash loan borrower context on completion.
    /// @param assets The addresses of the flash-loaned assets (must be a single-element array)
    /// @param amounts The amounts of each flash-loaned asset (must be a single-element array)
    /// @param premiums The fee amounts owed on each flash-loaned asset (must be a single-element array)
    /// @param initiator The address that initiated the flash loan (validated via `validateCallback`)
    /// @param data ABI-encoded `(TermFlashLoanCallback, ExecutionPlan)` containing the action pipeline
    /// @return success True if the callback executed and repaid the flash loan successfully
    function flashExecuteCallback(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata data
    ) external validateCallback(flashLoanAggregatorContract, initiator) returns (bool success) {
        ( , bytes memory executionPlanData) = abi.decode(data, (TermFlashLoanCallback, bytes));
        ExecutionPlan memory executionPlan = abi.decode(executionPlanData, (ExecutionPlan));

        if (_getFlashLoanBorrower() != executionPlan.user) {
            revert UserNotFlashLoanInitiator();
        }

        if(assets.length != 1 || amounts.length != 1 || premiums.length != 1) {
            revert InvalidFlashLoanReceived();
        }

        // Validate that assets[0] is the debt asset
        if (assets[0] != executionPlan.flashLoanToken) revert InvalidFlashloanAsset();
        if (amounts[0] != executionPlan.flashLoanAmount) revert IncorrectFlashLoanAmount();

        // Calculate amount owing to flash loan provider
        uint256 amountOwing = amounts[0] + premiums[0];

        // Enforce final action produces at least enough to repay the flash loan
        if (executionPlan.backPropagate) {
            executionPlan = _backPropagateMinOutputs(executionPlan, amountOwing);
        } else {
            uint256 lastActionIndex = executionPlan.actions.length - 1;
            uint256 lastDeposit = executionPlan.actions[lastActionIndex].outputTokenAmountIn;
            uint256 requiredFinalOutput = amountOwing > lastDeposit ? amountOwing - lastDeposit : 0;
            if (requiredFinalOutput > executionPlan.actions[lastActionIndex].minOutputAmount) {
                executionPlan.actions[lastActionIndex].minOutputAmount = requiredFinalOutput;
            }
        }

        address currentInputToken = assets[0];
        uint256 currentInputAmount = amounts[0];
        uint256 actualInputSpent;
        uint256 actualOutputGained;
        address actualOutputToken;

        for (uint256 i = 0; i < executionPlan.actions.length; i++) {

            // Validate action inputToken
            if (executionPlan.actions[i].inputToken == address(0)){
                revert ZeroInputToken(i);
            }

            // Validate action outputToken
            if (executionPlan.actions[i].outputToken == address(0)){
                revert ZeroOutputToken(i);
            }

            // Validate input and output tokens are not the same
            if (executionPlan.actions[i].inputToken == executionPlan.actions[i].outputToken){
                revert InputTokenMatchesOutputToken(i);
            }
            
            //  Validate current input token matches user defined input token
            if (currentInputToken != executionPlan.actions[i].inputToken){
                revert InvalidInputToken(i);
            }

            // Allow spend up to max and/or what is available
            if (currentInputAmount < executionPlan.actions[i].maxInputAmount){
                executionPlan.actions[i].maxInputAmount = currentInputAmount;
            }

            // Execute the action: preview, validate, and perform the on-chain call
            (actualOutputToken, actualOutputGained, actualInputSpent) = _executePipelineStep(
                executionPlan.user,
                executionPlan.actions[i],
                i
            );

            // Revert if more input was consumed than the allowed maximum
            if (actualInputSpent > executionPlan.actions[i].maxInputAmount) {
                revert InputAmountExceeded(i);
            }

            // Revert if output received is below the required minimum
            if (actualOutputGained < executionPlan.actions[i].minOutputAmount){
                revert OutputAmountInsufficient(i);
            }

            // Transfer in additional output tokens from user where specified
            uint256 outputTokenAmountIn = executionPlan.actions[i].outputTokenAmountIn;
            if (outputTokenAmountIn > 0) {
                if (executionPlan.actions[i].usePermit2ForOutputTokenIn){
                    Permit2Lib.PERMIT2.transferFrom(
                        executionPlan.user,
                        address(this),
                        outputTokenAmountIn.toUint160(),
                        actualOutputToken
                    );
                } else {
                    IERC20(actualOutputToken).safeTransferFrom(
                        executionPlan.user,
                        address(this),
                        outputTokenAmountIn
                    );
                }
                actualOutputGained += outputTokenAmountIn;
            }

            // Refund any unspent input tokens back to the user
            if (currentInputAmount > actualInputSpent) {
                IERC20(currentInputToken).safeTransfer(executionPlan.user, currentInputAmount - actualInputSpent);
            }
            currentInputToken = actualOutputToken;
            currentInputAmount  = actualOutputGained;
        }

        if (currentInputToken != executionPlan.flashLoanToken || currentInputAmount < amountOwing) {
            revert FlashloanRepayIncompatible();
        }

        //repay flashloan
        IERC20(currentInputToken).safeTransfer(msg.sender, amountOwing);

        if (currentInputAmount > amountOwing) {
            IERC20(currentInputToken).safeTransfer(executionPlan.user, currentInputAmount - amountOwing);
        }

        // Clear flashloan context after operations complete
        _clearFlashLoanBorrower();

        return true;
    }

    /// @notice Simulates backpropagation of output requirements across an execution plan.
    /// @param executionPlan The proposed execution plan to validate and tighten
    /// @param amountOwing The flash loan principal + premium the final action must cover
    /// @return The adjusted execution plan with tightened minOutputAmount and maxInputAmount values
    function quoteExecutionPlan(
        ExecutionPlan memory executionPlan,
        uint256 amountOwing
    ) external view returns (ExecutionPlan memory) {
        return _backPropagateMinOutputs(executionPlan, amountOwing);
    }

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

   
    function _getAmounts(uint256 flashLoanAmount) internal pure returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = flashLoanAmount;
        return amounts;
    }

    function _getTokens(address flashLoanToken) internal pure returns (address[] memory) {
        address[] memory tokens = new address[](1);
        tokens[0] = flashLoanToken;
        return tokens;
    }

    function _executePipelineStep(address user, Action memory action, uint256 index) private returns (address,uint256,uint256) {

        // Generate calldata
        (PreviewAction memory previewAction, bytes memory encodedCalldata) = _generateActionCalldata(user, action);
        
        // Validate actual output token matches user defined output token
        if (action.inputToken != previewAction.expectedInputToken) {
            revert InputTokenMismatch(index);
        }

        if (action.maxInputAmount < previewAction.expectedInputAmount) {
            revert ExpectedInputExceedsMax(index);
        }

        // Validate actual output token matches user defined output token
        if (action.outputToken != previewAction.expectedOutputToken) {
            revert OutputTokenMismatch(index);
        }

        if (previewAction.isDeterministic && action.minOutputAmount > previewAction.expectedOutputAmount) {
            revert ExpectedOutputBelowMin(index);
        }

        // Execute calldata
        (uint256 actualOutputGained, uint256 actualInputSpent) = _executeCallAndGetTokenBalances(encodedCalldata, action.inputToken, action.outputToken);

        return (action.outputToken, actualOutputGained, actualInputSpent);
    }

    function _getFacetAddress(bytes4 selector) private view returns(address) {
        address facetAddress = IDiamondLoupe(address(this)).facetAddress(selector);

        if (facetAddress == address(0)){
            revert SelectorNotFound();
        }

        return facetAddress;
    }


    function _generateActionCalldata(
        address user,
        Action memory action
    ) private view returns (PreviewAction memory, bytes memory) {
        bytes memory encodeGenerateCalldataInput;
        address facetAddress = _getFacetAddress(action.method);
        bytes4 sig = TermFlashHookFacet.generateActionCalldata.selector;
        encodeGenerateCalldataInput = abi.encodeWithSelector(
            sig,
            user,
            action.inputToken,
            action.maxInputAmount,
            action.outputToken,
            action.minOutputAmount,
            action.method,
            action.targetAddress,
            action.additionalCalldata
        );

        bytes memory generateCalldataReturn = Address.functionStaticCall(facetAddress, encodeGenerateCalldataInput);

        return abi.decode(generateCalldataReturn, (PreviewAction, bytes));
    }

    function _backPropagateMinOutputs(
        ExecutionPlan memory executionPlan,
        uint256 amountOwing
    ) private view returns (ExecutionPlan memory) {
        uint256 requiredOut = amountOwing;

        PreviewAction memory previewAction;
        Action memory action;
        for (uint256 i = executionPlan.actions.length; i > 0; ) {
            unchecked { --i; }

            action = executionPlan.actions[i];
            uint256 originalMinOutput = action.minOutputAmount;
            uint256 outputTokenAmountIn = action.outputTokenAmountIn;
            action.minOutputAmount = requiredOut > outputTokenAmountIn ? requiredOut - outputTokenAmountIn : 0;

            (previewAction,) = _generateActionCalldata(executionPlan.user, action);

            // Restore floor protection for non-deterministic actions
            if (!previewAction.isDeterministic && originalMinOutput > action.minOutputAmount) {
                action.minOutputAmount = originalMinOutput;
            }

            // Validate actual input token matches user defined input token
            if (action.inputToken != previewAction.expectedInputToken) {
                revert InputTokenMismatch(i);
            }

            // Validate actual output token matches user defined output token
            if (action.outputToken != previewAction.expectedOutputToken) {
                revert OutputTokenMismatch(i);
            }

            if (action.maxInputAmount < previewAction.expectedInputAmount) {
                revert ExpectedInputExceedsMax(i);
            }

            // Pin to exact input
            if(previewAction.isDeterministic) {
                action.maxInputAmount = previewAction.expectedInputAmount;
            }

            requiredOut = previewAction.expectedInputAmount;
            executionPlan.actions[i] = action;            
        }

        return executionPlan;
    }

    function _executeCallAndGetTokenBalances(bytes memory encodedCalldata, address tokenIn, address tokenOut) private returns (uint256,uint256) {
        IERC20 tokenInERC20 = IERC20(tokenIn);
        IERC20 tokenOutERC20 = IERC20(tokenOut);

        // Snapshot token balances before execution
        uint256 tokenInBalanceBefore = tokenInERC20.balanceOf(address(this));
        uint256 tokenOutBalanceBefore = tokenOutERC20.balanceOf(address(this));

        // Execute the encoded call against this contract
        Address.functionCall(address(this), encodedCalldata);

        // Verify output tokens were received and revert if not
        uint256 tokenInBalanceAfter = tokenInERC20.balanceOf(address(this));
        uint256 tokenOutBalanceAfter = tokenOutERC20.balanceOf(address(this));
        if (tokenOutBalanceAfter <= tokenOutBalanceBefore) {
            revert NoTokensReceived();
        }

        // Calculate net token deltas from the execution
        uint256 actualOutputGained = tokenOutBalanceAfter - tokenOutBalanceBefore;
        uint256 actualInputSpent = tokenInBalanceAfter < tokenInBalanceBefore ? tokenInBalanceBefore - tokenInBalanceAfter : 0;
        return (actualOutputGained, actualInputSpent);
    } 
}


