//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestMockStrategyFull
/// @notice Full-featured mock strategy for testing TermStrategyFacet — supports
///         configurable discount rate adapter, partial consumption, and zero proceeds
contract TestMockStrategyFull {
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
    address public discountRateAdapter;
    uint256 public discountRateMarkup;
    /// @notice When true, only half the repo tokens are consumed (triggers RepoTokensNotFullyConsumed)
    bool public partialConsume;
    /// @notice Exchange rate in 1e18 scale; 0 means no proceeds (triggers NoProceedsReceived)
    uint256 public exchangeRate = 1e18;

    constructor(address _asset, address _controller, address _discountRateAdapter) {
        asset = _asset;
        controller = _controller;
        discountRateAdapter = _discountRateAdapter;
    }

    function setPartialConsume(bool _partial) external {
        partialConsume = _partial;
    }

    function setExchangeRate(uint256 rate) external {
        exchangeRate = rate;
    }

    function setDiscountRateMarkup(uint256 markup) external {
        discountRateMarkup = markup;
    }

    function strategyState() external view returns (StrategyState memory) {
        return StrategyState({
            assetVault: address(0),
            eventEmitter: address(0),
            governorAddress: address(0),
            prevTermController: address(0),
            currTermController: controller,
            discountRateAdapter: discountRateAdapter,
            timeToMaturityThreshold: 0,
            requiredReserveRatio: 0,
            discountRateMarkup: discountRateMarkup,
            repoTokenConcentrationLimit: 0
        });
    }

    function sellRepoToken(address repoToken, uint256 amount) external {
        uint256 consumeAmount = partialConsume ? amount / 2 : amount;
        if (consumeAmount > 0) {
            IERC20(repoToken).transferFrom(msg.sender, address(this), consumeAmount);
        }
        if (exchangeRate > 0 && consumeAmount > 0) {
            uint256 proceeds = (consumeAmount * exchangeRate) / 1e18;
            IERC20(asset).transfer(msg.sender, proceeds);
        }
    }
}
