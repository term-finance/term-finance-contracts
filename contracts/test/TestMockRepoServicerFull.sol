//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {ITermRepoLocker} from "../interfaces/ITermRepoLocker.sol";
import {ITermRepoToken} from "../interfaces/ITermRepoToken.sol";
import {ITermController} from "../interfaces/ITermController.sol";

interface IMintableRepoToken {
    function mint(address account, uint256 amount) external;
}

interface ITestMockCollateralManager {
    function setCollateralBalance(address borrower, address token, uint256 amount) external;
}

/// @title TestMockRepoServicerFull
/// @notice Full mock implementing all ITermRepoServicer fields needed by TermStrategyFacet.
///         mintOpenExposure mints repo tokens directly to msg.sender (the facet).
contract TestMockRepoServicerFull {
    address private _purchaseToken;
    address private _termController;
    address private _collateralManager;
    address private _termRepoLocker;
    address private _termRepoToken;
    uint256 private _maturityTimestamp;
    uint256 private _redemptionTimestamp;
    uint256 private _servicingFee;
    uint256 private _repurchaseObligation;

    // ---- setters ----

    function setPurchaseToken(address t) external { _purchaseToken = t; }
    function setTermController(address c) external { _termController = c; }
    function setCollateralManager(address m) external { _collateralManager = m; }
    function setTermRepoLocker(address l) external { _termRepoLocker = l; }
    function setTermRepoToken(address t) external { _termRepoToken = t; }
    function setMaturityTimestamp(uint256 ts) external { _maturityTimestamp = ts; }
    function setRedemptionTimestamp(uint256 ts) external { _redemptionTimestamp = ts; }
    function setServicingFee(uint256 fee) external { _servicingFee = fee; }
    function setRepurchaseObligation(uint256 amount) external { _repurchaseObligation = amount; }

    // ---- ITermRepoServicer view functions ----

    function purchaseToken() external view returns (address) {
        return _purchaseToken;
    }

    function maturityTimestamp() external view returns (uint256) {
        return _maturityTimestamp;
    }

    function redemptionTimestamp() external view returns (uint256) {
        return _redemptionTimestamp;
    }

    function servicingFee() external view returns (uint256) {
        return _servicingFee;
    }

    function termController() external view returns (ITermController) {
        return ITermController(_termController);
    }

    function termRepoCollateralManager() external view returns (ITermRepoCollateralManager) {
        return ITermRepoCollateralManager(_collateralManager);
    }

    function termRepoLocker() external view returns (ITermRepoLocker) {
        return ITermRepoLocker(_termRepoLocker);
    }

    function termRepoToken() external view returns (ITermRepoToken) {
        return ITermRepoToken(_termRepoToken);
    }

    function getBorrowerRepurchaseObligation(address) external view returns (uint256) {
        return _repurchaseObligation;
    }

    // ---- ITermRepoServicer mutating functions ----

    /// @notice Clears collateral balance when repurchase payment is submitted (simulates collateral release)
    function submitRepurchasePayment(address borrower, uint256) external {
        // Get all collateral tokens and clear balances for this borrower
        ITermRepoCollateralManager collateralMgr = ITermRepoCollateralManager(_collateralManager);
        uint8 numTokens = collateralMgr.numOfAcceptedCollateralTokens();
        for (uint8 i = 0; i < numTokens; i++) {
            address token = collateralMgr.collateralTokens(i);
            uint256 balance = collateralMgr.getCollateralBalance(borrower, token);
            if (balance > 0) {
                // Call back to the manager to clear the balance
                // Since this is a mock, we need to cast and call setCollateralBalance
                ITestMockCollateralManager(address(collateralMgr)).setCollateralBalance(borrower, token, 0);
            }
        }
    }

    /// @notice Mints repo tokens to msg.sender (the facet/diamond calling this)
    function mintOpenExposure(
        address, /* borrower */
        uint256 amount,
        uint256[] calldata /* collateralAmounts */
    ) external {
        IMintableRepoToken(_termRepoToken).mint(msg.sender, amount);
    }
}
