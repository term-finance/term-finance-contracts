using DummyERC20A as lockingAuctionCollateralTokenOne;
using DummyERC20B as lockingAuctionCollateralTokenTwo;
using TermRepoCollateralManager as collateralManagerLocking;
using TermRepoLocker as lockerLocking;

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
    function hasRole(bytes32, address) external returns (bool) envfree;
    function bidCount() external returns (uint256) envfree;
    function auctionStartTime() external returns (uint256) envfree;
    function revealTime() external returns (uint256) envfree;
    function minimumTenderAmount() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function collateralTokens(address) external returns (bool) envfree;
    function termRepoCollateralManager() external returns (address) envfree;
    function lockingPaused() external returns (bool) envfree;
    function unlockingPaused() external returns (bool) envfree;
    function MAX_BID_COUNT() external returns (uint256) envfree;
    function harnessGetInternalBids(bytes32 bidId) external returns (TermAuctionBidLockerHarness.TermAuctionBid memory) envfree;
    function harnessBidExists(bytes32 bidId) external returns (bool) envfree;
    function harnessCompareIncomingBidWithInternalBid(TermAuctionBidLockerHarness.TermAuctionBid incomingBid, bytes32 bidId) external returns (bool) envfree;
    function generateBidIdPreview(bytes32,address) external returns (bytes32) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20A.myAddress() external returns(address) envfree;
    function DummyERC20B.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20B.myAddress() external returns(address) envfree;
    function TermRepoCollateralManager.AUCTION_LOCKER() external returns (bytes32) envfree;
    function TermRepoCollateralManager.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoCollateralManager.termRepoLocker() external returns(address) envfree;
    function _.usdValueOfTokens(address token, uint256 amount) external => usdValueCVL(token, amount) expect (ExponentialNoError.Exp);
    function harnessIsInInitialCollateralShortFall(uint256 bidAmount, address[] collateralTokens_, uint256[] collateralAmounts) external returns (bool) envfree;
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
    function harnessContainsBidId(TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bids, bytes32 bidId) external returns (bool) envfree;
    function harnessGenerateBidId(bytes32 id, address user) external returns (bytes32) envfree;
    function harnessReentrancyGuardEntered() external returns (bool) envfree;

    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;

    function DummyERC20A.allowance(address,address) external returns (uint256) envfree;
    function DummyERC20A.decimals() external returns (uint256) envfree => CONSTANT;
    function DummyERC20A.balanceOf(address) external returns (uint256) envfree;
    function DummyERC20B.allowance(address,address) external returns (uint256) envfree;
    function DummyERC20B.decimals() external returns (uint256) envfree => ALWAYS(18);
    function DummyERC20B.balanceOf(address) external returns (uint256) envfree;
    function _._ external => DISPATCH [
       collateralManagerLocking.auctionUnlockCollateral(address,address,uint256),
       collateralManagerLocking.auctionLockCollateral(address,address,uint256)
    ] default HAVOC_ALL;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Invariants                                                                                                          |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

invariant lockedBidIdAlwaysMatchesIndex(bytes32 bidId)
  harnessGetInternalBidId(bidId) == bidId || harnessGetInternalBidId(bidId) == to_bytes32(0)
  filtered { f ->
    f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector
  }

ghost mathint lockedBidCount {
  init_state axiom lockedBidCount == 0;
}
ghost mathint lockedBidCountWithoutRollovers {
  init_state axiom lockedBidCountWithoutRollovers == 0;
}
hook Sstore bids[KEY bytes32 bidId].amount uint256 newBidAmount (uint256 oldBidAmount) {
  // Update both lockedBidCount and lockedBidIds.
  // If the bid is new, increment lockedBidCount and add the bidId to lockedBidIds.
  // A bid is determined to be new if the oldBid's amount is 0 and the newBid's amount is not 0.
  lockedBidCount = lockedBidCount + (
    (oldBidAmount == 0 && newBidAmount != 0)
      ? 1 // Created bid
      : 0
  ) - (
    (oldBidAmount != 0 && newBidAmount == 0)
      ? 1 // Deleted bid
      : 0
  );
  lockedBidCountWithoutRollovers = lockedBidCountWithoutRollovers + (
    (oldBidAmount == 0 && newBidAmount != 0)
      ? 1 // Created bid
      : 0
  )- (
    (oldBidAmount != 0 && newBidAmount == 0)
      ? 1 // Deleted bid
      : 0
  );
}

// We split into two invariants to handle this for now.
invariant bidCountAlwaysMatchesNumberOfStoredBids()
  to_mathint(bidCount()) == lockedBidCount
  filtered { f ->
    f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector &&
    f.selector != sig:lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector
  }{ preserved {
      require(minimumTenderAmount() > 0);
    }
  }
