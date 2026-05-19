//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermMorphoInterfaceFacet} from "../facets/external/TermMorphoInterfaceFacet.sol";
import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MarketParams} from "@morpho-org/morpho-blue/src/interfaces/IMorpho.sol";

/// @title TestTermMorphoInterfaceFacetHelper
/// @notice Extends TermMorphoInterfaceFacet with storage manipulation helpers and settlement stubs for unit testing
contract TestTermMorphoInterfaceFacetHelper is TermMorphoInterfaceFacet {

    // ========================================================================
    // = Events for tracking stub calls =======================================
    // ========================================================================
    event SettleLimitLendCalled(address taker, uint256 fillAmount);
    event SettleLimitBorrowCalled(address taker, uint256 fillAmount);
    event SwapRepoTokenCalled(address taker, uint256 fillAmount);

    constructor(address morphoPool_) TermMorphoInterfaceFacet(morphoPool_) {}

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
    // = Internal function exposure wrappers ==================================
    // ========================================================================

    function testSupplyCollateralInternal(
        address pool,
        MarketParams memory mp,
        uint256 assets,
        address user,
        bool permit2
    ) external {
        _morphoSupplyCollateralInternal(pool, mp, assets, user);
    }

    function testSupplyInternal(
        address pool,
        MarketParams memory mp,
        uint256 assets,
        address user,
        bool permit2
    ) external {
        _morphoSupplyInternal(pool, mp, assets, user, permit2);
    }

    function testWithdrawCollateralInternal(
        address pool,
        MarketParams memory mp,
        uint256 assets,
        address user,
        bool payout
    ) external {
        _morphoWithdrawCollateralInternal(pool, mp, assets, user, payout);
    }

    function testBorrowInternal(
        address pool,
        MarketParams memory mp,
        uint256 assets,
        address user,
        bool payout
    ) external {
        _morphoBorrowInternal(pool, mp, assets, user, payout);
    }

    function testRepayInternal(
        address pool,
        MarketParams memory mp,
        uint256 assets,
        address user
    ) external {
        _morphoRepayInternal(pool, mp, assets, user);
    }

    // ========================================================================
    // = Self-call helpers for payoutUser=false + atomic context testing ======
    // ========================================================================

    /// @notice Sets activeSettlementMaker+atomicTxInitiator, then calls 5-arg morphoWithdrawCollateral
    function selfCallWithdrawCollateral(
        address pool,
        MarketParams calldata mp,
        uint256 assets,
        address user,
        bool payoutUser
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        ts.atomicTxInitiatior = user;
        this.morphoWithdrawCollateral(pool, mp, assets, user, payoutUser);
        ts.atomicTxInitiatior = address(0);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker+atomicTxInitiator, then calls 5-arg morphoBorrow
    function selfCallBorrow(
        address pool,
        MarketParams calldata mp,
        uint256 assets,
        address user,
        bool payoutUser
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        ts.atomicTxInitiatior = user;
        this.morphoBorrow(pool, mp, assets, user, payoutUser);
        ts.atomicTxInitiatior = address(0);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker, then calls 5-arg morphoSupplyCollateral as address(this)
    /// @dev Simulates the on-chain flow where activeSettlementMaker is only reachable via an
    ///      internal self-call from retrieveFunds in TermLoanIntentFacet / TermRepoTokenIntentFacet.
    ///      atomicTxInitiator is NOT set because supply-path operations do not require it.
    function selfCallSupplyCollateral(
        address pool,
        MarketParams calldata mp,
        uint256 assets,
        address user,
        bool usePermit2
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        this.morphoSupplyCollateral(pool, mp, assets, user, usePermit2);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker, then calls 5-arg morphoSupply as address(this)
    /// @dev Simulates the on-chain flow where activeSettlementMaker is only reachable via an
    ///      internal self-call from retrieveFunds in TermLoanIntentFacet / TermRepoTokenIntentFacet.
    ///      atomicTxInitiator is NOT set because supply-path operations do not require it.
    function selfCallSupply(
        address pool,
        MarketParams calldata mp,
        uint256 assets,
        address user,
        bool usePermit2
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        this.morphoSupply(pool, mp, assets, user, usePermit2);
        ts.activeSettlementMaker = address(0);
    }

    /// @notice Sets activeSettlementMaker, then calls 5-arg morphoRepay as address(this)
    /// @dev Simulates the on-chain flow where activeSettlementMaker is only reachable via an
    ///      internal self-call from retrieveFunds in TermLoanIntentFacet / TermRepoTokenIntentFacet.
    ///      atomicTxInitiator is NOT set because repay-path operations do not require it.
    function selfCallRepay(
        address pool,
        MarketParams calldata mp,
        uint256 assets,
        address user,
        bool usePermit2
    ) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeSettlementMaker = user;
        this.morphoRepay(pool, mp, assets, user, usePermit2);
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
