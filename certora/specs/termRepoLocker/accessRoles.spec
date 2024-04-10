import "../methods/emitMethods.spec";

methods {
    function upgradeToAndCall(address,bytes) external => NONDET;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function SERVICER_ROLE() external returns (bytes32) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
}

rule onlyRoleCanCallRevert(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:grantRole(bytes32,address).selector &&
    f.selector != sig:renounceRole(bytes32,address).selector &&
    f.selector != sig:revokeRole(bytes32,address).selector
} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => hasRole(SERVICER_ROLE(),e.msg.sender)
        || hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}

rule onlyRoleCanCallStorage(
    method f,
    calldataarg args,
    env e
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:grantRole(bytes32,address).selector &&
    f.selector != sig:renounceRole(bytes32,address).selector &&
    f.selector != sig:revokeRole(bytes32,address).selector
} {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(SERVICER_ROLE(),e.msg.sender)
        || hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}