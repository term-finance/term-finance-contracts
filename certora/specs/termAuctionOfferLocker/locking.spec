using DummyERC20A as lockingAuctionPurchaseToken;
using TermRepoServicer as repoServicerLocking;
using TermRepoLocker as repoLockerOfferLocking;

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

methods {
  // function _.usdValueOfTokens(address token,uint256 amount) external returns (TermAuctionOfferLockerHarness.Exp) => usdValueCVL(token, amount);
  function ADMIN_ROLE() external returns (bytes32) envfree;
  function hasRole(bytes32, address) external returns (bool) envfree;
  function offerCount() external returns (uint256) envfree;
  function auctionStartTime() external returns (uint256) envfree;
  function revealTime() external returns (uint256) envfree;
  function minimumTenderAmount() external returns (uint256) envfree;
  function lockingPaused() external returns (bool) envfree;
  function unlockingPaused() external returns (bool) envfree;
  function purchaseToken() external returns (address) envfree;
  function MAX_OFFER_COUNT() external returns (uint256) envfree;
  function harnessGetInternalOffers(bytes32 offerId) external returns (TermAuctionOfferLockerHarness.TermAuctionOffer memory) envfree;
  function harnessOfferExists(bytes32 offerId) external returns (bool) envfree;
  function termRepoServicer() external returns (address) envfree;
  function TermRepoServicer.AUCTION_LOCKER() external returns (bytes32) envfree;
  function TermRepoServicer.hasRole(bytes32,address) external returns (bool) envfree;
  function TermRepoServicer.purchaseToken() external returns(address) envfree;
  function TermRepoServicer.termRepoLocker() external returns(address) envfree;
  function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
  function DummyERC20A.allowance(address,address) external returns (uint256) envfree;
  function DummyERC20A.myAddress() external returns(address) envfree;
  function harnessCompareIncomingOfferWithInternalOffer(TermAuctionOfferLockerHarness.TermAuctionOffer incomingOffer, bytes32 offerId) external returns (bool) envfree;
  function harnessGetInternalOfferId(bytes32 offerId) external returns (bytes32) envfree;
  function harnessGetInternalOfferOfferor(bytes32 offerId) external returns (address) envfree;
  function harnessGetInternalOfferOfferPriceHash(bytes32 offerId) external returns (bytes32) envfree;
  function harnessGetInternalOfferOfferRevealedPrice(bytes32 offerId) external returns (uint256) envfree;
  function harnessGetInternalOfferAmount(bytes32 offerId) external returns (uint256) envfree;
  function harnessGetInternalOfferIsRevealed(bytes32 offerId) external returns (bool) envfree;
  function harnessGenerateOfferId(bytes32 offerId, address offeror) external returns (bytes32) envfree;
  function harnessReentrancyGuardEntered() external returns (bool) envfree;
  function generateOfferIdPreview(bytes32,address) external returns (bytes32) envfree;

  function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
  function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
  function TermRepoLocker.transfersPaused() external returns (bool) envfree;

}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Invariants                                                                                                          |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

invariant lockedOfferIdAlwaysMatchesIndex(bytes32 offerId)
  harnessGetInternalOfferId(offerId) == offerId || harnessGetInternalOfferId(offerId) == to_bytes32(0)
  filtered { f ->
    f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllOffers(bytes32[],bytes32[]).selector
  }

ghost mathint lockedOfferCount {
  init_state axiom lockedOfferCount == 0;
}
hook Sstore offers[KEY bytes32 offerId].amount uint256 newOfferAmount (uint256 oldOfferAmount) {
  // Update both lockedOfferCount and lockedOfferIds.
  // If the offer is new, increment lockedOfferCount and add the offerId to lockedOfferIds.
  // A offer is determined to be new if the oldOffer's amount is 0 and the newOffer's amount is not 0.
  lockedOfferCount = lockedOfferCount + (
    (oldOfferAmount == 0 && newOfferAmount != 0)
      ? 1 // Created offer
      : 0
  );

  lockedOfferCount = lockedOfferCount - (
    (oldOfferAmount != 0 && newOfferAmount == 0)
      ? 1 // Created offer
      : 0
  );
}

