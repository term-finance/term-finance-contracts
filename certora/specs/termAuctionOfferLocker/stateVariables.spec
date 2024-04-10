using DummyERC20A as offerStatePurchaseToken;
using TermRepoServicer as repoServicerOfferState;
using TermRepoLocker as repoLockerOfferState;

methods {
  function termRepoServicer() external returns (address) envfree;
  function purchaseToken() external returns (address) envfree;

  function TermRepoServicer.purchaseToken() external returns(address) envfree;
  function TermRepoServicer.termRepoLocker() external returns(address) envfree;
  function DummyERC20A.balanceOf(address) external returns(uint256) envfree;

}



ghost mathint sumOfOfferBalances {
    init_state axiom sumOfOfferBalances == 0;
}

ghost mathint numberOfChangesOfOfferBalances {
	init_state axiom numberOfChangesOfOfferBalances == 0;
}

hook Sload uint256 value offers[KEY bytes32 offerId].amount  {
    require sumOfOfferBalances >= to_mathint(value);
}

hook Sstore offers[KEY bytes32 offerId].amount  uint256 newValue (uint256 oldValue) {
    sumOfOfferBalances = sumOfOfferBalances - oldValue + newValue;
    numberOfChangesOfOfferBalances = numberOfChangesOfOfferBalances + 1;
}



/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pause Offerlocking Rules                                                                                              |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

// Pausing locking prevents offers from being locked
rule pauseLockingCausesOfferLockingToRevert(
    env e,
    method f,
    calldataarg args
) filtered { f ->
  f.selector == sig:TermAuctionOfferLockerHarness.lockOffersWithReferral(TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[],address).selector ||
  f.selector == sig:TermAuctionOfferLockerHarness.lockOffers(TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[]).selector
} {
    require lockingPaused() == true;
    f@withrevert(e, args);
    assert lastReverted,
      "lockOffers(...) should revert when trying to lock a paused contract";
}

// Unpausing locking allows offer to be locked
rule unpauseLockingAllowsOfferLocking(
  env e,
  method f,
  calldataarg args
) filtered { f ->
  f.selector == sig:TermAuctionOfferLockerHarness.lockOffersWithReferral(TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[],address).selector ||
  f.selector == sig:TermAuctionOfferLockerHarness.lockOffers(TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[]).selector
} {
  require lockingPaused() == false;
  f(e, args);
  assert !lastReverted,
    "lockOffers(...) should not revert when trying to lock offers on an unpaused contract";
}

// Pausing unlocking prevents offers from being unlocked
rule pauseUnlockingCausesOfferUnlockingToRevert(
    env e,
    bytes32[] ids
) {
    require unlockingPaused() == true;
    unlockOffers@withrevert(e, ids);
    assert lastReverted,
      "unlockOffers(...) should revert when trying to unlock offers on a paused contract";
}

// Unpausing unlocking allows offers to be unlocked
rule unpauseUnlockingAllowsOfferUnlocking(
  env e,
  bytes32 id
) {
  require unlockingPaused() == false;
  require harnessGetInternalOffers(id).id == id;
  unlockOffers(e, [id]);
  assert !lastReverted,
      "unlockOffers(...) should not revert when trying to unlock offers on a upaused contract";
}

// loop iteration 2, size of array 2 too
// pack all reverts into one rule

//NOTE: only tests atomic functions called by a user (not by another contract) that move purchase tokens
rule lockerPurchaseTokenBalanceGreaterThanOfferLedgerBalance(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
  f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllOffers(bytes32[],bytes32[]).selector &&
    f.selector != sig:unlockOfferPartial(bytes32,address,uint256).selector && 
    f.selector != sig:pairTermContracts(address,address,address,address,address).selector

} {
    require(termRepoServicer() == repoServicerOfferState); // bounds for test 
    require(repoServicerOfferState.termRepoLocker() == repoLockerOfferState);
    require(repoServicerOfferState.purchaseToken() == offerStatePurchaseToken); // bounds for test
    require(purchaseToken() == offerStatePurchaseToken); // bounds for test
    require(e.msg.sender != repoLockerOfferState); // repo locker does not call collateral manager
    require(sumOfOfferBalances <= to_mathint((offerStatePurchaseToken.balanceOf(repoLockerOfferState)))); // starting condition

    f(e, args);

    assert sumOfOfferBalances <= to_mathint((offerStatePurchaseToken.balanceOf(repoLockerOfferState)));
}
