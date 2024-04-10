import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";
import "./accessRoles.spec";
import "./election.spec";
import "./fulfillment.spec";
import "./stateVariables.spec";

methods {
    // TermAuctionBidLocker
    function _.termAuctionId() external => DISPATCHER(true);
    function _.termRepoServicer() external => DISPATCHER(true);
    function _.dayCountFractionMantissa() external => DISPATCHER(true);
    function _.auctionEndTime() external => DISPATCHER(true);
    function _.purchaseToken() external => DISPATCHER(true);
    function _.collateralTokens(address) external => DISPATCHER(true);
    function _.termAuction() external => DISPATCHER(true);
    function _.termRepoId() external => DISPATCHER(true);
    function _.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid) external => DISPATCHER(true);

    // TermRepoServicer
    function _.servicingFee() external => DISPATCHER(true);

    // TermController
    function _.isTermDeployed(address) external => PER_CALLEE_CONSTANT;

    // TermEventEmitter
    function _.emitBidLocked(bytes32,TermAuctionBidLockerHarness.TermAuctionBid,address) external => NONDET DELETE;
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
    f.selector != sig:pairTermContracts(address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,address,address,address,address).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

use rule electRolloverIntegrity;
use rule electRolloverDoesNotAffectThirdParty;
use rule electRolloverRevertConditions;
use rule cancelRolloverIntegrity;
use rule cancelRolloverDoesNotAffectThirdParty;
use rule cancelRolloverRevertConditions;

use rule fulfillRolloverIntegrity;
use rule fulfillRolloverDoesNotAffectThirdParty;
use rule fulfillRolloverRevertConditions;

use rule noMethodsChangeTermRepoId;
use rule onlyAllowedMethodsChangeTermContracts;
use rule onlyAllowedMethodsChangeApprovedRolloverAuctionBidLockers;
use rule onlyAllowedMethodsChangeRolloverElections;
