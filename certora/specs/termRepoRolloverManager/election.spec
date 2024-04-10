using TermRepoServicer as electionRepoServicer;
using TermAuctionBidLockerHarness as electionBidLocker;
using TermRepoCollateralManagerHarness as electionCollateralManager;

methods {
    
    function getRolloverBidId(address) external returns (bytes32) envfree;
    function getRolloverInstructions(address) external returns (TermRepoRolloverManagerHarness.TermRepoRolloverElection) envfree;
    function isRolloverAuctionApproved(address) external returns (bool) envfree;
    function repoCollateralManager() external returns (address) envfree;
    function repoServicer() external returns (address) envfree;

    function TermRepoCollateralManagerHarness.collateralTokensLength() external returns (uint256) envfree;
    
    function TermRepoServicer.getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function TermRepoServicer.maturityTimestamp() external returns (uint256) envfree;
    function TermRepoServicer.purchaseToken() external returns (address) envfree;
    function TermRepoServicer.servicingFee() external returns (uint256) envfree;

    function TermAuctionBidLockerHarness.MAX_BID_COUNT() external returns (uint256) envfree;
    function TermAuctionBidLockerHarness.ROLLOVER_MANAGER() external returns (bytes32) envfree;
    function TermAuctionBidLockerHarness.bidCount() external returns (uint256) envfree;
    function TermAuctionBidLockerHarness.dayCountFractionMantissa() external returns (uint256) envfree;
    function TermAuctionBidLockerHarness.getReentrancyGuardEntered() external returns (bool) envfree;
    function TermAuctionBidLockerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermAuctionBidLockerHarness.lockedBidAmount(bytes32) external returns (uint256) envfree;
    function TermAuctionBidLockerHarness.lockingPaused() external returns (bool) envfree;
    function TermAuctionBidLockerHarness.purchaseToken() external returns (address) envfree;
    function TermAuctionBidLockerHarness.minimumTenderAmount() external returns (uint256) envfree;


    function TermAuctionBidLockerHarness.revealTime() external returns (uint256) envfree;

}

hook EXTCODESIZE(address addr) uint v {
    require v > 0;
}


rule electRolloverIntegrity(env e) {
    TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission submission;


    require(repoServicer() == electionRepoServicer);
    electRollover(e, submission);
    uint256 rolloverAmount = getRolloverInstructions(e.msg.sender).rolloverAmount;
    bytes32 rolloverBidPriceHash = getRolloverInstructions(e.msg.sender).rolloverBidPriceHash;
    address rolloverAuctionBidLocker = getRolloverInstructions(e.msg.sender).rolloverAuctionBidLocker;

    assert submission.rolloverAmount == rolloverAmount;
    assert submission.rolloverBidPriceHash == rolloverBidPriceHash;
    assert submission.rolloverAuctionBidLocker == rolloverAuctionBidLocker;
    assert rolloverAmount <= electionRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender); // Rollover amount cannot be more than borrow
}

rule electRolloverDoesNotAffectThirdParty(env e) {
    TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission submission;
    address otherBorrower;

    require(otherBorrower != e.msg.sender);

    uint256 thirdPartyRolloverAmountBefore = getRolloverInstructions(otherBorrower).rolloverAmount;
    bytes32 thirdPartyRolloverBidPriceHashBefore = getRolloverInstructions(otherBorrower).rolloverBidPriceHash;
    address thirdPartyRolloverAuctionBidLockerBefore = getRolloverInstructions(otherBorrower).rolloverAuctionBidLocker;


    electRollover(e, submission);

    uint256 thirdPartyRolloverAmountAfter = getRolloverInstructions(otherBorrower).rolloverAmount;
    bytes32 thirdPartyRolloverBidPriceHashAfter = getRolloverInstructions(otherBorrower).rolloverBidPriceHash;
    address thirdPartyRolloverAuctionBidLockerAfter = getRolloverInstructions(otherBorrower).rolloverAuctionBidLocker;

    assert thirdPartyRolloverAmountBefore == thirdPartyRolloverAmountAfter;
    assert thirdPartyRolloverBidPriceHashBefore == thirdPartyRolloverBidPriceHashAfter;
    assert thirdPartyRolloverAuctionBidLockerBefore == thirdPartyRolloverAuctionBidLockerAfter;
}

