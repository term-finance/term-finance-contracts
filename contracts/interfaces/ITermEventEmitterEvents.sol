//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

interface ITermEventEmitterEvents {
    /// @notice Event emitted when a new Term Repo is delisted on Term Finance
    /// @param termRepoId unique identifier for a Term Repo
    event DelistTermRepo(bytes32 termRepoId);

    /// @notice Event emitted when a new Term Auction is delisted on Term Finance
    /// @param termAuctionId unique identifier for a Term Auction
    event DelistTermAuction(bytes32 termAuctionId);

    /// @notice Event emitted when a Term contract is upgraded to a new implementation
    /// @param proxy address of proxy contract
    /// @param implementation address of new impl contract proxy has been upgraded to
    event TermContractUpgraded(address proxy, address implementation);
}
