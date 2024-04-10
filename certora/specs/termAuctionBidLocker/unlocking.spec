using TermRepoCollateralManager as collateralManagerUnlocking;
using TermRepoLocker as lockerUnlocking;
using TermAuction as termAuction;
using DummyERC20A as unlockingAuctionCollateralTokenOne;
using DummyERC20B as unlockingAuctionCollateralTokenTwo;

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

methods {
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function bidCount() external returns (uint256) envfree;
    function auctionStartTime() external returns (uint256) envfree;
    function revealTime() external returns (uint256) envfree;
    function minimumTenderAmount() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function lockingPaused() external returns (bool) envfree;
    function unlockingPaused() external returns (bool) envfree;
    function MAX_BID_COUNT() external returns (uint256) envfree;
    function termAuction() external returns (address) envfree;
    function termRepoCollateralManager() external returns (address) envfree;
    function harnessGetInternalBids(bytes32 bidId) external returns (TermAuctionBidLockerHarness.TermAuctionBid memory) envfree;
    function harnessCompareIncomingBidWithInternalBid(TermAuctionBidLockerHarness.TermAuctionBid incomingBid, bytes32 bidId) external returns (bool) envfree;
    function TermRepoCollateralManager.AUCTION_LOCKER() external returns (bytes32) envfree;
    function TermRepoCollateralManager.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoCollateralManager.termRepoLocker() external returns(address) envfree;
    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermAuction.auctionCancelledForWithdrawal() external returns(bool) envfree;
    function harnessGetInternalBidId(bytes32 bidId) external returns (bytes32) envfree;
    function harnessGetInternalBidBidder(bytes32 bidId) external returns (address) envfree;
    function harnessGetInternalBidBidPriceHash(bytes32 bidId) external returns (bytes32) envfree;
    function harnessGetInternalBidBidRevealedPrice(bytes32 bidId) external returns (uint256) envfree;
    function harnessGetInternalBidAmount(bytes32 bidId) external returns (uint256) envfree;
    function harnessGetInternalBidCollateralAmount(bytes32 bidId, uint256 collateralIndex) external returns (uint256) envfree;
    function harnessGetInternalBidIsRollover(bytes32 bidId) external returns (bool) envfree;
    function harnessGetInternalBidRolloverPairOffTermRepoServicer(bytes32 bidId) external returns (address) envfree;
    function harnessGetInternalBidIsRevealed(bytes32 bidId) external returns (bool) envfree;
    function harnessBidCollateralAmountsLength(bytes32 bidId) external returns (uint256) envfree;
    function harnessGenerateBidId(bytes32 id, address user) external returns (bytes32) envfree;
    function harnessReentrancyGuardEntered() external returns (bool) envfree;
    function harnessGetInternalBidCollateralTokenCount(bytes32 bidId) external returns (uint256) envfree;
    function harnessGetInternalBidCollateralToken(bytes32, uint256) external returns (address) envfree;
    function harnessGetInternalBidCollateralAmountCount(bytes32 bidId) external returns (uint256) envfree;
    function harnessGetInternalBidCollateralAmount(bytes32, uint256) external returns (uint256) envfree;

    function unlockingAuctionCollateralTokenOne.allowance(address,address) external returns (uint256) envfree;
    function unlockingAuctionCollateralTokenOne.balanceOf(address) external returns (uint256) envfree;
    function unlockingAuctionCollateralTokenTwo.allowance(address,address) external returns (uint256) envfree;
    function unlockingAuctionCollateralTokenTwo.balanceOf(address) external returns (uint256) envfree;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Unlock Bids Rules                                                                                                   |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule unlockBidsIntegrity(
  env e,
  bytes32[] ids,
  mathint collateralTokenCount
) {
  require ids.length <= 2;
  require ids.length > 0;
  require collateralTokenCount <= 2;
  require collateralTokenCount > 0;
  bytes32 idOne = ids[0];
  bytes32 idTwo = ids[ids.length > 1 ? 1 : 0];

  require termRepoCollateralManager() == collateralManagerUnlocking;
  require e.msg.sender != collateralManagerUnlocking.termRepoLocker();

  // Ensure collateralAmounts and collateralTokens have the same length
  require collateralTokenCount == to_mathint(harnessGetInternalBidCollateralTokenCount(idOne));
  require collateralTokenCount == to_mathint(harnessGetInternalBidCollateralAmountCount(idOne));
  require harnessGetInternalBidCollateralToken(idOne, 0) == unlockingAuctionCollateralTokenOne;
  if (collateralTokenCount > 1) {
    require harnessGetInternalBidCollateralToken(idOne, 1) == unlockingAuctionCollateralTokenTwo;
  }
  if (ids.length > 1) {
    require collateralTokenCount == to_mathint(harnessGetInternalBidCollateralTokenCount(idTwo));
    require collateralTokenCount == to_mathint(harnessGetInternalBidCollateralAmountCount(idTwo));
    require harnessGetInternalBidCollateralToken(idTwo, 0) == unlockingAuctionCollateralTokenOne;
    if (collateralTokenCount > 1) {
      require harnessGetInternalBidCollateralToken(idTwo, 1) == unlockingAuctionCollateralTokenTwo;
    }
  }

  mathint idOneTokenOneAmountToUnlock = harnessGetInternalBidCollateralAmount(idOne, 0);
  mathint idOneTokenTwoAmountToUnlock = harnessGetInternalBidCollateralAmount(idOne, collateralTokenCount > 1 ? 1 : 0);
  mathint idTwoTokenOneAmountToUnlock = harnessGetInternalBidCollateralAmount(idTwo, 0);
  mathint idTwoTokenTwoAmountToUnlock = harnessGetInternalBidCollateralAmount(idTwo, collateralTokenCount > 1 ? 1 : 0);

  mathint collateralTokenOneBalanceBefore = unlockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceBefore = unlockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);

  unlockBids(e, ids);

  mathint collateralTokenOneBalanceAfter = unlockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceAfter = unlockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);

  if (collateralTokenCount > 1) {
    assert collateralTokenTwoBalanceAfter == collateralTokenTwoBalanceBefore + idOneTokenTwoAmountToUnlock + (ids.length > 1 ? idTwoTokenTwoAmountToUnlock : 0),
      "collateral token two balance should increase by the amount of collateral token two";
  }
  assert collateralTokenOneBalanceAfter == collateralTokenOneBalanceBefore + idOneTokenOneAmountToUnlock + (ids.length > 1 ? idTwoTokenOneAmountToUnlock : 0),
    "collateral token one balance should increase by the amount of collateral token one";
}

