//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {ITermController} from "../interfaces/ITermController.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {ITermIntentEvents} from "../interfaces/ITermIntentEvents.sol";

import {ExponentialNoError} from "../lib/ExponentialNoError.sol";
import {Versionable} from "../lib/Versionable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {LibTermStorage, TermStorage}  from "../libraries/LibTermStorage.sol";
import {IDiamondLoupe} from "./DiamondLoupeFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";

/// @author TermLabs
/// @title Term Loan Intent Facet
/// @notice This facet handles settlement of limit orders for lending and borrowing
/// @dev This facet provides off-chain order settlement functionality with EIP712 signature validation and presigned order support for contract wallets
contract TermLoanIntentFacet is 
    TermMultiContextAuth,
    ITermIntent,
    ReentrancyGuard,
    ExponentialNoError,
    Versionable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using Address for address;

    // ========================================================================
    // = Constants  ===========================================================
    // ========================================================================

    uint256 private constant YEAR_SECONDS = 360 days;
    address private constant ALLOW_ANY_ADDRESS = address(0);

    // EIP-712 TypeHashes for structs
    // keccak256("RetrieveFundsStruct(bytes4 method,address target,bytes additionalCalldata)")
    bytes32 private constant RETRIEVE_FUNDS_STRUCT_TYPEHASH = 0x256d2844f30b75f89e6ec9418f35732e254268f054ce2b9f508642c924b76a8a;

    // The type hash for limit orders
    // keccak256("LimitLendOrder(address repoServicer,uint256 purchaseTokenAmount,uint256 offerRate,address maker,address taker,uint256 borrowFee,address feeRecipient,uint256 expiry,uint256 salt,RetrieveFundsStruct retrieveFunds)RetrieveFundsStruct(bytes4 method,address target,bytes additionalCalldata)")
    bytes32 private constant _LEND_LIMIT_ORDER_TYPEHASH = 0x52a3e557725e0745de62ca9c2f873223f092b8f8fdb4bbf8f3120216ecedd7a9;

    // keccak256("LimitBorrowOrder(address repoServicer,uint256 purchaseTokenAmount,uint256[] collateralAmounts,uint256 offerRate,address maker,address taker,uint256 borrowFee,address feeRecipient,uint256 expiry,uint256 salt,RetrieveFundsStruct[] retrieveFundsList)RetrieveFundsStruct(bytes4 method,address target,bytes additionalCalldata)")
    bytes32 private constant _BORROW_LIMIT_ORDER_TYPEHASH = 0xa92b0c41d8931853dfcf7e881934d0e47cebb5e838164ed0473362e6958b70a5;

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    /// @notice Initializes the TermIntent state during diamond deployment
    /// @param emitter_ The term event emitter contract
    function initializeTermIntentFacet(
        ITermEventEmitter emitter_
    ) external {
        TermStorage storage s = LibTermStorage.termStorage();

        if (s.termIntentInitialized){
            revert AlreadyInitialized();
        }

        // Initialize EIP712 domain separator with correct proxy address (diamond address)
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
                keccak256(bytes(version())), // use version from Versionable
                chainId,
                address(this) // diamond address
            )
        );
        
        if (!s.termIntentInitialized) {
            require(address(emitter_) != address(0), "InvalidEventEmitter");
                // Mark as initialized
            s.termIntentInitialized = true;
            
            // Set event emitter
            s.emitter = emitter_;
        }
    }

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Calculates the hash for a lend limit order
    /// @param order The lend limit order struct
    /// @return The EIP712 hash of the order
    function getLendOrderHash(LimitLendOrder calldata order) external view returns (bytes32) {
        return _getLendOrderHash(order);
    }

    /// @notice Calculates the hash for a borrow limit order
    /// @param order The borrow limit order struct
    /// @return The EIP712 hash of the order
    function getBorrowOrderHash(LimitBorrowOrder calldata order) external view returns (bytes32) {
        return _getBorrowOrderHash(order);
    }

    /// @notice Pre-authorizes a lend order hash for maker addresses that cannot sign EIP712 messages
    /// @param order The lend limit order to pre-sign
    function setPreSignedLendOrderHash(LimitLendOrder calldata order) external nonReentrant {
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        _validateLendOrderParams(order);
        _validateLimitOrderNotCancelled(order.maker, servicer.purchaseToken(), address(servicer.termRepoToken()), order.salt);
        _validateRetrieveFunds(order.retrieveFunds);
        if (order.maker != msg.sender) {
            revert InvalidSender(order.maker, msg.sender);
        }

        bytes32 orderHash = _getLendOrderHash(order);
        TermStorage storage s = LibTermStorage.termStorage();
        if (s.preSignedLimitOrders[orderHash] != address(0)) {
            revert AlreadyPreSigned(s.preSignedLimitOrders[orderHash]);
        }
        OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        if (orderContext.status != ITermIntent.OrderStatus.UNFILLED) {
            revert InvalidOrderStatus();
        }

        s.preSignedLimitOrders[orderHash] = msg.sender;
    }

    /// @notice Pre-authorizes a borrow order hash for maker addresses that cannot sign EIP712 messages
    /// @param order The borrow limit order to pre-sign
    function setPreSignedBorrowOrderHash(LimitBorrowOrder calldata order) external nonReentrant {
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        _validateBorrowOrderParams(order);
        _validateLimitOrderNotCancelled(order.maker, address(servicer.termRepoToken()), servicer.purchaseToken(), order.salt);
        for (uint8 i = 0; i < order.retrieveFundsList.length; ++i) {
            _validateRetrieveFunds(order.retrieveFundsList[i]);
        }
        if (order.maker != msg.sender) {
            revert InvalidSender(order.maker, msg.sender);
        }

        bytes32 orderHash = _getBorrowOrderHash(order);
        TermStorage storage s = LibTermStorage.termStorage();
        if (s.preSignedLimitOrders[orderHash] != address(0)) {
            revert AlreadyPreSigned(s.preSignedLimitOrders[orderHash]);
        }
        OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        if (orderContext.status != ITermIntent.OrderStatus.UNFILLED) {
            revert InvalidOrderStatus();
        }

        s.preSignedLimitOrders[orderHash] = msg.sender;
    }

    /// @notice Revokes a pre-signed order hash
    /// @param orderHash The hash of the order to revoke
    function revokePreSignedLimitOrderHash(bytes32 orderHash) external nonReentrant {
        TermStorage storage s = LibTermStorage.termStorage();
        address maker = s.preSignedLimitOrders[orderHash];
        if (maker != msg.sender) {
            revert InvalidSender(maker, msg.sender);
        }
        delete s.preSignedLimitOrders[orderHash];
    }

    /// @notice Settles a lend limit order
    /// @param order The lend limit order to settle
    /// @param fillAmount The amount to fill
    /// @param collateralAmounts Array of collateral amounts
    /// @param signature The signature for the order
    /// @param usePermit2 Permit2 approvals used for token transfers
    function settleLimitLend(
        LimitLendOrder memory order,
        uint256 fillAmount,
        uint256[] memory collateralAmounts,
        Signature memory signature,
        bool usePermit2
    ) external nonReentrant {
        _settleLimitLendInternal(order, msg.sender, fillAmount, collateralAmounts, signature, false, usePermit2);
    }

    /// @notice Settles a lend limit order with specified taker (diamond multicall use only)
    /// @param order The lend limit order to settle
    /// @param taker The address acting as the taker
    /// @param fillAmount The amount to fill
    /// @param collateralAmounts Array of collateral amounts
    /// @param signature The signature for the order
    function settleLimitLend(
        LimitLendOrder memory order,
        address taker, 
        uint256 fillAmount,
        uint256[] memory collateralAmounts,
        Signature memory signature
    ) external requireBatchContext(taker) nonReentrant {
        _settleLimitLendInternal(order, taker, fillAmount, collateralAmounts, signature, true, false);
    }

    /// @notice Cancels a lend limit order
    /// @param order The lend limit order to cancel
    /// @param signature The signature for the order
    function cancelLimitLend(LimitLendOrder calldata order, Signature calldata signature) external nonReentrant {
        bytes32 orderHash = _getLendOrderHash(order);
        _cancelOrder(orderHash, order.maker, msg.sender, signature);
    }

    /// @notice Settles a borrow limit order
    /// @param order The borrow limit order to settle
    /// @param fillAmount The amount to fill
    /// @param signature The signature for the order
    /// @param usePermit2 Permit2 approvals used for token transfers
    function settleLimitBorrow(
        LimitBorrowOrder memory order,
        uint256 fillAmount,
        Signature memory signature,
        bool usePermit2
    ) external nonReentrant {
        _settleLimitBorrowInternal(order, msg.sender, fillAmount, signature, false, usePermit2);
    }

    /// @notice Settles a borrow limit order with specified taker (diamond multicall use only)
    /// @param order The borrow limit order to settle
    /// @param taker The address acting as the taker
    /// @param fillAmount The amount to fill
    /// @param signature The signature for the order
    function settleLimitBorrow(
        LimitBorrowOrder memory order,
        address taker,
        uint256 fillAmount,
        Signature memory signature
    ) external requireBatchContext(taker) nonReentrant  {
        _settleLimitBorrowInternal(order, taker, fillAmount, signature, true, false);
    }

    /// @notice Cancels a borrow limit order
    /// @param order The borrow limit order to cancel
    /// @param signature The signature for the order
    function cancelLimitBorrow(LimitBorrowOrder calldata order, Signature calldata signature) external nonReentrant {
        bytes32 orderHash = _getBorrowOrderHash(order);
        _cancelOrder(orderHash, order.maker, msg.sender, signature);
    }

    /**
     * @notice Cancels all limit orders with salt values below the specified minimum for a given token pair
     * @param makerToken The token that the maker is offering in the order
     * @param takerToken The token that the maker wants to receive in the order
     * @param minValidSalt The new minimum salt value - orders with salt below this value will be cancelled
     */
    function setLimitOrderMakerTokenPairMinSaltValue(address makerToken, address takerToken, uint256 minValidSalt) external nonReentrant {
        TermStorage storage s = LibTermStorage.termStorage();

        if (makerToken == address(0)) {
            revert InvalidParameters("No Maker Token Set");
        }
        if (takerToken == address(0)) {
            revert InvalidParameters("No Taker Token Set");
        }
        if (makerToken == takerToken) {
            revert InvalidParameters("Maker and Taker Token Identical");
        }
        if (minValidSalt == type(uint256).max) {
            revert InvalidParameters("Invalid Min Salt");
        }

        uint256 oldMinValidSalt = s.limitOrderMakerTokenPairMinSalt[msg.sender][
            makerToken
        ][takerToken];

        if (oldMinValidSalt > minValidSalt) {
            revert InvalidMinSalt();
        }

        s.limitOrderMakerTokenPairMinSalt[msg.sender][makerToken][takerToken] = minValidSalt;
        s.emitter.emitLimitOrderTokenPairMinSaltValue(msg.sender, makerToken, takerToken, minValidSalt);
    }

    /**
     * @notice Gets the current minimum salt value for limit orders for a given maker and token pair
     * @param maker The maker address to query
     * @param makerToken The token that the maker is offering in the order
     * @param takerToken The token that the maker wants to receive in the order
     * @return The current minimum salt value
     */
    function getLimitOrderMakerTokenPairMinSaltValue(address maker, IERC20 makerToken, IERC20 takerToken) external view returns (uint256) {
        TermStorage storage s = LibTermStorage.termStorage();
        return s.limitOrderMakerTokenPairMinSalt[maker][address(makerToken)][address(takerToken)];
    }

    /// @notice Returns the EIP-712 domain separator used for signing typed structured data.
    /// @return The EIP-712 domain separator as a bytes32 value.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        TermStorage storage s = LibTermStorage.termStorage();
        return s.eip712DomainSeparator;
    }

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    // ------------------------------------------------------------------------
    // Hash and Signature Utilities
    // ------------------------------------------------------------------------

    function _getLendOrderHash(LimitLendOrder memory order) private view returns (bytes32) {
        return _getEIP712Hash(
            keccak256(abi.encode(
                _LEND_LIMIT_ORDER_TYPEHASH,
                order.repoServicer,
                order.purchaseTokenAmount,
                order.offerRate,
                order.maker,
                order.taker,
                order.borrowFee,
                order.feeRecipient,
                order.expiry,
                order.salt,
                _hashRetrieveFundsStruct(order.retrieveFunds)
            )));
    }

    function _getBorrowOrderHash(LimitBorrowOrder memory order) private view returns (bytes32) {
        return _getEIP712Hash(
            keccak256(abi.encode(
                _BORROW_LIMIT_ORDER_TYPEHASH,
                order.repoServicer,
                order.purchaseTokenAmount,
                keccak256(abi.encodePacked(order.collateralAmounts)),
                order.offerRate,
                order.maker,
                order.taker,
                order.borrowFee,
                order.feeRecipient,
                order.expiry,
                order.salt,
                _hashRetrieveFundsArray(order.retrieveFundsList)
         )));
    }

    /// @notice Hashes a single RetrieveFundsStruct per EIP-712 specification
    /// @param item The RetrieveFundsStruct to hash
    /// @return The EIP-712 hash of the struct
    function _hashRetrieveFundsStruct(RetrieveFundsStruct memory item) private pure returns (bytes32) {
        return keccak256(abi.encode(
            RETRIEVE_FUNDS_STRUCT_TYPEHASH,
            item.method,
            item.target,
            keccak256(item.additionalCalldata) // bytes are hashed per EIP-712
        ));
    }

    /// @notice Hashes an array of RetrieveFundsStruct per EIP-712 specification
    /// @param items The array of RetrieveFundsStruct to hash
    /// @return The EIP-712 hash of the array
    function _hashRetrieveFundsArray(RetrieveFundsStruct[] memory items) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            hashes[i] = _hashRetrieveFundsStruct(items[i]);
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _getEIP712Hash(bytes32 structHash) private view returns (bytes32) {
        TermStorage storage s = LibTermStorage.termStorage();
        return keccak256(abi.encodePacked(hex"1901", s.eip712DomainSeparator, structHash));
    }

    function _recoverEIP712Signature(bytes32 orderHash, bytes memory sigData) private pure returns (address) {
        (uint8 v, bytes32 r, bytes32 s) = abi.decode(sigData, (uint8, bytes32, bytes32));
        return ECDSA.recover(orderHash, v, r, s);
    }

    function _getSignerOfHash(bytes32 orderHash, Signature memory signature) private view returns (address) {
        TermStorage storage s = LibTermStorage.termStorage();
        if (signature.sigType == SignatureType.EIP712) {
            return _recoverEIP712Signature(orderHash, signature.sigData);
        } else if (signature.sigType == SignatureType.PRESIGN) {
            return s.preSignedLimitOrders[orderHash];
        } else {
            revert InvalidSignature();
        }
    }

    // ------------------------------------------------------------------------
    // Validation Functions
    // ------------------------------------------------------------------------

    function _validateLendOrderParams(LimitLendOrder memory order) private view {
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        _validateRepoServicer(servicer);

        if (order.purchaseTokenAmount == 0) {
            revert InvalidPurchaseTokenAmount();
        }
        if (order.expiry < block.timestamp) {
            revert OrderExpired();
        }
        if (order.offerRate == 0) {
            revert InvalidOfferRate();
        }
        
    }

    function _validateBorrowOrderParams(LimitBorrowOrder memory order) private view {
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        _validateRepoServicer(servicer);

        if (order.purchaseTokenAmount == 0) {
            revert InvalidPurchaseTokenAmount();
        }
        if (order.expiry < block.timestamp) {
            revert OrderExpired();
        }
        if (order.offerRate == 0) {
            revert InvalidOfferRate();
        }
        
        if (order.collateralAmounts.length != servicer.termRepoCollateralManager().numOfAcceptedCollateralTokens()) {
            revert InvalidCollateralAmountsInput();
        }
        if (order.retrieveFundsList.length > 0) {
            if (order.retrieveFundsList.length != order.collateralAmounts.length) {
                revert InvalidRetrieveFundsListLength();
            }
        }
    }

    function _validateRepoServicer(ITermRepoServicer servicer) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = servicer.termController();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(servicer)) && !termController.isFactoryDeployed(address(servicer))) {
            revert InvalidRepoId();
        }

        if (block.timestamp > servicer.maturityTimestamp()) {
            revert AfterMaturity();
        }
    }

    function _validateOrderSignature(bytes32 orderHash, address maker, Signature memory signature) private view {
        address signer = _getSignerOfHash(orderHash, signature);
        if (signer != maker) {
            revert InvalidSignature();
        }
    }

    function _validateOrderStatus(OrderContext memory orderContext) private pure {
        if (orderContext.status != ITermIntent.OrderStatus.UNFILLED && orderContext.status != ITermIntent.OrderStatus.PARTIALLY_FILLED) {
            revert InvalidOrderStatus();
        }
    }

    function _validateOrderAuthorization(address taker, address fulfiller) private pure {
        if (taker != ALLOW_ANY_ADDRESS && fulfiller != taker) {
            revert InvalidTaker(taker, fulfiller);
        }
    }

    function _validateLimitOrderNotCancelled(address maker, address makerToken, address takerToken, uint256 salt) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        uint256 minSalt = s.limitOrderMakerTokenPairMinSalt[maker][makerToken][takerToken];
        if (salt <= minSalt) {
            revert OrderCancelled();
        }
    }

    function _validateRetrieveFunds(RetrieveFundsStruct memory retrieveFunds) private view returns(bool) {
        if (retrieveFunds.method != bytes4(0)) {
            address facetAddress = IDiamondLoupe(address(this)).facetAddress(retrieveFunds.method);

            // Confirm that method belongs to specified facet
            if (facetAddress == address(0)) {
                revert InvalidRetrieveFundsFunction();
            }
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------------
    // Calculation and Utility Functions
    // ------------------------------------------------------------------------

    function _validateFillAmount(
        uint256 fillAmount,
        uint256 totalAmount,
        uint256 filledAmount
    ) private pure returns (uint256)  {
        uint256 maxFill = totalAmount - filledAmount;
        if (maxFill < fillAmount) {
            revert InsufficientRemainingCapacity(maxFill);
        }
        return fillAmount;
    }

    function _generateRetrieveFundsCalldata(RetrieveFundsStruct memory retrieveFunds, uint256 amountToRetrieve, address token, address user) private returns (bytes memory) {
        address facetAddress = IDiamondLoupe(address(this)).facetAddress(retrieveFunds.method);
        bytes4 sig = bytes4(keccak256("generateCalldata(bytes4,address,address,address,uint256,bool,bytes)"));

        bytes memory encodeCalldataInput = abi.encodeWithSelector(sig, retrieveFunds.method, retrieveFunds.target, token, user, amountToRetrieve, false, retrieveFunds.additionalCalldata);
        bytes memory returnData = Address.functionCall(
            facetAddress,
            encodeCalldataInput
        );
        return abi.decode(returnData, (bytes));
    }

    // ------------------------------------------------------------------------
    // Order Management
    // ------------------------------------------------------------------------

    function _updateOrderStatus(
        uint256 maxFill,
        uint256 fillAmount,
        bytes32 orderHash,
        OrderContext memory orderContext
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        if (fillAmount == maxFill) {
            orderContext.status = ITermIntent.OrderStatus.FILLED;
        } else {
            orderContext.status = ITermIntent.OrderStatus.PARTIALLY_FILLED;
        }

        orderContext.filledAmount += fillAmount.toUint128();
        s.limitOrderContextMapping[orderHash] = orderContext;
    }

    function _cancelOrder(
        bytes32 orderHash,
        address maker,
        address caller,
        Signature memory signature
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];

        if (orderContext.status == ITermIntent.OrderStatus.FILLED || orderContext.status == ITermIntent.OrderStatus.CANCELLED) {
            revert InvalidOrderStatus();
        }

        address signer = _getSignerOfHash(orderHash, signature);
        if (signer != maker) {
            revert InvalidSignature();
        }

        if (maker != caller) {
            revert InvalidSender(maker, caller);
        }

        s.limitOrderContextMapping[orderHash].status = ITermIntent.OrderStatus.CANCELLED;
        s.emitter.emitIntentCancelled(orderHash);
    }

    // ------------------------------------------------------------------------
    // Settlement Processing
    // ------------------------------------------------------------------------

    /// @notice Internal function for settling lend orders
    function _settleLimitLendInternal(
        LimitLendOrder memory order,
        address borrower,
        uint256 fillAmount,
        uint256[] memory collateralAmounts,
        Signature memory signature,
        bool isRoutedCollateral,
        bool usePermit2
    ) private {
        ITermRepoServicer repoServicer = ITermRepoServicer(order.repoServicer);

        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }

        if (order.maker == borrower) {
            revert MakerCannotBeTaker();
        }

        if (collateralAmounts.length != repoServicer.termRepoCollateralManager().numOfAcceptedCollateralTokens()){
            revert InvalidCollateralAmountsInput();
        }

        _validateLendOrderParams(order);

        bytes32 orderHash = _getLendOrderHash(order);
        _validateOrderSignature(orderHash, order.maker, signature);

        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        _validateOrderStatus(orderContext);

        _validateLimitOrderNotCancelled(order.maker, repoServicer.purchaseToken(), address(repoServicer.termRepoToken()), order.salt);
        _validateOrderAuthorization(order.taker, borrower);
        bool retrieveFundsRequested = _validateRetrieveFunds(order.retrieveFunds);
        if (!s.approvedFeeRecipients[order.feeRecipient]) {
            revert InvalidFeeRecipient();
        }

       // Fill amount cached after validation to prevent stack overflow 
       uint256 validatedFillAmount = _validateFillAmount(
            fillAmount,
            order.purchaseTokenAmount,
            orderContext.filledAmount
        );

        _updateOrderStatus(
            order.purchaseTokenAmount - orderContext.filledAmount,
            validatedFillAmount,
            orderHash,
            orderContext
        );

        ITermRepoCollateralManager collateralManager = repoServicer.termRepoCollateralManager();
        address termRepoLocker = address(repoServicer.termRepoLocker());
        uint8 i;

        // Diamond needs to approve TermRepoLocker when collateral is routed through it
        if (usePermit2 || isRoutedCollateral) {       
            for (i = 0; i < collateralAmounts.length; ++i) {
                if (collateralAmounts[i] != 0) {
                    IERC20(collateralManager.collateralTokens(i)).forceApprove(termRepoLocker, collateralAmounts[i]);
                }
            }
        }

        _settleLendOrder(
            orderHash,
            order,
            borrower,
            validatedFillAmount,
            isRoutedCollateral,
            retrieveFundsRequested,
            collateralAmounts,
            usePermit2
        );

        // Diamond needs to revoke approval to TermRepoLocker when collateral is routed through it after minting
        if (usePermit2 || isRoutedCollateral) {
            for (i = 0; i < collateralAmounts.length; ++i) {
                if (collateralAmounts[i] != 0) {
                    IERC20(collateralManager.collateralTokens(i)).forceApprove(termRepoLocker, 0);
                }
            }
        }

    }

    /// @notice Internal function for settling borrow orders
    function _settleLimitBorrowInternal(
        LimitBorrowOrder memory order,
        address lender,
        uint256 fillAmount,
        Signature memory signature,
        bool isRoutedPurchaseToken,
        bool usePermit2
    ) private {
        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }

        if (order.maker == lender) {
            revert MakerCannotBeTaker();
        }

        _validateBorrowOrderParams(order);

        bytes32 orderHash = _getBorrowOrderHash(order);
        _validateOrderSignature(orderHash, order.maker, signature);

        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        _validateOrderStatus(orderContext);

        ITermRepoServicer repoServicer = ITermRepoServicer(order.repoServicer);

        _validateLimitOrderNotCancelled(order.maker, address(repoServicer.termRepoToken()), repoServicer.purchaseToken(), order.salt);
        _validateOrderAuthorization(order.taker, lender);

        bool retrieveFundsRequested;
        uint8 i;
        for (i=0; i < order.retrieveFundsList.length; ++i) {
            if (_validateRetrieveFunds(order.retrieveFundsList[i])) {
                retrieveFundsRequested = true;
            }
        }
        if (!s.approvedFeeRecipients[order.feeRecipient]) {
            revert InvalidFeeRecipient();
        }

        // Fill amount cached after validation to prevent stack overflow 
        uint256 validatedFillAmount = _validateFillAmount(
            fillAmount,
            order.purchaseTokenAmount,
            orderContext.filledAmount
        );

        _updateOrderStatus(
            order.purchaseTokenAmount - orderContext.filledAmount,
            validatedFillAmount,
            orderHash,
            orderContext
        );

        ITermRepoCollateralManager collateralManager = repoServicer.termRepoCollateralManager();
        address termRepoLocker = address(repoServicer.termRepoLocker());
        for (i = 0; i < order.collateralAmounts.length; ++i) {
            if (order.collateralAmounts[i] != 0) {
                IERC20(collateralManager.collateralTokens(i)).forceApprove(termRepoLocker, order.collateralAmounts[i]);
            }
        }

        _settleBorrowOrder(
            orderHash,
            order,
            lender,
            validatedFillAmount,
            isRoutedPurchaseToken,
            retrieveFundsRequested,
            usePermit2
        );

        for (i = 0; i < order.collateralAmounts.length; ++i) {
            if (order.collateralAmounts[i] != 0) {
                IERC20(collateralManager.collateralTokens(i)).forceApprove(termRepoLocker, 0);
            }
        }
    }

    function _settleLendOrder(
        bytes32 orderHash,
        LimitLendOrder memory order,
        address borrower,
        uint256 fillAmount,
        bool isRoutedCollateral,
        bool retrieveFundsRequested,
        uint256[] memory collateralAmounts,
        bool usePermit2
    ) private {
        bool isRoutedPurchaseToken = retrieveFundsRequested;
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);

        if (retrieveFundsRequested){
            // generate retrieveFundsCalldata
            bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
                    order.retrieveFunds,
                    fillAmount,
                    servicer.purchaseToken(),
                    order.maker
            );

            // Set settlement context before executing retrieveFunds
            TermStorage storage ts = LibTermStorage.termStorage();
            ts.activeSettlementMaker = order.maker;

            uint256 purchaseTokenBalanceBeforeRetrieveFunds = IERC20(servicer.purchaseToken()).balanceOf(address(this));

            // execute retrieveFundsCalldata
            Address.functionCall(
                address(this),
                retrieveFundsCalldata
            );

            uint256 purchaseTokenBalanceAfterRetrieveFunds = IERC20(servicer.purchaseToken()).balanceOf(address(this));
            if (purchaseTokenBalanceAfterRetrieveFunds < purchaseTokenBalanceBeforeRetrieveFunds + fillAmount) {
                revert InsufficientFundsRetrieved();
            }

            // Clear settlement context after execution
            ts.activeSettlementMaker = address(0);
        }

        if (!isRoutedCollateral && usePermit2 ) {
            ITermRepoCollateralManager collateralManager = servicer.termRepoCollateralManager();
            for (uint8 i = 0 ;  i < collateralAmounts.length; ++i) {
                if (collateralAmounts[i] != 0) {
                    Permit2Lib.PERMIT2.transferFrom(borrower, address(this), collateralAmounts[i].toUint160(), collateralManager.collateralTokens(i));
                }
            }
            isRoutedCollateral = true;
        }

        uint256 termRepoTokenFillAmount = servicer.mintOpenExposureFromIntent(
            borrower, // borrower
            order.maker, // lender
            fillAmount,
            collateralAmounts,
            order.offerRate,
            isRoutedCollateral
        );

        uint256 proratedFee = _settlePurchaseTokensAndFees(
            servicer,
            borrower, // borrower
            order.maker, // lender
            fillAmount,
            order.borrowFee,
            order.feeRecipient,
            isRoutedPurchaseToken,
            false // NOTE: usePermit2 only applies to taker (borrower not lender here)
        );

        _emitLendIntentFilled(
            orderHash,
            servicer,
            order.maker,
            borrower,
            order.offerRate,
            fillAmount,
            termRepoTokenFillAmount,
            proratedFee,
            order.feeRecipient,
            order.purchaseTokenAmount,
            order.expiry,
            order.salt
        );
    }

    function _settleBorrowOrder(
        bytes32 orderHash,
        LimitBorrowOrder memory order,
        address lender,
        uint256 fillAmount,
        bool isRoutedPurchaseToken,
        bool retrieveFundsRequested,
        bool usePermit2
    ) private {
        bool isRoutedCollateral = retrieveFundsRequested;
        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);

        uint256[] memory collateralAmounts = new uint256[](order.collateralAmounts.length);
        address collateralToken;

        for (uint8 i = 0; i < collateralAmounts.length; ++i) {
            collateralAmounts[i] = order.collateralAmounts[i] * fillAmount / order.purchaseTokenAmount;

            if (!retrieveFundsRequested) {
                continue;
            }
            if (order.retrieveFundsList[i].method != bytes4(0)){
                collateralToken = servicer.termRepoCollateralManager().collateralTokens(i);
                // generate retrieveFundsCalldata
                bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
                    order.retrieveFundsList[i],
                    collateralAmounts[i],
                    collateralToken,
                    order.maker
                );

                // Set settlement context before executing retrieveFunds
                TermStorage storage ts = LibTermStorage.termStorage();
                ts.activeSettlementMaker = order.maker;

                uint256 tokenBalanceBeforeRetrieveFunds = IERC20(collateralToken).balanceOf(address(this));

                // execute retrieveFundsCalldata
                Address.functionCall(
                    address(this),
                    retrieveFundsCalldata
                );

                uint256 tokenBalanceAfterRetrieveFunds = IERC20(collateralToken).balanceOf(address(this));

                if (tokenBalanceAfterRetrieveFunds < tokenBalanceBeforeRetrieveFunds + collateralAmounts[i]) {
                    revert InsufficientFundsRetrieved();
                }

                // Clear settlement context after execution
                ts.activeSettlementMaker = address(0);
            } else {
                // retrieve naked collateral into diamond for router settlement
                IERC20(servicer.termRepoCollateralManager().collateralTokens(i)).safeTransferFrom(order.maker, address(this), collateralAmounts[i]);
            }
        }

        uint256 termRepoTokenFillAmount = servicer.mintOpenExposureFromIntent(
            order.maker, // borrower
            lender, // lender
            fillAmount,
            collateralAmounts,
            order.offerRate,
            isRoutedCollateral
        );

        uint256 proratedFee = _settlePurchaseTokensAndFees(
            servicer,
            order.maker, // borrower
            lender, // lender
            fillAmount,
            order.borrowFee,
            order.feeRecipient,
            isRoutedPurchaseToken,
            usePermit2
        );

        _emitBorrowIntentFilled(
            orderHash,
            servicer,
            order.maker,
            lender,
            order.offerRate,
            termRepoTokenFillAmount,
            fillAmount,
            proratedFee,
            order.feeRecipient,
            order.purchaseTokenAmount,
            order.expiry,
            order.salt
        );
    }


    // ------------------------------------------------------------------------
    // Token and Fee Handling
    // ------------------------------------------------------------------------

    function _settlePurchaseTokensAndFees(
        ITermRepoServicer servicer,
        address borrower,
        address lender,
        uint256 fillAmount,
        uint256 borrowFee,
        address feeRecipient,
        bool isRoutedPurchaseToken,
        bool useTransfer2
    ) private returns (uint256) {
        uint256 proratedFee = mul_ScalarTruncate(
            mul_(
                Exp({mantissa: borrowFee}),
                div_(
                    Exp({mantissa: (servicer.maturityTimestamp() - block.timestamp)}),
                    Exp({mantissa: YEAR_SECONDS})
                )
            ),
            fillAmount
        );

        address purchaseToken = servicer.purchaseToken();

        _executeTokenTransfer(
            purchaseToken,
            isRoutedPurchaseToken,
            lender,
            borrower,
            feeRecipient,
            fillAmount,
            proratedFee,
            useTransfer2
        );

        return proratedFee;
    }

    function _executeTokenTransfer(
        address token,
        bool isRouted,
        address from,
        address to,
        address feeRecipient,
        uint256 amount,
        uint256 fee,
        bool useTransfer2
    ) private {
        if (isRouted) {
            IERC20(token).safeTransfer(to, amount - fee);
            if (fee > 0) {
                IERC20(token).safeTransfer(feeRecipient, fee);
            }
        } else {
            if (useTransfer2) {
                Permit2Lib.PERMIT2.transferFrom(from, to, (amount - fee).toUint160(), token);
                if (fee > 0) {
                    Permit2Lib.PERMIT2.transferFrom(from, feeRecipient, fee.toUint160(), token);
                }
             } else {
                IERC20(token).safeTransferFrom(from, to, amount - fee);
                if (fee > 0) {
                    IERC20(token).safeTransferFrom(from, feeRecipient, fee);
                }
             }
            
        }
    }

    // ------------------------------------------------------------------------
    // Event Emission
    // ------------------------------------------------------------------------

    function _emitLendIntentFilled(
        bytes32 orderHash,
        ITermRepoServicer servicer,
        address maker,
        address taker,
        uint256 offerRate,
        uint256 fillAmount,
        uint256 termRepoTokenFillAmount,
        uint256 proratedBorrowFee,
        address feeRecipient,
        uint256 originalOrderAmount,
        uint256 expiry,
        uint256 salt
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        address purchaseToken = servicer.purchaseToken();
        s.emitter.emitIntentFilled(
            orderHash,
            servicer.termRepoId(),
            purchaseToken,
            maker,
            taker,
            purchaseToken,
            address(servicer.termRepoToken()),
            offerRate,
            fillAmount,
            termRepoTokenFillAmount,
            proratedBorrowFee,
            feeRecipient,
            originalOrderAmount,
            expiry,
            salt
        );
    }

    function _emitBorrowIntentFilled(
        bytes32 orderHash,
        ITermRepoServicer servicer,
        address maker,
        address taker,
        uint256 offerRate,
        uint256 termRepoTokenFillAmount,
        uint256 fillAmount,
        uint256 proratedBorrowFee,
        address feeRecipient,
        uint256 originalOrderAmount,
        uint256 expiry,
        uint256 salt
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        address purchaseToken = servicer.purchaseToken();
        s.emitter.emitIntentFilled(
            orderHash,
            servicer.termRepoId(),
            purchaseToken,
            maker,
            taker,
            address(servicer.termRepoToken()),
            purchaseToken,
            offerRate,
            termRepoTokenFillAmount,
            fillAmount,
            proratedBorrowFee,
            feeRecipient,
            originalOrderAmount,
            expiry,
            salt
        );
    }
}
