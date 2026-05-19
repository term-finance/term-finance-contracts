//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockRepoToken
/// @notice Mock repo token for testing swap order flows.
/// @dev config() ABI matches TermRepoToken.config()
contract TestMockRepoToken {
    uint256 private _redemptionTimestamp;
    address private _purchaseToken;
    address private _termRepoServicer;
    address private _termRepoCollateralManager;

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
}
