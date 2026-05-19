//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";

/// @title TestMockRepoServicer
/// @notice Mock repo servicer for testing fulfillOrder flows
contract TestMockRepoServicer {
    address private _purchaseToken;
    ITermRepoCollateralManager private _collateralManager;

    function setPurchaseToken(address token) external {
        _purchaseToken = token;
    }

    function purchaseToken() external view returns (address) {
        return _purchaseToken;
    }

    function setCollateralManager(address manager) external {
        _collateralManager = ITermRepoCollateralManager(manager);
    }

    function termRepoCollateralManager() external view returns (ITermRepoCollateralManager) {
        return _collateralManager;
    }
}
