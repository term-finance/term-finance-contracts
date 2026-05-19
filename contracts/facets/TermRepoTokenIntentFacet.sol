//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermController} from "../interfaces/ITermController.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {ITermIntentEvents} from "../interfaces/ITermIntentEvents.sol";

import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {ExponentialNoError} from "../lib/ExponentialNoError.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {Versionable} from "../lib/Versionable.sol";
import {TermRepoToken} from "../TermRepoToken.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {LibTermStorage, TermStorage}  from "../libraries/LibTermStorage.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";
import {IDiamondLoupe} from "./DiamondLoupeFacet.sol";

/// @author TermLabs
/// @title Term Repo Token Swap Intent Facet
/// @notice This facet handles settlement of repo token swap orders between purchase tokens and repo tokens
/// @dev This facet provides functionality for swapping repo tokens with discount rate calculations, fee handling, and pre-signed order support
contract TermRepoTokenIntentFacet is 
    ReentrancyGuard,
    TermFlashHookFacet,
    TermMultiContextAuth,
    ITermIntent,
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

    // keccak256("RepoTokenSwapOrder(address repoToken,bool makerAssetIsPurchaseToken,uint256 purchaseTokenAmount,uint256 discountRate,address maker,address taker,uint256 makerFee,uint256 takerFee,address feeRecipient,uint256 expiry,uint256 salt,RetrieveFundsStruct retrieveFunds)RetrieveFundsStruct(bytes4 method,address target,bytes additionalCalldata)")
    bytes32 private constant _SWAP_ORDER_TYPEHASH = 0xcd57a296f280259286f502de3a6bab28e6b10627b6c0a7ab90bc3c6f6b8af807;

    
    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    constructor() {
        // Register preview function selectors for flash loan hook workflows
        previewMapping[this.swapRepoTokenHook.selector] = this.previewSwapRepoToken.selector;
    }
    
    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Calculates the hash for a swap order
    /// @param order The swap order struct
    /// @return The EIP712 hash of the order
    function getSwapOrderHash(RepoTokenSwapOrder calldata order) external view returns (bytes32) {
        return _getSwapOrderHash(order);
    }

    /// @notice Pre-authorizes a swap order hash for maker addresses that cannot sign EIP712 messages
    /// @param order The swap order to pre-sign
    function setPreSignedSwapHash(RepoTokenSwapOrder calldata order) external nonReentrant {
        TermRepoToken repoToken = TermRepoToken(order.repoToken);
        (,address purchaseToken,,) = repoToken.config();
        TermStorage storage s = LibTermStorage.termStorage();

        _validateSwapOrderParams(order);
        if (order.makerAssetIsPurchaseToken) {
            _validateSwapOrderNotCancelled(order.maker, purchaseToken, order.repoToken, order.salt);
        } else {
            _validateSwapOrderNotCancelled(order.maker, order.repoToken, purchaseToken, order.salt);
        }
        _validateRetrieveFunds(order.retrieveFunds);
        if (!s.approvedFeeRecipients[order.feeRecipient]) {
            revert InvalidFeeRecipient();
        }

        if (order.maker != msg.sender) {
            revert InvalidSender(order.maker, msg.sender);
        }

        bytes32 orderHash = _getSwapOrderHash(order);
        if (s.preSignedSwapOrders[orderHash] != address(0)) {
            revert AlreadyPreSigned(s.preSignedSwapOrders[orderHash]);
        }
        OrderContext memory orderContext = s.swapOrderContextMapping[orderHash];
        if (orderContext.status != ITermIntent.OrderStatus.UNFILLED) {
            revert InvalidOrderStatus();
        }

        s.preSignedSwapOrders[orderHash] = msg.sender;
    }

    /// @notice Revokes a pre-signed order hash
    /// @param orderHash The hash of the order to revoke
    function revokePreSignedSwapOrderHash(bytes32 orderHash) external nonReentrant {
        TermStorage storage s = LibTermStorage.termStorage();
        address maker = s.preSignedSwapOrders[orderHash];
        if (maker != msg.sender) {
            revert InvalidSender(maker, msg.sender);
        }
        delete s.preSignedSwapOrders[orderHash];
    }

    /// @notice Swaps repo tokens
    /// @param order The repo token swap order
    /// @param fillAmount The amount to fill
    /// @param signature The signature for the order
    /// @param usePermit2 Permit2 approvals used for token transfers
    function swapRepoToken(
        RepoTokenSwapOrder memory order,
        uint256 fillAmount,
        Signature memory signature,
        bool usePermit2
    ) external nonReentrant {
        _swapRepoTokenInternal(order, msg.sender, fillAmount, signature, false, usePermit2);
    }

    /// @notice Swaps repo tokens with specified taker (diamond multicall use only)
    /// @param order The repo token swap order
    /// @param taker The address acting as the taker
    /// @param fillAmount The amount to fill
    /// @param signature The signature for the order
    function swapRepoToken(
        RepoTokenSwapOrder memory order,
        address taker,
        uint256 fillAmount,
        Signature memory signature
    ) external requireBatchContext(taker) nonReentrant {
        _swapRepoTokenInternal(order, taker, fillAmount, signature, true, false);
    }

    /// @notice Cancels a repo token swap order
    /// @param order The repo token swap order to cancel
    /// @param signature The signature for the order
    function cancelRepoTokenSwap(RepoTokenSwapOrder calldata order, Signature calldata signature) external nonReentrant {
        bytes32 orderHash = _getSwapOrderHash(order);
        _cancelOrder(orderHash, order.maker, msg.sender, signature);
    }

     /**
     * @notice Cancels all swap orders with salt values below the specified minimum for a given token pair
     * @param makerToken The token that the maker is offering in the order
     * @param takerToken The token that the maker wants to receive in the order
     * @param minValidSalt The new minimum salt value - orders with salt below this value will be cancelled
     */
    function setSwapOrderMakerTokenPairMinSaltValue(address makerToken, address takerToken, uint256 minValidSalt) external nonReentrant {
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

        uint256 oldMinValidSalt = s.swapOrderMakerTokenPairMinSalt[msg.sender][
            makerToken
        ][takerToken];

        if (oldMinValidSalt > minValidSalt) {
            revert InvalidMinSalt();
        }

        s.swapOrderMakerTokenPairMinSalt[msg.sender][makerToken][takerToken] = minValidSalt;
        s.emitter.emitSwapOrderTokenPairMinSaltValue(msg.sender, makerToken, takerToken, minValidSalt);
    }

    /**
     * @notice Gets the current minimum salt value for swap orders for a given maker and token pair
     * @param maker The maker address to query
     * @param makerToken The token that the maker is offering in the order
     * @param takerToken The token that the maker wants to receive in the order
     * @return The current minimum salt value
     */
    function getSwapOrderMakerTokenPairMinSaltValue(address maker, IERC20 makerToken, IERC20 takerToken) external view returns (uint256) {
        TermStorage storage s = LibTermStorage.termStorage();
        return s.swapOrderMakerTokenPairMinSalt[maker][address(makerToken)][address(takerToken)];
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /**
     * @notice Executes a repo token swap as a flash loan hook action
     * @dev Decodes a RepoTokenSwapOrder and Signature from the hook input's additionalCalldata,
     *      calculates the purchase token fill amount from the taker's desired output amount,
     *      performs the swap, and transfers the taker's output tokens back to this contract.
     *      Must be called within a flash loan context for the given user.
     * @param input The action hook input containing the user, output amount, and encoded swap order data
     */
    function swapRepoTokenHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant {
        address taker = input.user;
        uint256 takerSwapOutputAmount = input.minOutputAmount;
        (bool usePermit2, RepoTokenSwapOrder memory order, Signature memory signature) = abi.decode(input.additionalCalldata, (bool, RepoTokenSwapOrder, Signature));
        TermRepoToken repoToken = TermRepoToken(order.repoToken);
        (uint256 redemptionTimestamp, address purchaseToken,,) = repoToken.config();
        uint256 redemptionValue = repoToken.redemptionValue();
        address takerToken = order.makerAssetIsPurchaseToken ? purchaseToken : address(repoToken);
        
        uint256 purchaseTokenFillAmount = _calculateFillAmountFromBorrowAmount(
            takerSwapOutputAmount,
            order.makerFee,
            redemptionTimestamp,
            redemptionValue,
            order.discountRate,
            order.makerAssetIsPurchaseToken
        );

        bytes32 orderHash = _getSwapOrderHash(order);
        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.swapOrderContextMapping[orderHash];

        _validateFillAmount(purchaseTokenFillAmount, order.purchaseTokenAmount, orderContext.filledAmount);
        
        _swapRepoTokenInternal(order, taker, purchaseTokenFillAmount, signature, true, usePermit2);

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                taker,
                address(this),
                takerSwapOutputAmount.toUint160(),
                takerToken
            );
        } else {
            IERC20(takerToken).safeTransferFrom(taker, address(this), takerSwapOutputAmount);
        }
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /**
     * @notice Previews a repo token swap by returning the expected input/output tokens and amounts
     * @dev Decodes the swap order from additionalCalldata to determine token directions based on
     *      whether the maker asset is the purchase token or the repo token. Reverts if input and
     *      output tokens are the same.
     * @param actionHookInput The action hook input containing encoded swap order data
     * @return A PreviewAction struct with the expected tokens, amounts, and determinism flag
     */
    function previewSwapRepoToken(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {
        (, RepoTokenSwapOrder memory order, ) = abi.decode(actionHookInput.additionalCalldata, (bool, RepoTokenSwapOrder, Signature));
        (uint256 redemptionTimestamp,address purchaseToken,,) = TermRepoToken(order.repoToken).config();
        uint256 redemptionValue = TermRepoToken(order.repoToken).redemptionValue();
        address expectedInputToken;
        address expectedOutputToken;
        uint256 expectedInputAmount;
        if (order.makerAssetIsPurchaseToken) {
            expectedInputToken = order.repoToken;
            uint256 grossPurchaseTokenFill = _calculateFillAmountFromBorrowAmount(
                actionHookInput.minOutputAmount,
                order.makerFee,
                redemptionTimestamp,
                redemptionValue,
                order.discountRate,
                true
            );
            expectedInputAmount = _calculateRepoTokenAmount(
                redemptionTimestamp,
                redemptionValue,
                grossPurchaseTokenFill,
                order.discountRate
            );
            expectedOutputToken = purchaseToken;
        } else {
            expectedInputToken = purchaseToken;
            expectedInputAmount = _calculateFillAmountFromBorrowAmount(
                actionHookInput.minOutputAmount,
                order.makerFee,
                redemptionTimestamp,
                redemptionValue,
                order.discountRate,
                false
            );
            expectedOutputToken = order.repoToken;
        }

         if (expectedInputToken == expectedOutputToken) {
             revert InputOutputTokenCollision();
         }

         return PreviewAction({
            expectedInputToken: expectedInputToken,
            expectedInputAmount: expectedInputAmount,
            expectedOutputToken: expectedOutputToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
         });
    }




    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    // ------------------------------------------------------------------------
    // Hash and Signature Utilities
    // ------------------------------------------------------------------------

    function _getSwapOrderHash(RepoTokenSwapOrder memory order) private view returns (bytes32) {
        return _getEIP712Hash(
            keccak256(abi.encode(
                _SWAP_ORDER_TYPEHASH,
                order.repoToken,
                order.makerAssetIsPurchaseToken,
                order.purchaseTokenAmount,
                order.discountRate,
                order.maker,
                order.taker,
                order.makerFee,
                order.takerFee,
                order.feeRecipient,
                order.expiry,
                order.salt,
                _hashRetrieveFundsStruct(order.retrieveFunds)
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
            return s.preSignedSwapOrders[orderHash];
        } else {
            revert InvalidSignature();
        }
    }

    // ------------------------------------------------------------------------
    // Validation Functions
    // ------------------------------------------------------------------------

    function _validateSwapOrderParams(RepoTokenSwapOrder memory order) private view {
        TermRepoToken repoToken = TermRepoToken(order.repoToken);
        _validateRepoToken(repoToken);

        if (order.purchaseTokenAmount == 0) {
            revert InvalidPurchaseTokenAmount();
        }
        if (order.expiry < block.timestamp) {
            revert OrderExpired();
        }
        if (order.discountRate == 0) {
            revert InvalidDiscountRate();
        }
        
    }

    function _validateRepoToken(TermRepoToken repoToken) private view {
        (, , address termRepoServicer,) = repoToken.config();
        ITermRepoServicer servicer = ITermRepoServicer(termRepoServicer);
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = servicer.termController();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(repoToken)) && !termController.isFactoryDeployed(address(repoToken))) {
            revert InvalidRepoId();
        }

        uint256 maturityTimestamp = servicer.maturityTimestamp();
        if (block.timestamp > maturityTimestamp ) {
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

    function _validateSwapOrderNotCancelled(address maker, address makerToken, address takerToken, uint256 salt) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        uint256 minSalt = s.swapOrderMakerTokenPairMinSalt[maker][makerToken][takerToken];
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

    function _calculateRepoTokenAmount(
        uint256 redemptionTimestamp,
        uint256 redemptionValue,
        uint256 fillAmount,
        uint256 discountRate
    ) private view returns(uint256) {

        Exp memory repurchaseFactor = _calculateRepurchaseFactor(redemptionTimestamp, discountRate);

        uint256 repoTokenAmount = truncate(
                div_(
                    mul_(
                        Exp({mantissa: fillAmount * expScale}),
                        repurchaseFactor
                    ),
                    Exp({mantissa: redemptionValue})
                )
        );
        return repoTokenAmount;
    }

    function _calculateRepurchaseFactor(
        uint256 redemptionTimestamp,
        uint256 discountRate
    ) private view returns (Exp memory) {
        uint256 dayCountFractionMantissa =
            ((redemptionTimestamp - block.timestamp) * expScale) /
            YEAR_SECONDS;

        return add_(
            Exp({mantissa: expScale}),
            mul_(
                Exp({mantissa: dayCountFractionMantissa}),
                Exp({mantissa: discountRate})
            )
        );
    }

    function _calculateFillAmountFromBorrowAmount(
        uint256 desiredSwapOutputAmount,
        uint256 swapFee,
        uint256 redemptionTimestamp,
        uint256 redemptionValue,
        uint256 discountRate,
        bool isPurchaseTokenFill
    ) internal view returns (uint256) {
        if (swapFee >= expScale) {
            revert InvalidFee();
        }
        // Early return for zero: the +1 conservative rounding applied in the branches below would
        // otherwise return 1 for a zero-output request, bypassing the InvalidFillAmount() guard in
        // _swapRepoTokenInternal and silently executing a 1-wei dust fill of the order.
        if (desiredSwapOutputAmount == 0) return 0;
        if (swapFee == 0 && isPurchaseTokenFill) {
            return desiredSwapOutputAmount;
        } else if (isPurchaseTokenFill) {
            // +1 for conservative rounding: div_ truncates (floor), so the gross fill may be 1 wei
            // short of exactly covering desiredSwapOutputAmount after the maker deducts swapFee.
            // Adding 1 ensures ceil(desiredSwapOutputAmount / (1 - swapFee)), guaranteeing the
            // taker receives at least desiredSwapOutputAmount purchase tokens.
            return
                div_(
                    Exp({mantissa: desiredSwapOutputAmount}),
                    sub_(
                            Exp({mantissa: expScale}),
                            Exp({mantissa: swapFee})
                        )
                ).mantissa + 1;
        } else {
            Exp memory repurchaseFactor = _calculateRepurchaseFactor(redemptionTimestamp, discountRate);

            Exp memory purchaseTokenAmount =
                    div_(
                        mul_(
                            Exp({mantissa: desiredSwapOutputAmount * expScale}),
                            Exp({mantissa: redemptionValue})
                        ),
                        repurchaseFactor
                    );

             // +1 for conservative rounding: both the repo-to-purchase conversion (div_ above) and the
             // fee grossing (div_ below) truncate independently. Keeping purchaseTokenAmount as an
             // intermediate Exp avoids a second truncation boundary, but the final truncate() still
             // floors by up to 1 wei. Adding 1 ensures the gross fill converts back to at least
             // desiredSwapOutputAmount repo tokens after the maker applies redemptionValue/repurchaseFactor.
             if (swapFee == 0) {
                 return truncate(purchaseTokenAmount) + 1;
             } else {
                return
                    truncate(
                        div_(
                            purchaseTokenAmount,
                            sub_(
                                    Exp({mantissa: expScale}),
                                    Exp({mantissa: swapFee})
                                )
                        )
                    ) + 1;
             }
        }
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
        s.swapOrderContextMapping[orderHash] = orderContext;
    }

    function _cancelOrder(
        bytes32 orderHash,
        address maker,
        address caller,
        Signature memory signature
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.swapOrderContextMapping[orderHash];

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

        s.swapOrderContextMapping[orderHash].status = ITermIntent.OrderStatus.CANCELLED;
        s.emitter.emitIntentCancelled(orderHash);
    }

    // ------------------------------------------------------------------------
    // Settlement Processing
    // ------------------------------------------------------------------------

    /// @notice Internal function for swapping repo tokens
    function _swapRepoTokenInternal(
        RepoTokenSwapOrder memory order,
        address taker,
        uint256 fillAmount,
        Signature memory signature,
        bool isRoutedTakerToken,
        bool usePermit2
    ) private {
        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }

        if (order.maker == taker) {
            revert MakerCannotBeTaker();
        }

        _validateSwapOrderParams(order);
        
        bytes32 orderHash = _getSwapOrderHash(order);
        _validateOrderSignature(orderHash, order.maker, signature);

        TermStorage storage s = LibTermStorage.termStorage();
        OrderContext memory orderContext = s.swapOrderContextMapping[orderHash];
        _validateOrderStatus(orderContext);

        TermRepoToken repoToken = TermRepoToken(order.repoToken);
        (uint256 redemptionTimestamp, address purchaseToken,,) = repoToken.config();
        uint256 redemptionValue = repoToken.redemptionValue();
        
        if (order.makerAssetIsPurchaseToken) {
            _validateSwapOrderNotCancelled(order.maker, purchaseToken, order.repoToken, order.salt);
        } else {
            _validateSwapOrderNotCancelled(order.maker, order.repoToken, purchaseToken, order.salt);
        }

        _validateOrderAuthorization(order.taker, taker);
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

        uint256 repoTokenFillAmount  = _calculateRepoTokenAmount(redemptionTimestamp, redemptionValue, fillAmount, order.discountRate);

        _updateOrderStatus(
            order.purchaseTokenAmount - orderContext.filledAmount,
            validatedFillAmount,
            orderHash,
            orderContext
        );

        bool isRoutedPurchaseToken;
        bool isRoutedRepoToken;
        address makerToken;

        if (order.makerAssetIsPurchaseToken) {
            makerToken = purchaseToken;
            isRoutedRepoToken = isRoutedTakerToken;
        } else {
            makerToken = order.repoToken;
            isRoutedPurchaseToken = isRoutedTakerToken;
        }

        _settleSwap(
            orderHash,
            order,
            isRoutedPurchaseToken,
            isRoutedRepoToken,
            retrieveFundsRequested,
            purchaseToken,
            address(repoToken),
            taker,
            validatedFillAmount,
            repoTokenFillAmount,
            usePermit2
        );
    }

    // ------------------------------------------------------------------------
    // Token and Fee Handling
    // ------------------------------------------------------------------------

    function _settleSwap(
        bytes32 orderHash,
        RepoTokenSwapOrder memory order,
        bool isRoutedPurchaseToken,
        bool isRoutedRepoToken,
        bool retrieveFundsRequested,
        address purchaseToken,
        address repoToken,
        address taker,
        uint256 purchaseTokenAmount,
        uint256 repoTokenAmount,
        bool usePermit2
    ) private {
        if (retrieveFundsRequested) {
            address retrieveFundsToken = order.makerAssetIsPurchaseToken ? purchaseToken : repoToken;
            uint256 retrieveFundsAmount = order.makerAssetIsPurchaseToken ? purchaseTokenAmount : repoTokenAmount;
            // generate retrieveFundsCalldata
            bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
                order.retrieveFunds,
                retrieveFundsAmount,
                retrieveFundsToken,
                order.maker
            );

            // Set settlement context before executing retrieveFunds
            TermStorage storage ts = LibTermStorage.termStorage();
            ts.activeSettlementMaker = order.maker;

            uint256 tokenBalanceBeforeRetrieveFunds = IERC20(retrieveFundsToken).balanceOf(address(this));
            // execute retrieveFundsCalldata
            Address.functionCall(
                address(this),
                retrieveFundsCalldata
            );
            uint256 tokenBalanceAfterRetrieveFunds = IERC20(retrieveFundsToken).balanceOf(address(this));

            if (tokenBalanceAfterRetrieveFunds < tokenBalanceBeforeRetrieveFunds + retrieveFundsAmount) {
                revert InsufficientFundsRetrieved();
            }

            // Clear settlement context after execution
            ts.activeSettlementMaker = address(0);

            if (order.makerAssetIsPurchaseToken) {
                isRoutedPurchaseToken = true;
            } else {
                isRoutedRepoToken = true;
            }
        }

        Exp memory purchaseTokenAmountExp = Exp({mantissa: purchaseTokenAmount });
        Exp memory repoTokenAmountExp = Exp({mantissa: repoTokenAmount });

        uint256 repoTokenFee = mul_ScalarTruncate(
            repoTokenAmountExp,
            order.makerAssetIsPurchaseToken ? order.takerFee : order.makerFee
        );
        uint256 purchaseTokenFee = mul_ScalarTruncate(
            purchaseTokenAmountExp,
            order.makerAssetIsPurchaseToken ? order.makerFee : order.takerFee
        );

        _executeTokenTransfer(
            repoToken,
            isRoutedRepoToken,
            order.makerAssetIsPurchaseToken ? taker : order.maker,
            order.makerAssetIsPurchaseToken ? order.maker : taker,
            order.feeRecipient,
            repoTokenAmount,
            repoTokenFee,
            order.makerAssetIsPurchaseToken ? usePermit2 : false
        );

        _executeTokenTransfer(
            purchaseToken,
            isRoutedPurchaseToken,
            order.makerAssetIsPurchaseToken ? order.maker : taker,
            order.makerAssetIsPurchaseToken ? taker : order.maker,
            order.feeRecipient,
            purchaseTokenAmount,
            purchaseTokenFee,
            order.makerAssetIsPurchaseToken ? false : usePermit2
        );

        _emitSwapEvent(
            orderHash,
            order,
            repoToken,
            taker,
            purchaseToken,
            order.makerAssetIsPurchaseToken ? purchaseTokenAmount : repoTokenAmount,
            order.makerAssetIsPurchaseToken ? repoTokenAmount : purchaseTokenAmount,
            order.makerAssetIsPurchaseToken ? purchaseTokenFee : repoTokenFee,
            order.makerAssetIsPurchaseToken ? repoTokenFee : purchaseTokenFee,
            order.feeRecipient
        );
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

    function _emitSwapEvent(
        bytes32 orderHash,
        RepoTokenSwapOrder memory order,
        address repoToken,
        address taker,
        address purchaseToken,
        uint256 makerAssetAmount,
        uint256 takerAssetAmount,
        uint256 makerFee,
        uint256 takerFee,
        address feeRecipient
    ) private {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermIntentEvents.RepoTokenSwapData memory swapData = ITermIntentEvents.RepoTokenSwapData({
            repoToken: repoToken,
            purchaseToken: purchaseToken,
            maker: order.maker,
            taker: taker,
            makerToken: order.makerAssetIsPurchaseToken ? purchaseToken : repoToken,
            takerToken: order.makerAssetIsPurchaseToken ? repoToken : purchaseToken,
            discountRate: order.discountRate,
            makerTokenAmountFilled: makerAssetAmount,
            takerTokenAmountFilled: takerAssetAmount,
            makerFee: makerFee,
            takerFee: takerFee,
            feeRecipient: feeRecipient,
            originalOrderAmount: order.purchaseTokenAmount,
            expiry: order.expiry,
            salt: order.salt

        });
        s.emitter.emitRepoTokenSwapFilled(orderHash, swapData);
    }
}
