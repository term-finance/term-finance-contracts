//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
/******************************************************************************/

import { LibDiamond, IDiamondCut, IDiamondInit, IDiamondPause } from "../libraries/LibDiamond.sol";
import { LibAccessControl } from "../libraries/LibAccessControl.sol";

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @author TermLabs
/// @title DiamondCutFacet
/// @notice Facet for managing diamond upgrades and pause functionality
/// @dev Implements EIP-2535 Diamond Standard for adding, replacing, and removing functions
/// @dev Provides pause/unpause functionality to halt diamond operations in emergency situations
contract DiamondCutFacet is IDiamondCut, IDiamondInit, IDiamondPause, AccessControl {

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when diamond is already paused
    error AlreadyPaused();

    /// @notice Thrown when attempting to initialize diamond roles that are already initialized
    error DiamondRolesAlreadyInitialized();

    /// @notice Thrown when diamond is not paused
    error NotPaused();

    /// @notice Thrown when caller is not the deployer wallet
    error OnlyDeployerCanCall();

    /// @notice Thrown when function is called outside of the deployment block
    error OnlyCallableInDeployBlock();


    address immutable deployerWallet;
    uint256 immutable deployBlockNumber;

    constructor () {
        deployerWallet = msg.sender;
        deployBlockNumber = block.number;
    }

    /// @notice Initializes diamond access control roles and supported interfaces
    /// @dev This function is intended to be called only via delegatecall during diamond
    ///      construction. The msg.sender check ensures it can only be called from within
    ///      the diamond contract itself, preventing external role hijacking attacks.
    /// @dev Registers ERC-165 and IDiamondCut interface support
    /// @param devopsWallet_ Address to be granted the DEVOPS_ROLE
    /// @param adminWallet_ Address to be granted the ADMIN_ROLE
    function initDiamond(address devopsWallet_, address adminWallet_) external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();

        if (ds.diamondRolesInitialized) revert DiamondRolesAlreadyInitialized();
        if (msg.sender != deployerWallet) revert OnlyDeployerCanCall();
        if (block.number != deployBlockNumber) revert OnlyCallableInDeployBlock();

        _grantRole(LibAccessControl.DEVOPS_ROLE, devopsWallet_);
        _grantRole(LibAccessControl.ADMIN_ROLE, adminWallet_);

        // Register supported interfaces for ERC-165
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IERC165).interfaceId] = true; // ERC-165 interface ID

        ds.diamondRolesInitialized = true;
    }

    /// @notice Add/replace/remove any number of1 functions and optionally execute
    ///         a function with delegatecall
    /// @param _diamondCut Contains the facet addresses and function selectors
    /// @param _init The address of the contract or facet to execute _calldata
    /// @param _calldata A function call, including function selector and arguments
    ///                  _calldata is executed with delegatecall on _init
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external override onlyRole(LibAccessControl.DEVOPS_ROLE) {
        LibDiamond.diamondCut(_diamondCut, _init, _calldata);
    }

    /// @notice Pauses the diamond contract
    /// @dev Only callable by accounts with ADMIN_ROLE
    /// @dev Reverts if the diamond is already paused
    function pauseDiamond() external onlyRole(LibAccessControl.ADMIN_ROLE){
        if (LibDiamond.diamondStorage().diamondPaused) revert AlreadyPaused();

        LibDiamond.diamondStorage().diamondPaused = true;
        emit DiamondPaused();
    }

    /// @notice Unpauses the diamond contract
    /// @dev Only callable by accounts with ADMIN_ROLE
    /// @dev Reverts if the diamond is not paused
    function unpauseDiamond() external onlyRole(LibAccessControl.ADMIN_ROLE){
        if (!LibDiamond.diamondStorage().diamondPaused) revert NotPaused();

        LibDiamond.diamondStorage().diamondPaused = false;
        emit DiamondUnpaused();
    }
}