invariant offerCountAlwaysMatchesNumberOfStoredOffers()
  to_mathint(offerCount()) == lockedOfferCount
  filtered { f ->
    f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllOffers(bytes32[],bytes32[]).selector &&
    f.selector != sig:pairTermContracts(address,address,address,address,address).selector
  }   { preserved {
      require(minimumTenderAmount() > 0);
    }
  }


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Lock Offers Rules                                                                                                   |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule lockOffersIntegrity(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();
  // Only handle one offer to simplify testing
  require offerSubmissions.length == 1;

  require harnessGetInternalOffers(offerSubmissions[0].id).amount == 0;
  require offerCount() < MAX_OFFER_COUNT();

  // ensure offer amount is valid
  require(minimumTenderAmount() > 0 && offerSubmissions[0].amount > minimumTenderAmount());

  // offerer must be msg.sender
  require offerSubmissions[0].offeror == e.msg.sender;

  require offerSubmissions[0].amount + lockingAuctionPurchaseToken.balanceOf(e.msg.sender) < 2^256;

  require offerSubmissions[0].purchaseToken == lockingAuctionPurchaseToken.myAddress();

  // require purchase token balance is positive
  require lockingAuctionPurchaseToken.balanceOf(e.msg.sender) > 0;

  TermAuctionOfferLockerHarness.TermAuctionOffer internalOffer = harnessGetInternalOffers(offerSubmissions[0].id);

  mathint oldLockedAmount = internalOffer.amount;
  mathint incomingAmount = offerSubmissions[0].amount;
  mathint amountToLock = (oldLockedAmount < incomingAmount) ? incomingAmount - oldLockedAmount : oldLockedAmount - incomingAmount;

  uint256 offerCountBefore = offerCount();
  mathint purchaseTokenBalanceBefore = lockingAuctionPurchaseToken.balanceOf(e.msg.sender);

  lockOffers(e, offerSubmissions);

  uint256 offerCountAfter = offerCount();
  mathint purchaseTokenOneBalanceAfter = lockingAuctionPurchaseToken.balanceOf(e.msg.sender);
  
  assert (purchaseTokenOneBalanceAfter == purchaseTokenBalanceBefore - amountToLock),
    "lockOffers should transfer collateral tokens from offeror to contract";
}

rule lockOffersDoesNotAffectThirdParty(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions,
  bytes32 thirdPartyOfferId,
  uint256 collateralTokenIndex
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();

  // Assume that any saved offers are saved under the same index as its id
  // See `lockedOfferIdAlwaysMatchesIndex` invariant above
  require thirdPartyOfferId == harnessGetInternalOfferId(thirdPartyOfferId);

  // Ensure that the third party offer is not in the offerSubmissions
  bytes32 offerSubmissionOneId = offerSubmissions[0].id;
  require offerSubmissions.length <= 1;
  require thirdPartyOfferId != offerSubmissionOneId;
  require thirdPartyOfferId != harnessGenerateOfferId(offerSubmissionOneId, e.msg.sender);

  bytes32 offerIdBefore = harnessGetInternalOfferId(thirdPartyOfferId);
  address offerorBefore = harnessGetInternalOfferOfferor(thirdPartyOfferId);
  bytes32 offerPriceHashBefore = harnessGetInternalOfferOfferPriceHash(thirdPartyOfferId);
  uint256 offerRevealedPriceBefore = harnessGetInternalOfferOfferRevealedPrice(thirdPartyOfferId);
  uint256 offerAmountBefore = harnessGetInternalOfferAmount(thirdPartyOfferId);
  bool offerIsRevealedBefore = harnessGetInternalOfferIsRevealed(thirdPartyOfferId);
  lockOffers(e, offerSubmissions);
  bytes32 offerIdAfter = harnessGetInternalOfferId(thirdPartyOfferId);
  address offerorAfter = harnessGetInternalOfferOfferor(thirdPartyOfferId);
  bytes32 offerPriceHashAfter = harnessGetInternalOfferOfferPriceHash(thirdPartyOfferId);
  uint256 offerRevealedPriceAfter = harnessGetInternalOfferOfferRevealedPrice(thirdPartyOfferId);
  uint256 offerAmountAfter = harnessGetInternalOfferAmount(thirdPartyOfferId);
  bool offerIsRevealedAfter = harnessGetInternalOfferIsRevealed(thirdPartyOfferId);

  assert offerIdBefore == offerIdAfter,
    "lockRolloverOffer should not modify offer id";
  assert offerorBefore == offerorAfter,
    "lockRolloverOffer should not modify offeror";
  assert offerPriceHashBefore == offerPriceHashAfter,
    "lockRolloverOffer should not modify offer price hash";
  assert offerRevealedPriceBefore == offerRevealedPriceAfter,
    "lockRolloverOffer should not modify offer revealed price";
  assert offerAmountBefore == offerAmountAfter,
    "lockRolloverOffer should not modify offer amount";
  assert offerIsRevealedBefore == offerIsRevealedAfter,
    "lockRolloverOffer should not modify offer revealed status";
}

