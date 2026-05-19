//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @notice ITermIntentEvents is an interface that defines all events emitted by the Term Intent contracts.
interface ITermIntentEvents {
    // ========================================================================
    // = Structs ==============================================================
    // ========================================================================

    /// @notice Data structure containing all information about a repo token swap transaction
    /// @dev Used in RepoTokenSwapFilled event to provide comprehensive swap details
    /// @param repoToken The repo token being swapped
    /// @param purchaseToken The purchase token involved in the swap
    /// @param maker The address of the order maker (initiator of the swap)
    /// @param taker The address of the order taker (counterparty of the swap)
    /// @param makerToken The token provided by the maker
    /// @param takerToken The token provided by the taker
    /// @param discountRate The discount rate applied to the swap (in basis points or similar unit)
    /// @param makerTokenAmountFilled The amount of maker tokens that were filled in the swap
    /// @param takerTokenAmountFilled The amount of taker tokens that were filled in the swap
    /// @param makerFee The fee paid by the maker for the swap
    /// @param takerFee The fee paid by the taker for the swap
    /// @param feeRecipient The address that receives the swap fees
    /// @param originalOrderAmount The original purchaseTokenAmount of the maker provided by the Maker
    /// @param expiry The expiration date of the order
    /// @param salt The user generated value for order uniqueness and replay protection
    struct RepoTokenSwapData {
        address repoToken;
        address purchaseToken;
        address maker;
        address taker;
        address makerToken;
        address takerToken;
        uint256 discountRate;
        uint256 makerTokenAmountFilled;
        uint256 takerTokenAmountFilled;
        uint256 makerFee;
        uint256 takerFee;
        address feeRecipient;
        uint256 originalOrderAmount;
        uint256 expiry;
        uint256 salt;
    }

    // ========================================================================
    // = Events ===============================================================
    // ========================================================================

    /// @notice Event emitted when an intent is successfully filled
    /// @param orderHash The hash of the order that was filled
    /// @param termRepoId The ID of the term repo
    /// @param purchaseToken The token being purchased
    /// @param maker The address of the order maker
    /// @param taker The address of the order taker
    /// @param makerToken The token provided by the maker
    /// @param takerToken The token provided by the taker
    /// @param offerRate The rate of the offer
    /// @param makerTokenAmountFilled The amount of maker tokens filled
    /// @param takerTokenAmountFilled The amount of taker tokens filled
    /// @param proratedBorrowFee The prorated fee for borrow
    /// @param feeRecipient The address that receives the fees
    /// @param originalOrderAmount The original purchaseTokenAmount of the maker provided by the Maker
    /// @param expiry The expiration date of the order
    /// @param salt The user generated value for order uniqueness and replay protection
    event IntentFilled(
        bytes32 orderHash,
        bytes32 termRepoId,
        address purchaseToken,
        address maker,
        address taker,
        address makerToken,
        address takerToken,
        uint256 offerRate,
        uint256 makerTokenAmountFilled,
        uint256 takerTokenAmountFilled,
        uint256 proratedBorrowFee,
        address feeRecipient,
        uint256 originalOrderAmount,
        uint256 expiry,
        uint256 salt
    );

    /// @notice Event emitted when an intent is successfully cancelled
    /// @param orderHash The hash of the order that was cancelled
    event IntentCancelled(
        bytes32 orderHash
    );

    /// @notice Event emitted when a repo token swap order is filled
    /// @param orderHash The hash of the order that was filled
    /// @param swapData The swap data containing all swap details
    event RepoTokenSwapFilled(
        bytes32 orderHash,
        RepoTokenSwapData swapData
    );

    /// @notice Event emitted when a minimum salt value is set for limit orders of a specific token pair by a maker
    /// @dev This event is used to track the minimum salt requirements for order creation
    /// @param maker The address of the maker setting the minimum salt value
    /// @param makerToken The address of the token being offered by the maker
    /// @param takerToken The address of the token being requested by the maker
    /// @param minSaltValue The minimum salt value required for orders with this token pair
    event LimitOrderTokenPairMinSalt(
        address maker,
        address makerToken,
        address takerToken,
        uint256 minSaltValue
    );

    /// @notice Event emitted when a minimum salt value is set for swap orders of a specific token pair by a maker
    /// @dev This event is used to track the minimum salt requirements for order creation
    /// @param maker The address of the maker setting the minimum salt value
    /// @param makerToken The address of the token being offered by the maker
    /// @param takerToken The address of the token being requested by the maker
    /// @param minSaltValue The minimum salt value required for orders with this token pair
    event SwapOrderTokenPairMinSalt(
        address maker,
        address makerToken,
        address takerToken,
        uint256 minSaltValue
    );
}