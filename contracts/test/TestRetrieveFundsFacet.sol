//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import "hardhat/console.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @title TestRetrieveFundsFacet
/// @notice Helper facet for testing retrieveFunds code paths in TermLoanIntentFacet
contract TestRetrieveFundsFacet {
    /// @notice No-op function whose selector is used as retrieveFunds.method in revert tests
    function noopForRetrieveFunds() external pure {}

    /// @notice Mints tokens to the diamond to simulate a retrieve funds operation
    function mockRetrieveFunds(address token, uint256 amount) external {
        console.log("mockRetrieveFunds called, token:", token, "amount:", amount);
        IMintable(token).mint(address(this), amount);
        console.log("mint succeeded");
    }

    /// @notice Called by _generateRetrieveFundsCalldata on the facet address directly.
    function generateCalldata(
        bytes4 method,
        address,       // target (ignored)
        address token,
        address,       // user (ignored)
        uint256 amount,
        bool,          // flag (ignored)
        bytes calldata // additionalCalldata (ignored)
    ) external view returns (bytes memory) {
        console.log("generateCalldata called");
        console.log("method selector:");
        console.logBytes4(method);
        console.log("mockRetrieveFunds selector:");
        console.logBytes4(TestRetrieveFundsFacet.mockRetrieveFunds.selector);
        if (method == TestRetrieveFundsFacet.mockRetrieveFunds.selector) {
            console.log("returning mockRetrieveFunds calldata");
            return abi.encodeWithSelector(TestRetrieveFundsFacet.mockRetrieveFunds.selector, token, amount);
        }
        console.log("returning noop calldata");
        return abi.encodeWithSelector(TestRetrieveFundsFacet.noopForRetrieveFunds.selector);
    }
}
