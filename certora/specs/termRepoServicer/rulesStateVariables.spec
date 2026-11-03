import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "./stateVariables.spec";

methods {
    function upgradeToAndCall(address,bytes) external => NONDET DELETE;
    function _.usdValueOfTokens(address,uint256) external => NONDET DELETE;
    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;

    // // TermRepoToken
    // function _.totalRedemptionValue() external => DISPATCHER(true);
    // function _.redemptionValue() external => DISPATCHER(true);
    // function _.burnAndReturnValue(address,uint256) external => DISPATCHER(true);
    // function _.mintRedemptionValue(address,uint256) external => DISPATCHER(true);
    // function _.mintTokens(address,uint256) external => DISPATCHER(true);
    // function _.decrementMintExposureCap(uint256) external => DISPATCHER(true);
    // function _.burn(address,uint256) external => DISPATCHER(true);

    // TermRepoLocker
    // function _.transferTokenFromWallet(address,address,uint256) external => DISPATCHER(true);
    // function _.transferTokenToWallet(address,address,uint256) external => DISPATCHER(true);

    // TermController
    function _.getTreasuryAddress() external => ALWAYS(100);
    function _.getProtocolReserveAddress() external => ALWAYS(100);
    // TermRepoToken's mintTokens/mintRedemptionValue/burnAndReturnValue call
    // ITermRepoServicer(config.termRepoServicer).termController(); config.termRepoServicer is a
    // struct member so link can't resolve it -> termController() autohavocs. Dispatch it to the
    // in-scene servicer (which reads its linked TermController) to kill the havoc.
    function _.termController() external => DISPATCHER(true);
    // Same struct-field issue for termContractsPaused() reached via the unresolvable servicer
    // reference; dispatch to the in-scene controller to kill autohavocs at all sites.
    function _.termContractsPaused() external => DISPATCHER(true);

    // The induction step for the parametric state-variable rules (esp. the exposure-sum invariant) is slow on
    // submitRepurchasePayment/burnCollapseExposure because their bodies carry assert(_isTermRepoBalanced()) plus
    // nonlinear repayment/burn math. None of the state-variable rules here depend on the *values* these produce:
    //  - the exposure-sum invariant is preserved because ledger and totalOutstanding move by the SAME amount;
    //  - totalRepurchaseCollected<=lockerBalance moves both sides in lockstep (and filters out the address-overloads);
    //  - the rest are method-identity / overflow / unrelated-variable checks.
    // So summarize the balance assert as true and abstract the two value-producers (safe over-approximations that
    // can only widen behavior, never violate a safety invariant) to make the induction step tractable.
    function TermRepoServicer._isTermRepoBalanced() internal returns (bool) => alwaysTermRepoBalanced();
    function TermRepoServicer._getMaxRepaymentAroundRollover(address) internal returns (uint256) => NONDET;
    function _.burnAndReturnValue(address,uint256) external => NONDET;
    // submit/burn -> collateralManager.unlockCollateralOnRepurchase loops over collateral tokens and transfers
    // each out of the locker, the dominant path-count blowup. It only touches collateral-manager/locker collateral
    // storage (not the servicer purchase-side state vars these rules track, nor the purchase-token locker balance),
    // and the servicer ledger/total are decremented before it runs, so NONDET-ing it is safe for every rule here.
    // The wildcard external summary does not bind on the linked collateral-manager call; the real branching is the
    // internal _unlockCollateral (try/catch transfer + SafeERC20._callOptionalReturn) reached through it, so NONDET
    // that internal function (binds across the linked contract like mul_/div_). It only touches collateral-side
    // storage / collateral-token transfers, which no state-variable rule here asserts on.
    function _.unlockCollateralOnRepurchase(address) external => NONDET;
    function _._unlockCollateral(address,address,uint256,bool) internal => NONDET;
    // Minting analog: mintOpenExposure(address,...)/mintOpenExposureFromIntent call the servicer-internal
    // _handleCollateral, which loops over collateral tokens locking collateral (transfers + oracle math) -- the
    // path-count source for the induction step on mint. It only touches collateral-side state / returns a max-mint
    // gate; the servicer ledger/total are incremented by the mintTokens value in lockstep regardless, so NONDET it.
    function TermRepoServicer._handleCollateral(address,address,uint256,uint256[] calldata) internal returns (uint256) => NONDET;
    // fulfillBid -> journalBidCollateralToCollateralManager double loop (inner _encumberExistingCollateralInternal +
    // outer journal loop) only updates collateral-manager ledger/encumbered state; the servicer ledger/total are
    // changed by fulfillBid itself in lockstep, so NONDET-ing these is safe for every state-variable rule here.
    function _._encumberExistingCollateralInternal(address) internal => NONDET;
    function _.journalBidCollateralToCollateralManager(address,address[],uint256[]) external => NONDET;


    // // TermRepoRolloverManager
    // function _.getRolloverInstructions(address) external => DISPATCHER(true);
    // function _.fulfillRollover(address) external => DISPATCHER(true);

    // // TermRepoCollateralManager
    // function _.numOfAcceptedCollateralTokens() external => DISPATCHER(true);
    // function _.collateralTokens() external => DISPATCHER(true);
    // function _.collateralTokens(uint256) external => DISPATCHER(true);
    // function _.calculateMintableExposure(address,uint256) external => DISPATCHER(true);
    // function _.encumberedCollateralRemaining() external => DISPATCHER(true);
    // function _.unlockCollateralOnRepurchase(address) external => DISPATCHER(true);
    // function _.journalBidCollateralToCollateralManager(address,address[],uint256[]) external => DISPATCHER(true);
    // function _.mintOpenExposureLockCollateral(address,address,uint256) external => DISPATCHER(true);
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}

function alwaysTermRepoBalanced() returns bool {
    return true;
}

use invariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

use rule onlyAllowedMethodsMayChangeTotalOutstandingRepurchaseExposure;
use rule totalOutstandingRepurchaseExposureNeverOverflows;
use rule onlyAllowedMethodsMayChangeTotalRepurchaseCollected;
use rule totalRepurchaseCollectedNeverOverflows;
use rule shortfallHaircutMantissaAlwaysZeroBeforeRedemptionAndLessThanExpScaleAfter;
use rule totalRepurchaseCollectedLessThanOrEqualToLockerPurchaseTokenBalance;
use rule noMethodsChangeMaturityTimestamp;
use rule noMethodsChangeEndOfRepurchaseWindow;
use rule noMethodsChangeRedemptionTimestamp;
use rule noMethodsChangeServicingFee;
use rule onlyAllowedMethodsChangeShortfallHaircutMantissa;
use rule noMethodChangesPurchaseToken;
use rule onlyAllowedMethodsMayChangeTermContracts;
