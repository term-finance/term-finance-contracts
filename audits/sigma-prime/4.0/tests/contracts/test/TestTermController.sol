//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermController} from "../TermController.sol";

contract TestTermController is TermController {
    function upgrade(address upgradeAddress) external view {
        _authorizeUpgrade(upgradeAddress);
    }
}
