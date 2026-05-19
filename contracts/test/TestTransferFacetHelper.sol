//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TransferFacet} from "../facets/TransferFacet.sol";
import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";
import {LibAccessControl} from "../libraries/LibAccessControl.sol";

/// @title TestTransferFacetHelper
/// @notice Extends TransferFacet with storage manipulation functions for testing
contract TestTransferFacetHelper is TransferFacet {
    function setMulticallInitiator(address _initiator) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = _initiator;
    }

    function clearMulticallInitiator() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = address(0);
    }

    function grantAdminRole(address account) external {
        _grantRole(LibAccessControl.ADMIN_ROLE, account);
    }
}
