//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @notice Describes the expected token inputs and outputs of an action
/// @param expectedInputToken The token to be consumed by the action
/// @param expectedInputAmount The amount of input token to be consumed
/// @param expectedOutputToken The token to be produced by the action
/// @param expectedOutputAmount The amount of output token to be produced
/// @param isDeterministic Whether the action produces a deterministic amount of output token
struct PreviewAction {
    address expectedInputToken;
    uint256 expectedInputAmount;
    address expectedOutputToken;
    uint256 expectedOutputAmount;
    bool isDeterministic;  // swap-like, take user calldata as given
}