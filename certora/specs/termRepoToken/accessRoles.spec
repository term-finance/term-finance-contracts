import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";

methods {
    function balanceOf(address) external returns(uint256) envfree;
    function totalSupply() external returns(uint256) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function MINTER_ROLE() external returns (bytes32) envfree;
    function BURNER_ROLE() external returns (bytes32) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
}


rule onlyRoleCanCallRevert(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:approve(address,uint256).selector
    && f.selector != sig:increaseAllowance(address,uint256).selector
    && f.selector != sig:decreaseAllowance(address,uint256).selector
    && f.selector != sig:transferFrom(address,address,uint256).selector
    && f.selector != sig:transfer(address,uint256).selector
    && f.selector != sig:permit(address,address,uint256,uint256,uint8,bytes32,bytes32).selector
    

} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => hasRole(MINTER_ROLE(),e.msg.sender)
        || hasRole(BURNER_ROLE(),e.msg.sender)
        || hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}

rule onlyRoleCanCallStorage(method f, calldataarg args, env e) filtered {
    f -> !f.isView
    && f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:approve(address,uint256).selector
    && f.selector != sig:increaseAllowance(address,uint256).selector
    && f.selector != sig:decreaseAllowance(address,uint256).selector
    && f.selector != sig:transferFrom(address,address,uint256).selector
    && f.selector != sig:transfer(address,uint256).selector
    && f.selector != sig:permit(address,address,uint256,uint256,uint8,bytes32,bytes32).selector

    } {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(MINTER_ROLE(),e.msg.sender)
        || hasRole(BURNER_ROLE(),e.msg.sender)
        || hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}