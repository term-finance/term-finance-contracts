import "../common/pausing.spec";
import "../common/isTermContractPaired.spec";
import "./accessRoles.spec";
import "./locking.spec";
import "./unlocking.spec";
import "./revealing.spec";

// termContractPaired
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
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,address,address[],address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

// common pausing
// use rule adminPauseLockingIntegrity;
// use rule nonAdminPauseLockingFailsIntegrity;
// use rule adminUnpauseLockingIntegrity;
// use rule nonAdminUnpauseLockingFailsIntegrity;
// use rule adminPauseUnlockingIntegrity;
// use rule nonAdminPauseUnlockingFailsIntegrity;
// use rule adminUnpauseUnlockingIntegrity;
// use rule nonAdminUnpauseUnlockingIntegrity;

// access roles
use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

// locking
use invariant lockedOfferIdAlwaysMatchesIndex;
use invariant offerCountAlwaysMatchesNumberOfStoredOffers;
use rule lockOffersIntegrity;
use rule lockOffersDoesNotAffectThirdParty;
use rule lockOffersRevertConditions;
use rule lockOffersMonotonicBehavior;

use rule lockOffersWithReferralIntegrity;
use rule lockOffersWithReferralDoesNotAffectThirdParty;
use rule lockOffersWithReferralRevertConditions;
use rule lockOffersWithReferralMonotonicBehavior;

// unlocking
use rule unlockOffersIntegrity;
use rule unlockOffersDoesNotAffectThirdParty;
use rule unlockOffersRevertConditions;
use rule unlockOffersMonotonicBehavior;

use rule unlockOfferPartialIntegrity;
use rule unlockOfferPartialDoesNotAffectThirdParty;
use rule unlockOfferPartialRevertConditions;
use rule unlockOfferPartialMonotonicBehavior;

// revealing
use rule revealOffersIntegrity;
use rule revealOffersDoesNotAffectThirdParty;
use rule revealOffersRevertConditions;
use rule revealOffersMonotonicBehavior;
