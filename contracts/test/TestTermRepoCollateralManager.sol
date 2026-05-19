//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermRepoCollateralManager} from "../TermRepoCollateralManager.sol";

contract TestTermRepoCollateralManager is TermRepoCollateralManager {
    function getEncumberedCollateralBalances(
        address collateralToken
    ) external view returns (uint256) {
        return encumberedCollateralBalances[collateralToken];
    }

    function setEncumberedCollateralBalances(
        address collateralToken,
        uint256 amount
    ) external returns (uint256) {
        encumberedCollateralBalances[collateralToken] = amount;
    }

    function testUnlockCollateral(
        address borrower,
        address collateralToken,
        uint256 amount,
        bool decrementEncumberedCollateral
    ) external {
        _unlockCollateral(
            borrower,
            collateralToken,
            amount,
            decrementEncumberedCollateral
        );
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
