//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {AuctionMetadata} from "../lib/AuctionMetadata.sol";

/// @notice ITermController is an interface that defines events and functions of the Controller contract.
interface ITermController {
    // ========================================================================
    // = Interface/API ========================================================
    // ========================================================================

    /// @notice External view function which returns contract address of treasury wallet
    function getTreasuryAddress() external view returns (address);

    /// @notice External view function which returns contract address of protocol reserve
    function getProtocolReserveAddress() external view returns (address);

    /// @notice External view function which returns if contract address is a Term Finance contract or not
    /// @param contractAddress input contract address
    function isTermDeployed(
        address contractAddress
    ) external view returns (bool);

    /// @notice External view function which returns whether contract address is deployed by a Term Finance factory
    /// @param contractAddress The input contract address to query
    /// @return Whether the given address is deployed by a Term Finance factory
    function isFactoryDeployed(
        address contractAddress
    ) external view returns (bool);

    /// @notice External view function which returns if term repo id is registered in Controller
    /// @param repoId input term repo id
    /// @return Whether the given term repo id is registered in Controller
    function registeredRepoIds(bytes32 repoId) external view returns (bool);

    ///@notice External view function which returns if term auction id is registered in Controller
    /// @param auctionId input term auction id
    /// @return Whether the given term auction id is registered in Controller
    function registeredAuctionIds(bytes32 auctionId) external view returns (bool);

    /// @notice External view function which returns if external contract address is approved for integration
    /// @param contractAddress input contract address
    function isTermApproved(
        address contractAddress
    ) external view returns (bool);

    /// @notice Returns history of all completed auctions within a term
    /// @param termRepoId term repo id to look up
    function getTermAuctionResults(
        bytes32 termRepoId
    )
        external
        view
        returns (AuctionMetadata[] memory auctionMetadata, uint8 numOfAuctions);

    /// @notice Returns whether all Term Finance contracts are currently paused
    /// @return True if contracts are paused, false otherwise
    function termContractsPaused() external view returns (bool);

    // ========================================================================
    // = Admin Functions ======================================================
    // ========================================================================

    /// @notice Initializer function to pair a new Term Auction with the controller
    /// @param auction    new auction address
    function pairAuction(address auction) external;

    /// @notice Admin function to update the Term Finance treasury wallet address
    /// @param treasuryWallet    new treasury address
    function updateTreasuryAddress(address treasuryWallet) external;

    /// @notice Admin function to update the Term Finance protocol reserve wallet address
    /// @param protocolReserveAddress    new protocol reserve wallet address
    function updateProtocolReserveAddress(
        address protocolReserveAddress
    ) external;

    /// @notice Admin function to add a new Term Finance contract to Controller
    /// @param termContract    new term contract address
    function markTermDeployed(address termContract) external;

    /// @notice Admin function to remove a contract from Controller
    /// @param termContract    term contract address to remove
    function unmarkTermDeployed(address termContract) external;

    /// @notice Admin function to add a new factory-deployed contract to Controller
    /// @param factoryDeployedContract The factory-deployed contract address
    function markTermFactoryDeployed(
        address factoryDeployedContract
    ) external;

    /// @notice Admin function to remove a factory-deployed contract from Controller
    /// @param factoryDeployedContract The factory-deployed contract address
    function unmarkTermFactoryDeployed(
        address factoryDeployedContract
    ) external;

    /// @notice Pauses all Term Finance contracts
    function pauseTermContracts() external;

    /// @notice Registers a new repo ID
    /// @param repoId    repo ID to register
    function registerRepoId(bytes32 repoId) external;

    /// @notice Registers a new auction ID
    /// @param auctionId auction ID to register
    function registerAuctionId(bytes32 auctionId) external;

    /// @notice Unpauses all Term Finance contracts
    function unpauseTermContracts() external;

    /// @notice Admin function to add an external contract approved for integration
    /// @param termContract    new external contract address
    function markTermApproved(address termContract) external;

    /// @notice Admin function to add an external contract approved for integration
    /// @param termContract    external contract address to remove
    function unmarkTermApproved(address termContract) external;

    /// @notice View Function to lookup if authedUser is granted mint exposure access
    /// @param authedUser    address to check for mint exposure access
    function verifyMintExposureAccess(
        address authedUser
    ) external view returns (bool);

    /// @notice Function for auction to add new auction completion information
    /// @param termId    term Id auction belongs to
    /// @param auctionId auction Id for auction
    /// @param auctionClearingRate auction clearing rate
    function recordAuctionResult(
        bytes32 termId,
        bytes32 auctionId,
        uint256 auctionClearingRate
    ) external;
}
