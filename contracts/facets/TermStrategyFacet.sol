//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {ITermController} from "../interfaces/ITermController.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermRepoLocker} from "../interfaces/ITermRepoLocker.sol";
import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {ITermRepoToken} from "../interfaces/ITermRepoToken.sol";
import {TermAtomicTxProtection} from "./base/TermAtomicTxProtection.sol";
import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMulticallProtection} from "./base/TermMulticallProtection.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";
import {TermStorage, LibTermStorage} from "../libraries/LibTermStorage.sol";
import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {ExponentialNoError} from "../lib/ExponentialNoError.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";

interface IStrategy {
    struct StrategyState {
        address assetVault;
        address eventEmitter;
        address governorAddress;
        ITermController prevTermController;
        ITermController currTermController;
        IDiscountRateAdapter discountRateAdapter;
        uint256 timeToMaturityThreshold;
        uint256 requiredReserveRatio;
        uint256 discountRateMarkup;
        uint256 repoTokenConcentrationLimit;
    }

    function asset() external view returns (address);
    function sellRepoToken(
        address repoToken,
        uint256 amount
    ) external;
    function strategyState() external view returns (StrategyState memory);
}

interface IDiscountRateAdapter {
    function getDiscountRate(address repoToken) external view returns (uint256);
    function repoRedemptionHaircut(address repoToken) external view returns (uint256);
}


