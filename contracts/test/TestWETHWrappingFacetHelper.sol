//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {WETHWrappingFacet} from "../facets/WETHWrappingFacet.sol";

/// @title TestWETHWrappingFacetHelper
/// @notice Extends WETHWrappingFacet with a receive() function for standalone testing.
/// @dev The real diamond's fallback is non-payable, so standalone deploy needs this
///      to accept ETH from WETH.withdraw().
contract TestWETHWrappingFacetHelper is WETHWrappingFacet {
    receive() external payable {}
}
