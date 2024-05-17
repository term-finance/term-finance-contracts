//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermPriceConsumerV3} from "../TermPriceConsumerV3.sol";

contract TestTermPriceConsumerV3 is TermPriceConsumerV3 {
    function upgrade(address upgradeAddress) external view {
        _authorizeUpgrade(upgradeAddress);
    }
}
