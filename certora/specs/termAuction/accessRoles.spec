import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
}


rule onlyRoleCanCallRevert(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,string,uint256,uint256,uint256,address,address,uint256).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:completeAuction(TermAuctionHarness.CompleteAuctionInput).selector
} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => 
        hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);

}

rule onlyRoleCanCallStorage(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,string,uint256,uint256,uint256,address,address,uint256).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:completeAuction(TermAuctionHarness.CompleteAuctionInput).selector

} {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender);
}

rule onlyRoleCanCallRevertCompleteAuction(env e) {
    TermAuctionHarness.CompleteAuctionInput completeAuctionInput;
    currentContract.completeAuction@withrevert(e,completeAuctionInput);

    assert !lastReverted => 
        ( !hasRole(ADMIN_ROLE(),e.msg.sender) && (completeAuctionInput.unrevealedBidSubmissions.length == 0) && (completeAuctionInput.unrevealedOfferSubmissions.length == 0))
        || hasRole(ADMIN_ROLE(),e.msg.sender);

}

rule onlyRoleCanCallStorageCompleteAuction(env e) {
    TermAuctionHarness.CompleteAuctionInput completeAuctionInput;
    storage storeBefore = lastStorage;
    currentContract.completeAuction(e,completeAuctionInput);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => ( !hasRole(ADMIN_ROLE(),e.msg.sender) && (completeAuctionInput.unrevealedBidSubmissions.length == 0) && (completeAuctionInput.unrevealedOfferSubmissions.length == 0))
        || hasRole(ADMIN_ROLE(),e.msg.sender);
}