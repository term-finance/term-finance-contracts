/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
methods {
  function revealTime() external returns (uint256) envfree;
  function offerCount() external returns (uint256) envfree;
  function MAX_OFFER_PRICE() external returns (uint256) envfree;
  function harnessGetInternalOffers(bytes32 offerId) external returns (TermAuctionOfferLockerHarness.TermAuctionOffer memory) envfree;
  function harnessGetInternalOfferIsRevealed(bytes32 offerId) external returns (bool) envfree;
  function harnessGetInternalOfferOfferRevealedPrice(bytes32 offerId) external returns (uint256) envfree;
  function harnessGetInternalOfferOfferPriceHash(bytes32 offerId) external returns (bytes32) envfree;
  function harnessGenerateOfferPriceHash(uint256 price, uint256 nonce) external returns (bytes32) envfree;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Reveal Offer Rules                                                                                                  |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule revealOffersIntegrity(
  env e,
  bytes32 id,
  uint256 price,
  uint256 nonce
) {

  // rule bounds
  require harnessGetInternalOffers(id).id == id;
  // require harnessGetInternalOffers(id).isRevealed == false;
  require harnessGetInternalOffers(id).offerPriceHash == harnessGenerateOfferPriceHash(price, nonce);

  // check values before revealOffer process
  bool isRevealedBefore = harnessGetInternalOfferIsRevealed(id);
  uint256 revealedPriceBefore = harnessGetInternalOfferOfferRevealedPrice(id);

  revealOffers(e, [id], [price], [nonce]);

  bool isRevealedAfter = harnessGetInternalOfferIsRevealed(id);
  uint256 revealedPriceAfter = harnessGetInternalOfferOfferRevealedPrice(id);

  assert isRevealedAfter && revealedPriceAfter == price,
    "revealOffers should not revert";
}

rule revealOffersDoesNotAffectThirdParty(
  env e,
  bytes32 firstPartyId,
  uint256 firstPartyPrice,
  uint256 firstPartyNonce,
  bytes32 thirdPartyOfferId
) {
  // rule bounds
  require firstPartyId != thirdPartyOfferId;

  // third party not revealed before
  TermAuctionOfferLockerHarness.TermAuctionOffer thirdPartyOfferBefore = harnessGetInternalOffers(thirdPartyOfferId);
  require thirdPartyOfferBefore.id == thirdPartyOfferId;
  require thirdPartyOfferBefore.isRevealed == false;

  revealOffers(e, [firstPartyId], [firstPartyPrice], [firstPartyNonce]);

  // third party not revealed after
  bool isThirdPartyRevealedAfter = harnessGetInternalOffers(thirdPartyOfferId).isRevealed;

  assert !isThirdPartyRevealedAfter,
    "revealOffers should not reveal third party offers";
}

rule revealOffersRevertConditions(
  env e,
  bytes32 id,
  uint256 price,
  uint256 nonce
) {
  bool isNotInRevealPhase = e.block.timestamp < revealTime(); // AuctionNotRevealing
  bool isOfferPriceModified = harnessGenerateOfferPriceHash(price, nonce) != harnessGetInternalOfferOfferPriceHash(id); // OfferPriceModified
  bool isTenderPriceTooHigh = price > MAX_OFFER_PRICE(); // TenderPriceTooHigh
  bool msgValueNotZero = e.msg.value != 0;

  bool isExpectedToRevert = isNotInRevealPhase || isOfferPriceModified || isTenderPriceTooHigh || msgValueNotZero;

  revealOffers@withrevert(e, [id], [price], [nonce]);

  assert lastReverted <=> isExpectedToRevert,
    "revealOffers should revert if conditions are met";
}

rule revealOffersMonotonicBehavior(
  env e,
  calldataarg args
) {
  uint256 offerCountBefore = offerCount();
  revealOffers(e, args);
  uint256 offerCountAfter = offerCount();
  assert offerCountBefore == offerCountAfter,
    "revealOffers should not change offer count";
}