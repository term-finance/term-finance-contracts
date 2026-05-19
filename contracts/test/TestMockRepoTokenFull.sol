//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestMockRepoTokenFull
/// @notice Plain ERC20 repo token mock with configurable redemptionValue, config, and mint capability
contract TestMockRepoTokenFull is ERC20 {
    uint256 private _redemptionValue;
    uint256 private _redemptionTimestamp;
    address private _purchaseToken;
    address private _termRepoServicer;
    address private _termRepoCollateralManager;

    constructor(
        string memory name,
        string memory symbol,
        uint256 redemptionVal
    ) ERC20(name, symbol) {
        _redemptionValue = redemptionVal;
    }

    function redemptionValue() external view returns (uint256) {
        return _redemptionValue;
    }

    function setRedemptionValue(uint256 val) external {
        _redemptionValue = val;
    }

    function setConfig(
        uint256 redemptionTimestamp,
        address purchaseToken,
        address termRepoServicer,
        address termRepoCollateralManager
    ) external {
        _redemptionTimestamp = redemptionTimestamp;
        _purchaseToken = purchaseToken;
        _termRepoServicer = termRepoServicer;
        _termRepoCollateralManager = termRepoCollateralManager;
    }

    function config()
        external
        view
        returns (
            uint256 redemptionTimestamp,
            address purchaseToken,
            address termRepoServicer,
            address termRepoCollateralManager
        )
    {
        return (_redemptionTimestamp, _purchaseToken, _termRepoServicer, _termRepoCollateralManager);
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
