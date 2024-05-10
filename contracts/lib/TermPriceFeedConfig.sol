//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";


/// @dev TermPriceFeedConfig represents the price feed contracts and the 
struct TermPriceFeedConfig {
    /// @dev The price feed aggregator
    AggregatorV3Interface priceFeed;
    /// @dev Price Feed oracle refresh rate before determined to be stale
    uint256 refreshRateThreshold;
}
