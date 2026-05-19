//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermPriceConsumerV3WithSequencer} from "../TermPriceConsumerV3WithSequencer.sol";

contract TestTermPriceConsumerV3WithSequencer is TermPriceConsumerV3WithSequencer {
    function upgrade(address upgradeAddress) external view {
        _authorizeUpgrade(upgradeAddress);
    }
}
