//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermMulticallProtection} from "./base/TermMulticallProtection.sol";
import { LibAccessControl } from "../libraries/LibAccessControl.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";



/// @author TermLabs
/// @title TransferFacet
/// @notice Provides token transfer functionality for moving assets within the Term Finance protocol
/// @dev Implements secure token transfers with validation and routing for protocol operations
contract TransferFacet is TermMulticallProtection, AccessControl {
    using SafeERC20 for ERC20;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when attempting to transfer to self
    error SelfTransferNotAllowed();

    /// @notice Thrown when recipient address is zero
    error ZeroAddress();

    /// @notice Thrown when amount is zero
    error ZeroAmount();

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Transfers tokens from the bundler to recipient
    /// @param asset The address of the ERC20 token to transfer
    /// @param recipient The address that will receive the tokens
    /// @param amount The amount of tokens to transfer
    function erc20Transfer(
        address asset,
        address recipient,
        uint256 amount
    ) external onlyRole(LibAccessControl.ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this)) revert SelfTransferNotAllowed();
        if (amount == 0) revert ZeroAmount();

        ERC20(asset).safeTransfer(recipient, amount);
    }

    /// @notice Transfers tokens from the initiator to this contract via ERC20 transferFrom
    /// @param asset The address of the ERC20 token to transfer
    /// @param amount The amount of tokens to transfer from the initiator
    function erc20TransferFrom(
        address asset,
        uint256 amount
    ) external onlyMulticallInitiator {
        address _initiator = initiator();
        if (amount == 0) revert ZeroAmount();
        ERC20(asset).safeTransferFrom(_initiator, address(this), amount);
    }
}
