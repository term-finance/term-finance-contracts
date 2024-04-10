methods {
    function mintExposureCap() external returns (uint256) envfree;
    function redemptionValue() external returns (uint256) envfree;
}

definition canDecreaseMintExposureCap(method f) returns bool = 
	f.selector == sig:mintRedemptionValue(address,uint256).selector || 
    f.selector == sig:mintTokens(address,uint256).selector ||
    f.selector == sig:resetMintExposureCap(uint256).selector ||
    f.selector == sig:decrementMintExposureCap(uint256).selector;

definition canIncreaseMintExposureCap(method f) returns bool = 
	f.selector == sig:burn(address,uint256).selector || 
    f.selector == sig:burnAndReturnValue(address,uint256).selector || 
    f.selector == sig:resetMintExposureCap(uint256).selector;

definition canOnlyIncreaseMintExposureCap(method f) returns bool = 
	f.selector == sig:burn(address,uint256).selector || 
    f.selector == sig:burnAndReturnValue(address,uint256).selector;

rule onlyAllowedMethodsMayChangeMintExposureCap(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    calldataarg args;

    uint256 mintExposureCapBefore = mintExposureCap();
    f(e, args);
    uint256 mintExposureCapAfter = mintExposureCap();

    assert mintExposureCapAfter > mintExposureCapBefore => canIncreaseMintExposureCap(f);
    assert mintExposureCapAfter < mintExposureCapBefore => canDecreaseMintExposureCap(f);
}

rule mintExposureCapNeverOverflow(env e, method f, calldataarg args) filtered{f -> canOnlyIncreaseMintExposureCap(f) }{
	uint256 mintExposureCapBefore = mintExposureCap();

	f(e, args);

	uint256 mintExposureCapAfter = mintExposureCap();

	assert mintExposureCapBefore <= mintExposureCapAfter;
}

rule noMethodChangesRedemptionValue(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    calldataarg args;

    uint256 redemptionValueBefore = redemptionValue();
    f(e, args);
    uint256 redemptionValueAfter = redemptionValue();

    assert redemptionValueBefore == redemptionValueAfter;
}