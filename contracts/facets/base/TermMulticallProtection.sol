//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermStorage} from "../../libraries/LibTermStorage.sol";

/// @title Term Multicall Protection Base Contract
/// @notice Provides protection mechanisms for multicall operations in Term Finance protocol
/// @dev Abstract base contract that prevents unauthorized multicall execution and reentrancy
abstract contract TermMulticallProtection {
    
    address constant UNSET_MULTICALL_INITIATOR = address(0);
    
    modifier onlyMulticallInitiator() {
        LibTermStorage.requireMulticallInitiator();
        _;
    }

    modifier initiateMulticallProtection() {
        TermStorage storage ts = LibTermStorage.termStorage();
        require(ts.multicallInitiator == UNSET_MULTICALL_INITIATOR, "Multicall already initiated");
        ts.multicallInitiator = msg.sender;
        _;
        ts.multicallInitiator = UNSET_MULTICALL_INITIATOR;
    }

    function initiator() internal view returns (address) {
        TermStorage storage ts = LibTermStorage.termStorage();
        return ts.multicallInitiator;
    }

    /// @dev Bubbles up the revert reason / custom error encoded in `returnData`.
    /// @dev Assumes `returnData` is the return data of any kind of failing CALL to a contract.
    function _revert(bytes memory returnData) internal pure {
        uint256 length = returnData.length;
        require(length > 0, "call reverted");

        assembly ("memory-safe") {
            revert(add(32, returnData), length)
        }
    }
}