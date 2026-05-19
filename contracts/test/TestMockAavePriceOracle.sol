//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockAavePriceOracle
/// @notice Mock Aave price oracle for testing
contract TestMockAavePriceOracle {
    mapping(address => uint256) private _prices;

    function setAssetPrice(address asset, uint256 price) external {
        _prices[asset] = price;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return _prices[asset];
    }
}
