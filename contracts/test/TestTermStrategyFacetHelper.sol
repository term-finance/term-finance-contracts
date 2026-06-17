//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermStrategyFacet, IStrategy} from "../facets/TermStrategyFacet.sol";
import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";

/// @title TestTermStrategyFacetHelper
/// @notice Extends TermStrategyFacet with storage manipulation functions for testing
contract TestTermStrategyFacetHelper is TermStrategyFacet {
    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllers[controller] = true;
    }

    function setActiveFlashLoanBorrower(address borrower) external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = borrower;
    }

    function clearActiveFlashLoanBorrower() external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = address(0);
    }

    function setEmitter(address emitter) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.emitter = ITermEventEmitter(emitter);
    }

    /// @notice Exposes _mintAndSellRepoTokenInternal so tests can cover the payoutToUser=false branch
    function mintAndSellRepoTokenInternalExposed(
        IStrategy strategy,
        address termRepoServicer,
        address borrower,
        uint256 borrowAmount,
        uint256[] memory collateralAmounts,
        bool payoutToUser
    ) external nonReentrant returns (uint256) {
        return _mintAndSellRepoTokenInternal(
            strategy,
            termRepoServicer,
            borrower,
            borrowAmount,
            collateralAmounts,
            payoutToUser
        );
    }
}
