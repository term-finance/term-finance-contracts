//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermRepoServicer} from "../TermRepoServicer.sol";

contract TestTermRepoServicer is TermRepoServicer {
    function setPurchaseCurrencyHeld(uint256 amount) external {
        totalRepurchaseCollected = amount;
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
