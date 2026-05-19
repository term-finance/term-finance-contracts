//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockTermController
/// @notice Minimal mock controller for testing vault and strategy approval checks
contract TestMockTermController {
    mapping(address => bool) public approvedVaults;
    mapping(address => bool) private _deployedTerms;
    mapping(address => bool) private _factoryDeployed;

     function setFactoryDeployed(address factory, bool deployed) external {
        _factoryDeployed[factory] = deployed;
    }

    function isFactoryDeployed(address contractAddress) external view returns (bool) {
        return _factoryDeployed[contractAddress];
    }

    function setVaultApproval(address vault, bool approved) external {
        approvedVaults[vault] = approved;
    }

    function isTermApproved(address contractAddress) external view returns (bool) {
        return approvedVaults[contractAddress];
    }

    function setTermDeployed(address term, bool deployed) external {
        _deployedTerms[term] = deployed;
    }

    function isTermDeployed(address contractAddress) external view returns (bool) {
        return _deployedTerms[contractAddress];
    }
}
