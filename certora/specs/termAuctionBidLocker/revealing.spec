/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
methods {
  function revealTime() external returns (uint256) envfree;
  function bidCount() external returns (uint256) envfree;
  function MAX_BID_PRICE() external returns (uint256) envfree;
  function harnessGetInternalBids(bytes32 bidId) external returns (TermAuctionBidLockerHarness.TermAuctionBid memory) envfree;
  function harnessGetInternalBidIsRevealed(bytes32 bidId) external returns (bool) envfree;
  function harnessGetInternalBidBidRevealedPrice(bytes32 bidId) external returns (uint256) envfree;
  function harnessGetInternalBidBidPriceHash(bytes32 bidId) external returns (bytes32) envfree;
  function harnessGenerateBidPriceHash(uint256 price, uint256 nonce) external returns (bytes32) envfree;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Reveal Bid Rules                                                                                                    |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule revealBidsIntegrity(
  env e,
  bytes32 id,
  uint256 price,
  uint256 nonce
) {

  // rule bounds
  require harnessGetInternalBids(id).id == id;
  // require harnessGetInternalBids(id).isRevealed == false;
  require harnessGetInternalBids(id).bidPriceHash == harnessGenerateBidPriceHash(price, nonce);

  // check values before revealBid process
  bool isRevealedBefore = harnessGetInternalBidIsRevealed(id);
  uint256 revealedPriceBefore = harnessGetInternalBidBidRevealedPrice(id);

  revealBids(e, [id], [price], [nonce]);

  bool isRevealedAfter = harnessGetInternalBidIsRevealed(id);
  uint256 revealedPriceAfter = harnessGetInternalBidBidRevealedPrice(id);

  assert isRevealedAfter && revealedPriceAfter == price,
    "revealBids should not revert";
}

rule revealBidsDoesNotAffectThirdParty(
  env e,
  bytes32 firstPartyId,
  uint256 firstPartyPrice,
  uint256 firstPartyNonce,
  bytes32 thirdPartyBidId
) {
  // rule bounds
  require firstPartyId != thirdPartyBidId;

  // third party not revealed before
  TermAuctionBidLockerHarness.TermAuctionBid thirdPartyBidBefore = harnessGetInternalBids(thirdPartyBidId);
  require thirdPartyBidBefore.id == thirdPartyBidId;
  require thirdPartyBidBefore.isRevealed == false;

  revealBids(e, [firstPartyId], [firstPartyPrice], [firstPartyNonce]);

  // third party not revealed after
  bool isThirdPartyRevealedAfter = harnessGetInternalBids(thirdPartyBidId).isRevealed;

  assert !isThirdPartyRevealedAfter,
    "revealBids should not reveal third party bids";
}

rule revealBidsRevertConditions(
  env e,
  bytes32 id,
  uint256 price,
  uint256 nonce
) {
  bool isNotInRevealPhase = e.block.timestamp < revealTime(); // AuctionNotRevealing
  bool isBidPriceModified = harnessGenerateBidPriceHash(price, nonce) != harnessGetInternalBidBidPriceHash(id); // BidPriceModified
  bool isTenderPriceTooHigh = price > MAX_BID_PRICE(); // TenderPriceTooHigh
  bool msgValueNotZero = e.msg.value != 0;

  bool isExpectedToRevert = isNotInRevealPhase || isBidPriceModified || isTenderPriceTooHigh || msgValueNotZero;

  revealBids@withrevert(e, [id], [price], [nonce]);

  assert lastReverted <=> isExpectedToRevert,
    "revealBids should revert if conditions are met";
}

rule revealBidsMonotonicBehavior(
  env e,
  calldataarg args
) {
  uint256 bidCountBefore = bidCount();
  revealBids(e, args);
  uint256 bidCountAfter = bidCount();
  assert bidCountBefore == bidCountAfter,
    "revealBids should not change bid count";
}