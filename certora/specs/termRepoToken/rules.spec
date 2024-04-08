import "./accessRoles.spec";
import "./erc20Full.spec";
import "./stateVariables.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";

use invariant totalSupplyIsSumOfBalances;

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
    f.selector != sig:pairTermContracts(address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

use rule totalSupplyNeverOverflow;
use rule noMethodChangesMoreThanTwoBalances;
use rule onlyAllowedMethodsMayChangeAllowance;
use rule onlyAllowedMethodsMayChangeBalance;
use rule onlyAllowedMethodsMayChangeTotalSupply;
use rule reachability;
use rule onlyAuthorizedCanTransfer;
use rule onlyHolderOfSpenderCanChangeAllowance;
use rule mintTokensIntegrity;
use rule mintRedemptionValueIntegrity;
use rule mintTokensRevertingConditions;
use rule mintRedemptionValueRevertingConditions;
use rule mintRedemptionValueDoesNotAffectThirdParty;
use rule mintTokensDoesNotAffectThirdParty;
use rule burnIntegrity;
use rule burnAndReturnValueIntegrity;
use rule burnRevertingConditions;
use rule burnDoesNotAffectThirdParty;
use rule burnAndReturnValueDoesNotAffectThirdParty;
use rule transferIntegrity;
use rule transferIsOneWayAdditive;
use rule transferRevertingConditions;
use rule transferDoesNotAffectThirdParty;
use rule transferFromIntegrity;
use rule transferFromRevertingConditions;
use rule transferFromDoesNotAffectThirdParty;
use rule transferFromIsOneWayAdditive;
use rule approveIntegrity;
use rule approveRevertingConditions;
use rule approveDoesNotAffectThirdParty;

use rule onlyAllowedMethodsMayChangeMintExposureCap;
use rule mintExposureCapNeverOverflow;
use rule noMethodChangesRedemptionValue;