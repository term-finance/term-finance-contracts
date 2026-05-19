//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermRepoRolloverManager} from "../TermRepoRolloverManager.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";

contract TestTermRepoRolloverManager is TermRepoRolloverManager {
    ///@dev only for test, repairs term contracts if a signer is needed to be paired to replace a fake contract
    function testRepairTermContracts(
        address termRepoServicer_,
        ITermEventEmitter emitter_
    ) external onlyRole(INITIALIZER_ROLE) {
        emitter = emitter_;
        _grantRole(ROLLOVER_BID_FULFILLER_ROLE, termRepoServicer_);

        emitter.emitTermRepoRolloverManagerInitialized(
            termRepoId,
            address(this)
        );
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
