import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function AUCTIONEER_ROLE() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
    function ROLLOVER_MANAGER() external returns (bytes32) envfree;
}


rule onlyRoleCanCallRevert(
    method f,
    calldataarg args,
    env e
) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector
    && f.selector != sig:lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector
    && f.selector != sig:lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector
    && f.selector != sig:revealBids(bytes32[],uint256[],uint256[]).selector
    && f.selector != sig:unlockBids(bytes32[]).selector
    && f.selector != sig:harnessIsInInitialCollateralShortFall(uint256,address[],uint256[]).selector
    && f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector
} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => 
        hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(AUCTIONEER_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_MANAGER(),e.msg.sender);
}

rule onlyRoleCanCallStorage(
    method f,
    calldataarg args,
    env e
) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,string,uint256,uint256,uint256,uint256,uint256,address,address[],address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:lockBidsWithReferral(TermAuctionBidLockerHarness.TermAuctionBidSubmission[],address).selector
    && f.selector != sig:lockRolloverBid(TermAuctionBidLockerHarness.TermAuctionBid).selector
    && f.selector != sig:lockBids(TermAuctionBidLockerHarness.TermAuctionBidSubmission[]).selector
    && f.selector != sig:revealBids(bytes32[],uint256[],uint256[]).selector
    && f.selector != sig:unlockBids(bytes32[]).selector
    && f.selector != sig:harnessIsInInitialCollateralShortFall(uint256,address[],uint256[]).selector
    && f.selector != sig:getAllBids(bytes32[],bytes32[],bytes32[]).selector
} {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(AUCTIONEER_ROLE(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_MANAGER(),e.msg.sender);
}