invariant bidCountAlwaysMatchesNumberOfStoredBidsWithoutRollovers()
  to_mathint(bidCount()) == lockedBidCountWithoutRollovers
  filtered { f ->
    f.contract == currentContract &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector &&
    f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector
  }{ preserved {
      require(minimumTenderAmount() > 0);
    }
  }


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Lock Bids Rules                                                                                                     |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule lockBidsIntegrity(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions
) {
  // rule bounds
  require termRepoCollateralManager() == collateralManagerLocking;
  require e.msg.sender != collateralManagerLocking.termRepoLocker();
  // Only handle one bid to simplify testing
  require bidSubmissions.length == 1;

  require bidCount() < MAX_BID_COUNT();

  // ensure bid amount is valid
  require(minimumTenderAmount() > 0 && bidSubmissions[0].amount > minimumTenderAmount());

  // bidder must be msg.sender
  require bidSubmissions[0].bidder == e.msg.sender;

  // 2 collateral tokens are supported
  require bidSubmissions[0].collateralTokens.length == 2 && bidSubmissions[0].collateralAmounts.length == 2;
  require bidSubmissions[0].collateralTokens[0] == lockingAuctionCollateralTokenOne;
  require bidSubmissions[0].collateralTokens[1] == lockingAuctionCollateralTokenTwo;

  // ensure collateral amount is valid
  require bidSubmissions[0].collateralAmounts[0] <= lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) && bidSubmissions[0].collateralAmounts[0] > 0;
  require bidSubmissions[0].collateralAmounts[1] <= lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) && bidSubmissions[0].collateralAmounts[1] > 0;

  require bidSubmissions[0].collateralAmounts[0] + lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) < 2^256;
  require bidSubmissions[0].collateralAmounts[1] + lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) < 2^256;

  // require collateral token balance is positive
  require lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) > 0;
  require lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) > 0;

  bytes32 bidOneId = bidSubmissions[0].id;
  mathint oldAmount = harnessGetInternalBidAmount(bidOneId);
  bool bidExists = oldAmount != 0;

  mathint oldCollateralOneAmount = harnessGetInternalBidCollateralAmount(bidOneId, 0);
  mathint newCollateralOneAmount = bidSubmissions[0].collateralAmounts[0];
  mathint collateralOneAmountToLock = bidExists ? newCollateralOneAmount - oldCollateralOneAmount : newCollateralOneAmount;

  mathint oldCollateralTwoAmount = harnessGetInternalBidCollateralAmount(bidOneId, 1);
  mathint newCollateralTwoAmount = bidSubmissions[0].collateralAmounts[1];
  mathint collateralTwoAmountToLock = bidExists ? newCollateralTwoAmount - oldCollateralTwoAmount : newCollateralTwoAmount;

  mathint collateralTokenOneBalanceBefore = lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceBefore = lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);

  lockBids(e, bidSubmissions);

  mathint collateralTokenOneBalanceAfter = lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceAfter = lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);
  
  assert
    (collateralTokenOneBalanceAfter == collateralTokenOneBalanceBefore - collateralOneAmountToLock),
    "lockBids should transfer collateral tokens from bidder to contract";
  assert
    (collateralTokenTwoBalanceAfter == collateralTokenTwoBalanceBefore - collateralTwoAmountToLock),
    "lockBids should transfer collateral tokens from bidder to contract";
}

