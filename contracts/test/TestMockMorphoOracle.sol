//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockMorphoOracle
/// @notice Minimal mock for IOracle (Morpho price oracle) — returns a configurable price
contract TestMockMorphoOracle {
    uint256 private _price;

    function setPrice(uint256 price_) external {
        _price = price_;
    }

    function price() external view returns (uint256) {
        return _price;
    }
}
