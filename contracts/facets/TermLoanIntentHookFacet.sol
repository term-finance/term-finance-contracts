//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {ITermController} from "../interfaces/ITermController.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";

import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {ExponentialNoError} from "../lib/ExponentialNoError.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";

import {LibTermStorage, TermStorage}  from "../libraries/LibTermStorage.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";
import {TermLoanIntentFacet} from "./TermLoanIntentFacet.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";


/// @author TermLabs
/// @title TermLoanIntentHookFacet
/// @notice Diamond facet that exposes loan intent settlement as flash loan hook actions
/// @dev Wraps TermLoanIntentFacet settlement functions for use within flash loan callback contexts.
///      Each hook action is gated by `onlyFlashLoanContext` and delegates to the corresponding
///      TermLoanIntentFacet function via a self-call through the diamond proxy.
contract TermLoanIntentHookFacet is ReentrancyGuard, TermFlashHookFacet, TermMultiContextAuth, ITermIntent, ExponentialNoError {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================
    
    error BorrowFeeTooHigh();
    error EmptyOrderBatch();
    error InconsistentRepoServicer();
    error BatchOrderInsufficientRemainingCapacity(uint256 orderIndex, uint256 maxFill);
    error InvalidCollateralToken();
    error OrderBatchLengthMismatch();

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    constructor() {
        // Register preview function selectors for flash loan hook workflows
        previewMapping[this.settleLimitLendHook.selector] = this.previewSettleLimitLend.selector;
    }


    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Settles a lend limit order as a flash loan hook action
    /// @dev Computes the fill amount from the taker's desired borrow amount (adjusting for borrow fees),
    ///      settles the lend order internally, then pulls purchase tokens from the taker via Permit2 or safeTransferFrom.
    /// @dev WARNING: This function has a side-effect of minting term repo tokens to `input.user` via the
    ///      internal call to `settleLimitLend`. Callers must account for the fact that the taker (input.user)
    ///      will hold newly minted term repo tokens representing their lending position after this call.
    /// @param input The flash loan hook input containing the user, borrow amount, and encoded order data
    ///        (a list of orders, signatures, and fill amounts; all orders must use the same termRepoServicer)
    function settleLimitLendHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) {
        address taker = input.user;
        address collateralToken = input.inputToken;
        
        (
            bool usePermit2,
            LimitLendOrder[] memory orders,
            Signature[] memory signatures,
            uint256[] memory fillAmounts
        ) = abi.decode(
            input.additionalCalldata,
            (bool, LimitLendOrder[], Signature[], uint256[])
        ); 
        uint256 len = orders.length;
        if (len == 0) revert EmptyOrderBatch();
        if (len != signatures.length || len != fillAmounts.length) revert OrderBatchLengthMismatch();       
        ITermRepoServicer termRepoServicer = ITermRepoServicer(orders[0].repoServicer);
        _validateRepoServicer(termRepoServicer);

        TermStorage storage ts = LibTermStorage.termStorage();

        address purchaseToken = termRepoServicer.purchaseToken();

        uint256 maturityTimestamp = termRepoServicer.maturityTimestamp();

        uint256 totalFillAmount;
        uint256 totalBorrowAmount;
        uint256 maxFill;

        for (uint256 i = 0; i < len; ++i) {
            if (orders[i].repoServicer != address(termRepoServicer)) {
                revert InconsistentRepoServicer();
            }

            if (fillAmounts[i] == 0) {
                revert InvalidFillAmount();
            }

            maxFill = _calculateLimitLendFillAmount(orders[i]);
            if (maxFill < fillAmounts[i]) {
                revert BatchOrderInsufficientRemainingCapacity(i, maxFill);
            }
            totalFillAmount += fillAmounts[i];

            totalBorrowAmount += _calculateBorrowAmountFromFillAmount(
                fillAmounts[i],
                orders[i].borrowFee,
                maturityTimestamp
            );
        }

        uint256 allocatedCollateral;
        for (uint256 i = 0; i < len; ++i) {
            uint256 collateralAmount;

            if (i == len - 1) {
                collateralAmount = input.maxInputAmount - allocatedCollateral;
            } else {
                collateralAmount =
                    (input.maxInputAmount * fillAmounts[i]) / totalFillAmount;
                allocatedCollateral += collateralAmount;
            }

            uint256[] memory collateralAmounts = _buildCollateralAmountsArray(
                address(termRepoServicer),
                collateralToken,
                collateralAmount
            );

            ts.activeAtomicTxSettlementTaker = taker;

            TermLoanIntentFacet(address(this)).settleLimitLend(
                orders[i],
                taker,
                fillAmounts[i],
                collateralAmounts,
                signatures[i]
            );
            ts.activeAtomicTxSettlementTaker = address(0);

        }

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                taker,
                address(this),
                totalBorrowAmount.toUint160(),
                purchaseToken
            );
        } else {
            IERC20(purchaseToken).safeTransferFrom(
                taker,
                address(this),
                totalBorrowAmount
            );
        }
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /// @notice Previews the expected token inputs and outputs for a lend limit order settlement via flash loan hook
    /// @param actionHookInput The flash loan hook input containing the encoded lend order and signature
    /// @return A PreviewAction struct with the expected collateral input and purchase token output
    function previewSettleLimitLend(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {
        (, LimitLendOrder[] memory orders, , ) = abi.decode(actionHookInput.additionalCalldata, (bool, LimitLendOrder[], Signature[], uint256[]));
        
        if (orders.length == 0) {
            revert EmptyOrderBatch();
        }
        
        address termRepoServicer = orders[0].repoServicer;

        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        address purchaseToken = _termRepoServicer.purchaseToken();

        _validateCollateralToken(_termRepoServicer, actionHookInput.inputToken);
        address collateralToken = actionHookInput.inputToken;

        if (purchaseToken == collateralToken) {
            revert InputOutputTokenCollision();
        }
        
        return PreviewAction({
            expectedInputToken: collateralToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: purchaseToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
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

    function _validateCollateralToken(
        ITermRepoServicer repoServicer,
        address collateralToken
    ) private view {
        if (repoServicer.termRepoCollateralManager().maintenanceCollateralRatios(collateralToken) == 0) {
            revert InvalidCollateralToken();
        }
    }

    function _buildCollateralAmountsArray(
        address servicer,
        address collateralToken,
        uint256 collateralAmount
    ) internal view returns (uint256[] memory) {
        ITermRepoServicer termRepoServicer = ITermRepoServicer(servicer);
        ITermRepoCollateralManager collateralManager = termRepoServicer.termRepoCollateralManager();
        uint256 numCollateralTokens = collateralManager.numOfAcceptedCollateralTokens();
        uint256[] memory collateralAmounts = new uint256[](numCollateralTokens);

        bool collateralSupported;
        for (uint256 i = 0; i < numCollateralTokens; i++) {
            if (collateralManager.collateralTokens(i) == collateralToken) {
                collateralAmounts[i] = collateralAmount;
                collateralSupported = true;
                break;
            } 
        }

        if (!collateralSupported) {
            revert InvalidCollateralToken();
        }

        return collateralAmounts;
    }

    function _calculateBorrowAmountFromFillAmount(
        uint256 fillAmount,
        uint256 borrowFee,
        uint256 maturityTimestamp
    ) internal view returns (uint256) {
        if (borrowFee == 0) {
            return fillAmount;
        } else {
            Exp memory feeFactor = mul_(
                Exp({mantissa: borrowFee}),
                div_ (
                    Exp({mantissa: maturityTimestamp - block.timestamp}),
                    Exp({mantissa: 360 days})
                )
            );

            if (feeFactor.mantissa >= expScale) {
                revert BorrowFeeTooHigh();
            }

            // Use the same mul_ScalarTruncate path as
            // TermLoanIntentFacet._settlePurchaseTokensAndFees so that the
            // preview borrowAmount exactly equals fillAmount - proratedFee.
            uint256 proratedFee = mul_ScalarTruncate(feeFactor, fillAmount);

            return fillAmount - proratedFee;
        }
    }

    /// @notice Calculates the actual fill amount for a limit lend order, capped by remaining unfilled capacity
    /// @param order The limit lend order to fill against
    /// @return The actual fill amount (min of requested and remaining capacity)
    /// @custom:reverts NothingToFill if the computed fill amount is zero
    function _calculateLimitLendFillAmount(
        ITermIntent.LimitLendOrder memory order
    ) internal view  returns (uint256 ) {
        TermStorage storage s = LibTermStorage.termStorage();
        bytes32 orderHash = TermLoanIntentFacet(address(this)).getLendOrderHash(order);
        ITermIntent.OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        uint256 maxFill = order.purchaseTokenAmount - orderContext.filledAmount;
        return maxFill;
    }
}