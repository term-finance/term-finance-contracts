//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWETHWrappingFacet {
    function unwrapETH(
        uint256 amount,
        address wrappedTokenAddr,
        bool usePermit2
    ) external;
}

/// @title TestETHRejecter
/// @notice Contract with no receive/fallback that calls unwrapETH.
/// @dev When the facet tries to send ETH back to this contract, it fails.
contract TestETHRejecter {
    function callUnwrapETH(
        address facet,
        uint256 amount,
        address wrappedTokenAddr,
        bool usePermit2
    ) external {
        // Approve WETH to facet so safeTransferFrom succeeds
        IERC20(wrappedTokenAddr).approve(facet, amount);
        IWETHWrappingFacet(facet).unwrapETH(
            amount,
            wrappedTokenAddr,
            usePermit2
        );
    }
}
