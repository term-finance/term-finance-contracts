//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermAtomicTxProtection} from "./base/TermAtomicTxProtection.sol";
import {ITermController} from "../interfaces/ITermController.sol";
import {ActionHookInput} from "../lib/ActionHookInput.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {LibTermStorage, TermERC4626VaultManagement, TermStorage} from "../libraries/LibTermStorage.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

import {TermFlashHookFacet} from "./base/TermFlashHookFacet.sol";
import {TermMultiContextAuth} from "./base/TermMultiContextAuth.sol";

/// @author TermLabs  
/// @title ERC4626InterfaceFacet Facet
/// @notice This facet provides deposit and withdrawal functions for ERC4626 vaults
/// @dev This facet allows the TermDiamond to interact with ERC4626 compliant vaults
contract ERC4626InterfaceFacet is ReentrancyGuard, TermFlashHookFacet, TermAtomicTxProtection, TermMultiContextAuth  {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    
    // ========================================================================
    // = Custom Errors  =======================================================
    // ========================================================================
    
    error AssetsMismatch();
    error ExpiredSignature();
    error IncorrectTargetAsset();
    error InvalidSignature();
    error InvalidVaultAsset();
    error NoAssetsReceived();
    error NoSharesReceived();
    error SharesMismatch();
    error UnapprovedVault();
    error UnsupportedSelector();
    error VaultAlreadyApproved();
    error VaultNotApproved();

    // ========================================================================
    // = Constants  ===========================================================
    // ========================================================================

    bytes4 public constant WITHDRAW_SELECTOR = bytes4(keccak256("withdrawFromVault(address,uint256,address,bool,bool)"));

    bytes32 public constant VAULT_APPROVAL_TYPEHASH = keccak256("VaultApproval(address vault,address user,uint256 deadline)");


    // ========================================================================
    // = Modifiers ============================================================
    // ========================================================================

    /// @notice Modifier to ensure vault is approved for use (either by Term or by specific user)
    /// @param vault The address of the ERC4626 vault to check
    /// @param user The address of the user to check for vault approval
    modifier approvedERC4626VaultOnly(address vault, address user) {
        TermERC4626VaultManagement storage tevm = LibTermStorage.termERC4626VaultManagement();
        TermStorage storage ts = LibTermStorage.termStorage();

        // Check if vault is approved by any Term controller
        bool isTermApproved;
        for (uint8 i = 0; i < ts.approvedTermControllerList.length; ++i) {
            if (ITermController(ts.approvedTermControllerList[i]).isTermApproved(vault)) {
                isTermApproved = true;
                break;
            }
        }

        // Check if vault is term approved OR user approved
        if (!isTermApproved && !tevm.userApprovedERC4626Vaults[user][vault]) {
            revert UnapprovedVault();
        }

        _;
    }

    // ========================================================================
    // = Deploy ===============================================================
    // ========================================================================
    constructor() {
        previewMapping[this.depositToVaultHook.selector] = this.previewDeposit.selector;
        previewMapping[this.redeemFromVaultHook.selector] = this.previewRedeem.selector;
    }
    
    // ========================================================================
    // = Vault Functions  =====================================================
    // ========================================================================

    /// @notice Deposit assets into an ERC4626 vault
    /// @notice Consider using previewDeposit() before calling this function to account for potential slippage
    /// @param vault The address of the ERC4626 vault contract
    /// @param assets The amount of assets to deposit
    /// @param usePermit2 Whether Permit2 was used for approval
    /// @return shares The amount of shares minted
    function depositToVault(
        address vault,
        uint256 assets,
        bool usePermit2
    ) external nonReentrant approvedERC4626VaultOnly(vault, msg.sender) returns (uint256) {
        IERC4626 vaultContract = IERC4626(vault);
        IERC20 asset = IERC20(vaultContract.asset());

        if (usePermit2) {
            // Approve via Permit2
            Permit2Lib.PERMIT2.transferFrom(
                msg.sender,
                address(this),
                assets.toUint160(),
                address(asset)
            );
        } else {
            // Transfer assets from user to this contract
            asset.safeTransferFrom(msg.sender, address(this), assets);
        }
        
        return _depositToVault(vault, address(asset), assets, msg.sender);
    }

    /// @notice Withdraw assets from an ERC4626 vault
    /// @notice This function uses previewWithdraw() to calculate required shares and account for potential slippage
    /// @param vault The address of the ERC4626 vault contract
    /// @param assets The amount of assets to withdraw
    /// @param usePermit2 Whether Permit2 was used for approval
    /// @return shares The amount of shares burned
    function withdrawFromVault(
        address vault,
        uint256 assets,
        bool usePermit2
    ) external nonReentrant approvedERC4626VaultOnly(vault, msg.sender) returns (uint256) {
        return _withdrawFromVault(vault, assets, msg.sender, msg.sender, usePermit2);
    }

    /// @notice Withdraw assets from an ERC4626 vault
    /// @notice This function uses previewWithdraw() to calculate required shares and account for potential slippage
    /// @param vault The address of the ERC4626 vault contract
    /// @param assets The amount of assets to withdraw
    /// @param user The user address for share source
    /// @param usePermit2 Whether Permit2 was used for approval
    /// @param payoutToUser If true, assets are sent to user; if false, assets are sent to this contract
    /// @return shares The amount of shares burned
    function withdrawFromVault(
        address vault,
        uint256 assets,
        address user,
        bool usePermit2,
        bool payoutToUser
    ) external onlyUserOrActiveContext(user) approvedERC4626VaultOnly(vault, user) returns (uint256) {
        address receiver = msg.sender != address(this) || payoutToUser ? user : address(this);
        
        return _withdrawFromVault(vault, assets, user, receiver, usePermit2);
    }

    /// @notice Redeem shares from an ERC4626 vault
    /// @notice This function burns exact shares and returns the corresponding assets
    /// @param vault The address of the ERC4626 vault contract
    /// @param shares The amount of shares to redeem
    /// @param usePermit2 Whether Permit2 was used for approval
    /// @return assets The amount of assets received
    function redeemFromVault(
        address vault,
        uint256 shares,
        bool usePermit2
    ) external nonReentrant approvedERC4626VaultOnly(vault, msg.sender) returns (uint256) {
        IERC20 vaultToken = IERC20(vault);

        if (usePermit2) {
            // Approve via Permit2
            Permit2Lib.PERMIT2.transferFrom(
                msg.sender,
                address(this),
                shares.toUint160(),
                address(vaultToken)
            );
        } else {
            // Transfer shares from user to this contract
            vaultToken.safeTransferFrom(msg.sender, address(this), shares);
        }
        
        return _redeemFromVaultInternal(vault, shares, msg.sender);
    }

    // ========================================================================
    // = Flash Hook Actions  ==================================================
    // ========================================================================

    /// @notice Deposit assets into an ERC4626 vault via flash loan hook context
    /// @dev Shares are sent to this contract (the diamond). Only callable within a flash loan context.
    /// @param input The action hook input containing user, target vault address, and deposit amount
    /// @return The amount of shares minted
    function depositToVaultHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant approvedERC4626VaultOnly(input.targetAddress, input.user) returns (uint256) {
        if (input.inputToken != IERC4626(input.targetAddress).asset()) {
            revert InvalidVaultAsset();
        }
        return _depositToVault(input.targetAddress, input.inputToken, input.maxInputAmount, address(this));
    }


    /// @notice Redeem shares from an ERC4626 vault via flash loan hook context
    /// @dev Assets are sent to this contract (the diamond). Only callable within a flash loan context.
    /// @param input The action hook input containing user, target vault address, and shares to redeem
    /// @return The amount of assets received
    function redeemFromVaultHook(
        ActionHookInput calldata input
    ) external onlyFlashLoanContext(input.user) nonReentrant approvedERC4626VaultOnly(input.targetAddress, input.user)  returns (uint256) {

        return _redeemFromVaultInternal(input.targetAddress, input.maxInputAmount, address(this));
    }

    // ========================================================================
    // = Utility Functions  ===================================================
    // ========================================================================
    
    /// @notice Generate calldata for ERC4626 vault operations
    /// @param selector The function selector to generate calldata for
    /// @param vault The address of the ERC4626 vault contract
    /// @param asset The address of the asset token (unused in current implementation)
    /// @param user The user address for the operation
    /// @param amount The amount of assets or shares
    /// @param payoutUser If true, assets are sent to user; if false, assets are sent to this contract
    /// @param data Additional calldata (unused in current implementation)
    /// @return The encoded function calldata
    function generateCalldata(
        bytes4 selector,
        address vault,
        address asset,
        address user,
        uint256 amount,
        bool payoutUser,
        bytes calldata data
    ) external view returns (bytes memory) {
        if (selector == WITHDRAW_SELECTOR) {
            if (asset != IERC4626(vault).asset()) {
                revert IncorrectTargetAsset();
            }
            return abi.encodeWithSelector(selector, vault, amount, user, false, payoutUser);
        } 
        else {
            revert UnsupportedSelector();
        }
    }

    /// @notice Previews an ERC4626 deposit by computing the underlying asset amount
    ///         required to mint the desired number of vault shares.
    /// @dev Uses `vault.previewMint` to determine the deposit amount for
    ///      `actionHookInput.minOutputAmount` shares. Reverts if the vault's underlying
    ///      asset is the vault itself.
    /// @param actionHookInput The action hook input where:
    ///   - `targetAddress`: the ERC4626 vault address
    ///   - `minOutputAmount`: the desired number of vault shares to mint
    /// @return A `PreviewAction` with the vault's underlying asset as input, vault shares
    ///         as output, and `isDeterministic` set to true.
    function previewDeposit(ActionHookInput calldata actionHookInput) external view returns (PreviewAction memory){
        IERC4626 vault = IERC4626(actionHookInput.targetAddress);
        if (vault.asset() == address(vault)) {
            revert InputOutputTokenCollision();
        }
        uint256 depositAmount = vault.previewMint(actionHookInput.minOutputAmount);
        return PreviewAction({
            expectedInputToken: vault.asset(),
            expectedInputAmount: depositAmount,
            expectedOutputToken: address(vault),
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
    }

    /// @notice Previews an ERC4626 redemption by computing the number of vault shares
    ///         required to withdraw the desired amount of underlying assets.
    /// @dev Uses `vault.previewWithdraw` to determine the shares needed for
    ///      `actionHookInput.minOutputAmount` of the underlying asset. Reverts if the
    ///      vault's underlying asset is the vault itself.
    /// @param actionHookInput The action hook input where:
    ///   - `targetAddress`: the ERC4626 vault address
    ///   - `minOutputAmount`: the desired amount of underlying asset to withdraw
    /// @return A `PreviewAction` with vault shares as input, the vault's underlying asset
    ///         as output, and `isDeterministic` set to true.
    function previewRedeem(ActionHookInput calldata actionHookInput) external view returns (PreviewAction memory) {
        IERC4626 vault = IERC4626(actionHookInput.targetAddress);
        if (vault.asset() == address(vault)) {
            revert InputOutputTokenCollision();
        }
        uint256 redeemShares = vault.previewWithdraw(actionHookInput.minOutputAmount);
        return PreviewAction({
            expectedInputToken: address(vault),
            expectedInputAmount: redeemShares,
            expectedOutputToken: vault.asset(),
            expectedOutputAmount: actionHookInput.minOutputAmount,
            isDeterministic: true
        });
    }

    /// @notice Approve an ERC4626 vault for individual user access via signature
    /// @param vault The address of the ERC4626 vault to approve
    /// @param deadline The signature expiry timestamp
    /// @param sigData The EIP-712 signature payload for approval
    function userApproveVault(
        address vault,
        uint256 deadline,
        bytes calldata sigData
    ) external {
        if (block.timestamp > deadline) {
            revert ExpiredSignature();
        }

        TermERC4626VaultManagement storage tevm = LibTermStorage.termERC4626VaultManagement();
        if (tevm.userApprovedERC4626Vaults[msg.sender][vault]) {
            revert VaultAlreadyApproved();
        }
        
        bytes32 structHash = keccak256(abi.encode(
            VAULT_APPROVAL_TYPEHASH,
            vault,
            msg.sender,
            deadline
        ));

        TermStorage storage ts = LibTermStorage.termStorage();
        
        bytes32 digest = keccak256(abi.encodePacked(
            hex"1901",
            ts.eip712DomainSeparator,
            structHash
        ));
        
        (uint8 v, bytes32 r, bytes32 s) = abi.decode(sigData, (uint8, bytes32, bytes32));
        address signer =  ECDSA.recover(digest, v, r, s);
        if (signer != msg.sender) {
            revert InvalidSignature();
        }
        
        tevm.userApprovedERC4626Vaults[msg.sender][vault] = true;
    }

    /// @notice Revoke approval of an ERC4626 vault for individual user access
    /// @param vault The address of the ERC4626 vault to revoke
    function userRevokeVault(
        address vault
    ) external {
        TermERC4626VaultManagement storage tevm = LibTermStorage.termERC4626VaultManagement();
        if (!tevm.userApprovedERC4626Vaults[msg.sender][vault]) {
            revert VaultNotApproved();
        }
        tevm.userApprovedERC4626Vaults[msg.sender][vault] = false;
    } 

    // ========================================================================
    // = Internal Functions  ==================================================
    // ========================================================================

    /// @notice Internal function to deposit assets into an ERC4626 vault
    /// @dev Handles the deposit process including asset transfer, validation, and share issuance
    /// @param vault_ The address of the ERC4626 vault contract
    /// @param assetToken_ The address of the vault's underlying asset token
    /// @param assetAmount_ The amount of assets to deposit
    /// @param receiver_ The address that will receive the vault shares
    /// @return shares The amount of shares minted
    function _depositToVault(
        address vault_,
        address assetToken_,
        uint256 assetAmount_,
        address receiver_
    ) internal returns (uint256) {
        IERC4626 vaultContract = IERC4626(vault_);
        IERC20 asset = IERC20(assetToken_);
        IERC20 vaultToken = IERC20(vault_);

        // Track receiver's share balance to ensure shares are received
        uint256 preShareBalance = vaultToken.balanceOf(receiver_);

        // Track contract's asset balance BEFORE deposit to ensure all assets are consumed
        uint256 preContractAssetBalance = asset.balanceOf(address(this));

        // Approve vault to spend assets
        asset.forceApprove(vault_, assetAmount_);

        // Deposit assets and receive shares
        uint256 shares = vaultContract.deposit(assetAmount_, receiver_);

        // Revoke approval to vault after deposit
        asset.forceApprove(vault_, 0);

        uint256 postShareBalance = vaultToken.balanceOf(receiver_);
        uint256 postContractAssetBalance = asset.balanceOf(address(this));

        // Ensure receiver actually got shares and prevent asset theft
        if (postShareBalance <= preShareBalance) {
            revert NoSharesReceived();
        }

        // Validate returned shares match actual balance increase
        uint256 actualSharesReceived = postShareBalance - preShareBalance;
        if (shares != actualSharesReceived) {
            revert SharesMismatch();
        }

        // Validate exact amount of assets were consumed by the vault
        uint256 actualAssetsConsumed = preContractAssetBalance - postContractAssetBalance;
        if (actualAssetsConsumed != assetAmount_) {
            revert AssetsMismatch();
        }

        return shares;
    }

    /// @notice Internal function to withdraw assets from an ERC4626 vault
    /// @dev Handles the withdrawal process including share transfer, validation, and asset redemption
    /// @param vault_ The address of the ERC4626 vault contract
    /// @param assets_ The amount of assets to withdraw
    /// @param user_ The address whose shares will be used for withdrawal
    /// @param receiver_ The address that will receive the withdrawn assets
    /// @param usePermit2_ Whether to use Permit2 for share transfer approval
    /// @return shares amount of shares that were burned in the withdrawal
    function _withdrawFromVault(
        address vault_,
        uint256 assets_,
        address user_,
        address receiver_,
        bool usePermit2_
    ) internal returns (uint256) {
        IERC4626 vaultContract = IERC4626(vault_);
        IERC20 vaultToken = IERC20(vault_);
        IERC20 asset = IERC20(vaultContract.asset());

        // Track receiver's asset balance to ensure assets are received
        uint256 preAssetBalance = asset.balanceOf(receiver_);

        uint256 sharesToRedeem = vaultContract.previewWithdraw(assets_);
        if (user_ != address(this)){  
            if (usePermit2_) {
                // Approve via Permit2
                Permit2Lib.PERMIT2.transferFrom(
                    user_,
                    address(this),
                    sharesToRedeem.toUint160(),
                    address(vaultToken)
                );
            } else {
                // Transfer shares from user to this contract
                vaultToken.safeTransferFrom(user_, address(this), sharesToRedeem);
            }
        }

        // Track facet's share balance AFTER transfer but BEFORE withdrawal
        uint256 preShareBalance = vaultToken.balanceOf(address(this));

        vaultToken.forceApprove(vault_, sharesToRedeem);

        // Withdraw assets and burn shares
        uint256 shares = vaultContract.withdraw(assets_, receiver_, address(this));

        vaultToken.forceApprove(vault_, 0);

        uint256 postAssetBalance = asset.balanceOf(receiver_);
        uint256 postShareBalance = vaultToken.balanceOf(address(this));
        
        // Ensure receiver actually got assets and prevent share theft
        if (postAssetBalance <= preAssetBalance) {
            revert NoAssetsReceived();
        }
        
        // Validate requested assets match actual balance increase
        uint256 actualAssetsReceived = postAssetBalance - preAssetBalance;
        if (assets_ != actualAssetsReceived) {
            revert AssetsMismatch();
        }
        
        // Validate returned shares match actual shares burned
        uint256 actualSharesBurned = preShareBalance - postShareBalance;
        if (shares != actualSharesBurned) {
            revert SharesMismatch();
        }

        if (actualSharesBurned < sharesToRedeem) {
            vaultToken.safeTransfer(user_, sharesToRedeem - actualSharesBurned);
        }
        
        return shares;
    }  

    /// @notice Internal function to redeem shares from an ERC4626 vault
    /// @dev Handles the redemption process including share transfer, validation, and asset withdrawal
    /// @param vault_ The address of the ERC4626 vault contract
    /// @param shares_ The amount of shares to redeem
    /// @param receiver_ The address that will receive the assets
    /// @return assets The amount of assets received
    function _redeemFromVaultInternal(
        address vault_,
        uint256 shares_,
        address receiver_
    ) internal returns (uint256) {
        IERC4626 vaultContract = IERC4626(vault_);
        IERC20 vaultToken = IERC20(vault_);
        IERC20 assetToken = IERC20(vaultContract.asset());

        // Track receiver's asset balance to ensure assets are received
        uint256 preAssetBalance = assetToken.balanceOf(receiver_);

        // Track facet's share balance AFTER transfer but BEFORE redeem
        uint256 preShareBalance = vaultToken.balanceOf(address(this));

        vaultToken.forceApprove(vault_, shares_);

        // Redeem shares for assets
        uint256 assets = vaultContract.redeem(shares_, receiver_, address(this));

        vaultToken.forceApprove(vault_, 0);


        uint256 postAssetBalance = assetToken.balanceOf(receiver_);
        uint256 postShareBalance = vaultToken.balanceOf(address(this));

        // Ensure receiver actually got assets and prevent share theft
        if (postAssetBalance <= preAssetBalance) {
            revert NoAssetsReceived();
        }

        // Validate actual assets received match expected
        uint256 actualAssetsReceived = postAssetBalance - preAssetBalance;
        if (assets != actualAssetsReceived) {
            revert AssetsMismatch();
        }

        // Validate exact shares were burned
        uint256 actualSharesBurned = preShareBalance - postShareBalance;
        if (shares_ != actualSharesBurned) {
            revert SharesMismatch();
        }

        return assets;
    }
}