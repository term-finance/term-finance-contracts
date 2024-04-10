import "../common/pausing.spec";
import "../common/isTermContractPaired.spec";
import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";
import "./accessRoles.spec";
import "./unlocking.spec";
import "./revealing.spec";

methods {
  function _.emitBidLocked(bytes32,TermAuctionBidLockerHarness.TermAuctionBid,address) external => NONDET DELETE;
  function _.auctionLockCollateral(address,address,uint256) external => DISPATCHER(true);
  function _.auctionUnlockCollateral(address,address,uint256) external => DISPATCHER(true);

    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}


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
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector // Exclude this method because it introduces too much complexity to the prover.
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}

// access roles
use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

// unlocking
use rule unlockBidsIntegrity;
use rule unlockBidsDoesNotAffectThirdParty;
use rule unlockBidsRevertConditions;
use rule unlockBidsMonotonicBehavior;

use rule auctionUnlockBidIntegrity;
use rule auctionUnlockBidDoesNotAffectThirdParty;
use rule auctionUnlockBidRevertConditions;
use rule auctionUnlockBidMonotonicBehavior;

// revealing
use rule revealBidsIntegrity;
use rule revealBidsDoesNotAffectThirdParty;
use rule revealBidsRevertConditions;
use rule revealBidsMonotonicBehavior;
