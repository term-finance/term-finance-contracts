//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ExponentialNoError} from "../lib/ExponentialNoError.sol";
import {ITermAuctionBidLocker} from "../interfaces/ITermAuctionBidLocker.sol";
import {ITermAuctionOfferLocker} from "../interfaces/ITermAuctionOfferLocker.sol";
import {ITermController} from "../interfaces/ITermController.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {ITermRepoLocker} from "../interfaces/ITermRepoLocker.sol";
import {ITermRepoRolloverManager} from "../interfaces/ITermRepoRolloverManager.sol";
import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {TermAuctionBid} from "../lib/TermAuctionBid.sol";
import {TermAuctionBidSubmission} from "../lib/TermAuctionBidSubmission.sol";
import {TermAuctionOffer} from "../lib/TermAuctionOffer.sol";
import {TermAuctionOfferSubmission} from "../lib/TermAuctionOfferSubmission.sol";
import {TermRepoRolloverElectionSubmission} from "../lib/TermRepoRolloverElectionSubmission.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

error InputOutputTokenCollision();

/// @author TermLabs  
/// @title Term Router Facet
/// @notice This facet provides centralized access to all DIAMOND_ROLE functions across Term contracts
/// @dev This facet aggregates settlement operations from TermRepoServicer, TermRepoCollateralManager, and TermRepoRolloverManager
contract TermRouterFacet is ReentrancyGuard, TermFlashHookFacet, TermMultiContextAuth, ExponentialNoError {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    
    // ========================================================================
    // = Custom Errors  =======================================================
    // ========================================================================

    error AfterMaturity();
    error CollateralTransferFailed();
    error InsufficientCollateralAmount(uint256 requested, uint256 available);
    error InvalidCollateralToken();
    error InvalidRepoId();
    error InvalidTermController();
    error PurchaseTokenMismatch();

    // ========================================================================
    // = Deploy ===============================================================
    // ========================================================================
    
    constructor() {
        previewMapping[this.submitRepurchasePaymentHook.selector] = this.previewSubmitRepurchasePayment.selector;
    }

    // ========================================================================
    // = TermAuctionBidLocker Functions  ======================================
    // ========================================================================

    /// @notice Locks bid submissions with collateral transfer and approval
    /// @dev Transfers collateral tokens from bidder and approves TermRepoLocker before locking bids
    /// @param termAuctionBidLocker Address of the TermAuctionBidLocker contract
    /// @param bidSubmissions Array of bid submissions to lock. The collateralTokens array in each
    ///        TermAuctionBidSubmission must be the same length and in the same order across all submissions
    /// @param usePermit2 Whether to use Permit2 for token transfers instead of standard ERC20 transfers
    function lockBids(
        address termAuctionBidLocker,
        TermAuctionBidSubmission[] calldata bidSubmissions,
        bool usePermit2
    ) external nonReentrant {
        ITermAuctionBidLocker _termAuctionBidLocker = ITermAuctionBidLocker(termAuctionBidLocker);
        _validateAuctionBidLocker(_termAuctionBidLocker);


        ITermRepoLocker termRepoLocker = _termAuctionBidLocker.termRepoServicer().termRepoLocker();
        TermAuctionBid memory existingBid;
        uint256 collateralRequired;

        // Track cumulative amounts for each collateral token position
        uint256 numCollateralTokens = bidSubmissions.length > 0 ? bidSubmissions[0].collateralTokens.length : 0;
        uint256[] memory totalAmounts = new uint256[](numCollateralTokens);

        if (usePermit2) {
            uint8 i;
            uint8 j;
            for (i = 0; i < bidSubmissions.length; ++i) {
                existingBid = _termAuctionBidLocker.lockedBid(bidSubmissions[i].id);
                bool bidExists = existingBid.amount != 0;
                for (j = 0; j < bidSubmissions[i].collateralTokens.length; ++j) {
                    if (bidExists) {
                        if (existingBid.collateralAmounts[j] == 0 && bidSubmissions[i].collateralAmounts[j] == 0) {
                            continue;
                        }
                        collateralRequired = bidSubmissions[i].collateralAmounts[j] > existingBid.collateralAmounts[j]
                            ? bidSubmissions[i].collateralAmounts[j] - existingBid.collateralAmounts[j]
                            : 0;
                    } else {
                        collateralRequired = bidSubmissions[i].collateralAmounts[j];
                    }
                    if (collateralRequired == 0) {
                        continue;
                    }
                    Permit2Lib.PERMIT2.transferFrom(
                        msg.sender,
                        address(this),
                        collateralRequired.toUint160(),
                        bidSubmissions[i].collateralTokens[j]
                    );
                    // Accumulate the total for this collateral token position
                    totalAmounts[j] += collateralRequired;
                }
            }
        } else {
            uint8 i;
            uint8 j;
            for (i = 0; i < bidSubmissions.length; ++i) {
                existingBid = _termAuctionBidLocker.lockedBid(bidSubmissions[i].id);
                bool bidExists = existingBid.amount != 0;
                for (j = 0; j < bidSubmissions[i].collateralTokens.length; ++j) {
                    if (bidExists) {
                        if (existingBid.collateralAmounts[j] == 0 && bidSubmissions[i].collateralAmounts[j] == 0) {
                            continue;
                        }
                        collateralRequired = bidSubmissions[i].collateralAmounts[j] > existingBid.collateralAmounts[j]
                            ? bidSubmissions[i].collateralAmounts[j] - existingBid.collateralAmounts[j]
                            : 0;
                    } else {
                        collateralRequired = bidSubmissions[i].collateralAmounts[j];
                    }
                    if (collateralRequired == 0) {
                        continue;
                    }
                    IERC20(bidSubmissions[i].collateralTokens[j]).safeTransferFrom(
                        msg.sender,
                        address(this),
                        collateralRequired
                    );
                    // Accumulate the total for this collateral token position
                    totalAmounts[j] += collateralRequired;
                }
            }
        }

        uint8 j;

        // Approve the total amount for each collateral token
        if (bidSubmissions.length > 0) {
            for (j = 0; j < numCollateralTokens; ++j) {
                if (totalAmounts[j] > 0) {
                    IERC20(bidSubmissions[0].collateralTokens[j]).forceApprove(address(termRepoLocker), totalAmounts[j]);
                }
            }
        }

        _termAuctionBidLocker.lockBidsWithReferral(msg.sender, bidSubmissions, address(0));

        // Revoke the approval for each collateral token after locking bids
        if (bidSubmissions.length > 0) {
            for (j = 0; j < numCollateralTokens; ++j) {
                if (totalAmounts[j] > 0) {
                    IERC20(bidSubmissions[0].collateralTokens[j]).forceApprove(address(termRepoLocker), 0);
                }
            }
        }

        
    }
      /// @notice Locks bid submissions with collateral transfer and approval
    /// @dev Transfers collateral tokens from bidder and approves TermRepoLocker before locking bids
    /// @param termAuctionBidLocker Address of the TermAuctionBidLocker contract
    /// @param bidSubmissions Array of bid submissions to lock
    /// @param referralAddress A user address that referred the submitter of this bid
    /// @param usePermit2 Whether to use Permit2 for token transfers instead of standard ERC20 transfers
    function lockBidsWithReferral(
        address termAuctionBidLocker,
        TermAuctionBidSubmission[] calldata bidSubmissions,
        address referralAddress,
        bool usePermit2
    ) external nonReentrant {
        ITermAuctionBidLocker _termAuctionBidLocker = ITermAuctionBidLocker(termAuctionBidLocker);
        _validateAuctionBidLocker(_termAuctionBidLocker);


        ITermRepoLocker termRepoLocker = _termAuctionBidLocker.termRepoServicer().termRepoLocker();
        TermAuctionBid memory existingBid;
        uint256 collateralRequired;

        // Track cumulative amounts for each collateral token position
        uint256 numCollateralTokens = bidSubmissions.length > 0 ? bidSubmissions[0].collateralTokens.length : 0;
        uint256[] memory totalAmounts = new uint256[](numCollateralTokens);

        if (usePermit2) {
            uint8 i;
            uint8 j;
            for (i = 0; i < bidSubmissions.length; ++i) {
                existingBid = _termAuctionBidLocker.lockedBid(bidSubmissions[i].id);
                bool bidExists = existingBid.amount != 0;
                for (j = 0; j < bidSubmissions[i].collateralTokens.length; ++j) {
                    if (bidExists) {
                        if (existingBid.collateralAmounts[j] == 0 && bidSubmissions[i].collateralAmounts[j] == 0) {
                            continue;
                        }
                        collateralRequired = bidSubmissions[i].collateralAmounts[j] > existingBid.collateralAmounts[j]
                            ? bidSubmissions[i].collateralAmounts[j] - existingBid.collateralAmounts[j]
                            : 0;
                    } else {
                        collateralRequired = bidSubmissions[i].collateralAmounts[j];
                    }
                    if (collateralRequired == 0) {
                        continue;
                    }
                    Permit2Lib.PERMIT2.transferFrom(
                        msg.sender,
                        address(this),
                        collateralRequired.toUint160(),
                        bidSubmissions[i].collateralTokens[j]
                    );
                    // Accumulate the total for this collateral token position
                    totalAmounts[j] += collateralRequired;
                }
            }
        } else {
            uint8 i;
            uint8 j;
            for (i = 0; i < bidSubmissions.length; ++i) {
                existingBid = _termAuctionBidLocker.lockedBid(bidSubmissions[i].id);
                bool bidExists = existingBid.amount != 0;
                for (j = 0; j < bidSubmissions[i].collateralTokens.length; ++j) {
                    if (bidExists) {
                        if (existingBid.collateralAmounts[j] == 0 && bidSubmissions[i].collateralAmounts[j] == 0) {
                            continue;
                        }
                        collateralRequired = bidSubmissions[i].collateralAmounts[j] > existingBid.collateralAmounts[j]
                            ? bidSubmissions[i].collateralAmounts[j] - existingBid.collateralAmounts[j]
                            : 0;
                    } else {
                        collateralRequired = bidSubmissions[i].collateralAmounts[j];
                    }
                    if (collateralRequired == 0) {
                        continue;
                    }
                    IERC20(bidSubmissions[i].collateralTokens[j]).safeTransferFrom(
                        msg.sender,
                        address(this),
                        collateralRequired
                    );
                    // Accumulate the total for this collateral token position
                    totalAmounts[j] += collateralRequired;
                }
            }
        }

        uint8 j;

        // Approve the total amount for each collateral token
        if (bidSubmissions.length > 0) {
            for (j = 0; j < numCollateralTokens; ++j) {
                if (totalAmounts[j] > 0) {
                    IERC20(bidSubmissions[0].collateralTokens[j]).forceApprove(address(termRepoLocker), totalAmounts[j]);
                }
            }
        }

        _termAuctionBidLocker.lockBidsWithReferral(msg.sender, bidSubmissions, referralAddress);

        // Revoke the approval for each collateral token after locking bids
        if (bidSubmissions.length > 0) {
            for (j = 0; j < numCollateralTokens; ++j) {
                if (totalAmounts[j] > 0) {
                    IERC20(bidSubmissions[0].collateralTokens[j]).forceApprove(address(termRepoLocker), 0);
                }
            }
        }
    }

    /// @notice Unlocks specified bid submissions
    /// @dev Delegates to the TermAuctionBidLocker to unlock bids for the caller
    /// @param termAuctionBidLocker Address of the TermAuctionBidLocker contract
    /// @param bidIds Array of bid IDs to unlock
    function unlockBids(
        address termAuctionBidLocker,
        bytes32[] calldata bidIds
    ) external nonReentrant {
        ITermAuctionBidLocker _termAuctionBidLocker = ITermAuctionBidLocker(termAuctionBidLocker);
        _validateAuctionBidLocker(_termAuctionBidLocker);
        _termAuctionBidLocker.unlockBids(msg.sender, bidIds);
    }

    // ========================================================================
    // = TermAuctionOfferLocker Functions  ====================================
    // ========================================================================

    /// @notice Locks offer submissions with purchase token transfer and approval
    /// @dev Transfers purchase tokens from offerer and approves TermRepoLocker before locking offers
    /// @param termAuctionOfferLocker Address of the TermAuctionOfferLocker contract
    /// @param offerSubmissions Array of offer submissions to lock
    /// @param usePermit2 Whether to use Permit2 for token transfers instead of standard ERC20 transfers
    function lockOffers(
        address termAuctionOfferLocker,
        TermAuctionOfferSubmission[] calldata offerSubmissions,
        bool usePermit2
    ) external nonReentrant {
        ITermAuctionOfferLocker _termAuctionOfferLocker = ITermAuctionOfferLocker(termAuctionOfferLocker);
        _validateAuctionOfferLocker(_termAuctionOfferLocker);

        ITermRepoLocker termRepoLocker = _termAuctionOfferLocker.termRepoServicer().termRepoLocker();
        TermAuctionOffer memory existingOffer;
        uint256 requiredPurchaseTokens;
        uint256 totalPurchaseTokensRequired = 0;
        address purchaseToken = offerSubmissions.length > 0 ? offerSubmissions[0].purchaseToken : address(0);

        if (usePermit2) {
            for (uint8 i = 0; i < offerSubmissions.length; ++i) {
                existingOffer = _termAuctionOfferLocker.lockedOffer(offerSubmissions[i].id);
                if (existingOffer.amount == 0 && offerSubmissions[i].amount == 0) {
                    continue;
                }
                requiredPurchaseTokens = offerSubmissions[i].amount > existingOffer.amount
                    ? offerSubmissions[i].amount - existingOffer.amount
                    : 0;
                if (requiredPurchaseTokens > 0) {
                    Permit2Lib.PERMIT2.transferFrom(
                        msg.sender,
                        address(this),
                        requiredPurchaseTokens.toUint160(),
                        offerSubmissions[i].purchaseToken
                    );
                    // Accumulate the total purchase tokens required
                    totalPurchaseTokensRequired += requiredPurchaseTokens;
                }
            }
        } else {
            for (uint8 i = 0; i < offerSubmissions.length; ++i) {
                existingOffer = _termAuctionOfferLocker.lockedOffer(offerSubmissions[i].id);

                if (existingOffer.amount == 0 && offerSubmissions[i].amount == 0) {
                    continue;
                }
                requiredPurchaseTokens = offerSubmissions[i].amount > existingOffer.amount
                    ? offerSubmissions[i].amount - existingOffer.amount
                    : 0;
                if (requiredPurchaseTokens > 0) {
                    IERC20(offerSubmissions[i].purchaseToken).safeTransferFrom(
                        msg.sender,
                        address(this),
                        requiredPurchaseTokens
                    );
                    // Accumulate the total purchase tokens required
                    totalPurchaseTokensRequired += requiredPurchaseTokens;
                }
            }
        }

        // Approve the total amount of purchase tokens
        if (totalPurchaseTokensRequired > 0 && purchaseToken != address(0)) {
            IERC20(purchaseToken).forceApprove(address(termRepoLocker), totalPurchaseTokensRequired);
        }

        _termAuctionOfferLocker.lockOffersWithReferral(msg.sender, offerSubmissions, address(0));

        // Revoke the purchase token approval after locking offers
        if (totalPurchaseTokensRequired > 0 && purchaseToken != address(0)) {
            IERC20(purchaseToken).forceApprove(address(termRepoLocker), 0);
        }
    }

      /// @notice Locks offer submissions with purchase token transfer and approval
    /// @dev Transfers purchase tokens from offerer and approves TermRepoLocker before locking offers
    /// @param termAuctionOfferLocker Address of the TermAuctionOfferLocker contract
    /// @param offerSubmissions Array of offer submissions to lock
    /// @param referralAddress A user address that referred the submitter of this offer
    /// @param usePermit2 Whether to use Permit2 for token transfers instead of standard ERC20 transfers
    function lockOffersWithReferral(
        address termAuctionOfferLocker,
        TermAuctionOfferSubmission[] calldata offerSubmissions,
        address referralAddress,
        bool usePermit2
    ) external nonReentrant {
        ITermAuctionOfferLocker _termAuctionOfferLocker = ITermAuctionOfferLocker(termAuctionOfferLocker);
        _validateAuctionOfferLocker(_termAuctionOfferLocker);

        ITermRepoLocker termRepoLocker = _termAuctionOfferLocker.termRepoServicer().termRepoLocker();
        TermAuctionOffer memory existingOffer;
        uint256 requiredPurchaseTokens;
        uint256 totalPurchaseTokensRequired = 0;
        address purchaseToken = offerSubmissions.length > 0 ? offerSubmissions[0].purchaseToken : address(0);

        if (usePermit2) {
            for (uint8 i = 0; i < offerSubmissions.length; ++i) {
                existingOffer = _termAuctionOfferLocker.lockedOffer(offerSubmissions[i].id);
                if (existingOffer.amount == 0 && offerSubmissions[i].amount == 0) {
                    continue;
                }
                requiredPurchaseTokens = offerSubmissions[i].amount > existingOffer.amount
                    ? offerSubmissions[i].amount - existingOffer.amount
                    : 0;
                if (requiredPurchaseTokens > 0) {
                    Permit2Lib.PERMIT2.transferFrom(
                        msg.sender,
                        address(this),
                        requiredPurchaseTokens.toUint160(),
                        offerSubmissions[i].purchaseToken
                    );
                    // Accumulate the total purchase tokens required
                    totalPurchaseTokensRequired += requiredPurchaseTokens;
                }
            }
        } else {
            for (uint8 i = 0; i < offerSubmissions.length; ++i) {
                existingOffer = _termAuctionOfferLocker.lockedOffer(offerSubmissions[i].id);

                if (existingOffer.amount == 0 && offerSubmissions[i].amount == 0) {
                    continue;
                }
                requiredPurchaseTokens = offerSubmissions[i].amount > existingOffer.amount
                    ? offerSubmissions[i].amount - existingOffer.amount
                    : 0;
                if (requiredPurchaseTokens > 0) {
                    IERC20(offerSubmissions[i].purchaseToken).safeTransferFrom(
                        msg.sender,
                        address(this),
                        requiredPurchaseTokens
                    );
                    // Accumulate the total purchase tokens required
                    totalPurchaseTokensRequired += requiredPurchaseTokens;
                }
            }
        }

        // Approve the total amount of purchase tokens
        if (totalPurchaseTokensRequired > 0 && purchaseToken != address(0)) {
            IERC20(purchaseToken).forceApprove(address(termRepoLocker), totalPurchaseTokensRequired);
        }

        _termAuctionOfferLocker.lockOffersWithReferral(msg.sender, offerSubmissions, referralAddress);

        // Revoke the purchase token approval after locking offers
        if (totalPurchaseTokensRequired > 0 && purchaseToken != address(0)) {
            IERC20(purchaseToken).forceApprove(address(termRepoLocker), 0);
        }
    }

    /// @notice Unlocks specified offer submissions
    /// @dev Delegates to the TermAuctionOfferLocker to unlock offers for the caller
    /// @param termAuctionOfferLocker Address of the TermAuctionOfferLocker contract
    /// @param offerIds Array of offer IDs to unlock
    function unlockOffers(
        address termAuctionOfferLocker,
        bytes32[] calldata offerIds
    ) external nonReentrant {
        ITermAuctionOfferLocker _termAuctionOfferLocker = ITermAuctionOfferLocker(termAuctionOfferLocker);
        _validateAuctionOfferLocker(_termAuctionOfferLocker);
        _termAuctionOfferLocker.unlockOffers(msg.sender, offerIds);
    }

    // ========================================================================
    // = TermRepoServicer Functions  ==========================================
    // ========================================================================

    /// @notice Submit repurchase payment on behalf of a borrower
    /// @param termRepoServicer The address of the TermRepoServicer contract
    /// @param amount The amount of purchase token to submit for repurchase
    /// @param usePermit2 Whether to use Permit2 for token transfer
    function submitRepurchasePayment(
        address termRepoServicer,
        uint256 amount,
        bool usePermit2
    ) external nonReentrant {
        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        _validateRepoServicer(_termRepoServicer);

        ITermRepoLocker termRepoLocker = _termRepoServicer.termRepoLocker();

        //@dev Transfer purchase tokens from msg.sender to this contract
        IERC20 purchaseToken = IERC20(_termRepoServicer.purchaseToken());
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                msg.sender,
                address(this),
                amount.toUint160(),
                address(purchaseToken)
            );
        } else {
            IERC20(purchaseToken).safeTransferFrom(msg.sender, address(this), amount);
        }
        IERC20(purchaseToken).forceApprove(address(termRepoLocker), amount);

        _termRepoServicer.submitRepurchasePayment(msg.sender, amount);

        IERC20(purchaseToken).forceApprove(address(termRepoLocker), 0);
    }

    /// @notice Burn and collapse exposure on behalf of a borrower
    /// @param termRepoServicer The address of the TermRepoServicer contract
    /// @param amountToBurn The amount of TermRepoTokens to burn
    function burnCollapseExposure(
        address termRepoServicer,
        uint256 amountToBurn
    ) external nonReentrant {
        _validateRepoServicer(ITermRepoServicer(termRepoServicer));
        ITermRepoServicer(termRepoServicer).burnCollapseExposure(msg.sender, amountToBurn);
    }

    /// @notice Mint open exposure for settlement
    /// @param termRepoServicer The address of the TermRepoServicer contract
    /// @param repoTokenAmount The amount of repoTokens tokens
    /// @param collateralAmounts Array of collateral amounts
    /// @param usePermit2 Whether to use Permit2 for token transfer
    function mintOpenExposure(
        address termRepoServicer,
        uint256 repoTokenAmount,
        uint256[] calldata collateralAmounts,
        bool usePermit2
    ) external nonReentrant {
        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        _validateRepoServicer(_termRepoServicer);

        ITermRepoLocker termRepoLocker = _termRepoServicer.termRepoLocker();

        // @dev Transfer collateral tokens from msg.sender to this contract
        ITermRepoCollateralManager termRepoCollateralManager = ITermRepoCollateralManager(
            _termRepoServicer.termRepoCollateralManager()
        );
        address collateralToken;
        uint256 amount;
        for (uint256 index = 0; index < collateralAmounts.length; ++index){
            collateralToken = termRepoCollateralManager.collateralTokens(index);
            amount = collateralAmounts[index];

            if (usePermit2) {
                Permit2Lib.PERMIT2.transferFrom(
                    msg.sender,
                    address(this),
                    amount.toUint160(),
                    collateralToken
                );
            } else {
                IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
            }
            
            IERC20(collateralToken).forceApprove(address(termRepoLocker), amount);
        }
      
        _termRepoServicer.mintOpenExposure(
            msg.sender, 
            repoTokenAmount, 
            collateralAmounts
        );

        // Revoke approvals after minting
        for (uint256 index = 0; index < collateralAmounts.length; ++index){
            collateralToken = termRepoCollateralManager.collateralTokens(index);
            IERC20(collateralToken).forceApprove(address(termRepoLocker), 0);
        }

        Exp memory proRate = div_(
            // solhint-disable-next-line not-rely-on-time
            Exp({mantissa: (_termRepoServicer.redemptionTimestamp() - block.timestamp)}),
            Exp({mantissa: (360 days)})
        );

        Exp memory protocolShareProRated = mul_(
            Exp({mantissa: _termRepoServicer.servicingFee()}),
            proRate
        );

        uint256 protocolMintTokens = mul_ScalarTruncate(
            protocolShareProRated,
            repoTokenAmount
        );
        uint256 minterTokens = repoTokenAmount - protocolMintTokens;
        
        IERC20(address(_termRepoServicer.termRepoToken())).safeTransfer(msg.sender, minterTokens);
    }

    // @notice Redeem Term Repo Tokens on behalf of a redeemer
    /// @param termRepoServicer The address of the TermRepoServicer contract
    /// @param redeemer The address of the redeemer
    /// @param amountToRedeem The amount of TermRepoTokens to redeem
    function redeemTermRepoTokens(
        address termRepoServicer,
        address redeemer,
        uint256 amountToRedeem
    ) external nonReentrant {
        _validateRepoServicer(ITermRepoServicer(termRepoServicer));
        ITermRepoServicer(termRepoServicer).redeemTermRepoTokens(redeemer, amountToRedeem);
    }

    // ========================================================================
    // = TermRepoCollateralManager Functions  ================================
    // ========================================================================

    /// @notice Lock collateral on behalf of a borrower
    /// @param termRepoCollateralManager The address of the TermRepoCollateralManager contract
    /// @param collateralToken The address of the collateral token to lock
    /// @param amount The amount of collateral token to lock
    function externalLockCollateral(
        address termRepoCollateralManager,
        address collateralToken,
        uint256 amount,
        bool usePermit2
    ) external nonReentrant {
        ITermRepoCollateralManager collateralManager = ITermRepoCollateralManager(termRepoCollateralManager);
        _validateCollateralManager(collateralManager);
        ITermRepoLocker termRepoLocker = collateralManager.termRepoLocker();

        
        // @dev Transfer collateral tokens from msg.sender to this contract
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                msg.sender,
                address(this),
                amount.toUint160(),
                collateralToken
            );
        } else {
            IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        }
        IERC20(collateralToken).forceApprove(address(termRepoLocker), amount);
        
        ITermRepoCollateralManager(termRepoCollateralManager).externalLockCollateral(msg.sender, collateralToken, amount);

        IERC20(collateralToken).forceApprove(address(termRepoLocker), 0);
    }

    /// @notice Unlock collateral on behalf of a borrower
    /// @param termRepoCollateralManager The address of the TermRepoCollateralManager contract
    /// @param collateralToken The address of the collateral token to unlock
    /// @param amount The amount of collateral token to unlock
    function externalUnlockCollateral(
        address termRepoCollateralManager,
        address collateralToken,
        uint256 amount
    ) external nonReentrant {
        _validateCollateralManager(ITermRepoCollateralManager(termRepoCollateralManager));
        ITermRepoCollateralManager(termRepoCollateralManager).externalUnlockCollateral(msg.sender, collateralToken, amount);
    }

    // ========================================================================
    // = TermRepoRolloverManager Functions  ==================================
    // ========================================================================

    /// @notice Elect rollover on behalf of a borrower
    /// @param termRepoRolloverManager The address of the TermRepoRolloverManager contract
    /// @param termRepoRolloverElectionSubmission A struct containing borrower rollover instructions
    function electRollover(
        address termRepoRolloverManager,
        TermRepoRolloverElectionSubmission calldata termRepoRolloverElectionSubmission
    ) external nonReentrant {
        _validateRolloverManager(ITermRepoRolloverManager(termRepoRolloverManager));
        ITermRepoRolloverManager(termRepoRolloverManager).electRollover(msg.sender, termRepoRolloverElectionSubmission);
    }

    /// @notice Cancel rollover on behalf of a borrower
    /// @param termRepoRolloverManager The address of the TermRepoRolloverManager contract
    function cancelRollover(
        address termRepoRolloverManager
    ) external nonReentrant {
        _validateRolloverManager(ITermRepoRolloverManager(termRepoRolloverManager));
        ITermRepoRolloverManager(termRepoRolloverManager).cancelRollover(msg.sender);
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Flash hook that repays a Term repo loan and pulls the freed collateral
    ///         back to the router.
    /// @dev Validates the repo servicer, collateral amount, and purchase token match before
    ///      approving the repo locker and calling `submitRepurchasePayment`. After repayment,
    ///      the approval is reset to zero and collateral is transferred from the borrower
    ///      via Permit2 or `safeTransferFrom` depending on `additionalCalldata`.
    /// @dev `TermRepoServicer.submitRepurchasePayment` releases the borrower's collateral directly
    ///      to the borrower's wallet upon full repayment. Consequently, the pre-repayment check
    ///      (`_validateCollateralAmount`) verifies collateral exists in the collateral manager,
    ///      and the post-repayment pull (`safeTransferFrom` / Permit2) reads from the borrower's
    ///      wallet.
    /// @dev WARNING: This hook should only be used for full repayments where the borrower has no
    ///      unprocessed rollover elections. `TermRepoServicer.submitRepurchasePayment` enforces an
    ///      upper bound of `repurchaseExposureLedger - outstandingRolloverAmount`. If the borrower
    ///      has an active rollover election, the repayment amount from the preview will exceed this
    ///      bound and the transaction will revert.
    /// @param input The action hook input where:
    ///   - `user`: the borrower repaying the loan
    ///   - `inputToken`: the purchase token used for repayment
    ///   - `maxInputAmount`: the repayment amount
    ///   - `outputToken`: the collateral token to retrieve
    ///   - `minOutputAmount`: the collateral amount to pull from the borrower
    ///   - `targetAddress`: the `TermRepoServicer` contract address
    ///   - `additionalCalldata`: ABI-encoded `bool` indicating whether to use Permit2
    function submitRepurchasePaymentHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant {
        address borrower = input.user;
        address purchaseToken = input.inputToken;
        uint256 repaymentAmount = input.maxInputAmount;
        address collateralToken = input.outputToken;
        uint256 collateralAmount = input.minOutputAmount;
        bool usePermit2 = abi.decode(input.additionalCalldata, (bool));

        ITermRepoServicer repoServicer = ITermRepoServicer(input.targetAddress);
        _validateRepoServicer(repoServicer);
        _validateCollateralAmount(repoServicer, borrower, collateralToken, collateralAmount);
        if (repoServicer.purchaseToken() != purchaseToken) {
            revert PurchaseTokenMismatch();
        }

        ITermRepoLocker termRepoLocker = repoServicer.termRepoLocker();
        IERC20(purchaseToken).forceApprove(address(termRepoLocker), repaymentAmount);

        repoServicer.submitRepurchasePayment(borrower, repaymentAmount);
        ITermRepoCollateralManager collateralManager = repoServicer.termRepoCollateralManager();
        if (collateralManager.getCollateralBalance(borrower, collateralToken) > 0) {
            revert CollateralTransferFailed();
        }

        IERC20(purchaseToken).forceApprove(address(termRepoLocker), 0);

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                borrower,
                address(this),
                collateralAmount.toUint160(),
                address(collateralToken)
            );
        } else {
            IERC20(collateralToken).safeTransferFrom(borrower, address(this), collateralAmount);
        }
    }

    // ========================================================================
    // = View Functions  ======================================================
    // ========================================================================

    /// @notice Previews a repurchase payment by querying the borrower's full repurchase
    ///         obligation and the first collateral token from the repo servicer.
    /// @dev Validates the repo servicer, then looks up the purchase token, the borrower's
    ///      outstanding repurchase obligation, and the primary collateral token (index 0)
    ///      from the collateral manager. The output amount is passed through from the input.
    /// @dev WARNING: The returned `expectedInputAmount` reflects the borrower's full repurchase
    ///      obligation. If the borrower has an unprocessed rollover election,
    ///      `TermRepoServicer.submitRepurchasePayment` will enforce a lower maximum
    ///      (`repurchaseExposureLedger - outstandingRolloverAmount`), causing the transaction
    ///      to revert. Cancel any pending rollover elections before using this preview.
    /// @param actionHookInput The action hook input where:
    ///   - `user`: the borrower whose obligation is being previewed
    ///   - `targetAddress`: the `TermRepoServicer` contract address
    ///   - `minOutputAmount`: the expected collateral amount to receive
    /// @return A `PreviewAction` with the purchase token and full repurchase obligation as
    ///         input, the primary collateral token as output, and `isDeterministic` set to true.
    function previewSubmitRepurchasePayment(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {
        address termRepoServicer = actionHookInput.targetAddress;
        address borrower = actionHookInput.user;

        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        address purchaseToken = _termRepoServicer.purchaseToken();
        uint256 repurchaseObligation = _termRepoServicer.getBorrowerRepurchaseObligation(borrower);

        _validateCollateralToken(_termRepoServicer, actionHookInput.outputToken);
        address collateralToken = actionHookInput.outputToken;

        if (purchaseToken == collateralToken) {
            revert InputOutputTokenCollision();
        }
        
        return PreviewAction({
            expectedInputToken: purchaseToken,
            expectedInputAmount: repurchaseObligation,
            expectedOutputToken: collateralToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
    }
    
    // ========================================================================
    // = Internal Validation Functions  ======================================
    // ========================================================================

    function _validateAuctionBidLocker(ITermAuctionBidLocker auctionBidLocker) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = auctionBidLocker.termAuction().controller();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(auctionBidLocker)) && !termController.isFactoryDeployed(address(auctionBidLocker))) {
            revert InvalidRepoId();
        }
    }

    function _validateAuctionOfferLocker(ITermAuctionOfferLocker auctionOfferLocker) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = auctionOfferLocker.termAuction().controller();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(auctionOfferLocker)) && !termController.isFactoryDeployed(address(auctionOfferLocker))) {
            revert InvalidRepoId();
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
    }

    function _validateCollateralManager(ITermRepoCollateralManager collateralManager) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = collateralManager.termController();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(collateralManager)) && !termController.isFactoryDeployed(address(collateralManager))) {
            revert InvalidRepoId();
        }
    
    }

    function _validateRolloverManager(ITermRepoRolloverManager rolloverManager) private view {
        TermStorage storage s = LibTermStorage.termStorage();
        ITermController termController = rolloverManager.termController();
        if (!s.approvedTermControllers[address(termController)]) {
            revert InvalidTermController();
        }
        if (!termController.isTermDeployed(address(rolloverManager)) && !termController.isFactoryDeployed(address(rolloverManager))) {
            revert InvalidRepoId();
        }
    }

    function _validateCollateralAmount(
        ITermRepoServicer repoServicer,
        address borrower,
        address collateralToken,
        uint256 collateralAmount
    ) private view {
        uint256 borrowerCollateralBalance = repoServicer.termRepoCollateralManager().getCollateralBalance(borrower, collateralToken);
        if (collateralAmount > borrowerCollateralBalance) {
            revert InsufficientCollateralAmount(collateralAmount, borrowerCollateralBalance);
        }
    }

    function _validateCollateralToken(
        ITermRepoServicer repoServicer,
        address collateralToken
    ) private view {
        if (repoServicer.termRepoCollateralManager().maintenanceCollateralRatios(collateralToken) == 0) {
            revert InvalidCollateralToken();
        }
    }
}
