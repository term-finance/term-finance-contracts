//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

/// @title TestAtomicTxProtectionHelper
/// @notice Provides storage manipulation functions for testing reentrancy protection in TermAtomicTxProtection
contract TestAtomicTxProtectionHelper {
    function setAtomicTxInitiator(address a) external {
        LibTermStorage.termStorage().atomicTxInitiatior = a;
    }

    function clearAtomicTxInitiator() external {
        LibTermStorage.termStorage().atomicTxInitiatior = address(0);
    }
}
