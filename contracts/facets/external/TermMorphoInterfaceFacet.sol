//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermMulticallProtection} from "../base/TermMulticallProtection.sol";
import {TermFlashHookFacet} from "../base/TermFlashHookFacet.sol";
import {TermAtomicTxProtection} from "../base/TermAtomicTxProtection.sol";
import {TermMultiContextAuth} from "../base/TermMultiContextAuth.sol";
import {ActionHookInput} from "../../lib/ActionHookInput.sol";
import {PreviewAction} from "../../lib/PreviewAction.sol";

import {Authorization, IMorpho, Id, MarketParams, Signature} from "@morpho-org/morpho-blue/src/interfaces/IMorpho.sol";
import {MathLib} from "@morpho-org/morpho-blue/src/libraries/MathLib.sol";
import {IOracle} from "@morpho-org/morpho-blue/src/interfaces/IOracle.sol";
import {MorphoBalancesLib} from "@morpho-org/morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";


/// @author TermLabs
/// @title TermMorphoInterfaceFacet
/// @notice Provides interface functions for interacting with Morpho protocol
/// @dev Implements all major Morpho operations with onBehalfOf pattern
contract TermMorphoInterfaceFacet is ReentrancyGuard, TermFlashHookFacet, TermAtomicTxProtection, TermMulticallProtection, TermMultiContextAuth {
    using SafeERC20 for IERC20;
    using MathLib for uint256;
    using SafeCast for uint256;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when borrowed assets don't match expected amount
    error BorrowedAssetsMismatch();

    /// @notice Thrown when deadline has expired
    error Expired();

    /// @notice Thrown when the target asset does not match the expected asset
    error IncorrectTargetAsset();

    /// @notice Thrown when amount is zero
    error InvalidAmount();

    /// @notice Thrown when asset address is zero
    error InvalidAssetAddress();

    /// @notice Thrown when collateral asset is not accepted by the collateral manager
    error InvalidCollateralAsset();

    /// @notice Thrown when loan token from morpho market is invalid
    error InvalidLoanToken();

    /// @notice Thrown when market ID is zero
    error InvalidMarketId();

    /// @notice Thrown when Morpho pool address is zero
    error InvalidMorphoPoolAddress();

    /// @notice Thrown when user address is zero
    error InvalidUserAddress();

    /// @notice Thrown when repaid assets don't match expected amount
    error RepaidAssetsMismatch();

    /// @notice Thrown when attempting to supply collateral to self
    error SelfSupplyNotAllowed();

    /// @notice Thrown when supplied assets don't match expected amount
    error SupplyAmountMismatch();

    /// @notice Thrown when unsupported selector is provided for calldata generation
    error UnsupportedSelector();

    // ========================================================================
    // = Constants ============================================================
    // ========================================================================
    uint256 private constant MORPHO_ORACLE_PRICE_SCALE = 1e36;

    // Function selectors for full signature versions (used in generateCalldata)
    bytes4 private constant WITHDRAW_COLLATERAL_SELECTOR = bytes4(keccak256("morphoWithdrawCollateral(address,(address,address,address,address,uint256),uint256,address,bool)"));
    bytes4 private constant BORROW_SELECTOR = bytes4(keccak256("morphoBorrow(address,(address,address,address,address,uint256),uint256,address,bool)"));

    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================

    address immutable deployedMorphoPool;

    // ========================================================================
    // = Modifiers ============================================================
    // ========================================================================

    modifier approvedMorphoPoolOnly(address morphoPool) {
        if (morphoPool != deployedMorphoPool) {
            revert InvalidMorphoPoolAddress();
        }
        _;
    }
    
    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    constructor(address deployedMorphoPool_) {
        if (deployedMorphoPool_ == address(0)) {
            revert InvalidMorphoPoolAddress();
        }
        deployedMorphoPool = deployedMorphoPool_;

        previewMapping[this.morphoRefinanceInHook.selector] = this.previewMorphoRefinanceIn.selector;
        previewMapping[this.morphoRefinanceOutHook.selector] = this.previewMorphoRefinanceOut.selector;
    }

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Approves `authorization.authorized` to manage `authorization.authorizer`'s position via EIP712 `signature`
    /// @param morphoPool The address of the Morpho pool
    /// @param authorization The `Authorization` struct
    /// @param signature The signature
    /// @param skipRevert Whether to avoid reverting the call in case the signature is frontrunned
    function morphoSetAuthorizationWithSig(
        address morphoPool,
        Authorization calldata authorization,
        Signature calldata signature,
        bool skipRevert
    ) external onlyMulticallInitiator approvedMorphoPoolOnly(morphoPool) {
        if (morphoPool == address(0)) revert InvalidMorphoPoolAddress();
        if (authorization.authorizer == address(0)) revert InvalidUserAddress();
        if (authorization.deadline <= block.timestamp) revert Expired();
        try IMorpho(morphoPool).setAuthorizationWithSig(authorization, signature) {}
        catch (bytes memory returnData) {
            if (!skipRevert) _revert(returnData);
        }
    }

    /// @notice Supplies `assets` of collateral on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to supply collateral to
    /// @param assets The amount of collateral to supply
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoSupplyCollateral(
        address morphoPool,
        MarketParams memory marketParams,
        uint256 assets,
        bool usePermit2
    ) external approvedMorphoPoolOnly(morphoPool) {
        if (marketParams.collateralToken == address(0)) revert InvalidCollateralAsset();
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(msg.sender, address(this), assets.toUint160(), marketParams.collateralToken);
        } else {
            // Transfer collateral from the user to this contract
            IERC20(marketParams.collateralToken).safeTransferFrom(msg.sender, address(this), assets);
        }
        _morphoSupplyCollateralInternal(morphoPool, marketParams, assets, msg.sender);
    }

    /// @notice Supplies `assets` of collateral on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to supply collateral to
    /// @param assets The amount of collateral to supply
    /// @param user The address of the account to supply collateral on behalf of
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoSupplyCollateral(
        address morphoPool,
        MarketParams memory marketParams,
        uint256 assets,
        address user,
        bool usePermit2
    ) external onlyUserOrActiveContext(user) approvedMorphoPoolOnly(morphoPool) {
        if (marketParams.collateralToken == address(0)) revert InvalidCollateralAsset();
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(user, address(this), assets.toUint160(), marketParams.collateralToken);
        } else {
            // Transfer collateral from the user to this contract
            IERC20(marketParams.collateralToken).safeTransferFrom(user, address(this), assets);
        }
        _morphoSupplyCollateralInternal(morphoPool, marketParams, assets, user);
    }

    /// @notice Supplies `assets` of the loan asset on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to supply assets to
    /// @param assets The amount of assets to supply
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoSupply(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets,
        bool usePermit2
    ) external approvedMorphoPoolOnly(morphoPool) {
        _morphoSupplyInternal(morphoPool, marketParams, assets, msg.sender, usePermit2);
    }

    /// @notice Supplies `assets` of the loan asset on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to supply assets to
    /// @param assets The amount of assets to supply
    /// @param user The address of the account to supply assets on behalf of
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoSupply(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets,
        address user,
        bool usePermit2
    ) external onlyUserOrActiveContext(user) approvedMorphoPoolOnly(morphoPool) {
        _morphoSupplyInternal(morphoPool, marketParams, assets, user, usePermit2);
    }

    /// @notice Withdraws `assets` of the collateral asset on behalf of the `user`
    /// @dev Caller must have pre-authorized this contract via IMorpho.setAuthorization
    /// or morphoSetAuthorizationWithSig before calling this function.
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to withdraw collateral from
    /// @param assets The amount of collateral to withdraw
    function morphoWithdrawCollateral(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets
    ) external approvedMorphoPoolOnly(morphoPool) {
        _morphoWithdrawCollateralInternal(morphoPool, marketParams, assets, msg.sender, true);
    }

    /// @notice Withdraws `assets` of the collateral asset on behalf of the `user`
    /// @dev Caller must have pre-authorized this contract via IMorpho.setAuthorization
    /// or morphoSetAuthorizationWithSig before calling this function.
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to withdraw collateral from
    /// @param assets The amount of collateral to withdraw
    /// @param user The address of the account to withdraw collateral on behalf of
    /// @param payoutUser If true, the withdrawn collateral will be transferred to `user`
    function morphoWithdrawCollateral(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets,
        address user,
        bool payoutUser
    ) external onlyUserOrActiveContext(user) approvedMorphoPoolOnly(morphoPool) {
        _morphoWithdrawCollateralInternal(morphoPool, marketParams, assets, user, payoutUser);
    }

    /// @notice Borrows `assets` of the loan asset on behalf of the `user`
    /// @dev Caller must have pre-authorized this contract via IMorpho.setAuthorization
    /// or morphoSetAuthorizationWithSig before calling this function.
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to borrow assets from
    /// @param assets The amount of assets to borrow
    function morphoBorrow(
        address morphoPool,
        MarketParams memory marketParams,
        uint256 assets
    ) external approvedMorphoPoolOnly(morphoPool) {
        _morphoBorrowInternal(morphoPool, marketParams, assets, msg.sender, true);
    }

    /// @notice Borrows `assets` of the loan asset on behalf of the `user`
    /// @dev Caller must have pre-authorized this contract via IMorpho.setAuthorization
    /// or morphoSetAuthorizationWithSig before calling this function.
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to borrow assets from
    /// @param assets The amount of assets to borrow
    /// @param user The address of the account to borrow assets on behalf of
    /// @param payoutUser If true, the borrowed assets will be transferred to `user`
    function morphoBorrow(
        address morphoPool,
        MarketParams memory marketParams,
        uint256 assets,
        address user,
        bool payoutUser
    ) external onlyUserOrActiveContext(user) approvedMorphoPoolOnly(morphoPool) {
        _morphoBorrowInternal(morphoPool, marketParams, assets, user, payoutUser);
    }

    /// @notice Repays `assets` of the loan asset on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to repay assets to
    /// @param assets The amount of assets to repay
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoRepay(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets,
        bool usePermit2
    ) external approvedMorphoPoolOnly(morphoPool) {
        if (marketParams.loanToken == address(0)) revert InvalidLoanToken();
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(msg.sender, address(this), assets.toUint160(), marketParams.loanToken);
        } else {
            // Transfer loan tokens from the user to this contract for repayment
            IERC20(marketParams.loanToken).safeTransferFrom(msg.sender, address(this), assets);
        }
        _morphoRepayInternal(morphoPool, marketParams, assets, msg.sender);
    }


    /// @notice Repays `assets` of the loan asset on behalf of `user`
    /// @param morphoPool The address of the Morpho pool
    /// @param marketParams The Morpho market to repay assets to
    /// @param assets The amount of assets to repay
    /// @param user The address of the account to repay assets on behalf of
    /// @param usePermit2 Whether Permit2 was used for token approvals
    function morphoRepay(
        address morphoPool,
        MarketParams calldata marketParams,
        uint256 assets,
        address user,
        bool usePermit2
    ) external onlyUserOrActiveContext(user) approvedMorphoPoolOnly(morphoPool) {
        if (marketParams.loanToken == address(0)) revert InvalidLoanToken();
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(user, address(this), assets.toUint160(), marketParams.loanToken);
        } else {
            // Transfer loan tokens from the user to this contract for repayment
            IERC20(marketParams.loanToken).safeTransferFrom(user, address(this), assets);
        }
        _morphoRepayInternal(morphoPool, marketParams, assets, user);
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Flash hook that refinances a user out of a Morpho position by repaying
    ///         their debt and withdrawing their collateral.
    /// @dev Decodes the Morpho market ID from `input.additionalCalldata`, resolves the market
    ///      params, then repays `input.maxInputAmount` of loan asset and withdraws
    ///      `input.minOutputAmount` of collateral on behalf of the borrower.
    /// @param input The action hook input where:
    ///   - `user`: the borrower whose Morpho position is being refinanced out
    ///   - `inputToken`: the loan asset to repay
    ///   - `maxInputAmount`: the repayment amount
    ///   - `outputToken`: the collateral token to withdraw
    ///   - `minOutputAmount`: the collateral amount to withdraw
    ///   - `targetAddress`: the Morpho pool address
    ///   - `additionalCalldata`: ABI-encoded `bytes32` Morpho market ID
    function morphoRefinanceOutHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) approvedMorphoPoolOnly(input.targetAddress) nonReentrant {
        address morphoPool = input.targetAddress;
        address loanAsset = input.inputToken;
        uint256 amount = input.maxInputAmount;
        address collateralToken = input.outputToken;
        uint256 collateralAmount = input.minOutputAmount;
        address borrower = input.user;
        bytes32 marketIdBytes = abi.decode(input.additionalCalldata, (bytes32));
        Id marketId = Id.wrap(marketIdBytes);
        MarketParams memory marketParams = IMorpho(morphoPool).idToMarketParams(marketId);

        _morphoRepayInternal(morphoPool, marketParams, amount, borrower);
        _morphoWithdrawCollateralInternal(morphoPool, marketParams, collateralAmount, borrower, false);
    }


    /// @notice Flash hook that refinances a user into a Morpho position by supplying
    ///         collateral and borrowing against it.
    /// @dev Decodes the Morpho market ID from `input.additionalCalldata`, resolves the market
    ///      params, then supplies `input.maxInputAmount` of collateral and borrows
    ///      `input.minOutputAmount` of loan asset on behalf of the borrower.
    /// @param input The action hook input where:
    ///   - `user`: the borrower opening the Morpho position
    ///   - `inputToken`: the collateral token to supply
    ///   - `maxInputAmount`: the collateral amount to supply
    ///   - `outputToken`: the loan asset to borrow
    ///   - `minOutputAmount`: the borrow amount
    ///   - `targetAddress`: the Morpho pool address
    ///   - `additionalCalldata`: ABI-encoded `bytes32` Morpho market ID
    function morphoRefinanceInHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) approvedMorphoPoolOnly(input.targetAddress) nonReentrant {
        address morphoPool = input.targetAddress;
        address loanAsset = input.outputToken;
        uint256 amount = input.minOutputAmount;
        address collateralToken = input.inputToken;
        uint256 collateralAmount = input.maxInputAmount;
        address borrower = input.user;
        bytes32 marketIdBytes = abi.decode(input.additionalCalldata, (bytes32));
        Id marketId = Id.wrap(marketIdBytes);
        MarketParams memory marketParams = IMorpho(morphoPool).idToMarketParams(marketId);
        _morphoSupplyCollateralInternal(
            morphoPool,
            marketParams,
            collateralAmount,
            borrower
        );
        _morphoBorrowInternal(
            morphoPool,
            marketParams,
            amount,
            borrower,
            false
        );
    }

    // ========================================================================
    // = View Functions  ======================================================
    // ========================================================================

    /// @notice Get the available collateral that can be withdrawn for a user in Morpho
    /// @param morphoPool The address of the Morpho pool
    /// @param user The address of the user to check balance for
    /// @param marketId The market ID to check balance in
    /// @return balance user's available collateral that can be withdrawn from the market
    function availableFunds(
        address morphoPool,
        address user,
        bytes32 marketId
    ) external view returns (uint256) {
        if (morphoPool == address(0)) revert InvalidMorphoPoolAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (marketId == bytes32(0)) revert InvalidMarketId();
        IMorpho morpho = IMorpho(morphoPool);
        Id wrappedMarketId = Id.wrap(marketId);

        // Get user's position
        uint256 collateralBalance = morpho.position(wrappedMarketId, user).collateral;
        uint256 borrowShares = morpho.position(wrappedMarketId, user).borrowShares;

        // If user has no borrows, they can withdraw all collateral
        if (borrowShares == 0) {
            return collateralBalance;
        }

        // Get market data to calculate borrowed amount
        MarketParams memory marketParams = morpho.idToMarketParams(wrappedMarketId);

        uint256 borrowedAssets = MorphoBalancesLib.expectedBorrowAssets(morpho, marketParams, user);

        // Get collateral price from oracle
        require(marketParams.oracle != address(0), "Invalid oracle address");
        uint256 collateralPrice = IOracle(marketParams.oracle).price();
        require(collateralPrice > 0, "Invalid price");

        uint256 denominator = collateralPrice.mulDivDown(marketParams.lltv, 1e18);
        require(denominator > 0, "Price*LTV rounds to zero");

        // Calculate minimum collateral required to maintain LTV
        // Required collateral value = borrowed amount / LTV
        // Required collateral units = (borrowed amount * PRICE_SCALE) / (collateral price * LTV)
        uint256 requiredCollateral = borrowedAssets.mulDivUp(MORPHO_ORACLE_PRICE_SCALE, denominator);

        // Return withdrawable amount (current collateral - required collateral)
        if (collateralBalance > requiredCollateral) {
            return collateralBalance - requiredCollateral;
        } else {
            return 0; // Cannot withdraw any collateral
        }
    }

    /// @notice Calculates the maximum available borrowing capacity for a user in a specific Morpho market
    /// @dev Computes borrowing capacity based on user's collateral value adjusted by loan-to-value ratio
    /// @param morphoPool Address of the Morpho protocol pool contract
    /// @param user Address of the user to check borrowing capacity for
    /// @param marketId Unique identifier for the specific Morpho market
    /// @return Available borrow capacity in the market's loan token (collateral value × LTV − outstanding debt)
    function availableBorrow(
        address morphoPool,
        address user,
        bytes32 marketId
    ) external view returns (uint256) {
        if (morphoPool == address(0)) revert InvalidMorphoPoolAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (marketId == bytes32(0)) revert InvalidMarketId();

        IMorpho morpho = IMorpho(morphoPool);
        Id wrappedMarketId = Id.wrap(marketId);
        MarketParams memory marketParams = morpho.idToMarketParams(wrappedMarketId);
        require(marketParams.oracle != address(0), "Invalid oracle address");
        uint256 collateralPrice = IOracle(marketParams.oracle).price();
        require(collateralPrice > 0, "Invalid price");

        uint256 collateralBalance = morpho.position(wrappedMarketId, user).collateral;

        uint256 borrowedAssets = MorphoBalancesLib.expectedBorrowAssets(morpho, marketParams, user);

        uint256 borrowCapacity = collateralBalance.mulDivDown(collateralPrice, MORPHO_ORACLE_PRICE_SCALE).wMulDown(marketParams.lltv);

        return borrowCapacity > borrowedAssets ? borrowCapacity - borrowedAssets : 0;
    }

    /// @notice Returns the current amount of assets borrowed by a user in a specific Morpho market
    /// @param morphoPool The address of the Morpho pool contract
    /// @param user The address of the user whose borrow balance is being queried
    /// @param marketId The identifier of the market (as a bytes32 value)
    /// @return The current amount of assets borrowed by the user in the specified market
    function currentBorrow(
        address morphoPool,
        address user,
        bytes32 marketId
    ) external view returns (uint256) {
        if (morphoPool == address(0)) revert InvalidMorphoPoolAddress();
        if (user == address(0)) revert InvalidUserAddress();
        if (marketId == bytes32(0)) revert InvalidMarketId();
        
        IMorpho morpho = IMorpho(morphoPool);
        Id wrappedMarketId = Id.wrap(marketId);
        MarketParams memory marketParams = morpho.idToMarketParams(wrappedMarketId);
        uint256 borrowedAssets = MorphoBalancesLib.expectedBorrowAssets(morpho, marketParams, user);
        return borrowedAssets;
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /// @notice Generates calldata for Morpho operations
    /// @param selector The function selector for the operation
    /// @param morphoPool The address of the Morpho pool
    /// @param asset The address of the asset (unused but kept for interface compatibility)
    /// @param user The address of the user
    /// @param amount The amount for the operation
    /// @param payoutUser Whether to pay out to the user
    /// @param data Additional data containing the market ID
    function generateCalldata(
        bytes4 selector,
        address morphoPool,
        address asset,
        address user,
        uint256 amount,
        bool payoutUser,
        bytes calldata data
    ) external view approvedMorphoPoolOnly(morphoPool) returns (bytes memory) {
        bytes32 marketIdBytes = abi.decode(data, (bytes32));
        Id marketId = Id.wrap(marketIdBytes);
        MarketParams memory marketParams = IMorpho(morphoPool).idToMarketParams(marketId);
        if (selector == WITHDRAW_COLLATERAL_SELECTOR) {
            if (marketParams.collateralToken != asset) {
                revert IncorrectTargetAsset();
            }
            return abi.encodeWithSelector(selector, morphoPool, marketParams, amount, user, payoutUser);
        } else if (selector == BORROW_SELECTOR) {
            if (marketParams.loanToken != asset) {
                revert IncorrectTargetAsset();
            }
            return abi.encodeWithSelector(selector, morphoPool, marketParams, amount, user, payoutUser);
        } else {
            revert UnsupportedSelector();
        }
    }

    /// @notice Previews a Morpho refinance-out action by resolving the market's loan and
    ///         collateral tokens from the on-chain market params.
    /// @dev Decodes the Morpho market ID from `additionalCalldata` and queries `idToMarketParams`
    ///      to populate the expected input (loan token) and output (collateral token). Amounts
    ///      are passed through unchanged.
    /// @param actionHookInput The action hook input where:
    ///   - `targetAddress`: the Morpho pool address
    ///   - `maxInputAmount`: the repayment amount
    ///   - `minOutputAmount`: the collateral amount to withdraw
    ///   - `additionalCalldata`: ABI-encoded `bytes32` Morpho market ID
    /// @return A `PreviewAction` with the market's loan token as input and collateral token as output.
    function previewMorphoRefinanceOut(ActionHookInput calldata actionHookInput) external view approvedMorphoPoolOnly(actionHookInput.targetAddress) returns (PreviewAction memory) {
        bytes32 marketIdBytes = abi.decode(actionHookInput.additionalCalldata, (bytes32));
        Id marketId = Id.wrap(marketIdBytes);
        MarketParams memory marketParams = IMorpho(actionHookInput.targetAddress).idToMarketParams(marketId);

        if (marketParams.loanToken == marketParams.collateralToken) {
            revert InputOutputTokenCollision();
        }

        PreviewAction memory previewAction = PreviewAction({
            expectedInputToken: marketParams.loanToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: marketParams.collateralToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
        return previewAction;
    }

    /// @notice Previews a Morpho refinance-in action by resolving the market's collateral and
    ///         loan tokens from the on-chain market params.
    /// @dev Decodes the Morpho market ID from `additionalCalldata` and queries `idToMarketParams`
    ///      to populate the expected input (collateral token) and output (loan token). Amounts
    ///      are passed through unchanged.
    /// @param actionHookInput The action hook input where:
    ///   - `targetAddress`: the Morpho pool address
    ///   - `maxInputAmount`: the collateral amount to supply
    ///   - `minOutputAmount`: the borrow amount
    ///   - `additionalCalldata`: ABI-encoded `bytes32` Morpho market ID
    /// @return A `PreviewAction` with the market's collateral token as input and loan token as output.
    function previewMorphoRefinanceIn(ActionHookInput calldata actionHookInput) external view approvedMorphoPoolOnly(actionHookInput.targetAddress) returns (PreviewAction memory) {
        bytes32 marketIdBytes = abi.decode(actionHookInput.additionalCalldata, (bytes32));
        Id marketId = Id.wrap(marketIdBytes);
        MarketParams memory marketParams = IMorpho(actionHookInput.targetAddress).idToMarketParams(marketId);

        if (marketParams.loanToken == marketParams.collateralToken) {
            revert InputOutputTokenCollision();
        }

        PreviewAction memory previewAction = PreviewAction({
            expectedInputToken: marketParams.collateralToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: marketParams.loanToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
        return previewAction;
    }

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    /// @notice Supplies `assets` of collateral on behalf of `user`
    /// @param morphoPool_ The address of the Morpho pool
    /// @param marketParams_ The Morpho market to supply collateral to
    /// @param assets_ The amount of collateral to supply
    /// @param user_ The address of the account to supply collateral on behalf of
    function _morphoSupplyCollateralInternal(
        address morphoPool_,
        MarketParams memory marketParams_,
        uint256 assets_,
        address user_
    ) internal {
        if (morphoPool_ == address(0)) revert InvalidMorphoPoolAddress();
        if (assets_ == 0) revert InvalidAmount();
        if (marketParams_.collateralToken == address(0)) revert InvalidAssetAddress();
        if (user_ == address(this)) revert SelfSupplyNotAllowed();

        IERC20(marketParams_.collateralToken).forceApprove(morphoPool_, assets_);
        uint256 collateralBalanceBefore = IERC20(marketParams_.collateralToken).balanceOf(address(this));

        IMorpho(morphoPool_).supplyCollateral(marketParams_, assets_, user_, bytes(""));

        uint256 collateralBalanceAfter = IERC20(marketParams_.collateralToken).balanceOf(address(this));
        uint256 actualSupplied = collateralBalanceBefore - collateralBalanceAfter;
        if (actualSupplied != assets_) revert SupplyAmountMismatch();

        IERC20(marketParams_.collateralToken).forceApprove(morphoPool_, 0);
    }

    /// @notice Supplies `assets` of the loan asset on behalf of `user`
    /// @param morphoPool_ The address of the Morpho pool
    /// @param marketParams_ The Morpho market to supply assets to
    /// @param assets_ The amount of assets to supply
    /// @param user_ The address of the account to supply assets on behalf of
    /// @param usePermit2_ Whether Permit2 was used for token approvals
    function _morphoSupplyInternal(
        address morphoPool_,
        MarketParams memory marketParams_,
        uint256 assets_,
        address user_,
        bool usePermit2_
    ) internal {
        if (assets_ == 0) revert InvalidAmount();
        if (marketParams_.loanToken == address(0)) revert InvalidAssetAddress();
        if (user_ == address(this)) revert SelfSupplyNotAllowed();

        if (usePermit2_) {
            Permit2Lib.PERMIT2.transferFrom(user_, address(this), assets_.toUint160(), marketParams_.loanToken);
        } else {
            IERC20(marketParams_.loanToken).safeTransferFrom(user_, address(this), assets_);
        }

        IERC20(marketParams_.loanToken).forceApprove(morphoPool_, assets_);
        uint256 loanTokenBalanceBefore = IERC20(marketParams_.loanToken).balanceOf(address(this));

        (uint256 assetsSupplied, ) = IMorpho(morphoPool_).supply(marketParams_, assets_, 0, user_, bytes(""));

        uint256 loanTokenBalanceAfter = IERC20(marketParams_.loanToken).balanceOf(address(this));
        uint256 actualSupplied = loanTokenBalanceBefore - loanTokenBalanceAfter;
        if (actualSupplied != assets_) revert SupplyAmountMismatch();
        
        IERC20(marketParams_.loanToken).forceApprove(morphoPool_, 0);

        if (assetsSupplied != assets_) revert SupplyAmountMismatch();
    }

    /// @notice Withdraws `assets` of the collateral asset on behalf of the `user`
    /// @param morphoPool_ The address of the Morpho pool
    /// @param marketParams_ The Morpho market to withdraw collateral from
    /// @param assets_ The amount of collateral to withdraw
    /// @param user_ The address of the account to withdraw collateral on behalf of
    /// @param payoutUser_ If true, the withdrawn collateral will be transferred to `user_`
    function _morphoWithdrawCollateralInternal(
        address morphoPool_,
        MarketParams memory marketParams_,
        uint256 assets_,
        address user_,
        bool payoutUser_
    ) internal {
        if (assets_ == 0) revert InvalidAmount();
        if (marketParams_.collateralToken == address(0)) revert InvalidAssetAddress();
        if (user_ == address(0)) revert InvalidUserAddress();

        /// @dev function does not return withdrawal amount
        if (atomicTxInitiator() != address(0) || getFlashLoanBorrower() != address(0) || msg.sender == address(this)){
            IMorpho(morphoPool_).withdrawCollateral(marketParams_, assets_, user_, payoutUser_ ? user_ : address(this));
        } else {
            IMorpho(morphoPool_).withdrawCollateral(marketParams_, assets_, user_, user_);
        }
    }

    /// @notice Borrows `assets` of the loan asset on behalf of the `user`
    /// @param morphoPool_ The address of the Morpho pool
    /// @param marketParams_ The Morpho market to borrow assets from
    /// @param assets_ The amount of assets to borrow
    /// @param user_ The address of the account to borrow assets on behalf of
    /// @param payoutUser_ If true, the borrowed assets will be transferred to `user_`
    function _morphoBorrowInternal(
        address morphoPool_,
        MarketParams memory marketParams_,
        uint256 assets_,
        address user_,
        bool payoutUser_
    ) internal {
        if (assets_ == 0) revert InvalidAmount();
        if (marketParams_.loanToken == address(0)) revert InvalidAssetAddress();
        if (user_ == address(0)) revert InvalidUserAddress();

        uint256 borrowedAssets;

        if (atomicTxInitiator() != address(0) || getFlashLoanBorrower() != address(0) || msg.sender == address(this)) {
            (borrowedAssets, ) =
                IMorpho(morphoPool_).borrow(marketParams_, assets_, 0, user_, payoutUser_ ? user_ : address(this));
        } else {
            (borrowedAssets, ) = IMorpho(morphoPool_).borrow(marketParams_, assets_, 0, user_, user_);
        }

        if (borrowedAssets != assets_) revert BorrowedAssetsMismatch();
    }

    /// @notice Repays `assets` of the loan asset on behalf of `user`
    /// @param morphoPool_ The address of the Morpho pool
    /// @param marketParams_ The Morpho market to repay assets to
    /// @param assets_ The amount of assets to repay
    /// @param user_ The address of the account to repay assets on behalf of
    function _morphoRepayInternal(
        address morphoPool_,
        MarketParams memory marketParams_,
        uint256 assets_,
        address user_
    ) internal {
        if (assets_ == 0) revert InvalidAmount();
        if (marketParams_.loanToken == address(0)) revert InvalidAssetAddress();
        if (user_ == address(0)) revert InvalidUserAddress();

        IERC20(marketParams_.loanToken).forceApprove(morphoPool_, assets_);
        (uint256 repaidAssets, ) = IMorpho(morphoPool_).repay(marketParams_, assets_, 0, user_, bytes(""));
        IERC20(marketParams_.loanToken).forceApprove(morphoPool_, 0);

        if (repaidAssets + 1 < assets_) revert RepaidAssetsMismatch();
    }
}
