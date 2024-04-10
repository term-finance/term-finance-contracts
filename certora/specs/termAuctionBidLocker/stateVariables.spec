using DummyERC20A as bidLockerStateCollateralToken;
using TermRepoCollateralManagerHarness as collateralManagerBidLockingState;
using TermRepoLocker as lockerBidLockingState;

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

ghost mapping(address => uint256) tokenPrices;

function usdValueCVL(address token, uint256 amount) returns ExponentialNoError.Exp {
  ExponentialNoError.Exp result;
  require to_mathint(result.mantissa) == tokenPrices[token] * amount;
  return result;
}

methods {
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function bidCount() external returns (uint256) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function lockingPaused() external returns (bool) envfree;
    function unlockingPaused() external returns (bool) envfree;
    function harnessGetInternalBids(bytes32 bidId) external returns (TermAuctionBidLockerHarness.TermAuctionBid memory) envfree;
    function termRepoCollateralManager() external returns (address) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function TermRepoCollateralManagerHarness.termRepoLocker() external returns(address) envfree;
    function TermRepoCollateralManagerHarness.collateralTokensLength() external returns(uint256) envfree;
    function TermRepoCollateralManagerHarness.collateralTokens(uint256) external returns (address) envfree;

    function _.emitBidLocked(bytes32,TermAuctionBidLockerHarness.TermAuctionBid,address) external => NONDET DELETE;

    function _.usdValueOfTokens(address token, uint256 amount) external => usdValueCVL(token, amount) expect (ExponentialNoError.Exp);

    function _._ external => DISPATCH [
       collateralManagerBidLockingState.auctionUnlockCollateral(address,address,uint256),
       collateralManagerBidLockingState.auctionLockCollateral(address,address,uint256)
    ] default HAVOC_ALL;
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}

ghost mathint sumOfCollateralBalances {
    init_state axiom sumOfCollateralBalances == 0;
}

ghost mathint numberOfChangesOfCollateralBalances {
	init_state axiom numberOfChangesOfCollateralBalances == 0;
}

hook Sload bool supported collateralTokens[KEY address token]  {
    if (token == bidLockerStateCollateralToken) {
      require supported == true;
    } else {
      require supported == false;
    }
}
hook Sload uint256 value bids[KEY bytes32 bidId].collateralAmounts[INDEX uint256 collateralIndex]  {
    require sumOfCollateralBalances >= to_mathint(value);
}

