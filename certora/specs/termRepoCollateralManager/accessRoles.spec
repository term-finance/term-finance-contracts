import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function ADMIN_ROLE() external returns (bytes32) envfree;
    function AUCTION_LOCKER() external returns (bytes32) envfree;
    function DEVOPS_ROLE() external returns (bytes32) envfree;
    function INITIALIZER_ROLE() external returns (bytes32) envfree;
    function SERVICER_ROLE() external returns (bytes32) envfree;
    function ROLLOVER_MANAGER() external returns (bytes32) envfree;
    function ROLLOVER_TARGET_AUCTIONEER_ROLE() external returns (bytes32) envfree;
}


rule onlyRoleCanCallRevert(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:externalLockCollateral(address,uint256).selector
    && f.selector != sig:externalUnlockCollateral(address,uint256).selector
    && f.selector != sig:batchLiquidation(address,uint256[]).selector
    && f.selector != sig:batchLiquidationWithRepoToken(address,uint256[]).selector
    && f.selector != sig:batchDefault(address,uint256[]).selector
    && f.selector != sig:harnessWithinNetExposureCapOnLiquidation(address).selector
    && f.selector != sig:willBeWithinNetExposureCapOnLiquidation(address,uint256,address,uint256).selector
    && f.selector != sig:allowFullLiquidation(address,uint256[]).selector
    && f.selector != sig:harnessCollateralSeizureAmounts(uint256,address).selector
} {
    currentContract.f@withrevert(e,args);

    assert !lastReverted => 
        hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(AUCTION_LOCKER(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender)
        || hasRole(SERVICER_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_MANAGER(),e.msg.sender)
        || hasRole(ROLLOVER_TARGET_AUCTIONEER_ROLE(),e.msg.sender);

}

rule onlyRoleCanCallStorage(method f, calldataarg args, env e) filtered {
    f -> !f.isView 
    && f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector
    && f.selector != sig:upgradeToAndCall(address,bytes).selector
    && f.selector != sig:upgradeTo(address).selector
    && f.selector != sig:grantRole(bytes32,address).selector
    && f.selector != sig:renounceRole(bytes32,address).selector
    && f.selector != sig:revokeRole(bytes32,address).selector
    && f.selector != sig:externalLockCollateral(address,uint256).selector
    && f.selector != sig:externalUnlockCollateral(address,uint256).selector
    && f.selector != sig:batchLiquidation(address,uint256[]).selector
    && f.selector != sig:batchLiquidationWithRepoToken(address,uint256[]).selector
    && f.selector != sig:batchDefault(address,uint256[]).selector
    && f.selector != sig:harnessWithinNetExposureCapOnLiquidation(address).selector
    && f.selector != sig:harnessCollateralSeizureAmounts(uint256,address).selector
} {
    storage storeBefore = lastStorage;
    currentContract.f(e,args);
    storage storeAfter = lastStorage;

    assert storeBefore != storeAfter => hasRole(ADMIN_ROLE(),e.msg.sender)
        || hasRole(AUCTION_LOCKER(),e.msg.sender)
        || hasRole(DEVOPS_ROLE(),e.msg.sender)
        || hasRole(INITIALIZER_ROLE(),e.msg.sender)
        || hasRole(SERVICER_ROLE(),e.msg.sender)
        || hasRole(ROLLOVER_MANAGER(),e.msg.sender)
        || hasRole(ROLLOVER_TARGET_AUCTIONEER_ROLE(),e.msg.sender);
}