rule electRolloverRevertConditions(env e) {
    TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission submission;

    mathint expScale = 10 ^ 18;


    require(repoServicer() == electionRepoServicer);
    require(submission.rolloverAuctionBidLocker == electionBidLocker);
    require(repoCollateralManager() == electionCollateralManager);
    require(submission.rolloverAmount * expScale * expScale <= max_uint256); // Prevents overflow
    require(electionRepoServicer.servicingFee() * electionBidLocker.dayCountFractionMantissa() <= max_uint256); //Prevents overflow
    require(electionRepoServicer.servicingFee() * electionBidLocker.dayCountFractionMantissa() / expScale < expScale); //Prevents underflow and div by 0
    require(electionBidLocker.bidCount() <= electionBidLocker.MAX_BID_COUNT()); // Not possible for bid count to be greater than MAX_BID_COUNT since reversion when these 2 values are equal;

    require(electionCollateralManager.collateralTokensLength() == 1);
    require(!electionBidLocker.getReentrancyGuardEntered());

    mathint bidAmount = ((submission.rolloverAmount * expScale * expScale) / (expScale - (electionRepoServicer.servicingFee() * electionBidLocker.dayCountFractionMantissa() / expScale))) / expScale;
    mathint minTenderAmountBidLocker = electionBidLocker.minimumTenderAmount();

    bool payable = e.msg.value > 0;
    bool pastMaturity = e.block.timestamp >= electionRepoServicer.maturityTimestamp();
    bool zeroBorrowerRepurchaseObligation = electionRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) == 0;
    bool rolloverAuctionNotApproved = !isRolloverAuctionApproved(submission.rolloverAuctionBidLocker);
    bool rolloverAlreadyProcessed = getRolloverInstructions(e.msg.sender).processed;
    bool zeroRolloverAmount = submission.rolloverAmount == 0;
    bool rolloverAmountGreaterThanBorrowerObligation = electionRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) < submission.rolloverAmount;
    bool lockingPausedForRolloverAuction = electionBidLocker.lockingPaused();
    bool noRolloverManagerAccessToBidLocker = !electionBidLocker.hasRole(electionBidLocker.ROLLOVER_MANAGER(), currentContract);
    bool beyondAuctionRevealTime = e.block.timestamp > electionBidLocker.revealTime();
    bool maxBidCountReached = electionBidLocker.bidCount() == electionBidLocker.MAX_BID_COUNT();
    bool purchaseTokensNotMatch = electionBidLocker.purchaseToken() != electionRepoServicer.purchaseToken();
    bool bidBelowMinimumTender = bidAmount < minTenderAmountBidLocker;

    bool isExpectedToRevert = payable || pastMaturity || zeroBorrowerRepurchaseObligation || rolloverAuctionNotApproved || rolloverAlreadyProcessed || zeroRolloverAmount || rolloverAmountGreaterThanBorrowerObligation || lockingPausedForRolloverAuction || noRolloverManagerAccessToBidLocker || beyondAuctionRevealTime || maxBidCountReached || purchaseTokensNotMatch || bidBelowMinimumTender;
    electRollover@withrevert(e, submission);

    assert lastReverted <=> isExpectedToRevert;

}

rule cancelRolloverIntegrity(env e) {

    cancelRollover(e);
    uint256 rolloverAmount = getRolloverInstructions(e.msg.sender).rolloverAmount;
    bytes32 rolloverBidPriceHash = getRolloverInstructions(e.msg.sender).rolloverBidPriceHash;
    address rolloverAuctionBidLocker = getRolloverInstructions(e.msg.sender).rolloverAuctionBidLocker;

    assert rolloverAmount == 0;
    assert rolloverBidPriceHash == to_bytes32(0);
    assert rolloverAuctionBidLocker == 0;
}

rule cancelRolloverDoesNotAffectThirdParty(env e) {

    address borrower2;
    require(borrower2 != e.msg.sender);

    uint256 thirdPartyRolloverAmountBefore = getRolloverInstructions(borrower2).rolloverAmount;
    bytes32 thirdPartyRolloverBidPriceHashBefore = getRolloverInstructions(borrower2).rolloverBidPriceHash;
    address thirdPartyRolloverAuctionBidLockerBefore = getRolloverInstructions(borrower2).rolloverAuctionBidLocker;

    cancelRollover(e);

    uint256 thirdPartyRolloverAmountAfter = getRolloverInstructions(borrower2).rolloverAmount;
    bytes32 thirdPartyRolloverBidPriceHashAfter = getRolloverInstructions(borrower2).rolloverBidPriceHash;
    address thirdPartyRolloverAuctionBidLockerAfter = getRolloverInstructions(borrower2).rolloverAuctionBidLocker;

    assert thirdPartyRolloverAmountBefore == thirdPartyRolloverAmountAfter;
    assert thirdPartyRolloverBidPriceHashBefore == thirdPartyRolloverBidPriceHashAfter;
    assert thirdPartyRolloverAuctionBidLockerBefore == thirdPartyRolloverAuctionBidLockerAfter;
}

rule cancelRolloverRevertConditions(env e) {
    require(repoServicer() == electionRepoServicer);
    require(getRolloverInstructions(e.msg.sender).rolloverAuctionBidLocker == electionBidLocker);
    require(repoCollateralManager() == electionCollateralManager);

    require(electionRepoServicer.servicingFee() * electionBidLocker.dayCountFractionMantissa() <= max_uint256); //TODO: Prevents overflow, note this should be moved into the if case
    require(electionCollateralManager.collateralTokensLength() == 1);
    require(!electionBidLocker.getReentrancyGuardEntered());

    uint256 existingRolloverBidAmount = electionBidLocker.lockedBidAmount(getRolloverBidId(e.msg.sender));
    require(electionBidLocker.bidCount() > 0 || existingRolloverBidAmount == 0); // Bid Count cannot be 0 if rollover has been locked before.
 
    bool payable = e.msg.value > 0;
    bool zeroBorrowerRepurchaseObligation = electionRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) == 0;
    bool noRolloverToCancel = getRolloverInstructions(e.msg.sender).rolloverAmount == 0;
    bool rolloverAlreadyProcessed = getRolloverInstructions(e.msg.sender).processed;
    bool lockingPausedForRolloverAuction = electionBidLocker.lockingPaused();
    bool noRolloverManagerAccessToBidLocker = !electionBidLocker.hasRole(electionBidLocker.ROLLOVER_MANAGER(), currentContract);
    bool beyondAuctionRevealTime = e.block.timestamp > electionBidLocker.revealTime();
    bool nonExistentRolloverBid = existingRolloverBidAmount == 0;

    bool isExpectedToRevert = payable || zeroBorrowerRepurchaseObligation || noRolloverToCancel || rolloverAlreadyProcessed || lockingPausedForRolloverAuction || noRolloverManagerAccessToBidLocker || beyondAuctionRevealTime || nonExistentRolloverBid;
    cancelRollover@withrevert(e);

    assert lastReverted <=> isExpectedToRevert;

}