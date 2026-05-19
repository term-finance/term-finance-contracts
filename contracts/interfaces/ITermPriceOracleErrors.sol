//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @notice ITermPriceOracleErrors defines all errors emitted by the PriceOracle.
interface ITermPriceOracleErrors {
    error GracePeriodNotOver();
    error NoPriceFeed(address tokenAddress);
    error SequencerDownError();
    error ZeroPrice();
    error InvalidPrice();
    error InvalidUpdateTimestamp();
    error PricesStale();
}
