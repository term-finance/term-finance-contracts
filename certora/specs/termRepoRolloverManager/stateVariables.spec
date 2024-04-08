methods {
    function termRepoId() external returns (bytes32) envfree;
    function collateralManager() external returns (address) envfree;
    function repoServicer() external returns (address) envfree;
    function controller() external returns (address) envfree;
    function eventEmitter() external returns (address) envfree;
    function isRolloverAuctionApproved(address) external returns (bool) envfree;
    function getRolloverInstructions(address) external returns (TermRepoRolloverManagerHarness.TermRepoRolloverElection) envfree;
}

rule noMethodsChangeTermRepoId(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    bytes32 termRepoIdBefore = termRepoId();
    f(e, args);
    bytes32 termRepoIdAfter = termRepoId();

    assert termRepoIdBefore == termRepoIdAfter,
        "termRepoId cannot be changed";
}

rule onlyAllowedMethodsChangeTermContracts(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:pairTermContracts(address,address,address,address).selector
} {
    address collateralManagerBefore = collateralManager();
    address servicerBefore = repoServicer();
    address controllerBefore = controller();
    address eventEmitterBefore = eventEmitter();
    f(e, args);
    address collateralManagerAfter = collateralManager();
    address servicerAfter = repoServicer();
    address controllerAfter = controller();
    address eventEmitterAfter = eventEmitter();

    assert collateralManagerBefore == collateralManagerAfter,
        "collateralManager cannot be changed";
    assert servicerBefore == servicerAfter,
        "servicer cannot be changed";
    assert controllerBefore == controllerAfter,
        "controller cannot be changed";
    assert eventEmitterBefore == eventEmitterAfter,
        "eventEmitter cannot be changed";
}

rule onlyAllowedMethodsChangeApprovedRolloverAuctionBidLockers(
    env e,
    method f,
    calldataarg args,
    address bidLocker
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:electRollover(TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission).selector &&
    f.selector != sig:approveRolloverAuction(address).selector &&
    f.selector != sig:revokeRolloverApproval(address).selector
} {
    bool isRolloverAuctionApprovedBefore = isRolloverAuctionApproved(bidLocker);
    f(e, args);
    bool isRolloverAuctionApprovedAfter = isRolloverAuctionApproved(bidLocker);

    assert isRolloverAuctionApprovedBefore == isRolloverAuctionApprovedAfter,
        "only the approveRolloverAuction method can change the approved rollover auction bid lockers";
}

rule onlyAllowedMethodsChangeRolloverElections(
    env e,
    method f,
    calldataarg args,
    address bidder
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:electRollover(TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission).selector &&
    f.selector != sig:cancelRollover().selector &&
    f.selector != sig:fulfillRollover(address).selector
} {
    TermRepoRolloverManagerHarness.TermRepoRolloverElection electionBefore = getRolloverInstructions(bidder);
    f(e, args);
    TermRepoRolloverManagerHarness.TermRepoRolloverElection electionAfter = getRolloverInstructions(bidder);

    assert electionBefore.rolloverAuctionBidLocker == electionAfter.rolloverAuctionBidLocker,
        "only the electRollover method can change the rollover elections";
    assert electionBefore.rolloverAmount == electionAfter.rolloverAmount,
        "only the electRollover method can change the rollover elections";
    assert electionBefore.rolloverBidPriceHash == electionAfter.rolloverBidPriceHash,
        "only the electRollover method can change the rollover elections";
    assert electionBefore.processed == electionAfter.processed,
        "only the electRollover method can change the rollover elections";
}
