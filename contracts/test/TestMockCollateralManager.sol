//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockCollateralManager
/// @notice Mock collateral manager for testing order fulfillment flows
contract TestMockCollateralManager {
    address[] private _collateralTokens;
    mapping(address => uint256) public maintenanceCollateralRatios;
    mapping(address => mapping(address => uint256)) private _collateralBalances;

    function setCollateralTokens(address[] calldata tokens) external {
        delete _collateralTokens;
        for (uint256 i = 0; i < tokens.length; i++) {
            _collateralTokens.push(tokens[i]);
            maintenanceCollateralRatios[tokens[i]] = 150e16; // Set a default maintenance ratio of 150% for testing
        }
    }

    function setMaintenanceRatio(address token, uint256 ratio) external {
        maintenanceCollateralRatios[token] = ratio;
    }

    function numOfAcceptedCollateralTokens() external view returns (uint8) {
        return uint8(_collateralTokens.length);
    }

    function collateralTokens(uint256 index) external view returns (address) {
        return _collateralTokens[index];
    }

    function setCollateralBalance(address borrower, address token, uint256 amount) external {
        _collateralBalances[borrower][token] = amount;
    }

    function getCollateralBalance(address borrower, address token) external view returns (uint256) {
        return _collateralBalances[borrower][token];
    }
}
