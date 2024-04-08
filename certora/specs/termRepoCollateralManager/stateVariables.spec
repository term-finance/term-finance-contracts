using TermRepoLocker as stateLocker;
using TermRepoServicer as stateServicer;
using DummyERC20A as stateToken;

function collateralTokenSupported(address token) returns bool {
    if (token == stateToken){
        return true;
    }
    return false;
}

methods {
    function collateralTokens(uint256) external returns (address) envfree;
    function collateralTokensLength() external returns (uint256) envfree;
    function isInCollateralTokenArray(address) external returns (bool) envfree;

    function encumberedCollateralBalance(address) external returns (uint256) envfree;
    function emitterAddress() external returns (address) envfree;
    function getCollateralBalance(address, address) external returns (uint256) envfree;
    function liquidatedDamages(address) external returns (uint256) envfree;
    function _._isAcceptedCollateralToken(address token) internal => collateralTokenSupported(token) expect (bool) ALL;
    function initialCollateralRatios(address) external returns (uint256) envfree;
    function maintenanceCollateralRatios(address) external returns (uint256) envfree;
    function liquidateDamangesDueToProtocol() external returns (uint256) envfree;
    function netExposureCapOnLiquidation() external returns (uint256) envfree;
    function termRepoId() external returns (bytes32) envfree;
    function repoServicer() external returns (address) envfree;
    function deMinimisMarginThreshold() external returns (uint256) envfree;
    function numOfAcceptedCollateralTokens() external returns (uint8) envfree;
    function termRepoLocker() external returns (address) envfree;
    function termRepoServicerAddress() external returns (address) envfree;
    function termPriceOracleAddress() external returns (address) envfree;
    function termControllerAddress() external returns (address) envfree;
    function termRepoServicerAddress() external returns (address) envfree;
    function purchaseToken() external returns (address) envfree;

    function DummyERC20A.balanceOf(address) external returns (uint256) envfree;

    function TermRepoServicer.purchaseToken() external returns (address) envfree;
}

definition canIncreaseEncumberedCollateralBalances(method f) returns bool = 
	f.selector == sig:externalLockCollateral(address,uint256).selector || 
    f.selector == sig:acceptRolloverCollateral(address,address,uint256).selector ||
    f.selector == sig:mintOpenExposureLockCollateral(address,address,uint256).selector ||
    f.selector == sig:journalBidCollateralToCollateralManager(address,address[],uint256[]).selector;

definition canDecreaseEncumberedCollateralBalances(method f) returns bool = 
	f.selector == sig:externalUnlockCollateral(address,uint256).selector || 
    f.selector == sig:batchLiquidation(address,uint256[]).selector ||
    f.selector == sig:batchLiquidationWithRepoToken(address,uint256[]).selector ||
    f.selector == sig:batchDefault(address,uint256[]).selector ||
    f.selector == sig:transferRolloverCollateral(address,uint256,address).selector || 
    f.selector == sig:unlockCollateralOnRepurchase(address).selector;

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ghost & hooks: sum of all balances                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

ghost mathint sumOfCollateralBalances {
    init_state axiom sumOfCollateralBalances == 0;
}

ghost mathint numberOfChangesOfCollateralBalances {
	init_state axiom numberOfChangesOfCollateralBalances == 0;
}

hook Sload uint256 balance lockedCollateralLedger[KEY address borrowAddr][KEY address tokenAddr] {
    require sumOfCollateralBalances >= to_mathint(balance);
}

hook Sstore lockedCollateralLedger[KEY address borrowAddr][KEY address tokenAddr] uint256 newValue (uint256 oldValue) {
    if (tokenAddr == stateToken) {
    sumOfCollateralBalances = sumOfCollateralBalances - oldValue + newValue;
    numberOfChangesOfCollateralBalances = numberOfChangesOfCollateralBalances + 1;
    }
}

//NOTE: only tests atomic functions called by a user (not by another contract)
rule lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance(
    env e,
    method f,
    calldataarg args,
    address borrower
) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:journalBidCollateralToCollateralManager(address,address[],uint256[]).selector && 
    f.selector != sig:auctionLockCollateral(address,address,uint256).selector &&
    f.selector != sig:auctionUnlockCollateral(address,address,uint256).selector &&
    f.selector != sig:transferRolloverCollateral(address,uint256,address).selector &&
    f.selector != sig:acceptRolloverCollateral(address,address,uint256).selector && 
    f.selector != sig:mintOpenExposureLockCollateral(address,address,uint256).selector

} {
    address token; 
    require(termRepoLocker() == stateLocker); // bounds for test 
    require(collateralTokensLength() == 1); // bounds for test
    require(collateralTokens(0) == stateToken); // bounds for test
    require(repoServicer() == stateServicer); // bounds for test
    require(e.msg.sender != termRepoLocker()); // repo locker does not call collateral manager
    require(stateServicer.purchaseToken() != stateToken); // bounds for test
    require(sumOfCollateralBalances <= to_mathint((stateToken.balanceOf(stateLocker)))); // starting condition
    require(borrower!= stateLocker); // repo locker contract does not have calls to collateral manager

    f(e, args);

    assert sumOfCollateralBalances <= to_mathint((stateToken.balanceOf(stateLocker)));
}


