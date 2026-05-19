//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {SwapRouterFacet} from "../facets/SwapRouterFacet.sol";
import {LibTermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";

/// @title TestSwapRouterFacetHelper
/// @notice Extends SwapRouterFacet with storage manipulation functions for testing
contract TestSwapRouterFacetHelper is SwapRouterFacet {
    constructor(address pendleRouter_, address pendleSwap_) SwapRouterFacet(pendleRouter_, pendleSwap_) {}

    function setActiveFlashLoanBorrower(address borrower) external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = borrower;
    }

    function clearActiveFlashLoanBorrower() external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = address(0);
    }
}
