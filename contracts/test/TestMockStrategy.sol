//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Simple mock strategy for testing TermStrategyFacet
contract TestMockStrategy {
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
    address public controller;
    uint256 public exchangeRate = 95; // 95% return rate by default

    constructor(address _asset, address _controller) {
        asset = _asset;
        controller = _controller;
    }

    function setExchangeRate(uint256 _rate) external {
        exchangeRate = _rate;
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

        // Calculate proceeds based on exchange rate
        uint256 proceeds = (amount * exchangeRate) / 100;

        // Transfer asset tokens back to caller
        IERC20(asset).transfer(msg.sender, proceeds);
    }
}