rule lockBidsDoesNotAffectThirdParty(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions,
  bytes32 thirdPartyBidId,
  uint256 collateralTokenIndex
) {
  // Rule bounds
  require termRepoCollateralManager() == collateralManagerLocking;
  require e.msg.sender != collateralManagerLocking.termRepoLocker();

  // Assume that any saved bids are saved under the same index as its id
  // See `lockedBidIdAlwaysMatchesIndex` invariant above
  require thirdPartyBidId == harnessGetInternalBidId(thirdPartyBidId);

  // Ensure that the third party bid is not in the bidSubmissions
  bytes32 bidSubmissionOneId = bidSubmissions[0].id;
  require bidSubmissions.length <= 1;
  require thirdPartyBidId != bidSubmissionOneId;
  require thirdPartyBidId != harnessGenerateBidId(bidSubmissionOneId, e.msg.sender);


  bytes32 bidIdBefore = harnessGetInternalBidId(thirdPartyBidId);
  address bidderBefore = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashBefore = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceBefore = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountBefore = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountBefore = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverBefore = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressBefore = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedBefore = harnessGetInternalBidIsRevealed(thirdPartyBidId);
  lockBids(e, bidSubmissions);
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

// Locking a new bid increases the bid count, editing keeps it the same
rule lockBidsMonotonicBehavior(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions
) {
  // require termRepoCollateralManager() == collateralManagerLocking;
  // require e.msg.sender != collateralManagerLocking.termRepoLocker();

  uint256 bidCountBefore = bidCount();
  lockBids(e, bidSubmissions);
  uint256 bidCountAfter = bidCount();

  assert bidCountAfter >= bidCountBefore,
    "bidCount should either increase or stay the same after lockBids is called";
}

rule lockBidsRevertConditions(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions
) {
  // rule bounds
  require(e.msg.sender != 0); // Not possible for this function to be called by the zero address.
  require bidSubmissions.length == 1;
  require(bidSubmissions[0].collateralAmounts.length == 2);
  require(bidSubmissions[0].collateralTokens.length == 2);

  require(bidSubmissions[0].collateralTokens[0] == lockingAuctionCollateralTokenOne);
  require(bidSubmissions[0].collateralTokens[1] == lockingAuctionCollateralTokenTwo);
  require(termRepoCollateralManager() == collateralManagerLocking);
  require(collateralManagerLocking.termRepoLocker() == lockerLocking);


  // support for 2 collateral tokens
  TermAuctionBidLockerHarness.TermAuctionBid existingBid = harnessGetInternalBids(bidSubmissions[0].id);
  require(existingBid.amount == 0 => existingBid.collateralTokens[0] == 0 && existingBid.collateralTokens[1] == 0); // nonexistent bid will not have existing collateral due to minimum bid requirement.
  require(existingBid.collateralTokens[0] == lockingAuctionCollateralTokenOne);
  require(existingBid.collateralTokens[1] == lockingAuctionCollateralTokenTwo);
  require existingBid.collateralTokens.length == 2;
  require existingBid.collateralAmounts.length == 2;
  uint256 bidCollat1Diff =  existingBid.collateralAmounts[0] > bidSubmissions[0].collateralAmounts[0] ? assert_uint256(existingBid.collateralAmounts[0]- bidSubmissions[0].collateralAmounts[0]) : assert_uint256(bidSubmissions[0].collateralAmounts[0]-existingBid.collateralAmounts[0]);
  uint256 bidCollat2Diff =  existingBid.collateralAmounts[1] > bidSubmissions[0].collateralAmounts[1] ? assert_uint256(existingBid.collateralAmounts[1]- bidSubmissions[0].collateralAmounts[1]) : assert_uint256(bidSubmissions[0].collateralAmounts[1]-existingBid.collateralAmounts[1]);

  require(lockingAuctionCollateralTokenOne.balanceOf(lockerLocking) + bidCollat1Diff <= max_uint256);
  require(lockingAuctionCollateralTokenTwo.balanceOf(lockerLocking) + bidCollat2Diff <= max_uint256);
  require(lockingAuctionCollateralTokenOne.balanceOf(bidSubmissions[0].bidder) + bidCollat1Diff <= max_uint256);
  require(lockingAuctionCollateralTokenTwo.balanceOf(bidSubmissions[0].bidder) + bidCollat2Diff <= max_uint256);

  uint256 existingBidAmount = existingBid.amount;
  address existingBidder = existingBid.bidder;

  require(lockingAuctionCollateralTokenOne.balanceOf(lockerLocking) >= existingBid.collateralAmounts[0]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec 
  require(lockingAuctionCollateralTokenTwo.balanceOf(lockerLocking) >= existingBid.collateralAmounts[1]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec 

  bytes32 generatedBidId = generateBidIdPreview(bidSubmissions[0].id, bidSubmissions[0].bidder);
  TermAuctionBidLockerHarness.TermAuctionBid existingGeneratedBid = harnessGetInternalBids(generatedBidId);
  uint256 existingGeneratedBidAmount = existingGeneratedBid.amount;

  bool msgValueIsNotZero = e.msg.value != 0;
  bool reentrant = harnessReentrancyGuardEntered();
  bool auctionNotOpen = e.block.timestamp < auctionStartTime() || e.block.timestamp > revealTime(); // AuctionNotOpen
  bool lockingPaused = lockingPaused(); // LockingPaused
  bool bidSubmissionNotOwned = bidSubmissions[0].bidder != e.msg.sender; // BidNotOwned
  bool maxBidCountReached = bidCount() >= MAX_BID_COUNT(); // MaxBidCountReached
  bool bidIdAlreadyExists = existingGeneratedBid.amount != 0 && existingBid.amount == 0 ; // BidIdAlreadyExists

  bool editingBidNotOwned = existingBidAmount != 0
    && existingBidder != bidSubmissions[0].bidder; // BidNotOwned
  bool purchaseTokenNotApproved = bidSubmissions[0].purchaseToken != purchaseToken(); // PurchaseTokenNotApproved
  bool firstCollateralTokenNotApproved = !collateralTokens(bidSubmissions[0].collateralTokens[0]); // CollateralTokenNotApproved
  bool secondCollateralTokenNotApproved = !collateralTokens(bidSubmissions[0].collateralTokens[1]); // CollateralTokenNotApproved
  bool bidAmountTooLow = bidSubmissions[0].amount < minimumTenderAmount(); // BidAmountTooLow
  bool collateralBalanceTooLow = ((existingBid.collateralAmounts[0] < bidSubmissions[0].collateralAmounts[0]) && lockingAuctionCollateralTokenOne.balanceOf(bidSubmissions[0].bidder) < bidCollat1Diff) || ((existingBid.collateralAmounts[1] < bidSubmissions[0].collateralAmounts[1]) && lockingAuctionCollateralTokenTwo.balanceOf(bidSubmissions[0].bidder) <bidCollat2Diff);
  bool collateralApprovalsTooLow = ((existingBid.collateralAmounts[0] < bidSubmissions[0].collateralAmounts[0]) && lockingAuctionCollateralTokenOne.allowance(bidSubmissions[0].bidder, lockerLocking) < bidCollat1Diff) || ((existingBid.collateralAmounts[1] < bidSubmissions[0].collateralAmounts[1]) && lockingAuctionCollateralTokenTwo.allowance(bidSubmissions[0].bidder, lockerLocking) < bidCollat2Diff);
  bool collateralAmountTooLow = harnessIsInInitialCollateralShortFall(
    bidSubmissions[0].amount,
    bidSubmissions[0].collateralTokens,
    bidSubmissions[0].collateralAmounts
  ); // CollateralAmountTooLow
  bool lockerTransfersPaused = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && lockerLocking.transfersPaused();
  bool collateralManagerNotPairedToLocker = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && !lockerLocking.hasRole(lockerLocking.SERVICER_ROLE(), collateralManagerLocking);
  bool bidLockerNotPairedToCollatManager = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && !collateralManagerLocking.hasRole(collateralManagerLocking.AUCTION_LOCKER(), currentContract);

  bool isExpectedToRevert =
    msgValueIsNotZero ||
    reentrant ||
    auctionNotOpen ||
    lockingPaused ||
    bidSubmissionNotOwned ||
    maxBidCountReached ||
    bidIdAlreadyExists || 
    editingBidNotOwned ||
    bidAmountTooLow ||
    purchaseTokenNotApproved ||
    firstCollateralTokenNotApproved ||
    secondCollateralTokenNotApproved ||
    bidAmountTooLow ||
    collateralBalanceTooLow ||
    collateralApprovalsTooLow || 
    collateralAmountTooLow || 
    lockerTransfersPaused || 
    collateralManagerNotPairedToLocker ||
    bidLockerNotPairedToCollatManager
    ;

  lockBids@withrevert(e, bidSubmissions);
  assert lastReverted == isExpectedToRevert,
    "lockBids should revert when one of the revert conditions is reached";
}




/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Lock Bids With Referral Rules                                                                                       |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule lockBidsWithReferralIntegrity(
  env e,
  address referrer,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions
) {
  // rule bounds
  require termRepoCollateralManager() == collateralManagerLocking;
  require e.msg.sender != collateralManagerLocking.termRepoLocker();
  // address can't be msg.sender
  require referrer != e.msg.sender;
  // Only handle one bid to simplify testing
  require bidSubmissions.length == 1;

  require harnessGetInternalBids(bidSubmissions[0].id).amount == 0;

  require bidCount() < MAX_BID_COUNT();

  // ensure bid amount is valid
  require(minimumTenderAmount() > 0 && bidSubmissions[0].amount > minimumTenderAmount());

  // bidder must be msg.sender
  require bidSubmissions[0].bidder == e.msg.sender;

  // 2 collateral tokens are supported
  require bidSubmissions[0].collateralTokens.length == 2 && bidSubmissions[0].collateralAmounts.length == 2;
  require bidSubmissions[0].collateralTokens[0] == lockingAuctionCollateralTokenOne.myAddress();
  require bidSubmissions[0].collateralTokens[1] == lockingAuctionCollateralTokenTwo.myAddress();

  // ensure collateral amount is valid
  require bidSubmissions[0].collateralAmounts[0] <= lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) && bidSubmissions[0].collateralAmounts[0] > 0;
  require bidSubmissions[0].collateralAmounts[1] <= lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) && bidSubmissions[0].collateralAmounts[1] > 0;

  require bidSubmissions[0].collateralAmounts[0] + lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) < 2^256;
  require bidSubmissions[0].collateralAmounts[1] + lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) < 2^256;

  // require collateral token balance is positive
  require lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender) > 0;
  require lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender) > 0;

  TermAuctionBidLockerHarness.TermAuctionBid internalBid = harnessGetInternalBids(bidSubmissions[0].id);

  mathint oldAmount = internalBid.amount;
  bool bidExists = oldAmount != 0;

  mathint oldCollateralOneAmount = internalBid.collateralAmounts[0];
  mathint newCollateralOneAmount = bidSubmissions[0].collateralAmounts[0];
  mathint collateralOneAmountToLock = bidExists ? newCollateralOneAmount - oldCollateralOneAmount : newCollateralOneAmount;

  mathint oldCollateralTwoAmount = internalBid.collateralAmounts[1];
  mathint newCollateralTwoAmount = bidSubmissions[0].collateralAmounts[1];
  mathint collateralTwoAmountToLock = bidExists ? newCollateralTwoAmount - oldCollateralTwoAmount : newCollateralTwoAmount;

  uint256 bidCountBefore = bidCount();
  mathint collateralTokenOneBalanceBefore = lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceBefore = lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);

  lockBidsWithReferral(e, bidSubmissions, referrer);

  uint256 bidCountAfter = bidCount();
  mathint collateralTokenOneBalanceAfter = lockingAuctionCollateralTokenOne.balanceOf(e.msg.sender);
  mathint collateralTokenTwoBalanceAfter = lockingAuctionCollateralTokenTwo.balanceOf(e.msg.sender);

  assert
    (collateralTokenOneBalanceAfter == collateralTokenOneBalanceBefore - collateralOneAmountToLock) &&
    (collateralTokenTwoBalanceAfter == collateralTokenTwoBalanceBefore - collateralTwoAmountToLock),
    "lockBids should transfer collateral tokens from bidder to contract";
}

