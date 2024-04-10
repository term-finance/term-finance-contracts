methods {
    function transfersPaused() external returns (bool) envfree;
    function termRepoId() external returns (bytes32) envfree;
    function emitterAddress() external returns (address) envfree;
}

rule onlyAllowedMethodsMayChangeTransfersPaused(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:pauseTransfers().selector &&
    f.selector != sig:unpauseTransfers().selector
} {
    bool transfersPausedBefore = transfersPaused();
    f(e, args);
    bool transfersPausedAfter = transfersPaused();

    assert(transfersPausedBefore == transfersPausedAfter);
}

rule noMethodChangesTermRepoId(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    bytes32 termRepoIdBefore = termRepoId();
    f(e, args);
    bytes32 termRepoIdAfter = termRepoId();

    assert(termRepoIdBefore == termRepoIdAfter);
}

rule onlyAllowedMethodsMayChangeEmitter(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address).selector &&
    f.selector != sig:pairTermContracts(address,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    address emitterBefore = emitterAddress();
    f(e, args);
    address emitterAfter = emitterAddress();

    assert(emitterBefore == emitterAfter);
}
