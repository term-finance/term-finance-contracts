import "../common/isTermContractPaired.spec";
import "../methods/emitMethods.spec";
import "./accessRoles.spec";

// termContractPaired
use rule pairTermContractsSucceedsWhenNotPaired;
use rule pairTermContractsRevertsWhenAlreadyPaired;
use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;
use rule onlyRoleCanCallRevertCompleteAuction;
use rule onlyRoleCanCallStorageCompleteAuction;
rule onlyPairTermContractsChangesIsTermContractPaired(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.contract == currentContract &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,string).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,address,address,uint256).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}