hook Sstore bids[KEY bytes32 bidId].collateralAmounts[INDEX uint256 collateralIndex]  uint256 newValue (uint256 oldValue) {
    require(sumOfCollateralBalances - oldValue >= 0);
    sumOfCollateralBalances = sumOfCollateralBalances - oldValue + newValue;
    numberOfChangesOfCollateralBalances = numberOfChangesOfCollateralBalances + 1;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules                                                                                                               |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pause Bidlocking Rules                                                                                              |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

// Pausing locking prevents bids from being locked
rule pauseLockingCausesBidLockingToRevert(
    env e,
    method f,
    calldataarg args
) filtered { f ->
  f.selector == sig:TermAuctionBidLockerHarness.lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector ||
  f.selector == sig:TermAuctionBidLockerHarness.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector ||
  f.selector == sig:TermAuctionBidLockerHarness.lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector
} {
    require lockingPaused() == true;
    f@withrevert(e, args);
    assert lastReverted,
      "lockBids(...) should revert when trying to lock a paused contract";
}

// Unpausing locking allows bids to be locked
rule unpauseLockingAllowsBidLocking(
  env e,
  method f,
  calldataarg args
) filtered { f ->
  f.selector == sig:TermAuctionBidLockerHarness.lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector ||
  f.selector == sig:TermAuctionBidLockerHarness.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector ||
  f.selector == sig:TermAuctionBidLockerHarness.lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector
} {
  require lockingPaused() == false;
  f(e, args);
  assert !lastReverted,
    "lockBids(...) should not revert when trying to lock bids on an unpaused contract";
}

// Pausing unlocking prevents bids from being unlocked
rule pauseUnlockingCausesBidUnlockingToRevert(
    env e,
    bytes32[] ids
) {
    require unlockingPaused() == true;
    unlockBids@withrevert(e, ids);
    assert lastReverted,
      "unlockBids(...) should revert when trying to unlock bids on a paused contract";
}

// Unpausing unlocking allows bids to be unlocked
rule unpauseUnlockingAllowsBidUnlocking(
  env e,
  bytes32 id
) {
  require unlockingPaused() == false;
  require harnessGetInternalBids(id).id == id;
  unlockBids(e, [id]);
  assert !lastReverted,
      "unlockBids(...) should not revert when trying to unlock bids on a upaused contract";
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Min Bid Amount Rules                                                                                                |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

// Not Allowed Methods Cannot Change Bid Count
rule notAllowedMethodsCannotChangeBidCount(
  env e,
  method f,
  calldataarg args
) filtered { f ->
    !f.isView &&
    f.contract == currentContract &&
    f.selector != sig:TermAuctionBidLockerHarness.upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.upgradeTo(address).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.unlockBids(bytes32[]).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.getAllBids(bytes32[],bytes32[],bytes32[]).selector &&
    f.selector != sig:TermAuctionBidLockerHarness.auctionUnlockBid(bytes32,address,address[],uint256[]).selector
} {
  uint256 bidCountBefore = bidCount();

  f(e, args);

  uint256 bidCountAfter = bidCount();

  assert bidCountBefore == bidCountAfter,
    "bidCount should not change";
}

// Only Allowed Methods Can Change Bid Count
rule onlyAllowedMethodsCanChangeBidCount(
  env e,
  method f,
  calldataarg args
) filtered { f ->
  !f.isView &&
  f.contract == currentContract &&
  f.selector != sig:TermAuctionBidLockerHarness.upgradeToAndCall(address,bytes).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.upgradeTo(address).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.unlockBids(bytes32[]).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.getAllBids(bytes32[],bytes32[],bytes32[]).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.auctionUnlockBid(bytes32,address,address[],uint256[]).selector
} {
  uint256 bidCountBefore = bidCount();
  f(e, args);
  uint256 bidCountAfter = bidCount();

  assert bidCountBefore == bidCountAfter,
    "bidCount should not change";
}

//NOTE: only tests atomic functions called by a user (not by another contract) that move collateral
rule lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
  f.contract == currentContract &&
  f.selector != sig:TermAuctionBidLockerHarness.upgradeToAndCall(address,bytes).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.upgradeTo(address).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.getAllBids(bytes32[],bytes32[],bytes32[]).selector &&
  f.selector != sig:TermAuctionBidLockerHarness.auctionUnlockBid(bytes32,address,address[],uint256[]).selector

} {
    require(termRepoCollateralManager() == collateralManagerBidLockingState); // bounds for test 
    require(collateralManagerBidLockingState.termRepoLocker() == lockerBidLockingState);
    require(collateralManagerBidLockingState.collateralTokensLength() == 1); // bounds for test
    require(collateralManagerBidLockingState.collateralTokens(0) == bidLockerStateCollateralToken); // bounds for test
    require(e.msg.sender != lockerBidLockingState); // repo locker does not call bid locker
    require(e.msg.sender != 0);
    require(sumOfCollateralBalances <= to_mathint((bidLockerStateCollateralToken.balanceOf(lockerBidLockingState)))); // starting condition
    TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions;
    require(bidSubmissions.length == 1);
    require(bidSubmissions[0].collateralTokens.length == 1);
    require(bidSubmissions[0].collateralTokens[0] == bidLockerStateCollateralToken);
    require(bidSubmissions[0].collateralAmounts.length == 1);

    TermAuctionBidLockerHarness.TermAuctionBid existingBid = harnessGetInternalBids(bidSubmissions[0].id);
      require(existingBid.collateralAmounts.length == 1);
      require(existingBid.collateralTokens.length == 1);
      require(existingBid.collateralTokens[0] == bidLockerStateCollateralToken);

    if (existingBid.amount != 0 && existingBid.bidder == bidSubmissions[0].bidder){
      uint256 bidCollat1Diff =  existingBid.collateralAmounts[0] > bidSubmissions[0].collateralAmounts[0] ? assert_uint256(existingBid.collateralAmounts[0]- bidSubmissions[0].collateralAmounts[0]) : assert_uint256(bidSubmissions[0].collateralAmounts[0]-existingBid.collateralAmounts[0]);
      require(existingBid.collateralAmounts[0] < bidSubmissions[0].collateralAmounts[0] => bidLockerStateCollateralToken.balanceOf(lockerBidLockingState) + bidSubmissions[0].collateralAmounts[0] <= max_uint256);
    }

    require(bidLockerStateCollateralToken.balanceOf(lockerBidLockingState) + bidSubmissions[0].collateralAmounts[0] <= max_uint256);
    if (f.selector == sig:TermAuctionBidLockerHarness.lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector
    ){
      lockBids(e,bidSubmissions);
    } else if (f.selector == sig:TermAuctionBidLockerHarness.lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector) {
      address referralAddress;
      lockBidsWithReferral(e,bidSubmissions,referralAddress);
    }
    else {
      f(e, args);
    }

    assert sumOfCollateralBalances <= to_mathint((bidLockerStateCollateralToken.balanceOf(lockerBidLockingState)));
}
