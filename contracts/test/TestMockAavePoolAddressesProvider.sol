//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockAavePoolAddressesProvider
/// @notice Mock Aave pool addresses provider for testing
contract TestMockAavePoolAddressesProvider {
    address private _poolDataProvider;
    address private _priceOracle;

    function setPoolDataProvider(address dataProvider) external {
        _poolDataProvider = dataProvider;
    }

    function getPoolDataProvider() external view returns (address) {
        return _poolDataProvider;
    }

    function setPriceOracle(address oracle) external {
        _priceOracle = oracle;
    }

    function getPriceOracle() external view returns (address) {
        return _priceOracle;
    }
}
