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
    function _.lockRolloverBid(uint256) external => DISPATCHER(true);
    function _.auctionEndTime() external => DISPATCHER(true);
    function _.purchaseToken() external => DISPATCHER(true);
    function _.collateralTokens(address) external => DISPATCHER(true);
    function _.termAuction() external => DISPATCHER(true);
    function _.termRepoId() external => DISPATCHER(true);

    // TermController
    function _.isTermDeployed(address) external => PER_CALLEE_CONSTANT;
    function _.getProtocolReserveAddress() external => CONSTANT;

    // TermPriceOracle
    function _.usdValueOfTokens(address token, uint256 amount) external => usdValueCVL(token, amount) expect (ExponentialNoError.Exp);
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
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
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