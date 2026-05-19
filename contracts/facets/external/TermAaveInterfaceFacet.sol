//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermAtomicTxProtection} from "../base/TermAtomicTxProtection.sol";
import {TermFlashHookFacet} from "../base/TermFlashHookFacet.sol";
import {TermMulticallProtection} from "../base/TermMulticallProtection.sol";
import {TermMultiContextAuth} from "../base/TermMultiContextAuth.sol";
import {ActionHookInput} from "../../lib/ActionHookInput.sol";
import {PreviewAction} from "../../lib/PreviewAction.sol";
import {LibTermStorage, TermStorage} from "../../libraries/LibTermStorage.sol";
import {ITermController} from "../../interfaces/ITermController.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {IPriceOracleGetter} from "@aave/core-v3/contracts/interfaces/IPriceOracleGetter.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IPoolDataProvider} from "@aave/core-v3/contracts/interfaces/IPoolDataProvider.sol";
import {ICreditDelegationToken} from "@aave/core-v3/contracts/interfaces/ICreditDelegationToken.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";


/// @author TermLabs
/// @title TermAaveInterfaceFacet
/// @notice Provides interface functions for interacting with Aave V3 protocol
/// @dev Implements all major Aave operations with onBehalfOf pattern
contract TermAaveInterfaceFacet is ReentrancyGuard, TermFlashHookFacet, TermAtomicTxProtection, TermMulticallProtection, TermMultiContextAuth {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ========================================================================
    // = Constants  ===========================================================
    // ========================================================================

    // Function selectors for full signature versions (used in generateCalldata)
    bytes4 private constant WITHDRAW_SELECTOR = bytes4(keccak256("aaveWithdrawOnBehalfOf(address,address,uint256,address,bool)"));
    bytes4 private constant BORROW_SELECTOR = bytes4(keccak256("aaveBorrow(address,address,uint256,address,bool)"));

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when deadline has expired
    error Expired();

    /// @notice Thrown when credit delegation allowance is insufficient
    error InsufficientCreditDelegationAllowance();

    /// @notice Thrown when Aave pool address is zero
    error InvalidAavePoolAddress();

    /// @notice Thrown when amount is zero
    error InvalidAmount();

    /// @notice Thrown when asset address is zero
    error InvalidAssetAddress();

    /// @notice Thrown when aToken address is zero
    error InvalidATokenAddress();

    /// @notice Thrown when delegator address is zero
    error InvalidDelegatorAddress();

    /// @notice Thrown when invalid rate mode is provided
    error InvalidRateMode();

    /// @notice Thrown when user address is zero
    error InvalidUserAddress();

    /// @notice Thrown when variable debt token address is zero
    error InvalidVariableDebtTokenAddress();

    /// @notice Thrown when repaid assets don't match expected amount
    error RepaidAssetsMismatch();

    /// @notice Thrown when supply amount doesn't match expected amount
    error SupplyAmountMismatch();

    /// @notice Thrown when supply doesnt use up all provided
    error SupplyAssetMismatch();

    /// @notice Thrown when unsupported selector is provided for calldata generation
    error UnsupportedSelector();

    /// @notice Thrown when withdrawal amount doesn't match expected amount
    error WithdrawalAmountMismatch();

    // ========================================================================
    // = Modifiers ============================================================
    // ========================================================================

    modifier approvedAavePoolOnly(address aavePool) {
        TermStorage storage ts = LibTermStorage.termStorage();
        bool termApproved;
        for (uint8 i = 0; i < ts.approvedTermControllerList.length; ++i) {
            if (ITermController(ts.approvedTermControllerList[i]).isTermApproved(aavePool)) {
                termApproved = true;
                break;
            }
        }
        if (!termApproved) {
            revert InvalidAavePoolAddress();
        }
        _;
    }

    // ========================================================================
    // = Deploy ===============================================================
    // ========================================================================
    
    constructor() {
        previewMapping[this.aaveRefinanceInHook.selector] = this.previewAaveRefinanceIn.selector;
        previewMapping[this.aaveRefinanceOutHook.selector] = this.previewAaveRefinanceOut.selector;
    }

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Approve credit delegation on Aave using EIP-712 signature
    /// @param aavePool The address of the Aave pool
    /// @param asset The address of the underlying asset to delegate borrowing for
    /// @param amount The amount to delegate for borrowing
    /// @param deadline The signature expiration timestamp
    /// @param v The recovery id of the signature
    /// @param r Half of the ECDSA signature pair
    /// @param s Half of the ECDSA signature pair
    /// @dev Enables this contract to borrow on behalf of the delegator using a signature
    /// @dev Only callable by multicall initiator to ensure proper access control
    function aaveApproveDelegationWithSig(
        address aavePool,
        address asset,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external approvedAavePoolOnly(aavePool) onlyMulticallInitiator {
        if (deadline <= block.timestamp) revert Expired();
        if (asset == address(0)) revert InvalidAssetAddress();
        if (amount == 0) revert InvalidAmount();

        // Get reserve data to find variable debt token address
        (, address variableDebtTokenAddress) = _lookupReserveTokens(aavePool, asset);

        // Now call delegationWithSig on the debt token
        ICreditDelegationToken debtToken = ICreditDelegationToken(variableDebtTokenAddress);

        // Execute delegationWithSig (can be called by anyone with valid signature)
        debtToken.delegationWithSig(
            initiator(),
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );
    }

    /// @notice Supply assets to Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to supply to
    /// @param asset The address of the underlying asset to supply
    /// @param amount The amount to be supplied
    /// @dev `onBehalfOf` must have approved this contract to spend `amount` of `asset`
    function aaveSupply(
        address aavePool,
        address asset,
        uint256 amount,
        bool usePermit2
    ) external approvedAavePoolOnly(aavePool) {
        if (asset == address(0)) revert InvalidAssetAddress();

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(msg.sender, address(this), amount.toUint160(), asset);
        } else {
            // Transfer assets from the user to this contract
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }
        _aaveSupplyInternal(aavePool, asset, amount, msg.sender);     
    }

    /// @notice Supply assets to Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to supply to
    /// @param asset The address of the underlying asset to supply
    /// @param amount The amount to be supplied
    /// @param onBehalfOf The address that will spend tokens and receive aTokens
    /// @dev `onBehalfOf` must have approved this contract to spend `amount` of `asset`
    function aaveSupply(
        address aavePool,
        address asset,
        uint256 amount,
        address onBehalfOf,
        bool usePermit2
    ) external onlyUserOrActiveContext(onBehalfOf) approvedAavePoolOnly(aavePool)  {
        if (asset == address(0)) revert InvalidAssetAddress();

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(onBehalfOf, address(this), amount.toUint160(), asset);
        } else {
            // Transfer assets from the user to this contract
            IERC20(asset).safeTransferFrom(onBehalfOf, address(this), amount);
        }
        _aaveSupplyInternal(aavePool, asset, amount, onBehalfOf);     
    }

    /// @notice Withdraw assets from Aave on behalf of another user via aToken transfer
    /// @param aavePool The address of the Aave pool to withdraw from
    /// @param asset The address of the underlying asset to withdraw
    /// @param amount The amount of aTokens to transfer and withdraw
    /// @dev This is a workaround since Aave doesn't support direct withdraw on behalf
    /// @dev `user` must have approved this contract to spend their aTokens
    function aaveWithdrawOnBehalfOf(
        address aavePool,
        address asset,
        uint256 amount
    ) external approvedAavePoolOnly(aavePool)   {
        _aaveWithdrawOnBehalfOfInternal(aavePool, asset, amount, msg.sender, true);
    }

    /// @notice Withdraw assets from Aave on behalf of another user via aToken transfer
    /// @param aavePool The address of the Aave pool to withdraw from
    /// @param asset The address of the underlying asset to withdraw
    /// @param amount The amount of aTokens to transfer and withdraw
    /// @param user The address of the user on whose behalf to withdraw
    /// @param payoutToUser If true, transfer withdrawn assets to `user`
    /// @dev This is a workaround since Aave doesn't support direct withdraw on behalf
    /// @dev `user` must have approved this contract to spend their aTokens
    function aaveWithdrawOnBehalfOf(
        address aavePool,
        address asset,
        uint256 amount,
        address user,
        bool payoutToUser
    ) external onlyUserOrActiveContext(user) approvedAavePoolOnly(aavePool) {
        _aaveWithdrawOnBehalfOfInternal(aavePool, asset, amount, user, payoutToUser);
    }

    /// @notice Borrow assets from Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to borrow from
    /// @param asset The address of the underlying asset to borrow
    /// @param amount The amount to be borrowed
    /// @dev Debt is assigned to `onBehalfOf`, but borrowed assets go to `to`
    /// @dev Requires credit delegation if `onBehalfOf` != `to`
    function aaveBorrow(
        address aavePool,
        address asset,
        uint256 amount
    ) external approvedAavePoolOnly(aavePool)  {
        _aaveBorrowInternal(aavePool, asset, amount, msg.sender, true);
    }

    /// @notice Borrow assets from Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to borrow from
    /// @param asset The address of the underlying asset to borrow
    /// @param amount The amount to be borrowed
    /// @param onBehalfOf The address that will incur the debt
    /// @param payoutToUser If true, transfer borrowed assets to `onBehalfOf`
    /// @dev Debt is assigned to `onBehalfOf`, but borrowed assets go to `to`
    /// @dev Requires credit delegation if `onBehalfOf` != `to`
    function aaveBorrow(
        address aavePool,
        address asset,
        uint256 amount,
        address onBehalfOf,
        bool payoutToUser
    ) external onlyUserOrActiveContext(onBehalfOf) approvedAavePoolOnly(aavePool)  {
        _aaveBorrowInternal(aavePool, asset, amount, onBehalfOf, payoutToUser);
    }

    /// @notice Repay debt to Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to repay to
    /// @param asset The address of the underlying asset being repaid
    /// @param amount The amount to repay
    /// @param usePermit2 Whether Permit2 was used for token approvals
    /// @dev `onBehalfOf` spends their tokens to repay their own debt
    function aaveRepay(
        address aavePool,
        address asset,
        uint256 amount,
        bool usePermit2
    ) external approvedAavePoolOnly(aavePool)  {
        if (asset == address(0)) revert InvalidAssetAddress();

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(msg.sender, address(this), amount.toUint160(), asset);
        } else {
            // Transfer assets from the user to this contract
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }
        _aaveRepayInternal(aavePool, asset, amount, msg.sender);
    }

    /// @notice Repay debt to Aave on behalf of a user
    /// @param aavePool The address of the Aave pool to repay to
    /// @param asset The address of the underlying asset being repaid
    /// @param amount The amount to repay
    /// @param onBehalfOf The address that will spend tokens and whose debt will be repaid
    /// @param usePermit2 Whether Permit2 was used for token approvals
    /// @dev `onBehalfOf` spends their tokens to repay their own debt
    function aaveRepay(
        address aavePool,
        address asset,
        uint256 amount,
        address onBehalfOf,
        bool usePermit2
    ) external onlyUserOrActiveContext(onBehalfOf) approvedAavePoolOnly(aavePool)  {
        if (asset == address(0)) revert InvalidAssetAddress();

        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(onBehalfOf, address(this), amount.toUint160(), asset);
        } else {
            // Transfer assets from the user to this contract
            IERC20(asset).safeTransferFrom(onBehalfOf, address(this), amount);
        }
        _aaveRepayInternal(aavePool, asset, amount, onBehalfOf);
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Flash hook that refinances a user out of an Aave position by repaying
    ///         their debt and withdrawing their collateral.
    /// @dev Repays `input.maxInputAmount` of `input.inputToken` debt on behalf of the user,
    ///      then withdraws `input.minOutputAmount` of `input.outputToken` collateral from the pool.
    /// @param input The action hook input where:
    ///   - `user`: the borrower whose Aave position is being refinanced out
    ///   - `inputToken`: the loan asset to repay
    ///   - `maxInputAmount`: the repayment amount
    ///   - `outputToken`: the collateral token to withdraw
    ///   - `minOutputAmount`: the collateral amount to withdraw
    ///   - `targetAddress`: the Aave pool address
    function aaveRefinanceOutHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant approvedAavePoolOnly(input.targetAddress)   {
        address aavePool = input.targetAddress;
        address loanAsset = input.inputToken;
        uint256 amount = input.maxInputAmount;
        address collateralToken = input.outputToken;
        uint256 collateralAmount = input.minOutputAmount;
        address borrower = input.user;

        _aaveRepayInternal(aavePool, loanAsset, amount, borrower);
        _aaveWithdrawOnBehalfOfInternal(aavePool, collateralToken, collateralAmount, borrower, false);
    }


    /// @notice Flash hook that refinances a user into an Aave position by supplying
    ///         collateral and borrowing against it.
    /// @dev Supplies `input.maxInputAmount` of `input.inputToken` as collateral on behalf of the user,
    ///      then borrows `input.minOutputAmount` of `input.outputToken` from the pool.
    /// @param input The action hook input where:
    ///   - `user`: the borrower opening the Aave position
    ///   - `inputToken`: the collateral token to supply
    ///   - `maxInputAmount`: the collateral amount to supply
    ///   - `outputToken`: the loan asset to borrow
    ///   - `minOutputAmount`: the borrow amount
    ///   - `targetAddress`: the Aave pool address
    function aaveRefinanceInHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant approvedAavePoolOnly(input.targetAddress)  {
        address aavePool = input.targetAddress;
        address loanAsset = input.outputToken;
        uint256 amount = input.minOutputAmount;
        address collateralToken = input.inputToken;
        uint256 collateralAmount = input.maxInputAmount;
        address borrower = input.user;

        _aaveSupplyInternal(
            aavePool,
            collateralToken,
            collateralAmount,
            borrower
        );

        _aaveBorrowInternal(
            aavePool,
            loanAsset,
            amount,
            borrower,
            false
        );
    }

    /// @notice Get the available balance for a user's deposited asset in Aave
    /// @param aavePool The address of the Aave pool
    /// @param asset The address of the underlying asset
    /// @param user The address of the user to check balance for
    /// @return The user's available balance for the specified asset
    function availableFunds(
        address aavePool,
        address asset,
        address user
    ) external view returns (uint256) {
        if (aavePool == address(0)) revert InvalidAavePoolAddress();
        if (asset == address(0)) revert InvalidAssetAddress();

        (address aTokenAddress, ) = _lookupReserveTokens(aavePool, asset);
        return IERC20(aTokenAddress).balanceOf(user);
    }

    /**
     * @notice Calculate how much of a specific token a user can borrow
     * @param user The user address
     * @param asset The token address to borrow
     * @return availableAmount The maximum amount of the specific token the user can borrow
     */
    function availableBorrow(
        address aavePool,
        address asset,
        address user
    ) external view returns (uint256 availableAmount) {
        IPool pool = IPool(aavePool);
        IPoolAddressesProvider provider = IPoolAddressesProvider(pool.ADDRESSES_PROVIDER());
        IPriceOracleGetter oracle = IPriceOracleGetter(provider.getPriceOracle());
        
        // Get user's total available borrow capacity in base currency
        (,, uint256 availableBorrowsBase,,,) = pool.getUserAccountData(user);
        
        // Get the asset price in base currency
        uint256 assetPrice = oracle.getAssetPrice(asset);
        
        // Get asset decimals
        uint8 assetDecimals = ERC20(asset).decimals();
        
        // Convert base currency amount to asset amount
        if (assetPrice > 0) {
            availableAmount = (availableBorrowsBase * (10 ** assetDecimals)) / assetPrice;
        } else {
            availableAmount = 0;
        }
        
        return availableAmount;
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================

    /// @notice Generate encoded calldata for Aave interface function calls
    /// @param selector The function selector for the target Aave interface function
    /// @param aavePool The address of the Aave pool
    /// @param asset The address of the underlying asset
    /// @param user The user address for the operation
    /// @param amount The amount for the operation
    /// @param payoutUser Whether to payout to user
    /// @param data Additional calldata for the operation (currently unused)
    /// @return Encoded calldata for the specified function with provided parameters
    /// @dev Supports aaveWithdrawOnBehalfOf and aaveBorrow selectors only
    function generateCalldata(
        bytes4 selector,
        address aavePool,
        address asset,
        address user,
        uint256 amount,
        bool payoutUser,
        bytes calldata data
    ) external view returns (bytes memory) {
        if (selector == WITHDRAW_SELECTOR) {
            return abi.encodeWithSelector(selector, aavePool, asset, amount, user, payoutUser);
        } else if (selector == BORROW_SELECTOR) {
            return abi.encodeWithSelector(selector, aavePool, asset, amount, user, payoutUser);
        } else {
            revert UnsupportedSelector();
        }
    }

    /// @notice Previews an Aave refinance-in action by passing through the input/output
    ///         amounts unchanged.
    /// @dev Since Aave supply and borrow amounts are deterministic (no slippage), the
    ///      preview simply mirrors the requested amounts.
    /// @param actionHookInput The action hook input containing the collateral and borrow parameters.
    /// @return A `PreviewAction` with expected tokens/amounts matching the input and `isDeterministic` set to true.
    function previewAaveRefinanceIn(
        ActionHookInput calldata actionHookInput
    ) external view returns (PreviewAction memory) {
        if(actionHookInput.inputToken == actionHookInput.outputToken){
            revert InputOutputTokenCollision();
        }
        PreviewAction memory previewAction = PreviewAction({
            expectedInputToken: actionHookInput.inputToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: actionHookInput.outputToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });

        return previewAction;
    }

    /// @notice Previews an Aave refinance-out action by passing through the input/output
    ///         amounts unchanged.
    /// @dev Since Aave repay and withdraw amounts are deterministic (no slippage), the
    ///      preview simply mirrors the requested amounts.
    /// @param actionHookInput The action hook input containing the repayment and collateral withdrawal parameters.
    /// @return A `PreviewAction` with expected tokens/amounts matching the input and `isDeterministic` set to true.
    function previewAaveRefinanceOut(
        ActionHookInput calldata actionHookInput
    ) external view  returns (PreviewAction memory) {
        if (actionHookInput.inputToken == actionHookInput.outputToken) {
            revert InputOutputTokenCollision();
        }
        PreviewAction memory previewAction = PreviewAction({
            expectedInputToken: actionHookInput.inputToken,
            expectedInputAmount: actionHookInput.maxInputAmount,
            expectedOutputToken: actionHookInput.outputToken,
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });

        return previewAction;
    }

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    /// @notice Supply assets to Aave on behalf of a user (internal)
    /// @param aavePool_ The address of the Aave pool to supply to
    /// @param asset_ The address of the underlying asset to supply
    /// @param amount_ The amount to be supplied
    /// @param onBehalfOf_ The address that will receive aTokens
    /// @dev Assumes the diamond already holds `amount_` of `asset_`. External wrappers handle user transfers.
    function _aaveSupplyInternal(
        address aavePool_,
        address asset_,
        uint256 amount_,
        address onBehalfOf_
    ) internal {
        if (asset_ == address(0)) revert InvalidAssetAddress();
        if (amount_ == 0) revert InvalidAmount();
        if (onBehalfOf_ == address(0)) revert InvalidUserAddress();
        
        // Approve Aave pool to spend the tokens
        IERC20(asset_).forceApprove(aavePool_, amount_);
        // Get aToken address for the asset
        (address aTokenAddress, ) = _lookupReserveTokens(aavePool_, asset_);

        // Record aToken balance before supply
        uint256 aTokenBalanceBefore = IERC20(aTokenAddress).balanceOf(onBehalfOf_);
        uint256 assetBalanceBefore = IERC20(asset_).balanceOf(address(this));

        // Supply to Aave on behalf of the specified user
        IPool(aavePool_).supply(asset_, amount_, onBehalfOf_, 0);

        // Revoke approvals to Aave pool after supply
        IERC20(asset_).forceApprove(aavePool_, 0);

        // Verify aToken balance increased correctly
        uint256 aTokenBalanceAfter = IERC20(aTokenAddress).balanceOf(onBehalfOf_);
        uint256 assetBalanceAfter = IERC20(asset_).balanceOf(address(this));

        uint256 aTokenReceived = aTokenBalanceAfter - aTokenBalanceBefore;
        if (aTokenReceived + 1 < amount_ || aTokenReceived > amount_ + 1) {
            revert SupplyAmountMismatch();
        }

        if (assetBalanceBefore - assetBalanceAfter != amount_) {
            revert SupplyAssetMismatch();
        }
    }

    /// @notice Withdraw assets from Aave on behalf of another user via aToken transfer
    /// @param aavePool_ The address of the Aave pool to withdraw from
    /// @param asset_ The address of the underlying asset to withdraw
    /// @param amount_ The amount of aTokens to transfer and withdraw
    /// @param user_ The address of the user on whose behalf to withdraw
    /// @param payoutToUser_ If true, transfer withdrawn assets to `user`
    /// @dev This is a workaround since Aave doesn't support direct withdraw on behalf
    /// @dev `user` must have approved this contract to spend their aTokens
    function _aaveWithdrawOnBehalfOfInternal(
        address aavePool_,
        address asset_,
        uint256 amount_,
        address user_,
        bool payoutToUser_
    ) internal {
        if (asset_ == address(0)) revert InvalidAssetAddress();
        if (amount_ == 0) revert InvalidAmount();
        if (user_ == address(0)) revert InvalidUserAddress();

        // Get the underlying asset address from the aToken
        (address aTokenAddress, ) = _lookupReserveTokens(aavePool_, asset_);
        if (user_ != address(this)) {
            IERC20(aTokenAddress).safeTransferFrom(user_, address(this), amount_); // @dev: aTokens support ERC20Permit
        }
        uint256 aTokenBalanceBefore = IERC20(aTokenAddress).balanceOf(address(this));
        uint256 assetBalanceBefore = IERC20(asset_).balanceOf(address(this));

        // Withdraw underlying assets from Aave to the specified recipient
        uint256 withdrawalAmount = IPool(aavePool_).withdraw(asset_, amount_, address(this));

        uint256 aTokenBalanceAfter = IERC20(aTokenAddress).balanceOf(address(this));
        uint256 assetBalanceAfter = IERC20(asset_).balanceOf(address(this));

        uint256 aTokensUsed = aTokenBalanceBefore - aTokenBalanceAfter;

        if (withdrawalAmount != amount_) revert WithdrawalAmountMismatch();

        if (assetBalanceAfter - assetBalanceBefore != amount_) {
            revert WithdrawalAmountMismatch();
        }

        if (aTokensUsed < amount_) {
            IERC20(aTokenAddress).safeTransfer(user_, amount_ - aTokensUsed);
        }
        // If no further batch operations, transfer assets back to user
        if ((atomicTxInitiator() == address(0) && getFlashLoanBorrower() == address(0) && msg.sender != address(this)) || payoutToUser_) {
            IERC20(asset_).safeTransfer(user_, amount_);
        } 
    }

    /// @notice Borrow assets from Aave on behalf of a user
    /// @param aavePool_ The address of the Aave pool to borrow from
    /// @param asset_ The address of the underlying asset to borrow
    /// @param amount_ The amount to be borrowed
    /// @param onBehalfOf_ The address that will incur the debt
    /// @param payoutToUser_ If true, transfer borrowed assets to `onBehalfOf`
    /// @dev Debt is assigned to `onBehalfOf`, but borrowed assets go to `to`
    /// @dev Requires credit delegation if `onBehalfOf` != `to`
    function _aaveBorrowInternal(
        address aavePool_,
        address asset_,
        uint256 amount_,
        address onBehalfOf_,
        bool payoutToUser_
    ) internal {
        if (asset_ == address(0)) revert InvalidAssetAddress();
        if (amount_ == 0) revert InvalidAmount();
        if (onBehalfOf_ == address(0)) revert InvalidUserAddress();

        // Check credit delegation allowance if borrowing on behalf of another user
        uint256 allowance = _aaveCheckBorrowAllowance(aavePool_, asset_, 2, onBehalfOf_);
        if (allowance < amount_) revert InsufficientCreditDelegationAllowance();
        
        /// @dev function does not return actual borrow amount
        IPool(aavePool_).borrow(asset_, amount_, 2, 0, onBehalfOf_);
        if ((atomicTxInitiator() == address(0) && getFlashLoanBorrower() == address(0) && msg.sender != address(this)) || payoutToUser_) {
            // Transfer borrowed assets to the user
            IERC20(asset_).safeTransfer(onBehalfOf_, amount_);
        }
    }

    /// @notice Repay debt to Aave on behalf of a user
    /// @param aavePool_ The address of the Aave pool to repay to
    /// @param asset_ The address of the underlying asset being repaid
    /// @param amount_ The amount to repay
    /// @param onBehalfOf_ The address that will spend tokens and whose debt will be repaid
    /// @dev `onBehalfOf` spends their tokens to repay their own debt
    function _aaveRepayInternal(
        address aavePool_,
        address asset_,
        uint256 amount_,
        address onBehalfOf_
    ) internal {
        if (asset_ == address(0)) revert InvalidAssetAddress();
        if (amount_ == 0) revert InvalidAmount();
        if (onBehalfOf_ == address(0)) revert InvalidUserAddress();

        // Approve Aave pool to spend the tokens
        IERC20(asset_).forceApprove(aavePool_, amount_);

        // Repay debt on behalf of the specified user
        uint256 repaidAmount = IPool(aavePool_).repay(asset_, amount_, 2, onBehalfOf_);

        // Revoke approvals to Aave pool after repay
        IERC20(asset_).forceApprove(aavePool_, 0);

        if (repaidAmount != amount_) revert RepaidAssetsMismatch();
    }

    /// @notice Check the borrow allowance (credit delegation) for a user
    /// @param aavePool_ The address of the Aave pool
    /// @param asset_ The address of the underlying asset
    /// @param rateMode_ The interest rate mode: 1 for stable, 2 for variable
    /// @param delegator_ The address that granted the delegation
    /// @return allowance The amount that can be borrowed on behalf of delegator
    function _aaveCheckBorrowAllowance(
        address aavePool_,
        address asset_,
        uint256 rateMode_,
        address delegator_
    ) internal view returns (uint256 allowance) {
        if (asset_ == address(0)) revert InvalidAssetAddress();
        if (rateMode_ != 1 && rateMode_ != 2) revert InvalidRateMode();
        if (delegator_ == address(0)) revert InvalidDelegatorAddress();

        // Get reserve data to find debt token address
        DataTypes.ReserveData memory reserveData = IPool(aavePool_).getReserveData(asset_);

        address debtTokenAddress;
        if (rateMode_ == 1) {
            debtTokenAddress = reserveData.stableDebtTokenAddress;
        } else {
            debtTokenAddress = reserveData.variableDebtTokenAddress;
        }

        // Check allowance on the debt token
        return ICreditDelegationToken(debtTokenAddress).borrowAllowance(delegator_, address(this));
    }

    /// @notice Lookup the aToken and variable debt token addresses for a given underlying asset in Aave
    /// @param aavePool_ The address of the Aave pool
    /// @param asset_ The address of the underlying asset
    /// @return aTokenAddress The address of the corresponding aToken
    /// @return variableDebtTokenAddress The address of the corresponding variable debt token
    function _lookupReserveTokens(
        address aavePool_,
        address asset_
    ) internal view returns (address,address) {
        IPoolAddressesProvider provider = IPoolAddressesProvider(IPool(aavePool_).ADDRESSES_PROVIDER());
        IPoolDataProvider dataProvider = IPoolDataProvider(provider.getPoolDataProvider());
        (address aTokenAddress, ,address variableDebtTokenAddress) = dataProvider.getReserveTokensAddresses(asset_);
        if (aTokenAddress == address(0)) revert InvalidATokenAddress();
        if (variableDebtTokenAddress == address(0)) revert InvalidVariableDebtTokenAddress();
        return (aTokenAddress, variableDebtTokenAddress);
    }
}