rule onlyAllowedMethodsMayChangeEncumberedCollateralBalances(
    env e,
    method f,
    calldataarg args,
    address token
) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 encumberedCollateralBalanceBefore = encumberedCollateralBalance(token);
    f(e, args);
    uint256 encumberedCollateralBalanceAfter = encumberedCollateralBalance(token);

    assert encumberedCollateralBalanceAfter > encumberedCollateralBalanceBefore => canIncreaseEncumberedCollateralBalances(f);
    assert encumberedCollateralBalanceAfter < encumberedCollateralBalanceBefore => canDecreaseEncumberedCollateralBalances(f);
}

rule encumberedCollateralBalancesNeverOverflows(
    env e,
    method f,
    calldataarg args,
    address token
) filtered { f -> canIncreaseEncumberedCollateralBalances(f) } {
    uint256 encumberedCollateralBalanceBefore = encumberedCollateralBalance(token);
    f(e, args);
    uint256 encumberedCollateralBalanceAfter = encumberedCollateralBalance(token);

    assert encumberedCollateralBalanceBefore <= encumberedCollateralBalanceAfter;
}

rule noMethodsChangeTermRepoId(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    bytes32 termRepoIdBefore = termRepoId();
    f(e, args);
    bytes32 termRepoIdAfter = termRepoId();

    assert termRepoIdBefore == termRepoIdAfter,
        "TermRepoId should not change";
}

rule noMethodsChangeNumOfAcceptedCollateralTokens(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint8 numOfAcceptedCollateralTokensBefore = numOfAcceptedCollateralTokens();
    f(e, args);
    uint8 numOfAcceptedCollateralTokensAfter = numOfAcceptedCollateralTokens();

    assert numOfAcceptedCollateralTokensBefore == numOfAcceptedCollateralTokensAfter,
        "NumOfAcceptedCollateralTokens should not change";
}

rule noMethodsChangeDeMinimisMarginThreshold(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 deMinimisMarginThresholdBefore = deMinimisMarginThreshold();
    f(e, args);
    uint256 deMinimisMarginThresholdAfter = deMinimisMarginThreshold();

    assert deMinimisMarginThresholdBefore == deMinimisMarginThresholdAfter,
        "DeMinimisMarginThreshold should not change";
}

rule noMethodsChangeLiquidateDamagesDueToProtocol(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 liquidateDamagesDueToProtocolBefore = liquidatedDamagesDueToProtocol();
    f(e, args);
    uint256 liquidateDamagesDueToProtocolAfter = liquidatedDamagesDueToProtocol();

    assert liquidateDamagesDueToProtocolBefore == liquidateDamagesDueToProtocolAfter,
        "LiquidateDamagesDueToProtocol should not change";
}

rule noMethodsChangeNetExposureCapOnLiquidation(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 netExposureCapOnLiquidationBefore = netExposureCapOnLiquidation();
    f(e, args);
    uint256 netExposureCapOnLiquidationAfter = netExposureCapOnLiquidation();

    assert netExposureCapOnLiquidationBefore == netExposureCapOnLiquidationAfter,
        "NetExposureCapOnLiquidation should not change";
}

rule noMethodsChangePurchaseToken(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    address purchaseTokenBefore = purchaseToken();
    f(e, args);
    address purchaseTokenAfter = purchaseToken();

    assert purchaseTokenBefore == purchaseTokenAfter,
        "PurchaseToken should not change";
}

rule onlyAllowedMethodsChangeTermContracts(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,address).selector
} {
    address servicerBefore = termRepoServicerAddress();
    address oracleBefore = termPriceOracleAddress();
    address lockerBefore = termRepoLocker();
    address controllerBefore = termControllerAddress();
    address emitterBefore = emitterAddress();
    f(e, args);
    address servicerAfter = termRepoServicerAddress();
    address oracleAfter = termPriceOracleAddress();
    address lockerAfter = termRepoLocker();
    address controllerAfter = termControllerAddress();
    address emitterAfter = emitterAddress();

    assert servicerBefore == servicerAfter,
        "Servicer should not change";
    assert oracleBefore == oracleAfter,
        "Oracle should not change";
    assert lockerBefore == lockerAfter,
        "Locker should not change";
    assert controllerBefore == controllerAfter,
        "Controller should not change";
    assert emitterBefore == emitterAfter,
        "Emitter should not change";
}