// Locking a new offer increases the offer count, editing keeps it the same
rule lockOffersMonotonicBehavior(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();

  uint256 offerCountBefore = offerCount();
  lockOffers(e, offerSubmissions);
  uint256 offerCountAfter = offerCount();

  assert offerCountAfter >= offerCountBefore,
    "offerCount should increment or maintain the same value after locking an offer";
}

rule lockOffersRevertConditions(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions
) {
  // rule bounds
  require(e.msg.sender != 0); // Not possible for this function to be called by the zero address.
  require offerSubmissions.length == 1;
  require(termRepoServicer() == repoServicerLocking);
  require(repoServicerLocking.termRepoLocker() == repoLockerOfferLocking);
  require(repoServicerLocking.purchaseToken() == lockingAuctionPurchaseToken);
  require(purchaseToken() == lockingAuctionPurchaseToken);

  require(lockingAuctionPurchaseToken.balanceOf(repoLockerOfferLocking) + offerSubmissions[0].amount <= max_uint256);
  require(lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) + offerSubmissions[0].amount <= max_uint256);

  TermAuctionOfferLockerHarness.TermAuctionOffer existingOffer = harnessGetInternalOffers(offerSubmissions[0].id);
  uint256 existingOfferAmount = existingOffer.amount;
  address existingOfferor = existingOffer.offeror;

  require(lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) + existingOffer.amount <= max_uint256);
  require(lockingAuctionPurchaseToken.balanceOf(repoLockerOfferLocking) >= existingOfferAmount); // Proved in lockerPurchaseTokenBalanceGreaterThanOfferLedgerBalance of ./stateVariables.spec 
  uint256 offerDiff = existingOfferAmount > offerSubmissions[0].amount  ? assert_uint256(existingOfferAmount-offerSubmissions[0].amount) : assert_uint256(offerSubmissions[0].amount-existingOfferAmount);


  bytes32 generatedOfferId = generateOfferIdPreview(offerSubmissions[0].id, offerSubmissions[0].offeror);
  TermAuctionOfferLockerHarness.TermAuctionOffer existingGeneratedOffer = harnessGetInternalOffers(generatedOfferId);
  bool offerIdAlreadyExists = existingGeneratedOffer.amount != 0 && existingOffer.amount == 0 ; // OfferIdAlreadyExists

  // support for 2 collateral tokens

  bool auctionNotOpen = e.block.timestamp < auctionStartTime() || e.block.timestamp > revealTime(); // AuctionNotOpen
  bool lockingPaused = lockingPaused(); // LockingPaused
  bool reentrant = harnessReentrancyGuardEntered();
  bool notSameOfferor = offerSubmissions[0].offeror != e.msg.sender ? true : false; // OfferNotOwned
  bool offerCountReached = offerCount() >= MAX_OFFER_COUNT() ? true : false; // MaxOfferCountReached
  bool offerNotOwned = harnessGetInternalOffers(offerSubmissions[0].id).amount != 0 && harnessGetInternalOffers(offerSubmissions[0].id).offeror != offerSubmissions[0].offeror; // OfferNotOwned

  bool editingOfferNotOwned = existingOfferAmount != 0
    && existingOfferor != offerSubmissions[0].offeror; // OfferNotOwned
  
  bool purchaseTokenNotApproved = offerSubmissions[0].purchaseToken != purchaseToken() ? true : false; // PurchaseTokenNotApproved
  bool offerAmountTooLow = offerSubmissions[0].amount < minimumTenderAmount(); // OfferAmountTooLow
  bool purchaseTokenBalanceTooLow = existingOfferAmount < offerSubmissions[0].amount  && lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) < offerDiff;
  bool purchaseTokenApprovalsTooLow = existingOfferAmount < offerSubmissions[0].amount && lockingAuctionPurchaseToken.allowance(offerSubmissions[0].offeror, repoLockerUnlocking) < offerDiff;
  bool lockerTransfersPaused = existingOfferAmount != offerSubmissions[0].amount && repoLockerOfferLocking.transfersPaused();
  bool repoServicerNotPairedToLocker = existingOfferAmount != offerSubmissions[0].amount && !repoLockerOfferLocking.hasRole(repoLockerOfferLocking.SERVICER_ROLE(), repoServicerLocking);
  bool offerLockerNotPairedToRepoServicer = existingOfferAmount != offerSubmissions[0].amount && !repoServicerLocking.hasRole(repoServicerLocking.AUCTION_LOCKER(), currentContract);

  bool nonZeroMsgValue = e.msg.value != 0;

  bool isExpectedToRevert =
    auctionNotOpen || lockingPaused || reentrant || notSameOfferor ||
    offerCountReached || offerNotOwned || editingOfferNotOwned || offerIdAlreadyExists ||
    purchaseTokenNotApproved || offerAmountTooLow || purchaseTokenBalanceTooLow || purchaseTokenApprovalsTooLow || lockerTransfersPaused 
    || repoServicerNotPairedToLocker || offerLockerNotPairedToRepoServicer || nonZeroMsgValue;

  lockOffers@withrevert(e, offerSubmissions);
  assert lastReverted <=> isExpectedToRevert,
    "lockOffers should revert when one of the revert conditions is reached";
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Lock Offers With Referral Rules                                                                                     |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule lockOffersWithReferralIntegrity(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions,
  address referrer
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();
  // Only handle one offer to simplify testing
  require offerSubmissions.length == 1;

  require referrer != e.msg.sender;

  require harnessGetInternalOffers(offerSubmissions[0].id).amount == 0;
  require offerCount() < MAX_OFFER_COUNT();

  // ensure offer amount is valid
  require(minimumTenderAmount() > 0 && offerSubmissions[0].amount > minimumTenderAmount());

  // offerer must be msg.sender
  require offerSubmissions[0].offeror == e.msg.sender;

  require offerSubmissions[0].amount + lockingAuctionPurchaseToken.balanceOf(e.msg.sender) < 2^256; //Prevents overflow

  require offerSubmissions[0].purchaseToken == lockingAuctionPurchaseToken.myAddress();

  // require purchase token balance is positive
  require lockingAuctionPurchaseToken.balanceOf(e.msg.sender) > 0;

  TermAuctionOfferLockerHarness.TermAuctionOffer internalOffer = harnessGetInternalOffers(offerSubmissions[0].id);

  mathint oldLockedAmount = internalOffer.amount;
  mathint incomingAmount = offerSubmissions[0].amount;
  mathint amountToLock = (oldLockedAmount < incomingAmount) ? incomingAmount - oldLockedAmount : oldLockedAmount - incomingAmount;

  uint256 offerCountBefore = offerCount();
  mathint purchaseTokenBalanceBefore = lockingAuctionPurchaseToken.balanceOf(e.msg.sender);

  lockOffersWithReferral(e, offerSubmissions, referrer);

  uint256 offerCountAfter = offerCount();
  mathint purchaseTokenOneBalanceAfter = lockingAuctionPurchaseToken.balanceOf(e.msg.sender);
  
  assert (purchaseTokenOneBalanceAfter == purchaseTokenBalanceBefore - amountToLock),
    "lockOffers should transfer collateral tokens from offeror to contract";
}

