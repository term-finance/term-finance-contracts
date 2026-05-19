//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockDiscountRateAdapter
/// @notice Configurable mock discount rate adapter for testing TermStrategyFacet
contract TestMockDiscountRateAdapter {
    mapping(address => uint256) private _discountRates;
    mapping(address => uint256) private _haircuts;

    function setDiscountRate(address repoToken, uint256 rate) external {
        _discountRates[repoToken] = rate;
    }

    function setHaircut(address repoToken, uint256 haircut) external {
        _haircuts[repoToken] = haircut;
    }

    function getDiscountRate(address repoToken) external view returns (uint256) {
        return _discountRates[repoToken];
    }

    function repoRedemptionHaircut(address repoToken) external view returns (uint256) {
        return _haircuts[repoToken];
    }
}
