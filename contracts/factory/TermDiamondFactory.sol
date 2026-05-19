//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.0;

import { TermDiamond } from "../TermDiamond.sol";
import { DiamondCutFacet } from "../facets/DiamondCutFacet.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @author TermLabs
/// @title TermDiamondFactory
/// @notice Factory contract for deploying TermDiamond instances with their associated DiamondCutFacet
/// @dev Enables atomic deployment of both contracts in a single transaction, improving security and UX
contract TermDiamondFactory is Ownable {

    // ========================================================================
    // = Events  ==============================================================
    // ========================================================================

    /// @notice Emitted when a new diamond is deployed
    /// @param diamond Address of the deployed TermDiamond
    /// @param diamondCutFacet Address of the deployed DiamondCutFacet
    event DiamondDeployed(
        address diamond,
        address diamondCutFacet
    );

    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================
    address immutable public adminWallet;
    address immutable public devopsWallet;

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================
    constructor(address adminWallet_, address devopsWallet_) Ownable(msg.sender) {
        adminWallet = adminWallet_;
        devopsWallet = devopsWallet_;
    }

    // ========================================================================
    // = API ==================================================================
    // ========================================================================

    /// @notice Deploys a new TermDiamond with its DiamondCutFacet
    /// @dev Both contracts are deployed in the same transaction, enabling block-based security checks
    /// @return diamond Address of the deployed TermDiamond
    /// @return diamondCutFacet Address of the deployed DiamondCutFacet
    function deployDiamond() external onlyOwner returns (address diamond, address diamondCutFacet) {
        // Deploy DiamondCutFacet first
        diamondCutFacet = address(new DiamondCutFacet());

        // Deploy TermDiamond with the facet address
        // This will automatically call initDiamondRoles via delegateCall during construction
        diamond = address(new TermDiamond(devopsWallet, adminWallet, diamondCutFacet));

        emit DiamondDeployed(diamond, diamondCutFacet);

        return (diamond, diamondCutFacet);
    }
}