rule noMethodsChangeMaintenanceCollateralRatios(
    env e,
    method f,
    calldataarg args,
    address token
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 maintenanceCollateralRatioBefore = maintenanceCollateralRatios(token);
    f(e, args);
    uint256 maintenanceCollateralRatioAfter = maintenanceCollateralRatios(token);

    assert maintenanceCollateralRatioBefore == maintenanceCollateralRatioAfter,
        "MaintenanceCollateralRatio should not change";
}

rule noMethodsChangeInitialCollateralRatios(
    env e,
    method f,
    calldataarg args,
    address token
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 initialCollateralRatioBefore = initialCollateralRatios(token);
    f(e, args);
    uint256 initialCollateralRatioAfter = initialCollateralRatios(token);

    assert initialCollateralRatioBefore == initialCollateralRatioAfter,
        "InitialCollateralRatio should not change";
}

rule noMethodsChangeLiquidatedDamages(
    env e,
    method f,
    calldataarg args,
    address token
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 liquidatedDamagesBefore = liquidatedDamages(token);
    f(e, args);
    uint256 liquidatedDamagesAfter = liquidatedDamages(token);

    assert liquidatedDamagesBefore == liquidatedDamagesAfter,
        "LiquidatedDamagesDueToRepo should not change";
}

rule onlyAllowedMethodsChangeLockedCollateralLedger(
    env e,
    method f,
    calldataarg args,
    address borrower,
    address token
) filtered { f ->
    f.selector != sig:initialize(string,uint256,uint256,uint256,address,TermRepoCollateralManagerHarness.Collateral[],address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:mintOpenExposureLockCollateral(address,address,uint256).selector &&
    f.selector != sig:acceptRolloverCollateral(address,address,uint256).selector &&
    f.selector != sig:unlockCollateralOnRepurchase(address).selector && 
    f.selector != sig:batchDefault(address,uint256[]).selector && 
    f.selector != sig:batchLiquidation(address,uint256[]).selector && 
    f.selector != sig:batchLiquidationWithRepoToken(address,uint256[]).selector && 
    f.selector != sig:externalLockCollateral(address,uint256).selector && 
    f.selector != sig:externalUnlockCollateral(address,uint256).selector &&
    f.selector != sig:journalBidCollateralToCollateralManager(address,address[],uint256[]).selector && 
    f.selector != sig:transferRolloverCollateral(address,uint256,address).selector
} {
    uint256 lockedCollateralLedgerBefore = getCollateralBalance(borrower, token);
    f(e, args);
    uint256 lockedCollateralLedgerAfter = getCollateralBalance(borrower, token);

    assert lockedCollateralLedgerBefore == lockedCollateralLedgerAfter,
        "LockedCollateralLedger should not change";
}

rule lockedCollateralLedgerDoesNotOverflow(
    env e,
    method f,
    calldataarg args,
    address borrower,
    address token
) filtered { f ->
    canIncreaseEncumberedCollateralBalances(f)
} {
    uint256 lockedCollateralLedgerBefore = getCollateralBalance(borrower, token);
    f(e, args);
    uint256 lockedCollateralLedgerAfter = getCollateralBalance(borrower, token);

    assert lockedCollateralLedgerBefore <= lockedCollateralLedgerAfter,
        "LockedCollateralLedger should not decrease";
}

/** NOTE: The purpose of this rule is to prove that encumbered collateral balances will never underflow and become negative.  
    This rule doesn't pass for liquidation functions. This is because after the complete liquidation of a user's balance, all collateral is unencumbered, but 
    not all collateral is unlocked from the ledger. The user unlocks remaining collateral on their own ina a separate txn. However, since that collateral has been unencumbered from a loan,
    it will never be deceremented from the encumbered collateral balance ledger anymore (line 307 of TermRepoCollateralManager.sol). So this doesn't negate the proof below that there will never be collateral
    ledger balances that causes encumbered collateral balances to become negative.
**/
rule sumOfCollateralBalancesLessThanEncumberedBalances(
    env e,
    method f,
    calldataarg args
) filtered { f -> (canIncreaseEncumberedCollateralBalances(f) || canDecreaseEncumberedCollateralBalances(f)) 
&& f.selector !=  sig:batchDefault(address,uint256[]).selector &&
f.selector != sig:batchLiquidation(address,uint256[]).selector && 
f.selector != sig:batchLiquidationWithRepoToken(address,uint256[]).selector  
} {
    require(collateralTokensLength() == 1);
    require(isInCollateralTokenArray(stateToken));

    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(stateToken);
    mathint sumOfCollateralBalancesBefore = sumOfCollateralBalances;
    require(sumOfCollateralBalancesBefore <= encumberedCollateralBalanceBefore);
    
    f(e, args);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(stateToken);
    mathint sumOfCollateralBalancesAfter = sumOfCollateralBalances;

    assert sumOfCollateralBalancesAfter <= encumberedCollateralBalanceAfter;
}
