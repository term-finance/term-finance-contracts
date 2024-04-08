import "./accessRoles.spec";
import "./balanceChecks.spec";
import "./stateVariables.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";

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
    f.selector != sig:pairTermContracts(address,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

use rule onlyAllowedMethodsMayChangeBalance;
use rule transferTokenFromWalletIntegrity;
use rule transferTokenToWalletIntegrity;
use rule pauseTransfersIntegrity;
use rule unpauseTransfersIntegrity;

use rule onlyAllowedMethodsMayChangeTransfersPaused;
use rule noMethodChangesTermRepoId;
use rule onlyAllowedMethodsMayChangeEmitter;
