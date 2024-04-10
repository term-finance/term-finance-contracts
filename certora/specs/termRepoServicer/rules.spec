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


    // TermController
    function _.getTreasuryAddress() external => ALWAYS(100);
    function _.getProtocolReserveAddress() external => ALWAYS(100);
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
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
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,string).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

