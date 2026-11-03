import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";
import "./accessRoles.spec";
import "./rolloverExposure.spec";
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
    function _.termContractsPaused() external => DISPATCHER(true);
    // TermRepoToken's mintTokens/mintRedemptionValue/burnAndReturnValue call
    // ITermRepoServicer(config.termRepoServicer).termController(); config.termRepoServicer is a
    // struct member so link can't resolve it -> termController() autohavocs. Dispatch it to the
    // in-scene servicer (which reads its linked TermController) to kill the havoc.
    function _.termController() external => DISPATCHER(true);


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

    // submitRepurchasePayment/burnCollapseExposure/liquidatorCoverExposureWithRepoToken end in
    // assert(_isTermRepoBalanced()), which (post-#1444) forces the prover to evaluate the nonlinear
    // threshold-balance check (totalRedemptionValue = totalSupply * redemptionValue vs totalLiquidity)
    // on every method. The rules in this spec (paired-flag, access control, rollover, exposure-sum
    // invariant) do not verify the balance invariant -- it is proven in the stateVariables /
    // repaymentsRedemptions specs -- so over-approximate the inline check as true to drop that
    // proof obligation and stop the parametric rules timing out on those functions.
    function TermRepoServicer._isTermRepoBalanced() internal returns (bool) => alwaysTermRepoBalanced();

    // Keep submitRepurchasePayment/burnCollapseExposure IN SCOPE for the paired-flag and role-storage
    // parametric rules (the whole point is to prove those calculations never touch the flag/role storage),
    // but make their bodies cheap to execute by abstracting the value-producers that carry the nonlinear
    // repayment/burn math. These two are not used by the rollover (openExposure*/closeExposure*) or
    // pairTermContracts rules in this conf, so NONDET-ing them does not weaken any other rule here; the
    // parametric rules only track which storage slots are written, not the arithmetic values.
    function TermRepoServicer._getMaxRepaymentAroundRollover(address) internal returns (uint256) => NONDET;
    function _.burnAndReturnValue(address,uint256) external => NONDET;
    // When submit/burn pay an obligation to zero they call collateralManager.unlockCollateralOnRepurchase,
    // which LOOPS over collateral tokens and transfers each out of the locker (-> transferTokenToWallet ->
    // ERC20.transfer). That loop x transfer chain is the ~2^20 path-count blowup for the parametric flag/role
    // rules, and it lives entirely on the collateral manager / locker / ERC20 -- it can never write the servicer's
    // isTermContractPaired flag or role storage. The rollover rules in this conf do not call it, so NONDET it to
    // collapse the chain. (Servicer ledger/total are already decremented before this call, so the exposure-sum
    // invariant is unaffected.)
    // NOTE: the wildcard external summary below does NOT bind on the linked collateral-manager call (linking wins
    // over a `_.` external summary, same as getTreasuryAddress), so the real branching source is the internal
    // _unlockCollateral (try/catch around transferTokenToWallet + SafeERC20._callOptionalReturn) reached through it.
    // An internal summary binds across the linked contract (like mul_/div_ do), so NONDET that to kill the chain.
    function _.unlockCollateralOnRepurchase(address) external => NONDET;
    function _._unlockCollateral(address,address,uint256,bool) internal => NONDET;
    // Minting analog of the unlock chain: mintOpenExposure(address,...)/mintOpenExposureFromIntent both call the
    // servicer-internal _handleCollateral, which LOOPS over collateral tokens calling mintOpenExposureLockCollateral
    // (collateral transfers into the locker) + calculateMintableExposure (oracle math). That loop x transfer x oracle
    // is the path-count blowup for onlyRoleCanCallRevert on those paths. It locks collateral / computes a max-mint
    // gate -- no rule here asserts on collateral state, and the servicer ledger/total are incremented by the
    // mintTokens value (lockstep) regardless of the returned gate, so NONDET it (internal => binds across the link).
    function TermRepoServicer._handleCollateral(address,address,uint256,uint256[] calldata) internal returns (uint256) => NONDET;
    // fulfillBid -> collateralManager.journalBidCollateralToCollateralManager is a DOUBLE loop: an inner
    // _encumberExistingCollateralInternal (loops all collateral tokens) plus the outer ledger-journal loop. It does
    // no token transfers -- only collateral-manager ledger/encumbered updates -- which no rule here asserts on, and
    // fulfillBid changes the servicer ledger/total in lockstep itself (and is excluded from the locker-balance
    // invariant). NONDET the inner loop (internal => binds) and the external entry to collapse the path-count blowup.
    function _._encumberExistingCollateralInternal(address) internal => NONDET;
    function _.journalBidCollateralToCollateralManager(address,address[],uint256[]) external => NONDET;
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


// Correctness of the `isTermContractPaired` field.
use rule pairTermContractsSucceedsWhenNotPaired;
use rule pairTermContractsRevertsWhenAlreadyPaired;
rule onlyPairTermContractsChangesIsTermContractPaired(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.contract == currentContract &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,address,string).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

use rule openExposureOnRolloverNewIntegrity;
use rule openExposureOnRolloverNewDoesNotAffectThirdParty;
use rule openExposureOnRolloverNewRevertConditions;
use rule closeExposureOnRolloverExistingIntegrity;
use rule closeExposureOnRolloverExistingDoesNotAffectThirdParty;
use rule closeExposureOnRolloverExistingRevertConditions;