rule lockOffersWithReferralDoesNotAffectThirdParty(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions,
  bytes32 thirdPartyOfferId,
  address referrer,
  uint256 collateralTokenIndex
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();

  // Assume that any saved offers are saved under the same index as its id
  // See `lockedOfferIdAlwaysMatchesIndex` invariant above
  require thirdPartyOfferId == harnessGetInternalOfferId(thirdPartyOfferId);

  // Ensure that the third party offer is not in the offerSubmissions
  bytes32 offerSubmissionOneId = offerSubmissions[0].id;
  require offerSubmissions.length <= 1;
  require thirdPartyOfferId != offerSubmissionOneId;
  require thirdPartyOfferId != harnessGenerateOfferId(offerSubmissionOneId, e.msg.sender);

  bytes32 offerIdBefore = harnessGetInternalOfferId(thirdPartyOfferId);
  address offerorBefore = harnessGetInternalOfferOfferor(thirdPartyOfferId);
  bytes32 offerPriceHashBefore = harnessGetInternalOfferOfferPriceHash(thirdPartyOfferId);
  uint256 offerRevealedPriceBefore = harnessGetInternalOfferOfferRevealedPrice(thirdPartyOfferId);
  uint256 offerAmountBefore = harnessGetInternalOfferAmount(thirdPartyOfferId);
  bool offerIsRevealedBefore = harnessGetInternalOfferIsRevealed(thirdPartyOfferId);
  lockOffersWithReferral(e, offerSubmissions, referrer);
  bytes32 offerIdAfter = harnessGetInternalOfferId(thirdPartyOfferId);
  address offerorAfter = harnessGetInternalOfferOfferor(thirdPartyOfferId);
  bytes32 offerPriceHashAfter = harnessGetInternalOfferOfferPriceHash(thirdPartyOfferId);
  uint256 offerRevealedPriceAfter = harnessGetInternalOfferOfferRevealedPrice(thirdPartyOfferId);
  uint256 offerAmountAfter = harnessGetInternalOfferAmount(thirdPartyOfferId);
  bool offerIsRevealedAfter = harnessGetInternalOfferIsRevealed(thirdPartyOfferId);

  assert offerIdBefore == offerIdAfter,
    "lockRolloverOffer should not modify offer id";
  assert offerorBefore == offerorAfter,
    "lockRolloverOffer should not modify offeror";
  assert offerPriceHashBefore == offerPriceHashAfter,
    "lockRolloverOffer should not modify offer price hash";
  assert offerRevealedPriceBefore == offerRevealedPriceAfter,
    "lockRolloverOffer should not modify offer revealed price";
  assert offerAmountBefore == offerAmountAfter,
    "lockRolloverOffer should not modify offer amount";
  assert offerIsRevealedBefore == offerIsRevealedAfter,
    "lockRolloverOffer should not modify offer revealed status";
}

