//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.22;

import {TermRepoRolloverElection} from "../lib/TermRepoRolloverElection.sol";
import {TermRepoRolloverElectionSubmission} from "../lib/TermRepoRolloverElectionSubmission.sol";
import {ITermController} from "./ITermController.sol";

interface ITermRepoRolloverManager {

    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================
    function termController() external view returns (ITermController);

    // ========================================================================
    // = APIs  ================================================================
    // ========================================================================

    /// @notice An external function that accepted Term Repo rollover instructions
    /// @param termRepoRolloverElectionSubmission A struct containing borrower rollover instructions
    function electRollover(
        TermRepoRolloverElectionSubmission
            calldata termRepoRolloverElectionSubmission
    ) external;

    /// @notice Elect rollover on behalf of a borrower (DIAMOND_ROLE)
    /// @param borrower The address of the borrower for whom rollover is being elected
    /// @param termRepoRolloverElectionSubmission A struct containing borrower rollover instructions
    function electRollover(
        address borrower,
        TermRepoRolloverElectionSubmission
            calldata termRepoRolloverElectionSubmission
    ) external;

    /// @notice A view function that returns borrower rollover instructions
    /// @param borrower The address of the borrower
    /// @return A struct containing borrower rollover instructions
    function getRolloverInstructions(
        address borrower
    ) external view returns (TermRepoRolloverElection memory);

    /// @notice An external function to cancel previously submitted rollover instructions, if it hasn't been locked into an auction
    function cancelRollover() external;

    /// @notice Cancel rollover on behalf of a borrower (DIAMOND_ROLE)
    /// @param borrower The address of the borrower for whom rollover is being cancelled
    function cancelRollover(address borrower) external;

    
    // ========================================================================
    // = Fulfiller Functions ================================================
    // ========================================================================

    /// @notice An external function called by repo servicer to to mark rollover as fulfilled
    /// @param borrower The address of the borrower
    function fulfillRollover(address borrower) external;
}
