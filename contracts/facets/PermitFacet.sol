//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermMulticallProtection} from "./base/TermMulticallProtection.sol";
import {ITermController} from "../interfaces/ITermController.sol";

import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";


import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @author TermLabs
/// @title PermitFacet
/// @notice Provides EIP-2612 permit functionality for gasless token approvals
/// @dev Enables users to approve token spending via signatures instead of transactions
contract PermitFacet is TermMulticallProtection {

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when deadline has expired
    error Expired();

    /// @notice Thrown when the owner address is invalid
    error InvalidOwner();

    /// @notice Thrown when the spender address is invalid
    error InvalidSpender();

    /// @notice Thrown when the asset address is invalid
    error InvalidAsset();

    /// @notice Thrown when signature components are invalid
    error InvalidSignature();

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Calls the permit function on an ERC20 token that supports EIP-2612 permits
    /// @param asset The address of the ERC20 token
    /// @param amount The amount of tokens to approve
    /// @param spender The address which will be approved to spend the tokens
    /// @param deadline The timestamp after which the permit is no longer valid
    /// @param v The recovery byte of the signature
    /// @param r Half of the ECDSA signature pair
    /// @param s Half of the ECDSA signature pair
    /// @param skipRevert If true, the function will not revert on failure
    function permit(
        address asset,
        uint256 amount,
        address spender,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (deadline <= block.timestamp) revert Expired();
        if (asset == address(0)) revert InvalidAsset();
        if (spender == address(0)) revert InvalidSpender();
        address owner = initiator();
        if (owner == address(0)) revert InvalidOwner();
        if (r == bytes32(0) || s == bytes32(0)) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        try IERC20Permit(asset).permit(owner, spender, amount, deadline, v, r, s) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Calls the permit function on an ERC20 token that supports EIP-2612 permits, approving TermDiamond to spend tokens on behalf of the initiator
    /// @param asset The address of the ERC20 token
    /// @param amount The amount of tokens to approve
    /// @param owner The address which owns the tokens
    /// @param deadline The timestamp after which the permit is no longer valid
    /// @param v The recovery byte of the signature
    /// @param r Half of the ECDSA signature pair
    /// @param s Half of the ECDSA signature pair
    /// @param skipRevert If true, the function will not revert on failure
    function permitDiamond(
        address asset,
        uint256 amount,
        address owner,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (deadline <= block.timestamp) revert Expired();
        if (asset == address(0)) revert InvalidAsset();
        if (owner == address(0)) revert InvalidOwner();
        if (r == bytes32(0) || s == bytes32(0)) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        try IERC20Permit(asset).permit(owner, address(this), amount, deadline, v, r, s) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Calls the permit function on an ERC20 token that supports EIP-2612 permits, approving a term contract to spend tokens on behalf of the owner
    /// @param asset The address of the ERC20 token
    /// @param amount The amount of tokens to approve
    /// @param owner The address which owns the tokens
    /// @param termContractAddress The address of the term contract to approve as spender
    /// @param deadline The timestamp after which the permit is no longer valid
    /// @param v The recovery byte of the signature
    /// @param r Half of the ECDSA signature pair
    /// @param s Half of the ECDSA signature pair
    /// @param skipRevert If true, the function will not revert on failure
    function permitTermContract(
        address asset,
        uint256 amount,
        address owner,
        address termContractAddress,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (deadline <= block.timestamp) revert Expired();
        if (asset == address(0)) revert InvalidAsset();
        if (owner == address(0)) revert InvalidOwner();
        if (r == bytes32(0) || s == bytes32(0)) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        TermStorage storage ts = LibTermStorage.termStorage();
        bool isValidTermContract;
        for (uint256 i = 0; i < ts.approvedTermControllerList.length; ++i) {
            ITermController termController = ITermController(ts.approvedTermControllerList[i]);
            if (termController.isTermDeployed(termContractAddress) || termController.isFactoryDeployed(termContractAddress)) {
                isValidTermContract = true;
                break;
            }
        }
        if (!isValidTermContract) revert InvalidSpender();
        try IERC20Permit(asset).permit(owner, termContractAddress, amount, deadline, v, r, s) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }
}