rule lockOffersWithReferralRevertConditions(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions,
  address referrer
) {
  // rule bounds
  require(e.msg.sender != 0); // Not possible for this function to be called by the zero address.
  require offerSubmissions.length == 1;
  require(termRepoServicer() == repoServicerLocking);
  require(repoServicerLocking.termRepoLocker() == repoLockerOfferLocking);
  require(repoServicerLocking.purchaseToken() == lockingAuctionPurchaseToken);
  require(purchaseToken() == lockingAuctionPurchaseToken);
  require(repoLockerOfferLocking.SERVICER_ROLE() != repoServicerLocking.AUCTION_LOCKER());
  require(repoLockerOfferLocking.SERVICER_ROLE() != to_bytes32(0));
  require(repoServicerLocking.AUCTION_LOCKER() != to_bytes32(0));

  require(lockingAuctionPurchaseToken.balanceOf(repoLockerOfferLocking) + offerSubmissions[0].amount <= max_uint256);
  require(lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) + offerSubmissions[0].amount <= max_uint256);

  TermAuctionOfferLockerHarness.TermAuctionOffer existingOffer = harnessGetInternalOffers(offerSubmissions[0].id);
  uint256 existingOfferAmount = existingOffer.amount;
  address existingOfferor = existingOffer.offeror;

  require(lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) + existingOffer.amount <= max_uint256);
  require(lockingAuctionPurchaseToken.balanceOf(repoLockerOfferLocking) >= existingOfferAmount); // Proved in lockerPurchaseTokenBalanceGreaterThanOfferLedgerBalance of ./stateVariables.spec 
  uint256 offerDiff = existingOfferAmount > offerSubmissions[0].amount  ? assert_uint256(existingOfferAmount-offerSubmissions[0].amount) : assert_uint256(offerSubmissions[0].amount-existingOfferAmount);


  bytes32 generatedOfferId = generateOfferIdPreview(offerSubmissions[0].id, offerSubmissions[0].offeror);
  TermAuctionOfferLockerHarness.TermAuctionOffer existingGeneratedOffer = harnessGetInternalOffers(generatedOfferId);
  bool offerIdAlreadyExists = existingGeneratedOffer.amount != 0 && existingOffer.amount == 0 ; // OfferIdAlreadyExists


  bool auctionNotOpen = e.block.timestamp < auctionStartTime() || e.block.timestamp > revealTime(); // AuctionNotOpen
  bool lockingPaused = lockingPaused(); // LockingPaused
  bool reentrant = harnessReentrancyGuardEntered();
  bool sameReferral = e.msg.sender == referrer; // InvalidSelfReferral
  bool notSameOfferor = offerSubmissions[0].offeror != e.msg.sender ? true : false; // OfferNotOwned
  bool offerCountReached = offerCount() >= MAX_OFFER_COUNT() ? true : false; // MaxOfferCountReached
  bool offerNotOwned = harnessGetInternalOffers(offerSubmissions[0].id).amount != 0 && harnessGetInternalOffers(offerSubmissions[0].id).offeror != offerSubmissions[0].offeror; // OfferNotOwned
  bool purchaseTokenNotApproved = offerSubmissions[0].purchaseToken != purchaseToken() ? true : false; // PurchaseTokenNotApproved
  bool offerAmountTooLow = offerSubmissions[0].amount < minimumTenderAmount(); // OfferAmountTooLow
  bool editingOfferNotOwned = existingOfferAmount != 0
    && existingOfferor != offerSubmissions[0].offeror; // OfferNotOwned
  
  bool purchaseTokenBalanceTooLow = existingOfferAmount < offerSubmissions[0].amount  && lockingAuctionPurchaseToken.balanceOf(offerSubmissions[0].offeror) < offerDiff;
  bool purchaseTokenApprovalsTooLow = existingOfferAmount < offerSubmissions[0].amount && lockingAuctionPurchaseToken.allowance(offerSubmissions[0].offeror, repoLockerUnlocking) < offerDiff;
  bool lockerTransfersPaused = existingOfferAmount != offerSubmissions[0].amount && repoLockerOfferLocking.transfersPaused();
  bool repoServicerNotPairedToLocker = existingOfferAmount != offerSubmissions[0].amount && !repoLockerOfferLocking.hasRole(repoLockerOfferLocking.SERVICER_ROLE(), repoServicerLocking);
  bool offerLockerNotPairedToRepoServicer = existingOfferAmount != offerSubmissions[0].amount && !repoServicerLocking.hasRole(repoServicerLocking.AUCTION_LOCKER(), currentContract);

  bool nonZeroMsgValue = e.msg.value != 0;

  bool isExpectedToRevert =
    auctionNotOpen || lockingPaused || reentrant || notSameOfferor || sameReferral ||
    offerCountReached || offerNotOwned || editingOfferNotOwned || offerIdAlreadyExists ||
    purchaseTokenNotApproved || offerAmountTooLow || purchaseTokenBalanceTooLow || purchaseTokenApprovalsTooLow || lockerTransfersPaused 
    || repoServicerNotPairedToLocker || offerLockerNotPairedToRepoServicer || nonZeroMsgValue;

  lockOffersWithReferral@withrevert(e, offerSubmissions, referrer);
  assert lastReverted <=> isExpectedToRevert,
    "lockOffersWithReferral should revert when one of the revert conditions is reached";
}

rule lockOffersWithReferralMonotonicBehavior(
  env e,
  TermAuctionOfferLockerHarness.TermAuctionOfferSubmission[] offerSubmissions,
  address referrer
) {
  // rule bounds
  require termRepoServicer() == repoServicerLocking;
  require e.msg.sender != repoServicerLocking.termRepoLocker();

  uint256 offerCountBefore = offerCount();
  lockOffersWithReferral(e, offerSubmissions, referrer);
  uint256 offerCountAfter = offerCount();

  assert offerCountAfter >= offerCountBefore,
    "offerCount should increment or maintain the same value after locking an offer";
}