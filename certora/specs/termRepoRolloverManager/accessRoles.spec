import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
    function ROLLOVER_BID_FULFILLER_ROLE() external returns (bytes32) envfree;
}


rule onlyRoleCanCallRevert(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,address,address,address,address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:electRollover(TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission).selector
    && f.selector != sig:cancelRollover().selector
} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => 
        hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_BID_FULFILLER_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}

rule onlyRoleCanCallStorage(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,address,address,address,address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:electRollover(TermRepoRolloverManagerHarness.TermRepoRolloverElectionSubmission).selector
    && f.selector != sig:cancelRollover().selector
    } {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_BID_FULFILLER_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}