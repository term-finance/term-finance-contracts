//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermMulticallProtection} from "./base/TermMulticallProtection.sol";
import {ITermController} from "../interfaces/ITermController.sol";

import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
/// @dev Permit2Lib uses a hardcoded address for PERMIT2, make sure it is the correct address for the chain of deployment.
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @author TermLabs
/// @title Permit2Facet
/// @notice Provides Uniswap Permit2 integration for advanced signature-based token approvals
/// @dev Enables batch permits, allowance transfers, and signature-based token operations via Permit2 protocol
contract Permit2Facet is TermMulticallProtection {
    using SafeCast for uint256;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when deadline has expired
    error Expired();

    /// @notice Thrown when the spender address is invalid
    error InvalidSpender();

    /// @notice Thrown when the owner address is invalid
    error InvalidOwner();

    /// @notice Thrown when amount is zero
    error ZeroAmount();

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Approves the given `amount` of `asset` from the initiator to be spent by `permitSingle.spender` via Permit2 with the given `deadline` & EIP-712 `signature`
    /// @param permitSingle The `PermitSingle` struct
    /// @param signature The signature, serialized
    /// @param skipRevert Whether to avoid reverting the call in case the signature is frontrunned
    function approve2(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (permitSingle.details.expiration <= block.timestamp) revert Expired();
        try Permit2Lib.PERMIT2.permit(initiator(), permitSingle, signature) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Approves the Diamond contract to spend tokens using Permit2
    /// @dev Validates that the spender in the permit is the Diamond contract (address(this))
    /// @param permitSingle The Permit2 single permit data containing token, amount, expiration, and nonce
    /// @param owner The address which owns the tokens
    /// @param signature The EIP-712 signature for the permit
    /// @param skipRevert If true, the function will not revert on failure
    function approve2Diamond(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        address owner,
        bytes calldata signature,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (permitSingle.details.expiration <= block.timestamp) revert Expired();
        if (permitSingle.spender != address(this)) revert InvalidSpender();
        try Permit2Lib.PERMIT2.permit(owner, permitSingle, signature) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Approves a Term contract to spend tokens using Permit2
    /// @dev Validates that the spender is a valid Term contract deployed by an approved Term Controller
    /// @param permitSingle The Permit2 single permit data containing the Term contract as spender, token, amount, expiration, and nonce
    /// @param owner The address which owns the tokens
    /// @param signature The EIP-712 signature for the permit
    /// @param skipRevert If true, the function will not revert on failure
    function approve2TermContract(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        address owner,
        bytes calldata signature,
        bool skipRevert
    ) external onlyMulticallInitiator {
        if (permitSingle.details.expiration <= block.timestamp) revert Expired();
        if (owner == address(0)) revert InvalidOwner();
        TermStorage storage ts = LibTermStorage.termStorage();
        bool isValidTermContract;
        for (uint256 i = 0; i < ts.approvedTermControllerList.length; ++i) {
            ITermController termController = ITermController(ts.approvedTermControllerList[i]);
            if (termController.isTermDeployed(permitSingle.spender) || termController.isFactoryDeployed(permitSingle.spender)) {
                isValidTermContract = true;
                break;
            }
        }
        if (!isValidTermContract) revert InvalidSpender();
        try Permit2Lib.PERMIT2.permit(owner, permitSingle, signature) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Transfers the given `amount` of `asset` from the initiator to the bundler via Permit2
    /// @param asset The address of the ERC20 token to transfer
    /// @param amount The amount of `asset` to transfer from the initiator. Capped at the initiator's balance
    function transferFrom2(
        address asset,
        uint256 amount
    ) external onlyMulticallInitiator {
        address _initiator = initiator();

        if (amount == 0) revert ZeroAmount();

        Permit2Lib.PERMIT2.transferFrom(_initiator, address(this), amount.toUint160(), asset);
    }
}