rule lockBidsWithReferralDoesNotAffectThirdParty(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions,
  bytes32 thirdPartyBidId,
  address referrer,
  uint256 collateralTokenIndex
) {
  // Rule bounds
  require termRepoCollateralManager() == collateralManagerLocking;
  require e.msg.sender != collateralManagerLocking.termRepoLocker();

  // Assume that any saved bids are saved under the same index as its id
  // See `lockedBidIdAlwaysMatchesIndex` invariant above
  require thirdPartyBidId == harnessGetInternalBidId(thirdPartyBidId);

  // Ensure that the third party bid is not in the bidSubmissions
  bytes32 bidSubmissionOneId = bidSubmissions[0].id;
  require bidSubmissions.length <= 1;
  require thirdPartyBidId != bidSubmissionOneId;
  require thirdPartyBidId != harnessGenerateBidId(bidSubmissionOneId, e.msg.sender);

  bytes32 bidIdBefore = harnessGetInternalBidId(thirdPartyBidId);
  address bidderBefore = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashBefore = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceBefore = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountBefore = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountBefore = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverBefore = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressBefore = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedBefore = harnessGetInternalBidIsRevealed(thirdPartyBidId);
  lockBidsWithReferral(e, bidSubmissions, referrer);
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
    "lockBidsWithReferral should not modify bid id";
  assert bidderBefore == bidderAfter,
    "lockBidsWithReferral should not modify bidder";
  assert bidPriceHashBefore == bidPriceHashAfter,
    "lockBidsWithReferral should not modify bid price hash";
  assert bidRevealedPriceBefore == bidRevealedPriceAfter,
    "lockBidsWithReferral should not modify bid revealed price";
  assert bidAmountBefore == bidAmountAfter,
    "lockBidsWithReferral should not modify bid amount";
  assert bidCollateralAmountBefore == bidCollateralAmountAfter,
    "lockBidsWithReferral should not modify bid collateral amounts";
  assert bidIsRolloverBefore == bidIsRolloverAfter,
    "lockBidsWithReferral should not modify bid rollover status";
  assert bidRolloverAddressBefore == bidRolloverAddressAfter,
    "lockBidsWithReferral should not modify bid rollover address";
  assert bidIsRevealedBefore == bidIsRevealedAfter,
    "lockBidsWithReferral should not modify bid revealed status";
}