/// @author TermLabs  
/// @title Term Strategy Facet
/// @notice This facet provides functionality to interact with strategy contracts for repo token operations
/// @dev This facet allows users to sell repo tokens through approved strategy contracts with automatic asset handling
contract TermStrategyFacet is ReentrancyGuard, TermFlashHookFacet, TermAtomicTxProtection, TermMulticallProtection, TermMultiContextAuth, ExponentialNoError {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error AfterMaturity();
    error InvalidCollateralToken();
    error InvalidRepoId();
    error InvalidStrategy();
    error InvalidTermController();
    error NoProceedsReceived();
    error NotEnoughProceedsReceived();
    error PurchaseTokenMismatch();
    error RepoTokensNotFullyConsumed();
    error RepoRedemptionHaircutNotSupported();

    // ========================================================================
    // = Deploy ===============================================================
    // ========================================================================
    
    constructor() {
        previewMapping[this.mintAndSellRepoTokenHook.selector] = this.previewMintAndSellRepoToken.selector;
    }

    // ========================================================================
    // = Strategy Functions ===================================================
    // ========================================================================

    /// @notice Sell repo tokens through a strategy contract and receive proceeds
    /// @param strategy The strategy contract to execute the sale through
    /// @param repoToken The address of the repo token to sell
    /// @param repoTokenAmount The amount of repo tokens to sell
    /// @return proceeds The amount of underlying assets received from the sale
    function sellRepoToken(
        IStrategy strategy,
        address repoToken,
        uint256 repoTokenAmount
    ) external nonReentrant returns (uint256 proceeds) {
        IStrategy.StrategyState memory strategyState = strategy.strategyState();
        _validateStrategy(strategy, strategyState);
        address asset = strategy.asset();
        uint256 preProceedsBalance = IERC20(asset).balanceOf(address(this));

        // Transfer repo tokens from user to this contract
        IERC20(repoToken).safeTransferFrom(msg.sender, address(this), repoTokenAmount);

        // Check repo token balance before strategy call
        uint256 repoTokenBalanceBefore = IERC20(repoToken).balanceOf(address(this));

        IERC20(repoToken).forceApprove(address(strategy), repoTokenAmount);

        // Call the strategy's sellRepoTokenfunction
        strategy.sellRepoToken(repoToken, repoTokenAmount);

        IERC20(repoToken).forceApprove(address(strategy), 0);

        // Check repo token balance after strategy call
        uint256 repoTokenBalanceAfter = IERC20(repoToken).balanceOf(address(this));

        // Ensure exact amount was consumed
        if (repoTokenBalanceBefore - repoTokenBalanceAfter != repoTokenAmount) {
            revert RepoTokensNotFullyConsumed();
        }

        uint256 postProceedsBalance = IERC20(asset).balanceOf(address(this));

        // @dev Ensure that proceeds were received and prevents repo token thefts
        if (postProceedsBalance <= preProceedsBalance) {
            revert NoProceedsReceived();
        }
        proceeds = postProceedsBalance - preProceedsBalance;
        
        IERC20(asset).safeTransfer(msg.sender, proceeds);
    }

    /// @notice Mints Term Repo Tokens and sells them through a strategy in a single transaction
    /// @dev This function enables atomic minting and selling of repo tokens, useful for immediate liquidity provision.
    ///      The minted tokens are sent to the strategy for selling.
    /// @param strategy The strategy contract that will handle the sale of the minted repo tokens
    /// @param termRepoServicer The address of the TermRepoServicer contract for the specific Term
    /// @param borrowAmount The amount of purchase token proceeds the borrower expects to receive from the sale
    /// @param collateralAmounts Array of collateral amounts corresponding to each accepted collateral token in the Term
    /// @param usePermit2 If true, uses Permit2 for token transfers; if false, uses standard ERC20 transferFrom
    function mintAndSellRepoToken(
        IStrategy strategy,
        address termRepoServicer,
        uint256 borrowAmount,
        uint256[] calldata collateralAmounts,
        bool usePermit2
    ) external initiateAtomicTxProtection nonReentrant returns (uint256 proceeds) {
        address borrower = msg.sender;
        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);

        ITermRepoCollateralManager termRepoCollateralManager = ITermRepoCollateralManager(
            _termRepoServicer.termRepoCollateralManager()
        );

        address collateralToken;
        uint256 amount;
        uint8 index;

        // @dev Transfer collateral tokens from msg.sender to this contract
        for (index = 0; index < collateralAmounts.length; ++index){
            collateralToken = termRepoCollateralManager.collateralTokens(index);
            amount = collateralAmounts[index];
            if (usePermit2) {
                Permit2Lib.PERMIT2.transferFrom(
                    borrower,
                    address(this),
                    amount.toUint160(),
                    collateralToken
                );
            } else {
                IERC20(collateralToken).safeTransferFrom(borrower, address(this), amount);
            }
        }

        return _mintAndSellRepoTokenInternal(
            strategy,
            termRepoServicer,
            borrower,
            borrowAmount,
            collateralAmounts,
            true
        );
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Flash hook that mints repo tokens using the borrower's collateral and sells
    ///         them into a strategy for purchase token proceeds.
    /// @dev Reads the repo servicer from `targetAddress` and decodes the strategy address
    ///      from `additionalCalldata`. Builds the collateral amounts array, validates the
    ///      purchase token matches the servicer's expected token, then delegates to
    ///      `_mintAndSellRepoTokenInternal` to lock collateral, mint repo tokens, and sell
    ///      them into the strategy.
    /// @param input The action hook input where:
    ///   - `user`: the borrower minting and selling repo tokens
    ///   - `inputToken`: the collateral token to lock
    ///   - `maxInputAmount`: the collateral amount to lock
    ///   - `outputToken`: the purchase token expected as proceeds
    ///   - `minOutputAmount`: the borrow/mint amount
    ///   - `targetAddress`: the TermRepoServicer contract address
    ///   - `additionalCalldata`: ABI-encoded `(address strategy)`
    /// @return proceeds The purchase token amount received from selling the minted repo tokens.
    function mintAndSellRepoTokenHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant returns (uint256 proceeds) {
        address borrower = input.user;
        address collateralToken = input.inputToken;
        uint256 collateralAmount = input.maxInputAmount;
        address purchaseToken = input.outputToken;
        uint256 borrowAmount = input.minOutputAmount;
        address termRepoServicer = input.targetAddress;
        address strategyAddress = abi.decode(input.additionalCalldata, (address));

        IStrategy strategy = IStrategy(strategyAddress);

        uint256[] memory collateralAmounts = _buildCollateralAmountsArray(
            termRepoServicer,
            collateralToken,
            collateralAmount
        );

        ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        if (_termRepoServicer.purchaseToken() != purchaseToken) {
            revert PurchaseTokenMismatch();
        }

        return _mintAndSellRepoTokenInternal(
            strategy,
            termRepoServicer,
            borrower,
            borrowAmount,
            collateralAmounts,
            false
        );
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /**
     * @notice Previews a mint-and-sell repo token action by returning the expected input/output tokens and amounts
     * @dev Validates that the repo servicer's purchase token matches the strategy's underlying asset.
     *      The strategy address is decoded from the hook input's additionalCalldata.
     * @param actionHookInput The action hook input containing the target repo servicer, encoded strategy address, and token amounts
     * @return A PreviewAction struct with the expected tokens, amounts, and determinism flag
     */
    function previewMintAndSellRepoToken(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {
        address termRepoServicerAddr = actionHookInput.targetAddress;
        address strategyAddress = abi.decode(actionHookInput.additionalCalldata, (address));
        
         ITermRepoServicer termRepoServicer = ITermRepoServicer(termRepoServicerAddr);
         IStrategy strategy = IStrategy(strategyAddress);
         if (termRepoServicer.purchaseToken() != strategy.asset()) {
             revert PurchaseTokenMismatch();
         }

         return PreviewAction({
            expectedInputToken: actionHookInput.inputToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: strategy.asset(),
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
         });
    }

    function _mintAndSellRepoTokenInternal(
        IStrategy strategy,
        address termRepoServicer,
        address borrower,
        uint256 borrowAmount,
        uint256[] memory collateralAmounts,
        bool payoutToUser
    ) internal returns (uint256 proceeds) {
        IStrategy.StrategyState memory strategyState = strategy.strategyState();
         _validateStrategy(strategy, strategyState);
         ITermRepoServicer _termRepoServicer = ITermRepoServicer(termRepoServicer);
        _validateRepoServicer(_termRepoServicer);
        if (_termRepoServicer.purchaseToken() != strategy.asset()) {
             revert PurchaseTokenMismatch();
         }
        ITermRepoLocker termRepoLocker = _termRepoServicer.termRepoLocker();

        ITermRepoCollateralManager termRepoCollateralManager = ITermRepoCollateralManager(
            _termRepoServicer.termRepoCollateralManager()
        );

        ITermRepoToken termRepoTokenMinted = _termRepoServicer.termRepoToken();

        // Block repo tokens with redemption haircuts — our pricing doesn't account for them
        if (strategyState.discountRateAdapter.repoRedemptionHaircut(address(termRepoTokenMinted)) != 0) {
            revert RepoRedemptionHaircutNotSupported();
        }

        address collateralToken;
        uint256 amount;
        uint8 index;

        for (index = 0; index < collateralAmounts.length; ++index){
            collateralToken = termRepoCollateralManager.collateralTokens(index);
            amount = collateralAmounts[index];
            if (amount > 0) {
                IERC20(collateralToken).forceApprove(address(termRepoLocker), amount);
            }
        }

        uint256 discountRate = strategyState.discountRateAdapter.getDiscountRate(address(termRepoTokenMinted));
        uint256 discountRateMarkup = strategyState.discountRateMarkup;

        Exp memory dayCountFraction = div_(
            // solhint-disable-next-line not-rely-on-time
            Exp({mantissa: (_termRepoServicer.redemptionTimestamp() - block.timestamp)}),
            Exp({mantissa: (360 days)})
        );

        Exp memory repurchaseFactor = add_(
            Exp({mantissa: expScale}),
            mul_(
                dayCountFraction,
                Exp({mantissa: discountRate + discountRateMarkup})
            )
        );

        uint256 redemptionValue = termRepoTokenMinted.redemptionValue();

        // Back propagate amount of repo tokens to sell from borrowAmount: (borrowAmount * repurchaseFactor) / redemptionValue
        uint256 minAmountOfRepoTokensToSell = truncate(
            div_(
                mul_(
                    Exp({mantissa: borrowAmount * expScale}),
                    repurchaseFactor
                ),
                Exp({mantissa: redemptionValue})
            )
        );

        // Forward-verify: ensure the strategy would pay at least borrowAmount
        uint256 estimatedProceeds = truncate(
            div_(
                Exp({mantissa: mul_(minAmountOfRepoTokensToSell, redemptionValue)}),
                repurchaseFactor
            )
        );


        /// @dev This off-by-one adjustment is necessary due to precision loss in division operations.
        // Round up minAmountOfRepoTokensToSell if estimated proceeds are less than borrow amount to ensure we meet the target after the discount
        if (estimatedProceeds < borrowAmount) {
            minAmountOfRepoTokensToSell += 1;
        }

        // Calculate pro-rated servicing fee: servicingFee * (timeToMaturity / 360 days)
        Exp memory proRatedServicingFee = mul_(
            dayCountFraction,
            Exp({mantissa: _termRepoServicer.servicingFee()})
        );

        uint256 amountOfRepoTokensToMint = 
            truncate(
                div_(
                    Exp({mantissa: minAmountOfRepoTokensToSell * expScale}),
                    sub_(Exp({mantissa: expScale}), proRatedServicingFee)
                )
            );

        uint256 repoTokenBalanceBeforeMint = termRepoTokenMinted.balanceOf(address(this));
        
        _termRepoServicer.mintOpenExposure(
            borrower, 
            amountOfRepoTokensToMint, 
            collateralAmounts
        );

        uint256 repoTokenBalanceAfterMint = termRepoTokenMinted.balanceOf(address(this));
        uint256 actualMintedAmount = repoTokenBalanceAfterMint - repoTokenBalanceBeforeMint;

        for (index = 0; index < collateralAmounts.length; ++index){
            collateralToken = termRepoCollateralManager.collateralTokens(index);
            IERC20(collateralToken).forceApprove(address(termRepoLocker), 0);
        }

        address asset = strategy.asset();
        uint256 preProceedsBalance = IERC20(asset).balanceOf(address(this));

        termRepoTokenMinted.approve(address(strategy), actualMintedAmount);

        // Call the strategy's sellRepoTokenfunction
        strategy.sellRepoToken(address(termRepoTokenMinted), actualMintedAmount);

        termRepoTokenMinted.approve(address(strategy), 0);

        // Check repo token balance after strategy call
        uint256 repoTokenBalanceAfterSellRepoToken = termRepoTokenMinted.balanceOf(address(this));

        // Ensure exact amount was consumed
        if (repoTokenBalanceAfterMint - repoTokenBalanceAfterSellRepoToken != actualMintedAmount) {
            revert RepoTokensNotFullyConsumed();
        }

        uint256 postProceedsBalance = IERC20(asset).balanceOf(address(this));

        // @dev Ensure that proceeds were received and prevents repo token thefts
        if (postProceedsBalance <= preProceedsBalance) {
            revert NoProceedsReceived();
        }
        proceeds = postProceedsBalance - preProceedsBalance;
        if (proceeds < borrowAmount) {
            revert NotEnoughProceedsReceived();
        }
        if (payoutToUser) {
            IERC20(asset).safeTransfer(borrower, proceeds);
        }
    }

    function _validateStrategy(IStrategy strategy, IStrategy.StrategyState memory strategyState) private view {
        ITermController controller = strategyState.currTermController;
        TermStorage storage s = LibTermStorage.termStorage();
        if (!s.approvedTermControllers[address(controller)]) {
            revert InvalidTermController();
        }
        if (!controller.isTermDeployed(address(strategy))) {
            revert InvalidStrategy();
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
}
