//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC4626InterfaceFacet} from "../facets/ERC4626InterfaceFacet.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {LibTermStorage, TermERC4626VaultManagement, TermStorage} from "../libraries/LibTermStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestERC4626InterfaceFacetHelper
/// @notice Extends ERC4626InterfaceFacet with storage manipulation functions for testing
contract TestERC4626InterfaceFacetHelper is ERC4626InterfaceFacet {

    // ========================================================================
    // = Events for tracking stub calls =======================================
    // ========================================================================
    event SettleLimitLendCalled(address taker, uint256 fillAmount);
    event SettleLimitBorrowCalled(address taker, uint256 fillAmount);
    event SwapRepoTokenCalled(address taker, uint256 fillAmount);

    // ========================================================================
    // = Existing helpers =====================================================
    // ========================================================================

    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllerList.push(controller);
    }

    function removeAllTermControllers() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        delete ts.approvedTermControllerList;
    }

    function setUserApprovedVault(address user, address vault, bool approved) external {
        TermERC4626VaultManagement storage tevm = LibTermStorage.termERC4626VaultManagement();
        tevm.userApprovedERC4626Vaults[user][vault] = approved;
    }

    function setEip712DomainSeparator(bytes32 separator) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.eip712DomainSeparator = separator;
    }

    // ========================================================================
    // = New helpers for 5-arg overload testing ===============================
    // ========================================================================

    function setActiveSettlementMaker(address maker) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = maker;
    }

    function clearActiveSettlementMaker() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker = user, then calls 5-arg withdrawFromVault on this contract, then clears.
    function selfCallWithdrawFromVault(
        address vault,
        uint256 assets,
        address user,
        bool usePermit2,
        bool payoutToUser
    ) external returns (uint256) {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        uint256 shares = this.withdrawFromVault(vault, assets, user, usePermit2, payoutToUser);
        ts.activeSettlementMaker = address(0);
        return shares;
    }

    // ========================================================================
    // = Stub functions for fulfillOrder testing ==============================
    // ========================================================================
    // These stubs match the selectors that ERC4626InterfaceFacet calls via
    // TermLoanIntentFacet(address(this)).settleLimitLend(...) etc.

    /// @notice Stub for TermLoanIntentFacet.settleLimitLend (5-arg batch version)
    function settleLimitLend(
        ITermIntent.LimitLendOrder memory,
        address taker,
        uint256 fillAmount,
        uint256[] memory,
        ITermIntent.Signature memory
    ) external {
        emit SettleLimitLendCalled(taker, fillAmount);
    }

    /// @notice Stub for TermLoanIntentFacet.settleLimitBorrow (4-arg batch version)
    function settleLimitBorrow(
        ITermIntent.LimitBorrowOrder memory,
        address taker,
        uint256 fillAmount,
        ITermIntent.Signature memory
    ) external {
        emit SettleLimitBorrowCalled(taker, fillAmount);
    }

    /// @notice Stub for TermRepoTokenIntentFacet.swapRepoToken (4-arg batch version)
    function swapRepoToken(
        ITermIntent.RepoTokenSwapOrder memory,
        address taker,
        uint256 fillAmount,
        ITermIntent.Signature memory
    ) external {
        emit SwapRepoTokenCalled(taker, fillAmount);
    }

    // ========================================================================
    // = Balance helpers ======================================================
    // ========================================================================

    function getAssetBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
