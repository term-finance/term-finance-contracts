// SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IPSwapAggregator, SwapData} from "@pendle/core-v2/contracts/router/swap-aggregator/IPSwapAggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Simple mock swap aggregator implementing Pendle's IPSwapAggregator interface.
/// @dev The SwapRouterFacet (non-PT path) does:
///      1. safeTransfer(tokenIn, pendleSwap, amountIn)  — pushes tokens here
///      2. IPSwapAggregator(pendleSwap).swap(tokenIn, amountIn, swapData)
///   So this contract already holds tokenIn when swap() is invoked. It just
///   needs to send tokenOut back to msg.sender (the diamond).
///
///   Rate is 1e18-scaled: amountOut = amountIn * rate / 1e18
contract TestMockSwapAggregator is IPSwapAggregator {
    mapping(address => address) public tokenOutFor;
    mapping(address => uint256) public rateFor;

    function setSwap(address tokenIn, address tokenOut, uint256 rate) external {
        tokenOutFor[tokenIn] = tokenOut;
        rateFor[tokenIn] = rate;
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        SwapData calldata
    ) external payable override {
        address out = tokenOutFor[tokenIn];
        uint256 amountOut = amountIn * rateFor[tokenIn] / 1e18;
        IERC20(out).transfer(msg.sender, amountOut);
    }
}
