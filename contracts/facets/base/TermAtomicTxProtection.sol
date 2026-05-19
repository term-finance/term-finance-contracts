//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {LibTermStorage, TermStorage} from "../../libraries/LibTermStorage.sol";


abstract contract TermAtomicTxProtection {
    
    address constant UNSET_ATOMIC_TX_INITIATOR = address(0);
    
    modifier initiateAtomicTxProtection() {
        TermStorage storage ts = LibTermStorage.termStorage();
        require(ts.atomicTxInitiatior == UNSET_ATOMIC_TX_INITIATOR, "AtomicTx already initiated");
        ts.atomicTxInitiatior = msg.sender;
        _;
        ts.atomicTxInitiatior = UNSET_ATOMIC_TX_INITIATOR;
    }

    function atomicTxInitiator() internal view returns (address) {
        TermStorage storage ts = LibTermStorage.termStorage();
        return ts.atomicTxInitiatior;
    }
}