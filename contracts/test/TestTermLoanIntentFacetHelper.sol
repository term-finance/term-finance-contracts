//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

/// @title TestTermLoanIntentFacetHelper
/// @notice Provides storage manipulation functions for testing TermLoanIntentFacet
contract TestTermLoanIntentFacetHelper {
    function setMulticallInitiator(address _initiator) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = _initiator;
    }

    function clearMulticallInitiator() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = address(0);
    }
}
