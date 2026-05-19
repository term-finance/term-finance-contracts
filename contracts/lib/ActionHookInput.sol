//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @notice Input parameters for an action hook execution
/// @param user The address of the user initiating the action
/// @param inputToken The token to be consumed by the action
/// @param maxInputAmount The maximum amount of input token to be consumed
/// @param outputToken The token to be produced by the action
/// @param minOutputAmount The minimum amount of output token to be produced
/// @param targetAddress The address of the contract to execute the action on
/// @param additionalCalldata Additional calldata to pass to the target contract
struct ActionHookInput {
    address user;
    address inputToken;
    uint256 maxInputAmount;
    address outputToken;
    uint256 minOutputAmount;
    address targetAddress;
    bytes additionalCalldata;
}