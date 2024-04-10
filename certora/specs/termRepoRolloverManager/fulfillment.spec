methods {
    function ROLLOVER_BID_FULFILLER_ROLE() external returns (bytes32) envfree;
    function getRolloverInstructions(address) external returns (TermRepoRolloverManagerHarness.TermRepoRolloverElection) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
}

rule fulfillRolloverIntegrity(env e) {
    address borrower;

    fulfillRollover(e, borrower);

    bool rolloverProcessed = getRolloverInstructions(borrower).processed;

    assert rolloverProcessed;
}

rule fulfillRolloverDoesNotAffectThirdParty(env e) {
    address borrower;
    address borrower2;
    require(borrower2 != borrower); // bounds for test

    bool thirdPartyRolloverProcessedBefore = getRolloverInstructions(borrower2).processed;
    
    fulfillRollover(e, borrower);

    bool thirdPartyRolloverProcessedAfter = getRolloverInstructions(borrower2).processed;

    assert thirdPartyRolloverProcessedBefore == thirdPartyRolloverProcessedAfter;
}

rule fulfillRolloverRevertConditions(env e) {
    address borrower;

    bool payable = e.msg.value > 0;
    bool callerNotRolloverBidFulfillerFole = !hasRole(ROLLOVER_BID_FULFILLER_ROLE(), e.msg.sender);

    bool isExpectedToRevert = payable || callerNotRolloverBidFulfillerFole;
    fulfillRollover@withrevert(e, borrower);

    assert lastReverted <=> isExpectedToRevert;

}
