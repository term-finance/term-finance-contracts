//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title ITermIntent Term Intent Interface
/// @notice Interface for settlement operations including limit orders and repo token swaps
interface ITermIntent {
    // ========================================================================
    // = Enums ================================================================
    // ========================================================================
    enum OrderStatus {
        UNFILLED,
        PARTIALLY_FILLED,
        FILLED,
        CANCELLED
    }

    enum OrderType {
        LEND,
        BORROW,
        SWAP
    }

    enum SignatureType {
        EIP712,
        PRESIGN
    }

    // ========================================================================
    // = Structs ==============================================================
    // ========================================================================

    /**
     * @notice Represents a limit order for lending in a term repo auction
     * @dev Used for off-chain order creation and on-chain settlement
     * @param repoServicer Address of the repo servicer contract
     * @param purchaseTokenAmount Amount of purchase tokens to lend, in native purchase token decimals
     * @param offerRate Interest rate offered, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param maker Address of the order creator (lender)
     * @param taker Address of the order taker (borrower), zero address for any taker
     * @param borrowFee Fee charged to the borrower, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param feeRecipient Address that receives the fees
     * @param expiry Order expiration timestamp (Unix timestamp)
     * @param salt Random value for order uniqueness and replay protection
     * @param retrieveFunds Instructions for fund retrieval after settlement
     */
    struct LimitLendOrder {
        address repoServicer;
        uint256 purchaseTokenAmount;
        uint256 offerRate; 
        address maker;
        address taker;
        uint256 borrowFee;
        address feeRecipient; 
        uint256 expiry;
        uint256 salt;
        RetrieveFundsStruct retrieveFunds;
    }

    /**
     * @notice Represents a limit order for borrowing in a term repo auction
     * @dev Used for off-chain order creation and on-chain settlement
     * @param repoServicer Address of the repo servicer contract
     * @param purchaseTokenAmount Amount of purchase tokens to borrow, in native purchase token decimals
     * @param collateralAmounts Array of collateral token amounts, each in native collateral token decimals
     * @param offerRate Interest rate offered, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param maker Address of the order creator (borrower)
     * @param taker Address of the order taker (lender), zero address for any taker
     * @param borrowFee Fee charged to the borrower, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param feeRecipient Address that receives the fees
     * @param expiry Order expiration timestamp (Unix timestamp)
     * @param salt User generated value for order uniqueness and replay protection
     * @param retrieveFundsList Array of instructions for fund retrieval after settlement
     */
    struct LimitBorrowOrder {
        address repoServicer;
        uint256 purchaseTokenAmount;
        uint256[] collateralAmounts;
        uint256 offerRate;
        address maker;
        address taker;
        uint256 borrowFee;
        address feeRecipient;
        uint256 expiry;
        uint256 salt;
        RetrieveFundsStruct[] retrieveFundsList;
    }

    /**
     * @notice Represents an order for swapping repo tokens for purchase tokens or vice versa
     * @dev Used for trading repo tokens at a discount to their underlying value
     * @param repoToken Address of the repo token contract
     * @param makerAssetIsPurchaseToken True if maker is offering purchase tokens, false if offering repo tokens
     * @param purchaseTokenAmount Amount of purchase tokens involved in the swap, in native purchase token decimals
     * @param discountRate Discount rate applied to the swap, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param maker Address of the order creator
     * @param taker Address of the order taker, zero address for any taker
     * @param makerFee Fee charged to the maker, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param takerFee Fee charged to the taker, percentage in 1e18 format (1e18 = 100%, 1e17 = 10%, 1e16 = 1%)
     * @param feeRecipient Address that receives the fees
     * @param expiry Order expiration timestamp (Unix timestamp)
     * @param salt User generated value for order uniqueness and replay protection
     * @param retrieveFunds Instructions for fund retrieval after settlement
     */
    struct RepoTokenSwapOrder {
        address repoToken;
        bool makerAssetIsPurchaseToken;
        uint256 purchaseTokenAmount; 
        uint256 discountRate; 
        address maker;
        address taker;
        uint256 makerFee; 
        uint256 takerFee; 
        address feeRecipient;
        uint256 expiry; 
        uint256 salt;
        RetrieveFundsStruct retrieveFunds;
    }

