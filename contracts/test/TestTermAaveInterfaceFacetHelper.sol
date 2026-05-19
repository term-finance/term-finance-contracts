//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermAaveInterfaceFacet} from "../facets/external/TermAaveInterfaceFacet.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestTermAaveInterfaceFacetHelper
/// @notice Extends TermAaveInterfaceFacet with storage manipulation helpers and settlement stubs for unit testing
contract TestTermAaveInterfaceFacetHelper is TermAaveInterfaceFacet {

    // ========================================================================
    // = Events for tracking stub calls =======================================
    // ========================================================================
    event SettleLimitLendCalled(address taker, uint256 fillAmount);
    event SettleLimitBorrowCalled(address taker, uint256 fillAmount);
    event SwapRepoTokenCalled(address taker, uint256 fillAmount);

    // ========================================================================
    // = Storage helpers ======================================================
    // ========================================================================

    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllerList.push(controller);
    }

    function setActiveSettlementMaker(address maker) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = maker;
    }

    function clearActiveSettlementMaker() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = address(0);
    }

    function setAtomicTxInitiator(address initiator_) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.atomicTxInitiatior = initiator_;
    }

    function clearAtomicTxInitiator() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.atomicTxInitiatior = address(0);
    }

    function setMulticallInitiator(address initiator_) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = initiator_;
    }

    function clearMulticallInitiator() external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.multicallInitiator = address(0);
    }

    function setActiveFlashLoanBorrower(address borrower) external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = borrower;
    }

    function clearActiveFlashLoanBorrower() external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = address(0);
    }

    // ========================================================================
    // = Balance helpers ======================================================
    // ========================================================================

    function getAssetBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ========================================================================
    // = Internal function exposure ===========================================
    // ========================================================================

    /// @notice Public wrapper for _aaveCheckBorrowAllowance to enable testing rateMode=1 and InvalidRateMode branches
    function testCheckBorrowAllowance(
        address pool,
        address asset,
        uint256 rateMode,
        address delegator
    ) external view returns (uint256) {
        return _aaveCheckBorrowAllowance(pool, asset, rateMode, delegator);
    }

    // ========================================================================
    // = Self-call helpers for payoutToUser=false + atomic context testing ====
    // ========================================================================

    /// @notice Sets activeSettlementMaker+atomicTxInitiator, then calls 5-arg aaveWithdrawOnBehalfOf as address(this)
    function selfCallWithdraw(
        address aavePool,
        address asset,
        uint256 amount,
        address user,
        bool payoutToUser
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        ts.atomicTxInitiatior = user;
        this.aaveWithdrawOnBehalfOf(aavePool, asset, amount, user, payoutToUser);
        ts.atomicTxInitiatior = address(0);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker+atomicTxInitiator, then calls 5-arg aaveBorrow as address(this)
    function selfCallBorrow(
        address aavePool,
        address asset,
        uint256 amount,
        address user,
        bool payoutToUser
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        ts.atomicTxInitiatior = user;
        this.aaveBorrow(aavePool, asset, amount, user, payoutToUser);
        ts.atomicTxInitiatior = address(0);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker, then calls 5-arg aaveSupply as address(this)
    /// @dev Simulates the on-chain flow where activeSettlementMaker is only reachable via an
    ///      internal self-call from retrieveFunds in TermLoanIntentFacet / TermRepoTokenIntentFacet.
    ///      atomicTxInitiator is NOT set because supply-path operations do not require it.
    function selfCallSupply(
        address aavePool,
        address asset,
        uint256 amount,
        address user,
        bool usePermit2
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        this.aaveSupply(aavePool, asset, amount, user, usePermit2);
        ts.activeSettlementMaker = address(0);
    }

    // ========================================================================
    // = Stub functions for fulfillOrder testing ==============================
    // ========================================================================

    /// @notice Stub for TermLoanIntentFacet.settleLimitLend
    function settleLimitLend(
        ITermIntent.LimitLendOrder memory,
        address taker,
        uint256 fillAmount,
        uint256[] memory,
        ITermIntent.Signature memory
    ) external {
        emit SettleLimitLendCalled(taker, fillAmount);
    }

    /// @notice Stub for TermLoanIntentFacet.settleLimitBorrow
    function settleLimitBorrow(
        ITermIntent.LimitBorrowOrder memory,
        address taker,
        uint256 fillAmount,
        ITermIntent.Signature memory
    ) external {
        emit SettleLimitBorrowCalled(taker, fillAmount);
    }

    /// @notice Stub for TermRepoTokenIntentFacet.swapRepoToken
    function swapRepoToken(
        ITermIntent.RepoTokenSwapOrder memory,
        address taker,
        uint256 fillAmount,
        ITermIntent.Signature memory
    ) external {
        emit SwapRepoTokenCalled(taker, fillAmount);
    }
}