rule lockBidsWithReferralRevertConditions(
  env e,
  address refer,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions
) {
  // rule bounds
  require(e.msg.sender != 0); // Not possible for this function to be called by the zero address.
  require bidSubmissions.length == 1;
  require(bidSubmissions[0].collateralAmounts.length == 2);
  require(bidSubmissions[0].collateralTokens.length == 2);

  require(bidSubmissions[0].collateralTokens[0] == lockingAuctionCollateralTokenOne);
  require(bidSubmissions[0].collateralTokens[1] == lockingAuctionCollateralTokenTwo);
  require(termRepoCollateralManager() == collateralManagerLocking);
  require(collateralManagerLocking.termRepoLocker() == lockerLocking);


  // support for 2 collateral tokens
  TermAuctionBidLockerHarness.TermAuctionBid existingBid = harnessGetInternalBids(bidSubmissions[0].id);
  require(existingBid.amount == 0 => existingBid.collateralTokens[0] == 0 && existingBid.collateralTokens[1] == 0); // nonexistent bid will not have existing collateral due to minimum bid requirement.
  require(existingBid.collateralTokens[0] == lockingAuctionCollateralTokenOne);
  require(existingBid.collateralTokens[1] == lockingAuctionCollateralTokenTwo);
  require existingBid.collateralTokens.length == 2;
  require existingBid.collateralAmounts.length == 2;
  uint256 bidCollat1Diff =  existingBid.collateralAmounts[0] > bidSubmissions[0].collateralAmounts[0] ? assert_uint256(existingBid.collateralAmounts[0]- bidSubmissions[0].collateralAmounts[0]) : assert_uint256(bidSubmissions[0].collateralAmounts[0]-existingBid.collateralAmounts[0]);
  uint256 bidCollat2Diff =  existingBid.collateralAmounts[1] > bidSubmissions[0].collateralAmounts[1] ? assert_uint256(existingBid.collateralAmounts[1]- bidSubmissions[0].collateralAmounts[1]) : assert_uint256(bidSubmissions[0].collateralAmounts[1]-existingBid.collateralAmounts[1]);

  require(lockingAuctionCollateralTokenOne.balanceOf(lockerLocking) + bidCollat1Diff <= max_uint256);
  require(lockingAuctionCollateralTokenTwo.balanceOf(lockerLocking) + bidCollat2Diff <= max_uint256);
  require(lockingAuctionCollateralTokenOne.balanceOf(bidSubmissions[0].bidder) + bidCollat1Diff <= max_uint256);
  require(lockingAuctionCollateralTokenTwo.balanceOf(bidSubmissions[0].bidder) + bidCollat2Diff <= max_uint256);

  uint256 existingBidAmount = existingBid.amount;
  address existingBidder = existingBid.bidder;

  require(lockingAuctionCollateralTokenOne.balanceOf(lockerLocking) >= existingBid.collateralAmounts[0]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec  
  require(lockingAuctionCollateralTokenTwo.balanceOf(lockerLocking) >= existingBid.collateralAmounts[1]); // Proved with lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ./stateVariables.spec 

  bytes32 generatedBidId = generateBidIdPreview(bidSubmissions[0].id, bidSubmissions[0].bidder);
  TermAuctionBidLockerHarness.TermAuctionBid existingGeneratedBid = harnessGetInternalBids(generatedBidId);
  uint256 existingGeneratedBidAmount = existingGeneratedBid.amount;

  bool auctionNotOpen = e.block.timestamp < auctionStartTime() || e.block.timestamp > revealTime(); // AuctionNotOpen
  bool lockingPaused = lockingPaused(); // LockingPaused
  bool reentrant = harnessReentrancyGuardEntered();
  bool sameReferral = (refer == e.msg.sender ? true : false); // InvalidSelfReferral
  bool bidSubmissionNotOwned = bidSubmissions[0].bidder != e.msg.sender ? true : false; // BidNotOwned
  bool maxBidCountReached = bidCount() >= MAX_BID_COUNT() ? true : false; // MaxBidCountReached
  bool bidIdAlreadyExists = existingGeneratedBid.amount != 0 && existingBid.amount == 0 ; // BidIdAlreadyExists


  bool editingBidNotOwned = existingBid.amount != 0 && existingBid.bidder != bidSubmissions[0].bidder; // BidNotOwned
  bool purchaseTokenNotApproved = bidSubmissions[0].purchaseToken != purchaseToken() ? true : false; // PurchaseTokenNotApproved
  bool firstCollateralTokenNotApproved = !collateralTokens(bidSubmissions[0].collateralTokens[0]); // CollateralTokenNotApproved
  bool secondCollateralTokenNotApproved = !collateralTokens(bidSubmissions[0].collateralTokens[1]); // CollateralTokenNotApproved
  bool bidAmountTooLow = bidSubmissions[0].amount < minimumTenderAmount(); // BidAmountTooLow
    bool collateralBalanceTooLow = ((existingBid.collateralAmounts[0] < bidSubmissions[0].collateralAmounts[0]) && lockingAuctionCollateralTokenOne.balanceOf(bidSubmissions[0].bidder) < bidCollat1Diff) || ((existingBid.collateralAmounts[1] < bidSubmissions[0].collateralAmounts[1]) && lockingAuctionCollateralTokenTwo.balanceOf(bidSubmissions[0].bidder) <bidCollat2Diff);
  bool collateralApprovalsTooLow = ((existingBid.collateralAmounts[0] < bidSubmissions[0].collateralAmounts[0]) && lockingAuctionCollateralTokenOne.allowance(bidSubmissions[0].bidder, lockerLocking) < bidCollat1Diff) || ((existingBid.collateralAmounts[1] < bidSubmissions[0].collateralAmounts[1]) && lockingAuctionCollateralTokenTwo.allowance(bidSubmissions[0].bidder, lockerLocking) < bidCollat2Diff);
  bool lockerTransfersPaused = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && lockerLocking.transfersPaused();
  bool collateralManagerNotPairedToLocker = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && !lockerLocking.hasRole(lockerLocking.SERVICER_ROLE(), collateralManagerLocking);
  bool bidLockerNotPairedToCollatManager = (bidCollat1Diff != 0 || bidCollat2Diff != 0) && !collateralManagerLocking.hasRole(collateralManagerLocking.AUCTION_LOCKER(), currentContract);
 bool collateralAmountTooLow = harnessIsInInitialCollateralShortFall(
    bidSubmissions[0].amount,
    bidSubmissions[0].collateralTokens,
    bidSubmissions[0].collateralAmounts
  ); // CollateralAmountTooLow
  bool msgValueNotZero = e.msg.value != 0;
  bool isExpectedToRevert =
    auctionNotOpen || lockingPaused || reentrant || sameReferral ||
    bidSubmissionNotOwned || maxBidCountReached ||  bidIdAlreadyExists || 
    editingBidNotOwned ||
    bidAmountTooLow || collateralBalanceTooLow || collateralApprovalsTooLow || purchaseTokenNotApproved ||
    firstCollateralTokenNotApproved || secondCollateralTokenNotApproved ||
    bidAmountTooLow || collateralAmountTooLow || lockerTransfersPaused || collateralManagerNotPairedToLocker || bidLockerNotPairedToCollatManager || msgValueNotZero;

  lockBidsWithReferral@withrevert(e, bidSubmissions, refer);
  assert lastReverted <=> isExpectedToRevert,
    "lockBidsWithReferral should revert when one of the revert conditions is reached";
}

rule lockBidsWithReferralMonotonicBehavior(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBidSubmission[] bidSubmissions,
  address referrer
) {
  // require termRepoCollateralManager() == collateralManagerLocking;
  // require e.msg.sender != collateralManagerLocking.termRepoLocker();
  // require referrer != e.msg.sender;

  uint256 bidCountBefore = bidCount();
  lockBidsWithReferral(e, bidSubmissions, referrer);
  uint256 bidCountAfter = bidCount();

  assert bidCountAfter >= bidCountBefore,
    "bidCount should either increase or stay the same after lockBidsWithReferral is called";
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Lock Rollover Bid Rules                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule lockRolloverBidIntegrity(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBid bid
) {
  // rule boundaries
  require bid.isRollover == true;
  require bidCount() < MAX_BID_COUNT();

  // check bid exists
  bool internalBidExists = harnessBidExists(bid.id);

  // setting existing rollover bid to 0 should decrement bid count
  bool shouldDecrementBidCount = (bid.amount == 0 && internalBidExists) ? true : false;

  // creating new rollover bid should increment bid count
  bool shouldIncrementBidCount = (!shouldDecrementBidCount && bid.amount != 0 && !internalBidExists) ? true : false;

  uint256 bidCountBefore = bidCount();
  lockRolloverBid(e, bid);
  uint256 bidCountAfter = bidCount();

  mathint expectedBidCount = shouldDecrementBidCount ? bidCountBefore - 1 : shouldIncrementBidCount ? bidCountBefore + 1 : bidCountBefore;

  assert to_mathint(bidCountAfter) == expectedBidCount,
    "bidCount should increment by the number of bids submitted";
}

rule lockRolloverBidDoesNotAffectThirdParty(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBid bid,
  bytes32 thirdPartyBidId,
  uint256 collateralTokenIndex
) {
  // Assume that any saved bids are saved under the same index as its id
  // See `lockedBidIdAlwaysMatchesIndex` invariant above
  require thirdPartyBidId == harnessGetInternalBidId(thirdPartyBidId);

  // Ensure that the third party bid is not in the bidSubmissions
  bytes32 bidSubmissionId = bid.id;
  require thirdPartyBidId != bidSubmissionId;
  require thirdPartyBidId != harnessGenerateBidId(bidSubmissionId, e.msg.sender);

  bytes32 bidIdBefore = harnessGetInternalBidId(thirdPartyBidId);
  address bidderBefore = harnessGetInternalBidBidder(thirdPartyBidId);
  bytes32 bidPriceHashBefore = harnessGetInternalBidBidPriceHash(thirdPartyBidId);
  uint256 bidRevealedPriceBefore = harnessGetInternalBidBidRevealedPrice(thirdPartyBidId);
  uint256 bidAmountBefore = harnessGetInternalBidAmount(thirdPartyBidId);
  uint256 bidCollateralAmountBefore = harnessGetInternalBidCollateralAmount(thirdPartyBidId, collateralTokenIndex);
  bool bidIsRolloverBefore = harnessGetInternalBidIsRollover(thirdPartyBidId);
  address bidRolloverAddressBefore = harnessGetInternalBidRolloverPairOffTermRepoServicer(thirdPartyBidId);
  bool bidIsRevealedBefore = harnessGetInternalBidIsRevealed(thirdPartyBidId);
  lockRolloverBid(e, bid);
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
    "lockRolloverBid should not modify bid id";
  assert bidderBefore == bidderAfter,
    "lockRolloverBid should not modify bidder";
  assert bidPriceHashBefore == bidPriceHashAfter,
    "lockRolloverBid should not modify bid price hash";
  assert bidRevealedPriceBefore == bidRevealedPriceAfter,
    "lockRolloverBid should not modify bid revealed price";
  assert bidAmountBefore == bidAmountAfter,
    "lockRolloverBid should not modify bid amount";
  assert bidCollateralAmountBefore == bidCollateralAmountAfter,
    "lockRolloverBid should not modify bid collateral amounts";
  assert bidIsRolloverBefore == bidIsRolloverAfter,
    "lockRolloverBid should not modify bid rollover status";
  assert bidRolloverAddressBefore == bidRolloverAddressAfter,
    "lockRolloverBid should not modify bid rollover address";
  assert bidIsRevealedBefore == bidIsRevealedAfter,
    "lockRolloverBid should not modify bid revealed status";
}

rule lockRolloverBidRevertConditions(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBid bid
) {
  bool lockingPaused = lockingPaused(); // LockingPaused
  bool auctionNotOpen = e.block.timestamp > revealTime(); // AuctionNotOpen
  bool nonExistentBid = harnessGetInternalBids(bid.id).amount == 0 && bid.amount == 0; // NonExistentBid
  bool maxBidCountReached = bid.amount != 0 && bidCount() >= MAX_BID_COUNT(); // MaxBidCountReached
  bool nonRolloverBid = bid.amount != 0 && !bid.isRollover; // NonRolloverBid
  bool bidAmountTooLow = bid.amount != 0 && bid.amount < minimumTenderAmount(); // BidAmountTooLow
  bool invalidPurchaseToken = bid.amount != 0 && bid.purchaseToken != purchaseToken(); // InvalidPurchaseToken

  bool isExpectedToRevert = lockingPaused || auctionNotOpen || nonExistentBid || maxBidCountReached || nonRolloverBid || bidAmountTooLow || invalidPurchaseToken;

  lockRolloverBid(e, bid);

  assert lastReverted == isExpectedToRevert,
    "lockRolloverBid should revert when one of the revert conditions is reached";
}

rule lockRolloverBidMonotonicBehavior(
  env e,
  TermAuctionBidLockerHarness.TermAuctionBid bid
) {
  mathint bidAmount = bid.amount;

  uint256 bidCountBefore = bidCount();
  lockRolloverBid(e, bid);
  uint256 bidCountAfter = bidCount();

  if (bidAmount == 0) {
    assert bidCountAfter <= bidCountBefore,
      "bidCount should decrease after lockRolloverBid is called with a bid amount of 0";
  } else {
    assert bidCountAfter >= bidCountBefore,
      "bidCount should either increase or stay the same after lockRolloverBid is called with a bid amount greater than 0";
  }
}
