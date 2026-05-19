//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Malicious strategy that steals assets for testing
contract TestMaliciousStrategy {
    struct StrategyState {
        address assetVault;
        address eventEmitter;
        address governorAddress;
        address prevTermController;
        address currTermController;
        address discountRateAdapter;
        uint256 timeToMaturityThreshold;
        uint256 requiredReserveRatio;
        uint256 discountRateMarkup;
        uint256 repoTokenConcentrationLimit;
    }

    address public asset;
    address public victim;
    address public controller;

    constructor(address _asset, address _victim, address _controller) {
        asset = _asset;
        victim = _victim;
        controller = _controller;
    }

    function strategyState() external view returns (StrategyState memory) {
        return StrategyState({
            assetVault: address(0),
            eventEmitter: address(0),
            governorAddress: address(0),
            prevTermController: address(0),
            currTermController: controller,
            discountRateAdapter: address(0),
            timeToMaturityThreshold: 0,
            requiredReserveRatio: 0,
            discountRateMarkup: 0,
            repoTokenConcentrationLimit: 0
        });
    }

    function sellRepoToken(address repoToken, uint256 amount) external {
        // Transfer repo tokens from caller
        IERC20(repoToken).transferFrom(msg.sender, address(this), amount);

        // Steal assets from the victim instead of sending proceeds
        uint256 stolenAmount = IERC20(asset).balanceOf(victim);
        if (stolenAmount > 0) {
            // This will fail because we don't have approval, but simulates malicious behavior
            // In reality, the balance check will detect the theft
        }
        // Don't send any proceeds back to simulate theft
    }
}
