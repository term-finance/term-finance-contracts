//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermRepoServicer} from "../TermRepoServicer.sol";

contract TestTermRepoServicer is TermRepoServicer {
    function setPurchaseCurrencyHeld(uint256 amount) external {
        totalRepurchaseCollected = amount;
    }

    // Test methods for _isTermRepoBalanced function
    function setTotalOutstandingRepurchaseExposure(uint256 amount) external {
        totalOutstandingRepurchaseExposure = amount;
    }

    function setTotalRepurchaseCollected(uint256 amount) external {
        totalRepurchaseCollected = amount;
    }

    function setShortfallHaircutMantissa(uint256 mantissa) external {
        shortfallHaircutMantissa = mantissa;
    }

    // Mock totalRedemptionValue since we can't easily mock the token call
    uint256 private mockTotalRedemptionValue;

    function setTotalRedemptionValue(uint256 value) external {
        mockTotalRedemptionValue = value;
    }

    function testIsTermRepoBalanced() external view returns (bool) {
        return _testIsTermRepoBalanced();
    }

    // Modified version of _isTermRepoBalanced that uses mock value
    function _testIsTermRepoBalanced() internal view returns (bool) {
        if (shortfallHaircutMantissa == 0) {
            uint256 totalLiquidity = totalOutstandingRepurchaseExposure + totalRepurchaseCollected;
            uint256 totalRedemptionValue = mockTotalRedemptionValue;
            if (totalLiquidity >= totalRedemptionValue) {
                return totalLiquidity - totalRedemptionValue <= termRepoBalancedThreshold;
            } else {
                return totalRedemptionValue - totalLiquidity <= termRepoBalancedThreshold;
            }
        }
        else {
            uint256 haircutRedemptionValue = mul_ScalarTruncate(
                Exp({mantissa: shortfallHaircutMantissa}),
                mockTotalRedemptionValue
            );
            if (totalRepurchaseCollected >= haircutRedemptionValue) {
                return totalRepurchaseCollected - haircutRedemptionValue <= termRepoBalancedThreshold;
            } else {
                return haircutRedemptionValue - totalRepurchaseCollected <= termRepoBalancedThreshold;
            }
        }
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
