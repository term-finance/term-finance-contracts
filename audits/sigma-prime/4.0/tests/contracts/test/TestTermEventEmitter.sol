//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermEventEmitter} from "../TermEventEmitter.sol";

contract TestTermEventEmitter is TermEventEmitter {
    function upgrade(address upgradeAddress) external view {
        _authorizeUpgrade(upgradeAddress);
    }
}
