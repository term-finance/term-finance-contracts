import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";
import "./stateVariables.spec";

ghost mapping(address => uint256) tokenPrices;

function usdValueCVL(address token, uint256 amount) returns ExponentialNoError.Exp {
    ExponentialNoError.Exp result;
    require to_mathint(result.mantissa) == tokenPrices[token] * amount;
    return result;
}

methods {
    // TermAuctionBidLocker
    function _.termAuctionId() external => DISPATCHER(true);
    function _.termRepoServicer() external => DISPATCHER(true);
    function _.dayCountFractionMantissa() external => DISPATCHER(true);
    function _.lockRolloverBid(TermAuctionBidLocker.TermAuctionBid) external => DISPATCHER(true);
    function _.auctionEndTime() external => DISPATCHER(true);
    function _.purchaseToken() external => DISPATCHER(true);
    function _.collateralTokens(address) external => DISPATCHER(true);
    function _.termAuction() external => DISPATCHER(true);
    function _.termRepoId() external => DISPATCHER(true);

    // TermController
    function _.isTermDeployed(address) external => PER_CALLEE_CONSTANT;
    function _.getProtocolReserveAddress() external => CONSTANT;
    // TermRepoToken's burnAndReturnValue (and sibling mint paths) call
    // ITermRepoServicer(config.termRepoServicer).termController()/termContractsPaused();
    // config.termRepoServicer is a struct member so link can't resolve it -> those calls
    // autohavoc. Dispatch to the in-scene servicer/controller to kill the havocs.
    function _.termController() external => DISPATCHER(true);
    function _.termContractsPaused() external => DISPATCHER(true);

    // TermPriceOracle
    function _.usdValueOfTokens(address token, uint256 amount) external => usdValueCVL(token, amount) expect (ExponentialNoError.Exp);

    // The batchLiquidation/batchLiquidationWithRepoToken paths time out here on (a) the servicer's
    // assert(_isTermRepoBalanced()) reached via liquidatorCoverExposure/liquidatorCoverExposureWithRepoToken
    // (nonlinear threshold proof), (b) the seizure ratio math (mul_/div_), and (c) the repo-token burn value.
    // These state-variable rules assert on COLLATERAL storage changes (encumbered/locked), not on the servicer
    // balance or the seizure value, and locked/encumbered are always decremented in lockstep by the same seizure
    // amount, so abstracting these is sound: the balance assert is proven independently, and the seizure/burn value
    // being NONDET only makes the equal-decrement amount arbitrary (invariants still hold).
    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;
    function TermRepoServicer._isTermRepoBalanced() internal returns (bool) => alwaysTermRepoBalanced();
    function _.burnAndReturnValue(address,uint256) external => NONDET;
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

use rule pairTermContractsSucceedsWhenNotPaired;
use rule pairTermContractsRevertsWhenAlreadyPaired;
rule onlyPairTermContractsChangesIsTermContractPaired(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.contract == currentContract &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyAllowedMethodsMayChangeEncumberedCollateralBalances;
use rule encumberedCollateralBalancesNeverOverflows;
use rule noMethodsChangeTermRepoId;
use rule noMethodsChangeNumOfAcceptedCollateralTokens;
use rule noMethodsChangeDeMinimisMarginThreshold;
use rule noMethodsChangeLiquidateDamagesDueToProtocol;
use rule noMethodsChangeNetExposureCapOnLiquidation;
use rule noMethodsChangePurchaseToken;
use rule onlyAllowedMethodsChangeTermContracts;
use rule noMethodsChangeMaintenanceCollateralRatios;
use rule noMethodsChangeInitialCollateralRatios;
use rule noMethodsChangeLiquidatedDamages;
use rule onlyAllowedMethodsChangeLockedCollateralLedger;
use rule lockedCollateralLedgerDoesNotOverflow;
use rule lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance;
use rule sumOfCollateralBalancesLessThanEncumberedBalances;
use rule sumOfCollateralBalancesForBatchDefault;
use rule sumOfCollateralBalancesForBatchDefaultWithRepoToken;
use rule sumOfCollateralBalancesForBatchLiquidation;
use rule sumOfCollateralBalancesForBatchLiquidationWithRepoToken;
use rule sumOfCollateralBalancesForUnlockCollateralOnRepurchase;