rule unlockBidsDoesNotAffectThirdParty(
  env e,
  bytes32[] bidIds,
  bytes32 thirdPartyBidId,
  uint256 collateralTokenIndex
) {
  // Rule bounds
  require termRepoCollateralManager() == collateralManagerUnlocking;
  require e.msg.sender != collateralManagerUnlocking.termRepoLocker();

  // Assume that any saved bids are saved under the same index as its id
  // See `lockedBidIdAlwaysMatchesIndex` invariant above
  require thirdPartyBidId == harnessGetInternalBidId(thirdPartyBidId);

  // Ensure that the third party bid is not in the first party bid
  bytes32 bidIdOne = bidIds[0];
  require bidIds.length <= 1;
  require thirdPartyBidId != bidIdOne;
  require thirdPartyBidId != harnessGenerateBidId(bidIdOne, e.msg.sender);

  bytes32 bidIdBefore = harnessGetInternalBidId(thirdPartyBidId);
  address bidderBefore = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashBefore = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceBefore = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountBefore = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountBefore = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverBefore = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressBefore = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedBefore = harnessGetInternalBidIsRevealed(thirdPartyBidId);
  unlockBids(e, bidIds);
  bytes32 bidIdAfter = harnessGetInternalBidId(thirdPartyBidId);
  address bidderAfter = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashAfter = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceAfter = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountAfter = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountAfter = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverAfter = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressAfter = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedAfter = harnessGetInternalBidIsRevealed(thirdPartyBidId);

  assert bidIdBefore == bidIdAfter,
    "lockBids should not modify bid id";
  assert bidderBefore == bidderAfter,
    "lockBids should not modify bidder";
  assert bidPriceHashBefore == bidPriceHashAfter,
    "lockBids should not modify bid price hash";
  assert bidRevealedPriceBefore == bidRevealedPriceAfter,
    "lockBids should not modify bid revealed price";
  assert bidAmountBefore == bidAmountAfter,
    "lockBids should not modify bid amount";
  assert bidCollateralAmountBefore == bidCollateralAmountAfter,
    "lockBids should not modify bid collateral amounts";
  assert bidIsRolloverBefore == bidIsRolloverAfter,
    "lockBids should not modify bid rollover status";
  assert bidRolloverAddressBefore == bidRolloverAddressAfter,
    "lockBids should not modify bid rollover address";
  assert bidIsRevealedBefore == bidIsRevealedAfter,
    "lockBids should not modify bid revealed status";

  // require harnessGetInternalBids(thirdPartyBidId).id == thirdPartyBidId;
  // require harnessGetInternalBids(thirdPartyBidId).collateralTokens.length == 2;
  // require harnessGetInternalBids(thirdPartyBidId).collateralAmounts.length == 2;
}

