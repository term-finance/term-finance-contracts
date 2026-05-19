//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";
import {LibAccessControl} from "../libraries/LibAccessControl.sol";
import {Versionable} from "../lib/Versionable.sol";
import {IDiamondLoupe} from "./DiamondLoupeFacet.sol";

/// @author TermLabs  
/// @title Term Controller Facet
/// @notice This facet manages approval and revocation of term controller contracts and fee recipients
/// @dev This facet whitelists term controller contracts and fee recipients for use in Term Repos
contract TermControllerFacet is AccessControl {

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    error TermControllerAlreadyApproved();
    error InvalidFacetAddress();
    error InvalidTermController();
    error FeeRecipientAlreadyApproved();
    error InvalidFeeRecipient();

    // ========================================================================
    // = Admin Functions ======================================================
    // ========================================================================

    /// @notice Approves a new term controller contract
    /// @param termController The address of the new term controller contract
    function approveTermController(address termController) external onlyRole(LibAccessControl.DEVOPS_ROLE) {
        TermStorage storage s = LibTermStorage.termStorage();
        if (s.approvedTermControllers[termController]) {
            revert TermControllerAlreadyApproved();
        }
        s.approvedTermControllers[termController] = true;
        s.approvedTermControllerList.push(termController);
    }

    /// @notice Revokes an existing term controller contract
    /// @param termController The address of the term controller contract to revoke
    function revokeTermController(address termController) external onlyRole(LibAccessControl.DEVOPS_ROLE) {
        TermStorage storage s = LibTermStorage.termStorage();
        if (!s.approvedTermControllers[termController]) {
            revert InvalidTermController();
        }
        s.approvedTermControllers[termController] = false;
        // Remove termController from approvedTermControllerList
        uint256 length = s.approvedTermControllerList.length;
        for (uint256 i = 0; i < length; ++i) {
            if (s.approvedTermControllerList[i] == termController) {
                s.approvedTermControllerList[i] = s.approvedTermControllerList[length - 1];
                s.approvedTermControllerList.pop();
                break;
            }
        }
    }

    /// @notice Approves a new fee recipient
    /// @param feeRecipient The address of the fee recipient to approve
    function approveFeeRecipient(address feeRecipient) external onlyRole(LibAccessControl.DEVOPS_ROLE) {
        TermStorage storage s = LibTermStorage.termStorage();
        if (s.approvedFeeRecipients[feeRecipient]) {
            revert FeeRecipientAlreadyApproved();
        }
        s.approvedFeeRecipients[feeRecipient] = true;
    }

    /// @notice Revokes an existing fee recipient
    /// @param feeRecipient The address of the fee recipient to revoke
    function revokeFeeRecipient(address feeRecipient) external onlyRole(LibAccessControl.DEVOPS_ROLE) {
        TermStorage storage s = LibTermStorage.termStorage();
        if (!s.approvedFeeRecipients[feeRecipient]) {
            revert InvalidFeeRecipient();
        }
        s.approvedFeeRecipients[feeRecipient] = false;
    }

    ///@notice Updates the EIP-712 domain separator used for signing limit orders
    ///@param loanIntentFacetAddress The address of the TermLoanIntentFacet to read the
    function updateEIP712DomainSeparator(address loanIntentFacetAddress) external onlyRole(LibAccessControl.ADMIN_ROLE) {
        // Verify facetAddress is a registered diamond facet via loupe
        bytes4[] memory selectors = IDiamondLoupe(address(this)).facetFunctionSelectors(loanIntentFacetAddress);
        if (selectors.length == 0) {
            revert InvalidFacetAddress();
        }

        // Read version directly from the facet contract (not through diamond)
        string memory ver = Versionable(loanIntentFacetAddress).version();
        TermStorage storage s = LibTermStorage.termStorage();
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        s.eip712DomainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain("
                    "string name,"
                    "string version,"
                    "uint256 chainId,"
                    "address verifyingContract"
                    ")"
                ),
                keccak256("TermFinance"),
                keccak256(bytes(ver)),
                chainId,
                address(this)
            )
        );
    }
    
}