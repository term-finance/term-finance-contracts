//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {ITermController} from "./interfaces/ITermController.sol";
import {ITermControllerEvents} from "./interfaces/ITermControllerEvents.sol";

import {TermAuctionResults} from "./lib/TermAuctionResults.sol";
import {AuctionMetadata} from "./lib/AuctionMetadata.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Versionable} from "./lib/Versionable.sol";


/// @author TermLabs
/// @title Term Controller
/// @notice This contract manages Term Finance protocol permissions and controls
/// @dev This contract operates at the protocol level and governs all instances of a Term Repo
contract TermController is
    ITermController,
    ITermControllerEvents,
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    Versionable
{
    // ========================================================================
    // = Access Roles =========================================================
    // ========================================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant AUCTION_ROLE = keccak256("AUCTION_ROLE");
    bytes32 public constant CONTROLLER_ADMIN_ROLE =
        keccak256("CONTROLLER_ADMIN_ROLE");
    bytes32 public constant DEVOPS_ROLE = keccak256("DEVOPS_ROLE");
    bytes32 public constant INITIALIZER_ROLE = keccak256("INITIALIZER_ROLE");
    bytes32 public constant SPECIALIST_ROLE = keccak256("SPECIALIST_ROLE");

    // ========================================================================
    // = State Variables ======================================================
    // ========================================================================

    // Term Finance Treasury Wallet Address
    address internal treasuryWallet;

    // Term Finance Protocol Reserves
    address internal protocolReserveWallet;

    // Mapping which returns true for contract addresses deployed by Term Finance Protocol
    mapping(address => bool) internal termAddresses;

    // Mapping which returns a TermAuctionResults object for each termId.
    mapping(bytes32 => TermAuctionResults) internal termAuctionResults;

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address treasuryWallet_,
        address protocolReserveWallet_,
        address controllerAdminWallet_,
        address devopsWallet_,
        address adminWallet_
    ) external initializer {
        UUPSUpgradeable.__UUPSUpgradeable_init();
        AccessControlUpgradeable.__AccessControl_init();

        require(
            controllerAdminWallet_ != address(0),
            "controller admin is zero address"
        );

        require(
            devopsWallet_ != address(0),
            "devops wallet is zero address"
        );

        require(
            adminWallet_ != address(0),
            "admin wallet is zero address"
        );

        _grantRole(CONTROLLER_ADMIN_ROLE, controllerAdminWallet_);
        _grantRole(DEVOPS_ROLE, devopsWallet_);
        _grantRole(ADMIN_ROLE, adminWallet_);

        require(treasuryWallet_ != address(0), "treasury is zero address");
        treasuryWallet = treasuryWallet_;

        require(
            protocolReserveWallet_ != address(0),
            "reserve is zero address"
        );
        protocolReserveWallet = protocolReserveWallet_;
    }

    function pairInitializer(address initializer) external onlyRole(ADMIN_ROLE) {
        _grantRole(INITIALIZER_ROLE, initializer);
    }

    function pairAuction (address auction) external onlyRole(INITIALIZER_ROLE) {
        _grantRole(AUCTION_ROLE, auction);
    }


    // ========================================================================
    // = Interface/API ========================================================
    // ========================================================================

    /// @notice External view function which returns contract address of treasury wallet
    function getTreasuryAddress() external view returns (address) {
        return treasuryWallet;
    }

    /// @notice External view function which returns contract address of protocol reserve
    /// @return The protocol reserve address
    function getProtocolReserveAddress() external view returns (address) {
        return protocolReserveWallet;
    }

    function getTermAuctionResults(bytes32 termRepoId) external view returns (AuctionMetadata[] memory auctionMetadata, uint8 numOfAuctions){
        auctionMetadata =  termAuctionResults[termRepoId].auctionMetadata;
        numOfAuctions = termAuctionResults[termRepoId].numOfAuctions;
    }

    /// @notice External view function which returns whether contract address is deployed by Term Finance Protocol
    /// @param contractAddress The input contract address to query
    /// @return Whether the given address is deployed by Term Finance Protocol
    function isTermDeployed(
        address contractAddress
    ) external view returns (bool) {
        return _isTermDeployed(contractAddress);
    }

     /// @param authedUser The address of user to check access for mint exposure
    function verifyMintExposureAccess(
        address authedUser
    ) external view returns (bool) {
        return hasRole(SPECIALIST_ROLE, authedUser);
    }

    // ========================================================================
    // = Admin Functions ======================================================
    // ========================================================================

    /// @notice Admin function to update the Term Finance treasury wallet address
    /// @param newTreasuryWallet The new treasury address
    function updateTreasuryAddress(
        address newTreasuryWallet
    ) external onlyRole(DEVOPS_ROLE) {
        require(
            newTreasuryWallet != treasuryWallet,
            "No change in treasury address"
        );

        address oldTreasuryWallet = treasuryWallet;

        treasuryWallet = newTreasuryWallet;

        emit TreasuryAddressUpdated(oldTreasuryWallet, treasuryWallet);
    }

    /// @notice Admin function to update the Term Finance protocol reserve wallet address
    /// @param newProtocolReserveWallet The new protocol reserve wallet address
    function updateProtocolReserveAddress(
        address newProtocolReserveWallet
    ) external onlyRole(DEVOPS_ROLE) {
        require(
            newProtocolReserveWallet != protocolReserveWallet,
            "No change in protocol reserve address"
        );

        address oldProtocolReserveWallet = protocolReserveWallet;

        protocolReserveWallet = newProtocolReserveWallet;

        emit ProtocolReserveAddressUpdated(
            oldProtocolReserveWallet,
            protocolReserveWallet
        );
    }

    /// @notice Admin function to update the designated controller admin wallet that calls markTermDeployed
    /// @param oldControllerAdminWallet The current controller admin wallet to revoke permissions for
    /// @param newControllerAdminWallet The new controller admin wallet to grant permissions for
    function updateControllerAdminWallet(
        address oldControllerAdminWallet,
        address newControllerAdminWallet
    ) external onlyRole(DEVOPS_ROLE) {
        require(
            oldControllerAdminWallet != address(0),
            "Old Controller Admin Wallet cannot be zero address"
        );
        require(
            newControllerAdminWallet != address(0),
            "New Controller Admin Wallet cannot be zero address"
        );
        require(
            hasRole(CONTROLLER_ADMIN_ROLE, oldControllerAdminWallet),
            "incorrect old controller admin wallet address"
        );

        _revokeRole(CONTROLLER_ADMIN_ROLE, oldControllerAdminWallet);

        _grantRole(CONTROLLER_ADMIN_ROLE, newControllerAdminWallet);
    }

    /// @notice Admin function to add a new Term Finance contract to Controller
    /// @param termContract The new term contract address
    function markTermDeployed(
        address termContract
    ) external onlyRole(CONTROLLER_ADMIN_ROLE) {
        require(!_isTermDeployed(termContract), "Contract is already in Term");

        termAddresses[termContract] = true;
    }

    /// @notice Admin function to remove a contract from Controller
    /// @param termContract The new term contract address
    function unmarkTermDeployed(
        address termContract
    ) external onlyRole(CONTROLLER_ADMIN_ROLE) {
        require(_isTermDeployed(termContract), "Contract is not in Term");

        delete termAddresses[termContract];
    }

    /// @param authedUser The address of user granted access to create mint exposure
    function grantMintExposureAccess(
        address authedUser
    ) external onlyRole(ADMIN_ROLE) {
        _grantRole(SPECIALIST_ROLE, authedUser);
    }

    function recordAuctionResult(bytes32 termRepoId, bytes32 termAuctionId, uint256 auctionClearingRate) external onlyRole(AUCTION_ROLE) {
    
        TermAuctionResults storage term = termAuctionResults[termRepoId];
        AuctionMetadata memory auctionMetadata = AuctionMetadata({
            termAuctionId: termAuctionId,
            auctionClearingRate: auctionClearingRate,
            auctionClearingBlockTimestamp: block.timestamp
        });
        term.auctionMetadata.push(auctionMetadata);
        term.numOfAuctions++;   
    }

    function _isTermDeployed(
        address contractAddress
    ) private view returns (bool) {
        return termAddresses[contractAddress];
    }

    // ========================================================================
    // = Upgrades =============================================================
    // ========================================================================

    // solhint-disable no-empty-blocks
    ///@dev required override by the OpenZeppelin UUPS module
    function _authorizeUpgrade(
        address
    ) internal view override onlyRole(DEVOPS_ROLE) {}
    // solhint-enable no-empty-blocks
}