rule unlockBidsRevertConditions(
  env e,
  bytes32 unlockBidId
) {
  require termAuction() == termAuction;
  require(termRepoCollateralManager() == collateralManagerUnlocking);
  require(collateralManagerUnlocking.termRepoLocker() == lockerUnlocking);

  TermAuctionBidLockerHarness.TermAuctionBid existingBid = harnessGetInternalBids(unlockBidId);
  require existingBid.collateralTokens.length == 2;
  require existingBid.collateralAmounts.length == 2;
  require(existingBid.collateralTokens[0] == unlockingAuctionCollateralTokenOne);
  require(existingBid.collateralTokens[1] == unlockingAuctionCollateralTokenTwo);

  require(unlockingAuctionCollateralTokenOne.balanceOf(existingBid.bidder) + existingBid.collateralAmounts[0] <= max_uint256);
  require(unlockingAuctionCollateralTokenTwo.balanceOf(existingBid.bidder) + existingBid.collateralAmounts[1] <= max_uint256);

  require(unlockingAuctionCollateralTokenOne.balanceOf(lockerUnlocking) >= existingBid.collateralAmounts[0]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec 
  require(unlockingAuctionCollateralTokenTwo.balanceOf(lockerUnlocking) >= existingBid.collateralAmounts[1]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec 
  require(bidCount() > 0); // If Bid exists, bidCount will be greater than 0 according to bidCountAlwaysMatchesNumberOfStoredBids invariant in ./locking.spec
  

  bool unlockingPaused = unlockingPaused(); // UnlockingPaused
  bool reentrant = harnessReentrancyGuardEntered();
  bool auctionNotOpen = e.block.timestamp < auctionStartTime(); // AuctionNotOpen
  bool auctionNotCancelledForWithdrawal = e.block.timestamp > revealTime() && !termAuction.auctionCancelledForWithdrawal(); // AuctionNotOpen
  bool nonExistentBid = harnessGetInternalBids(unlockBidId).amount == 0; // NonExistentBid

  bool bidNotOwned = harnessGetInternalBids(unlockBidId).bidder != e.msg.sender; // BidNotOwned
  bool rolloverBid = harnessGetInternalBids(unlockBidId).isRollover; // RolloverBid
  bool lockerTransfersPaused = lockerUnlocking.transfersPaused();
  bool collateralManagerNotPairedToLocker = !lockerUnlocking.hasRole(lockerUnlocking.SERVICER_ROLE(), collateralManagerUnlocking);
  bool bidLockerNotPairedToCollatManager = !collateralManagerUnlocking.hasRole(collateralManagerUnlocking.AUCTION_LOCKER(), currentContract);

  bool nonZeroMsgValue = e.msg.value != 0;

  bool isExpectedToRevert = unlockingPaused || reentrant || auctionNotOpen || auctionNotCancelledForWithdrawal || nonExistentBid || bidNotOwned || rolloverBid ||
  lockerTransfersPaused || collateralManagerNotPairedToLocker || bidLockerNotPairedToCollatManager || nonZeroMsgValue;

  unlockBids@withrevert(e, [unlockBidId]);

  assert isExpectedToRevert <=> lastReverted,
    "unlockBids should revert when revert conditions are met";
}

rule unlockBidsMonotonicBehavior(
  env e,
  bytes32[] unlockBidIds
) {
  uint256 bidCountBefore = bidCount();
  unlockBids(e, unlockBidIds);
  uint256 bidCountAfter = bidCount();
  
  assert bidCountAfter <= bidCountBefore,
    "unlockBids should decrease or maintain bid count";
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Auction Unlock Bid Rules                                                                                            |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule auctionUnlockBidIntegrity(
  env e,
  bytes32 id,
  address bidder,
  address[] bidCollateralTokens,
  uint256[] amounts
) {
  require bidder != collateralManagerUnlocking.termRepoLocker();
  require termRepoCollateralManager() == collateralManagerUnlocking;

  require bidCollateralTokens.length == amounts.length;
  require bidCollateralTokens.length <= 2;

  require bidCollateralTokens[0] == unlockingAuctionCollateralTokenOne;
  require bidCollateralTokens.length < 2 || bidCollateralTokens[1] == unlockingAuctionCollateralTokenTwo;

  mathint collateralTokenOneBalanceBefore = unlockingAuctionCollateralTokenOne.balanceOf(bidder);
  mathint collateralTokenTwoBalanceBefore = unlockingAuctionCollateralTokenTwo.balanceOf(bidder);

  require amounts[0] + collateralTokenOneBalanceBefore < 2^256;
  require bidCollateralTokens.length < 2 || amounts[1] + collateralTokenTwoBalanceBefore < 2^256;

  auctionUnlockBid(e, id, bidder, bidCollateralTokens, amounts);

  mathint collateralTokenOneBalanceAfter = unlockingAuctionCollateralTokenOne.balanceOf(bidder);
  mathint collateralTokenTwoBalanceAfter = unlockingAuctionCollateralTokenTwo.balanceOf(bidder);

  if (bidCollateralTokens.length > 1) {
    assert collateralTokenTwoBalanceAfter == collateralTokenTwoBalanceBefore + amounts[1],
      "collateral token two balance should increase by the amount of collateral token two";
  }
  assert bidCollateralTokens.length == 0 || collateralTokenOneBalanceAfter == collateralTokenOneBalanceBefore + amounts[0],
    "collateral token one balance should increase by the amount of collateral token one";
}

rule auctionUnlockBidDoesNotAffectThirdParty(
  env e,
  bytes32 firstPartyBidId,
  bytes32 thirdPartyBidId,
  address firstPartyBidder,
  address[] firstPartyBidCollateralTokens,
  uint256[] firstPartyAmounts,
  uint256 collateralTokenIndex
) {
  require firstPartyBidId != thirdPartyBidId;
  require harnessGetInternalBids(thirdPartyBidId).id == thirdPartyBidId;

  bytes32 bidIdBefore = harnessGetInternalBidId(thirdPartyBidId);
  address bidderBefore = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashBefore = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceBefore = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountBefore = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountBefore = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverBefore = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressBefore = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedBefore = harnessGetInternalBidIsRevealed(thirdPartyBidId);
  auctionUnlockBid(e, firstPartyBidId, firstPartyBidder, firstPartyBidCollateralTokens, firstPartyAmounts);
  bytes32 bidIdAfter = harnessGetInternalBidId(thirdPartyBidId);
  address bidderAfter = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashAfter = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceAfter = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountAfter = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountAfter = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverAfter = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressAfter = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedAfter = harnessGetInternalBidIsRevealed(thirdPartyBidId);

  assert bidIdBefore == bidIdAfter,
    "lockBids should not modify bid id";
  assert bidderBefore == bidderAfter,
    "lockBids should not modify bidder";
  assert bidPriceHashBefore == bidPriceHashAfter,
    "lockBids should not modify bid price hash";
  assert bidRevealedPriceBefore == bidRevealedPriceAfter,
    "lockBids should not modify bid revealed price";
  assert bidAmountBefore == bidAmountAfter,
    "lockBids should not modify bid amount";
  assert bidCollateralAmountBefore == bidCollateralAmountAfter,
    "lockBids should not modify bid collateral amounts";
  assert bidIsRolloverBefore == bidIsRolloverAfter,
    "lockBids should not modify bid rollover status";
  assert bidRolloverAddressBefore == bidRolloverAddressAfter,
    "lockBids should not modify bid rollover address";
  assert bidIsRevealedBefore == bidIsRevealedAfter,
    "lockBids should not modify bid revealed status";
}

rule auctionUnlockBidRevertConditions(
  env e,
  bytes32 unlockBidId,
  address bidder,
  address[] bidCollateralTokens,
  uint256[] amounts
) {
  require(termRepoCollateralManager() == collateralManagerUnlocking);
  require(collateralManagerUnlocking.termRepoLocker() == lockerUnlocking);

  require(bidCollateralTokens[0] == unlockingAuctionCollateralTokenOne);
  require(bidCollateralTokens[1] == unlockingAuctionCollateralTokenTwo);
  require(amounts.length == 2);
  require(bidCollateralTokens.length == 2);

  require(unlockingAuctionCollateralTokenOne.balanceOf(bidder) + amounts[0] <= max_uint256);
  require(unlockingAuctionCollateralTokenTwo.balanceOf(bidder) + amounts[1] <= max_uint256);

  bool isRollover = harnessGetInternalBidIsRollover(unlockBidId); // RolloverBid
  bool msgValueIsNotZero = e.msg.value != 0;
  bool callerNotAuctioneer = !hasRole(AUCTIONEER_ROLE(), e.msg.sender);
  bool lockerTransfersPaused = lockerUnlocking.transfersPaused();
  bool collateralManagerNotPairedToLocker = !lockerUnlocking.hasRole(lockerUnlocking.SERVICER_ROLE(), collateralManagerUnlocking);
  bool bidLockerNotPairedToCollatManager = !collateralManagerUnlocking.hasRole(collateralManagerUnlocking.AUCTION_LOCKER(), currentContract);
  bool insufficientLockerBalance = amounts[0] > unlockingAuctionCollateralTokenOne.balanceOf(lockerUnlocking) ||  amounts[1] > unlockingAuctionCollateralTokenTwo.balanceOf(lockerUnlocking);


  bool isExpectedToRevert = isRollover || msgValueIsNotZero || callerNotAuctioneer || lockerTransfersPaused || collateralManagerNotPairedToLocker || bidLockerNotPairedToCollatManager || insufficientLockerBalance;

  auctionUnlockBid@withrevert(e, unlockBidId, bidder, bidCollateralTokens, amounts);
  assert isExpectedToRevert <=> lastReverted,
    "auctionUnlockBid should revert if it tries to unlock a rollover bid";
}

rule auctionUnlockBidMonotonicBehavior(
  env e,
  bytes32 id,
  address bidder,
  address[] bidCollateralTokens,
  uint256[] amounts
) {
  uint256 bidCountBefore = bidCount();
  auctionUnlockBid(e, id, bidder, bidCollateralTokens, amounts);
  uint256 bidCountAfter = bidCount();

  assert bidCountAfter <= bidCountBefore,
    "auctionUnlockBid should decrease or maintain bid count";
}