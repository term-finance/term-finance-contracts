//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermRepoToken} from "../TermRepoToken.sol";

contract TestTermRepoToken is TermRepoToken {
    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
