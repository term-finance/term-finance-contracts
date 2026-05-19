//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermRepoLocker} from "../TermRepoLocker.sol";

contract TestTermRepoLocker is TermRepoLocker {
    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
