//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../../libraries/LibTermStorage.sol";

/// @title Term Multi-Context Authorization Contract
/// @author TermLabs
/// @notice Provides multi-context authorization mechanisms for user operations in Term Finance protocol
/// @dev Abstract base contract that implements authorization across multiple execution contexts (direct, settlement, flashloan, batch operations)
abstract contract TermMultiContextAuth {

    modifier onlyFlashLoanContext(address user) {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        require(
            (tflc.activeFlashLoanBorrower != address(0) &&
             tflc.activeFlashLoanBorrower == user),                  // Active flashloan for this user
            "Unauthorized caller"
        );
        _;
    }

    /// @notice Restricts function execution to the user directly or authorized contexts acting on their behalf
    /// @dev Allows execution when called by the user directly, during their order settlement, or during their flash loan
    /// @param user The address of the user whose assets or positions are being accessed
    modifier onlyUserOrActiveContext(address user) {
        TermStorage storage ts = LibTermStorage.termStorage();
        require(
            msg.sender == user || // Direct user call
            (
                msg.sender == address(this) &&
                ts.activeAtomicTxSettlementTaker != address(0) &&
                ts.activeAtomicTxSettlementTaker == user
            ) || // Diamond self-call during active atomic settlement for this user
            (ts.activeSettlementMaker != address(0) &&
             ts.activeSettlementMaker == user && msg.sender == address(this)),                    // Settlement context for this user
            "Unauthorized caller"
        );
        _;
    }

    /// @notice Restricts function execution to batch operation contexts initiated by the specified user
    /// @dev Only allows execution within atomic transaction or flash loan contexts for the specified user
    /// @param user The address of the user who must have initiated the batch operation
    modifier requireBatchContext(address user) {
        TermStorage storage ts = LibTermStorage.termStorage();
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        require(
            msg.sender == address(this) && (
                (ts.activeAtomicTxSettlementTaker != address(0) &&
                 ts.activeAtomicTxSettlementTaker == user) 
            ),
            "Batch context required"
        );
        _;
    }

    /// @notice Retrieves the address of the current active flash loan borrower
    /// @dev Returns the borrower address from TermFlashLoanContext if a flash loan is in progress, otherwise returns address(0)
    /// @return The address of the active flash loan borrower, or address(0) if no flash loan is active
    function getFlashLoanBorrower() internal view returns (address) {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        return tflc.activeFlashLoanBorrower;
    }
}