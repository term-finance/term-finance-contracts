//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermFlashLoanContext} from "../../libraries/LibTermStorage.sol";

/// @title Term Multicall Protection Base Contract
/// @notice Provides protection mechanisms for multicall operations in Term Finance protocol
/// @dev Abstract base contract that prevents unauthorized multicall execution and reentrancy
abstract contract TermFlashBase {

    // ========================================================================
    // = Constants  ===========================================================
    // ========================================================================

    address constant UNSET_FLASHLOAN_BORROWER = address(0);

    
    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================
    
    /// @notice Thrown when attempting to set a flashloan borrower while another flashloan is already active
    error FlashloanAlreadyActive();

    /// @notice Thrown when attempting to access flashloan borrower when no flashloan is active
    error FlashloanNotActive();
    
    /// @notice Thrown when caller is not the authorized caller
    error InvalidCaller();

    /// @notice Thrown when flash loan initiator is not authorized
    error InvalidInitiator();

    // ========================================================================
    // = Modifiers ============================================================
    // ========================================================================

    /// @notice Validates flashloan callback caller and initiator
    /// @param flashLoanAggregator Expected flash loan aggregator address
    /// @param initiator Expected initiator (should be diamond)
    modifier validateCallback(address flashLoanAggregator, address initiator) {
        if (msg.sender != flashLoanAggregator) revert InvalidCaller();
        if (initiator != address(this)) revert InvalidInitiator();
        _;
    }

    // ========================================================================
    // = Flashloan Context Management =========================================
    // ========================================================================

    /// @notice Retrieves the address of the active flashloan borrower
    /// @return The address of the borrower who initiated the current flashloan operation
    /// @dev Returns address(0) if no flashloan is currently active
    function _getFlashLoanBorrower() internal view returns (address) {
        TermFlashLoanContext storage ts = LibTermStorage.termFlashLoanContext();
        if (ts.activeFlashLoanBorrower == UNSET_FLASHLOAN_BORROWER) revert FlashloanNotActive();
        return ts.activeFlashLoanBorrower;
    }

    /// @notice Sets the active flashloan borrower in storage
    /// @param borrower The address of the borrower for the active flashloan
    function _setFlashLoanBorrower(address borrower) internal {
        TermFlashLoanContext storage ts = LibTermStorage.termFlashLoanContext();
        if (ts.activeFlashLoanBorrower != UNSET_FLASHLOAN_BORROWER) revert FlashloanAlreadyActive();
        ts.activeFlashLoanBorrower = borrower;
    }

    /// @notice Clears the active flashloan borrower from storage
    function _clearFlashLoanBorrower() internal {
        TermFlashLoanContext storage ts = LibTermStorage.termFlashLoanContext();
        if (ts.activeFlashLoanBorrower == UNSET_FLASHLOAN_BORROWER) revert FlashloanNotActive();
        ts.activeFlashLoanBorrower = UNSET_FLASHLOAN_BORROWER;
    }

}