//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {PreviewAction} from "../../lib/PreviewAction.sol";
import {ActionHookInput} from "../../lib/ActionHookInput.sol"; 

import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title TermFlashHookFacet
/// @notice Abstract base facet for generating previewed action calldata used by flash loan hook workflows.
/// @dev Inheriting facets register action selectors to corresponding preview selectors via `previewMapping`.
///      `generateActionCalldata` uses this mapping to preview an action (via static call to self) and then
///      encode the final calldata with the previewed token amounts. This allows callers to simulate an
///      action's expected inputs/outputs before building the execution payload.
abstract contract TermFlashHookFacet {
    using Address for address;


    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================

    /// @notice Maps an action selector to its corresponding preview function selector.
    mapping(bytes4 => bytes4) public previewMapping;

    // ========================================================================
    // = Custom Errors  =======================================================
    // ========================================================================

    /// @notice Thrown when the input and output tokens for an action are the same, which is not allowed.
    error InputOutputTokenCollision();

    /// @notice Thrown when `generateActionCalldata` is called with a selector that has no registered preview mapping.
    error UnsupportedHookSelector();

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================
    
    /// @notice Generates a preview and encoded calldata for a given action selector.
    /// @dev Looks up the corresponding preview function via `previewMapping`, invokes it to
    ///      compute expected input/output amounts, then encodes the final action calldata
    ///      with the previewed values.
    /// @param user The address of the user performing the action.
    /// @param inputToken The address of the token being provided as input.
    /// @param maxInputAmount The maximum amount of `inputToken` the user is willing to spend.
    /// @param outputToken The address of the desired output token.
    /// @param minOutputAmount The minimum amount of `outputToken` the user expects to receive.
    /// @param selector The function selector of the action to execute.
    /// @param targetAddress The target contract address for the action (e.g., an ERC4626 vault).
    /// @param additionalCalldata Any extra calldata to pass through to the action.
    /// @return previewAction The previewed action containing expected input/output tokens and amounts.
    /// @return encodedCalldata The ABI-encoded calldata ready to be used to execute the action.
    function generateActionCalldata (
        address user,
        address inputToken,
        uint256 maxInputAmount,
        address outputToken,
        uint256 minOutputAmount,
        bytes4 selector,
        address targetAddress,
        bytes memory additionalCalldata
    ) external view returns (PreviewAction memory, bytes memory) {
        bytes4 previewSig = previewMapping[selector];
        if (previewSig == bytes4(0)){
            revert UnsupportedHookSelector();
        }

        ActionHookInput memory actionHookInput = ActionHookInput({
            user: user,
            inputToken: inputToken,
            maxInputAmount: maxInputAmount,
            outputToken: outputToken,
            minOutputAmount: minOutputAmount,
            targetAddress: targetAddress,
            additionalCalldata: additionalCalldata
        });

        bytes memory returnData = Address.functionStaticCall(
            address(this),
            abi.encodeWithSelector(previewSig, actionHookInput)
        );

        PreviewAction memory previewAction = abi.decode(returnData, (PreviewAction));    

        ActionHookInput memory previewActionHookInput = ActionHookInput({
            user: user,
            inputToken: previewAction.expectedInputToken,
            maxInputAmount: previewAction.expectedInputAmount,
            outputToken: previewAction.expectedOutputToken,
            minOutputAmount: previewAction.expectedOutputAmount,
            targetAddress: targetAddress,
            additionalCalldata: additionalCalldata
        });

        bytes memory encodedCalldata = abi.encodeWithSelector(
            selector, previewActionHookInput
        );

        return (previewAction, encodedCalldata);
    }

}