//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {PermitFacet} from "../facets/PermitFacet.sol";
import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

/// @title TestPermitFacetHelper
/// @notice Extends PermitFacet with storage manipulation functions for testing
contract TestPermitFacetHelper is PermitFacet {
    function setMulticallInitiator(address _initiator) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = _initiator;
    }

    function clearMulticallInitiator() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = address(0);
    }

    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllerList.push(controller);
        ts.approvedTermControllers[controller] = true;
    }

    function clearApprovedTermControllers() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        delete ts.approvedTermControllerList;
    }
}
