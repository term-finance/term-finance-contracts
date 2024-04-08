/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Methods                                                                                                             |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

methods {
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function lockingPaused() external returns (bool) envfree;
    function unlockingPaused() external returns (bool) envfree;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pausing Integrity Rules                                                                                            |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

// Only admin can pause locking
rule adminPauseLockingIntegrity(
    env e
) {
    require lockingPaused() == false;
    pauseLocking(e);
    assert lockingPaused() == true && !lastReverted => hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseLocking should not revert";
}

// Non-admin cannot pause locking
rule nonAdminPauseLockingFailsIntegrity(
    env e
) {
    require lockingPaused() == false;
    pauseLocking@withrevert(e);
    assert lockingPaused() == false && lastReverted => !hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseLocking should revert if not admin";
}

// Only admin can unpause locking
rule adminUnpauseLockingIntegrity(
    env e
) {
    require lockingPaused() == true;
    pauseLocking(e);
    assert lockingPaused() == false && !lastReverted => hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseLocking should not revert";
}

// Non-admin cannot unpause locking
rule nonAdminUnpauseLockingFailsIntegrity(
    env e
) {
    require lockingPaused() == true;
    pauseLocking@withrevert(e);
    assert lockingPaused() == false && lastReverted => !hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseLocking should revert if not admin";
}

// Only admin can pause unlocking
rule adminPauseUnlockingIntegrity(
    env e
) {
    require unlockingPaused() == false;
    pauseUnlocking(e);
    assert unlockingPaused() == true && !lastReverted => hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseUnlocking should not revert";
}

// Non-admin cannot pause unlocking
rule nonAdminPauseUnlockingFailsIntegrity(
    env e
) {
    require unlockingPaused() == false;
    pauseUnlocking@withrevert(e);
    assert unlockingPaused() == true && lastReverted => !hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseUnlocking should revert if not admin";
}

// Only admin can unpause unlocking
rule adminUnpauseUnlockingIntegrity(
    env e
) {
    require unlockingPaused() == true;
    pauseUnlocking@withrevert(e);
    assert unlockingPaused() == false && !lastReverted => hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseUnlocking should not revert";
}

// Non-admin cannot unpause unlocking
rule nonAdminUnpauseUnlockingIntegrity(
    env e
) {
    require unlockingPaused() == true;
    pauseUnlocking@withrevert(e);
    assert unlockingPaused() == false && lastReverted => !hasRole(ADMIN_ROLE(),e.msg.sender),
       "pauseUnlocking should revert if not admin";
}