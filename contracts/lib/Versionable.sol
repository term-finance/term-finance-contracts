//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @author TermLabs
/// @title Versionable contract
/// @notice This contract adds a version string that can be queried to all contracts that inherit from it.
/// @dev The version returned is replaced during the build process.
contract Versionable {
    /// @dev This function returns the version of the contract.
    function version() public view returns (string memory) {
        return "development"; // This string is replaced during the build process.
    }
}