    /**
     * @notice Defines instructions for retrieving funds after order settlement
     * @dev Used to specify custom fund retrieval logic via external contract calls
     * @param method Function selector (bytes4) of the method to call for fund retrieval
     * @param target Address of the contract to call for fund retrieval
     * @param additionalCalldata Additional calldata to used to encode the function call
     */
    struct RetrieveFundsStruct{
        bytes4 method;
        address target;
        bytes additionalCalldata;
    }

    /**
     * @notice Represents a signature for order authorization
     * @dev Supports multiple signature types for flexible order authentication
     * @param sigType Type of signature (EIP712 or PRESIGN)
     * @param sigData Raw signature data, format depends on sigType
     */
    struct Signature {
        SignatureType sigType;
        bytes sigData;
    }

    /**
     * @notice Tracks the execution state and filled amount for an order
     * @dev Used to prevent double-spending and track partial fills
     * @param filledAmount Total amount filled for this order (in purchase token units)
     * @param status Current execution status of the order
     */
    struct OrderContext {
        uint128 filledAmount;
        OrderStatus status;
    }

    // ========================================================================
    // = Errors ===============================================================
    // ========================================================================

    /// @notice Thrown when operation attempted after maturity
    error AfterMaturity();
    /// @notice Thrown when TermIntent storage is already initialized
    error AlreadyInitialized();
    /// @notice Notice when setting signer for already presigned order
    error AlreadyPreSigned(address signer);
    /// @notice Thrown when fee recipient is already approved
    error FeeRecipientAlreadyApproved();
    /// @notice Thrown when there is insufficient capacity remaining to fill the order
    error InsufficientRemainingCapacity(uint256 capacityRemaining);
    /// @notice Thrown when collateral amounts list does not match collateral manager tokens array
    error InvalidCollateralAmountsInput();
    /// @notice Thrown when discount rate is invalid
    error InvalidDiscountRate();
    /// @notice Thrown when fee value is invalid
    error InvalidFee();
    /// @notice Thrown when fee recipient is not approved
    error InvalidFeeRecipient();
    /// @notice Thrown when fill amount is invalid
    error InvalidFillAmount();
    /// @notice Thrown when insufficient funds are retrieved before settlement
    error InsufficientFundsRetrieved();
    /// @notice Thrown when minimum salt value is invalid
    error InvalidMinSalt();
    /// @notice Thrown when offer rate is invalid
    error InvalidOfferRate();
    /// @notice Thrown when order status is invalid for the operation
    error InvalidOrderStatus();
    /// @notice Thrown when invalid parameters are provided
    error InvalidParameters(string message);
    /// @notice Thrown when purchase token amount is invalid
    error InvalidPurchaseTokenAmount();
    /// @notice Thrown when repo ID is invalid
    error InvalidRepoId();
    /// @notice Thrown when retrieve funds function selector is not diamond cut
    error InvalidRetrieveFundsFunction();
    /// @notice Thrown when retrieve funds list does not match collateral amounts list
    error InvalidRetrieveFundsListLength();
    /// @notice Thrown when sender address doesn't match expected address
    error InvalidSender(address expected, address actual);
    /// @notice Thrown when signature verification fails
    error InvalidSignature();
    /// @notice Thrown when taker address doesn't match expected address
    error InvalidTaker(address expected, address actual);
    /// @notice Thrown when term controller is invalid
    error InvalidTermController();
    /// @notice Thrown when order has expired
    error OrderExpired();
    /// @notice Thrown when order has been cancelled
    error OrderCancelled();
    /// @notice Thrown when order maker matches taker
    error MakerCannotBeTaker();
    /// @notice Thrown when retrieve funds parameter not specified for hook execution
    error RetrieveFundsNotSpecified();
    /// @notice Thrown when term controller is already approved
    error TermControllerAlreadyApproved(); 
    /// @notice Thrown when selector is not supported for preview or execution
    error UnsupportedSelector();

}
