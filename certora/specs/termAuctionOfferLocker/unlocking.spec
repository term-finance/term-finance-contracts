using DummyERC20A as unlockingAuctionPurchaseToken;
using TermRepoServicer as repoServicerUnlocking;
using TermRepoLocker as repoLockerUnlocking;
using TermAuction as termAuction;
/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
methods {
  function revealTime() external returns (uint256) envfree;
  function harnessGetTermAuction() external returns (address) envfree;
  function MAX_OFFER_PRICE() external returns (uint256) envfree;
  function harnessGetInternalOffers(bytes32 offerId) external returns (TermAuctionOfferLockerHarness.TermAuctionOffer memory) envfree;
  function harnessGenerateOfferPriceHash(uint256 price, uint256 nonce) external returns (bytes32) envfree;
  function harnessCompareIncomingOfferWithInternalOffer(TermAuctionOfferLockerHarness.TermAuctionOffer incomingOffer, bytes32 offerId) external returns (bool) envfree;
  function TermAuction.auctionCancelledForWithdrawal() external returns(bool) envfree;
  function hasRole(bytes32 role, address account) external returns (bool) envfree;
  function AUCTIONEER_ROLE() external returns (bytes32) envfree;
  function termRepoServicer() external returns (address) envfree;
  function TermRepoServicer.AUCTION_LOCKER() external returns (bytes32) envfree;
  function TermRepoServicer.hasRole(bytes32 role, address account) external returns (bool) envfree;
  function TermRepoServicer.termRepoLocker() external returns (address) envfree;
  function TermRepoServicer.purchaseToken() external returns (address) envfree;
  function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
  function TermRepoLocker.hasRole(bytes32 role, address account) external returns (bool) envfree;
  function TermRepoLocker.transfersPaused() external returns (bool) envfree;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Unlock Offers Rules                                                                                                 |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule unlockOffersIntegrity(
  env e,
  bytes32 id
) {
  // rule bounds
  require termRepoServicer() == repoServicerUnlocking;
  require e.msg.sender != repoServicerUnlocking.termRepoLocker();

  mathint purchaseTokenAmountToUnlock = harnessGetInternalOffers(id).amount;

  mathint purchaseTokenBalanceBefore = unlockingAuctionPurchaseToken.balanceOf(e.msg.sender);

  unlockOffers(e, [id]);

  mathint purchaseTokenBalanceAfter = unlockingAuctionPurchaseToken.balanceOf(e.msg.sender);

  assert (purchaseTokenBalanceAfter == (purchaseTokenBalanceBefore + purchaseTokenAmountToUnlock)),
    "unlockOffers should not revert";
}

rule unlockOffersDoesNotAffectThirdParty(
  env e,
  bytes32 firstPartyOfferId,
  bytes32 thirdPartyOfferId
) {

  require firstPartyOfferId != thirdPartyOfferId;
  require harnessGetInternalOffers(thirdPartyOfferId).id == thirdPartyOfferId;

  TermAuctionOfferLockerHarness.TermAuctionOffer thirdPartyOfferBefore = harnessGetInternalOffers(thirdPartyOfferId);
  unlockOffers(e, [firstPartyOfferId]);

  bool thirdPartyOfferAffected = harnessCompareIncomingOfferWithInternalOffer(thirdPartyOfferBefore, thirdPartyOfferId);

  assert thirdPartyOfferAffected,
    "unlockOffers should not modify offers that are not in args"; 
}

rule unlockOffersRevertConditions(
  env e,
  bytes32 unlockOfferId
) {
  require harnessGetTermAuction() == termAuction;
  require(termRepoServicer() == repoServicerUnlocking);
  require(repoServicerUnlocking.termRepoLocker() == repoLockerUnlocking);

  TermAuctionOfferLockerHarness.TermAuctionOffer existingOffer = harnessGetInternalOffers(unlockOfferId);
  require(existingOffer.purchaseToken == unlockingAuctionPurchaseToken);

  require(unlockingAuctionPurchaseToken.balanceOf(existingOffer.offeror) + existingOffer.amount <= max_uint256);

  require(unlockingAuctionPurchaseToken.balanceOf(repoLockerUnlocking) >= existingOffer.amount); // Proved in lockerPurchaseTokenBalanceGreaterThanOfferLedgerBalance of ./stateVariables.spec 
  require(offerCount() > 0); // If Offer exists, offerCount will be greater than 0 according to offerCountAlwaysMatchesNumberOfStoredOffers invariant in ./locking.spec
  

  bool unlockingPaused = unlockingPaused(); // UnlockingPaused
  bool reentrant = harnessReentrancyGuardEntered();
  bool auctionNotOpen = e.block.timestamp < auctionStartTime(); // AuctionNotOpen
  bool auctionNotCancelledForWithdrawal = e.block.timestamp > revealTime() && !termAuction.auctionCancelledForWithdrawal(); // AuctionNotOpen
  bool nonExistentOffer = harnessGetInternalOffers(unlockOfferId).amount == 0; // NonExistentOffer
  bool offerNotOwned = harnessGetInternalOffers(unlockOfferId).offeror != e.msg.sender; // OfferNotOwned

  bool lockerTransfersPaused = repoLockerUnlocking.transfersPaused();
  bool repoServicerNotPairedToLocker = !repoLockerUnlocking.hasRole(repoLockerUnlocking.SERVICER_ROLE(), repoServicerUnlocking);
  bool offerLockerNotPairedToRepoServicer = !repoServicerUnlocking.hasRole(repoServicerUnlocking.AUCTION_LOCKER(), currentContract);

  bool nonZeroMsgValue = e.msg.value != 0;

  bool isExpectedToRevert = unlockingPaused || reentrant || auctionNotOpen || auctionNotCancelledForWithdrawal || nonExistentOffer || offerNotOwned 
  || lockerTransfersPaused || repoServicerNotPairedToLocker ||  offerLockerNotPairedToRepoServicer || nonZeroMsgValue;

  unlockOffers@withrevert(e, [unlockOfferId]);

  assert isExpectedToRevert <=> lastReverted,
    "unlockOffers should revert when revert conditions are met";
}

rule unlockOffersMonotonicBehavior(
  env e,
  bytes32[] unlockOfferIds
) {
  uint256 offerCountBefore = offerCount();
  unlockOffers(e, unlockOfferIds);
  uint256 offerCountAfter = offerCount();
  assert offerCountAfter == assert_uint256(offerCountBefore - unlockOfferIds.length),
    "offerCount should decrement by the number of offer ids submitted to unlock";
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Unlock Offer Partial Rules                                                                                          |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule unlockOfferPartialIntegrity(
  env e,
  bytes32 id,
  address offeror,
  uint256 amount
) {
  require offeror != repoServicerUnlocking.termRepoLocker();
  require termRepoServicer() == repoServicerUnlocking;

  mathint purchaseTokenBalanceBefore = unlockingAuctionPurchaseToken.balanceOf(offeror);

  require amount + purchaseTokenBalanceBefore < 2^256;

  unlockOfferPartial(e, id, offeror, amount);

  mathint purchaseTokenBalancAfter = unlockingAuctionPurchaseToken.balanceOf(offeror);

  assert purchaseTokenBalancAfter == purchaseTokenBalanceBefore + amount,
    "purchase token balance should increase by the provided amount";
}

rule unlockOfferPartialDoesNotAffectThirdParty(
  env e,
  bytes32 firstPartyOfferId,
  bytes32 thirdPartyOfferId,
  address firstPartyOfferor,
  uint256 firstPartyAmount
) {
  require firstPartyOfferId != thirdPartyOfferId;
  require harnessGetInternalOffers(thirdPartyOfferId).id == thirdPartyOfferId;

  TermAuctionOfferLockerHarness.TermAuctionOffer thirdPartyOfferBefore = harnessGetInternalOffers(thirdPartyOfferId);
  unlockOfferPartial(e, firstPartyOfferId, firstPartyOfferor, firstPartyAmount);

  bool thirdPartyOfferNotAffected = harnessCompareIncomingOfferWithInternalOffer(thirdPartyOfferBefore, thirdPartyOfferId);

  assert thirdPartyOfferNotAffected,
    "unlockOfferPartial should not modify offers that are not in args";
}

rule unlockOfferPartialRevertConditions(
  env e,
  bytes32 id,
  address offeror,
  uint256 amount
) {
  require repoServicerUnlocking == termRepoServicer();
  require repoLockerUnlocking == repoServicerUnlocking.termRepoLocker();
  require unlockingAuctionPurchaseToken == repoServicerUnlocking.purchaseToken();

  require amount + unlockingAuctionPurchaseToken.balanceOf(offeror) < 2^256;

  bool msgValueNotZero = e.msg.value != 0;
  bool notAuctioneer = !hasRole(AUCTIONEER_ROLE(), e.msg.sender);
  bool lockerNotAuctionLocker = !repoServicerUnlocking.hasRole(repoServicerUnlocking.AUCTION_LOCKER(), currentContract);
  bool servicerNotServicer = !repoLockerUnlocking.hasRole(repoLockerUnlocking.SERVICER_ROLE(), repoServicerUnlocking);
  bool insufficientLockerBalance = amount > unlockingAuctionPurchaseToken.balanceOf(repoLockerUnlocking);
  bool lockerTransfersPaused = repoLockerUnlocking.transfersPaused();

  bool isExpectedToRevert =
    msgValueNotZero ||
    notAuctioneer ||
    lockerNotAuctionLocker ||
    servicerNotServicer ||
    insufficientLockerBalance ||
    lockerTransfersPaused;

  unlockOfferPartial@withrevert(e, id, offeror, amount);

  assert isExpectedToRevert == lastReverted,
    "unlockOfferPartial should revert when revert conditions are met";
}

rule unlockOfferPartialMonotonicBehavior(
  env e,
  calldataarg args
) {
  uint256 offerCountBefore = offerCount();
  unlockOfferPartial(e, args);
  uint256 offerCountAfter = offerCount();

  assert offerCountAfter == offerCountBefore,
    "unlockOfferPartial should not affect the offerCount";
}