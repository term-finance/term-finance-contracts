//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermFlashLoanCentralReceiverFacet} from "../facets/flashloan/TermFlashLoanCentralReceiverFacet.sol";

/// @title TestTermFlashLoanCentralReceiverFacetHelper
/// @notice Extends TermFlashLoanCentralReceiverFacet with configurable diamond loupe and mock callback for testing
contract TestTermFlashLoanCentralReceiverFacetHelper is TermFlashLoanCentralReceiverFacet {
    mapping(bytes4 => address) private _facetAddresses;
    bool public mockCallbackCalled;

    constructor(address flashLoanAggregator_)
        TermFlashLoanCentralReceiverFacet(flashLoanAggregator_) {}

    /// @notice Configure the mock diamond loupe mapping
    function setFacetAddress(bytes4 selector, address facet) external {
        _facetAddresses[selector] = facet;
    }

    /// @notice IDiamondLoupe.facetAddress — called via IDiamondLoupe(address(this))
    function facetAddress(bytes4 selector) external view returns (address) {
        return _facetAddresses[selector];
    }

    /// @notice No-op callback used as delegatecall target in success path tests
    function mockCallback(
        address[] calldata,
        uint256[] calldata,
        uint256[] calldata,
        address,
        bytes calldata
    ) external {
        mockCallbackCalled = true;
    }

    function getMockCallbackSelector() external pure returns (bytes4) {
        return TestTermFlashLoanCentralReceiverFacetHelper.mockCallback.selector;
    }
}
