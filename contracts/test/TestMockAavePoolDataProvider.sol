//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockAavePoolDataProvider
/// @notice Mock Aave pool data provider for testing reserve token address lookups
contract TestMockAavePoolDataProvider {
    struct ReserveTokens {
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
    }

    mapping(address => ReserveTokens) private _reserveTokens;

    function setReserveTokensAddresses(
        address asset,
        address aToken,
        address stableDebt,
        address varDebt
    ) external {
        _reserveTokens[asset] = ReserveTokens(aToken, stableDebt, varDebt);
    }

    function getReserveTokensAddresses(address asset)
        external
        view
        returns (
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress
        )
    {
        ReserveTokens memory rt = _reserveTokens[asset];
        return (rt.aTokenAddress, rt.stableDebtTokenAddress, rt.variableDebtTokenAddress);
    }
}
