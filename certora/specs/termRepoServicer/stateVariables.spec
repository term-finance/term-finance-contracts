using TermRepoLocker as stateLocker;
using DummyERC20A as stateToken;

methods {
    function isTokenCollateral(address) external returns (bool) envfree;
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function maturityTimestamp() external returns (uint256) envfree => CONSTANT;


    function redemptionTimestamp() external returns (uint256) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function termRepoCollateralManager() external returns (address) envfree;
    function termRepoRolloverManager() external returns (address) envfree;
    function termRepoLocker() external returns (address) envfree;
    function termRepoToken() external returns (address) envfree;
    function termControllerAddress() external returns (address) envfree;
    function emitterAddress() external returns (address) envfree;
    function servicingFee() external returns (uint256) envfree => ALWAYS(3000000000000000);


    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;

}

definition canIncreaseTotalOutstandingRepurchaseExposure(method f) returns bool = 
	f.selector == sig:fulfillBid(address,uint256,uint256,address[],uint256[],uint256).selector || 
    f.selector == sig:openExposureOnRolloverNew(address,uint256,uint256,address,uint256).selector ||
    f.selector == sig:mintOpenExposure(uint256,uint256[]).selector;

definition canDecreaseTotalOutstandingRepurchaseExposure(method f) returns bool = 
	f.selector == sig:submitRepurchasePayment(uint256).selector || 
    f.selector == sig:closeExposureOnRolloverExisting(address,uint256).selector ||
    f.selector == sig:liquidatorCoverExposureWithRepoToken(address,address,uint256).selector ||
    f.selector == sig:liquidatorCoverExposure(address,address,uint256).selector ||
    f.selector == sig:burnCollapseExposure(uint256).selector;

definition canIncreaseTotalRepurchaseCollected(method f) returns bool = 
    f.selector == sig:submitRepurchasePayment(uint256).selector || 
    f.selector == sig:closeExposureOnRolloverExisting(address,uint256).selector ||
    f.selector == sig:liquidatorCoverExposure(address,address,uint256).selector;

definition canDecreaseTotalRepurchaseCollected(method f) returns bool = 
    f.selector == sig:redeemTermRepoTokens(address,uint256).selector;


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ghost & hooks: sum of all balances                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

ghost mathint sumOfRepurchases {
    init_state axiom sumOfRepurchases == 0;
}

ghost mathint numberOfChangesOfBalances {
	init_state axiom numberOfChangesOfBalances == 0;
}

// having an initial state where Alice initial balance is larger than totalSupply, which 
// overflows Alice's balance when receiving a transfer. This is not possible unless the contract is deployed into an 
// already used address (or upgraded from corrupted state).
// We restrict such behavior by making sure no balance is greater than the sum of balances.
hook Sload uint256 balance repurchaseExposureLedger[KEY address addr] {
    require sumOfRepurchases >= to_mathint(balance);
}

hook Sstore repurchaseExposureLedger[KEY address addr] uint256 newValue (uint256 oldValue) {
    sumOfRepurchases = sumOfRepurchases - oldValue + newValue;
    numberOfChangesOfBalances = numberOfChangesOfBalances + 1;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Invariant: totalSupply is the sum of all balances                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
invariant totalOutstandingRepurchaseExposureIsSumOfRepurchases()
    to_mathint(totalOutstandingRepurchaseExposure()) == sumOfRepurchases
    filtered { m -> 
        m.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
        m.selector != sig:upgradeToAndCall(address,bytes).selector &&
        m.selector != sig:upgradeTo(address).selector
    }

rule onlyAllowedMethodsMayChangeTotalOutstandingRepurchaseExposure(method f, env e) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    calldataarg args;

    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    f(e, args);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();

    assert totalOutstandingRepurchaseExposureAfter > totalOutstandingRepurchaseExposureBefore => canIncreaseTotalOutstandingRepurchaseExposure(f);
    assert totalOutstandingRepurchaseExposureAfter < totalOutstandingRepurchaseExposureBefore => canDecreaseTotalOutstandingRepurchaseExposure(f);
}

rule totalOutstandingRepurchaseExposureNeverOverflows(env e, method f, calldataarg args) filtered{f -> canIncreaseTotalOutstandingRepurchaseExposure(f) }{
	uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    f(e, args);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();

	assert totalOutstandingRepurchaseExposureBefore <= totalOutstandingRepurchaseExposureAfter;
}


rule onlyAllowedMethodsMayChangeTotalRepurchaseCollected(method f, env e) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    calldataarg args;

    uint256 totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    f(e, args);
    uint256 totalRepurchaseCollectedAfter = totalRepurchaseCollected();

    assert totalRepurchaseCollectedAfter > totalRepurchaseCollectedBefore => canIncreaseTotalRepurchaseCollected(f);
    assert totalRepurchaseCollectedAfter < totalRepurchaseCollectedBefore => canDecreaseTotalRepurchaseCollected(f);
}

rule totalRepurchaseCollectedNeverOverflows(env e, method f, calldataarg args) filtered{f -> canIncreaseTotalRepurchaseCollected(f) }{
	uint256 totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    f(e, args);
    uint256 totalRepurchaseCollectedAfter = totalRepurchaseCollected();

	assert totalRepurchaseCollectedBefore <= totalRepurchaseCollectedAfter;
}

rule shortfallHaircutMantissaAlwaysZeroBeforeRedemptionAndLessThanExpScaleAfter(method f, env e) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
}{
    calldataarg args;

    require(shortfallHaircutMantissa() == 0);

    f(e, args);

    assert (e.block.timestamp <= redemptionTimestamp()) => (shortfallHaircutMantissa() == 0);
    assert (shortfallHaircutMantissa() > 0  && shortfallHaircutMantissa() < 10 ^ 18) => (e.block.timestamp > redemptionTimestamp());
}

// Tests only atomic functions (functions that are called by end user)
rule totalRepurchaseCollectedLessThanOrEqualToLockerPurchaseTokenBalance(method f, env e) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector && 
    f.selector != sig:upgradeTo(address).selector && 
    f.selector != sig:closeExposureOnRolloverExisting(address,uint256).selector &&
    f.selector != sig:openExposureOnRolloverNew(address,uint256,uint256,address,uint256).selector &&
    f.selector != sig:fulfillBid(address,uint256,uint256,address[],uint256[],uint256).selector &&
    f.selector != sig:liquidatorCoverExposure(address,address,uint256).selector &&
    f.selector != sig:unlockOfferAmount(address,uint256).selector

}{
    calldataarg args;

    require(termRepoLocker() == stateLocker); // bounds for test 
    require(purchaseToken() == stateToken); // bounds for test
    require(totalRepurchaseCollected() <= stateToken.balanceOf(stateLocker)); // starting condition
    require(e.msg.sender != stateLocker); // repo locker contract does not have calls to servicer
    require(!isTokenCollateral(stateToken)); // token will not be both purchase and collateral token

    f(e, args);

    assert (totalRepurchaseCollected() <= stateToken.balanceOf(stateLocker));

}

rule noMethodsChangeMaturityTimestamp(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 maturityTimestampBefore = maturityTimestamp();
    f(e, args);
    uint256 maturityTimestampAfter = maturityTimestamp();

    assert maturityTimestampBefore == maturityTimestampAfter;
}

rule noMethodsChangeEndOfRepurchaseWindow(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 endOfRepurchaseWindowBefore = endOfRepurchaseWindow();
    f(e, args);
    uint256 endOfRepurchaseWindowAfter = endOfRepurchaseWindow();

    assert endOfRepurchaseWindowBefore == endOfRepurchaseWindowAfter;
}

rule noMethodsChangeRedemptionTimestamp(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 redemptionTimestampBefore = redemptionTimestamp();
    f(e, args);
    uint256 redemptionTimestampAfter = redemptionTimestamp();

    assert redemptionTimestampBefore == redemptionTimestampAfter;
}

rule noMethodsChangeServicingFee(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    uint256 servicingFeeBefore = servicingFee();
    f(e, args);
    uint256 servicingFeeAfter = servicingFee();

    assert servicingFeeBefore == servicingFeeAfter;
}

rule onlyAllowedMethodsChangeShortfallHaircutMantissa(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:redeemTermRepoTokens(address,uint256).selector
} {
    uint256 shortfallHaircutMantissaBefore = shortfallHaircutMantissa();
    f(e, args);
    uint256 shortfallHaircutMantissaAfter = shortfallHaircutMantissa();

    assert shortfallHaircutMantissaBefore == shortfallHaircutMantissaAfter;
}

rule noMethodChangesPurchaseToken(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector
} {
    address purchaseTokenBefore = purchaseToken();
    f(e, args);
    address purchaseTokenAfter = purchaseToken();

    assert purchaseTokenBefore == purchaseTokenAfter;
}

rule onlyAllowedMethodsMayChangeTermContracts(
    method f,
    env e,
    calldataarg args
) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,string).selector
} {
    address termRepoCollateralManagerBefore = termRepoCollateralManager();
    address termRepoRolloverManagerBefore = termRepoRolloverManager();
    address termRepoLockerBefore = termRepoLocker();
    address termRepoTokenBefore = termRepoToken();
    address termControllerBefore = termControllerAddress();
    address emitterBefore = emitterAddress();
    f(e, args);
    address termRepoCollateralManagerAfter = termRepoCollateralManager();
    address termRepoRolloverManagerAfter = termRepoRolloverManager();
    address termRepoLockerAfter = termRepoLocker();
    address termRepoTokenAfter = termRepoToken();
    address termControllerAfter = termControllerAddress();
    address emitterAfter = emitterAddress();

    assert termRepoCollateralManagerAfter == termRepoCollateralManagerBefore,
        "termRepoCollateralManager cannot be changed";
    assert termRepoRolloverManagerAfter == termRepoRolloverManagerBefore,
        "termRepoRolloverManager cannot be changed";
    assert termRepoLockerAfter == termRepoLockerBefore,
        "termRepoLocker cannot be changed";
    assert termRepoTokenAfter == termRepoTokenBefore,
        "termRepoToken cannot be changed";
    assert termControllerAfter == termControllerBefore,
        "termController cannot be changed";
    assert emitterAfter == emitterBefore,
        "emitter cannot be changed";
}

rule onlyAllowedMethodsMayChangeRepurchaseExposureLedger(
    method f,
    env e,
    calldataarg args,
    address borrower
) filtered { f ->
    !f.isView  && 
    f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:upgradeTo(address).selector &&
    f.selector != sig:fulfillBid(address,uint256,uint256,address[],uint256[],uint256).selector &&
    f.selector != sig:openExposureOnRolloverNew(address,uint256,uint256,address,uint256).selector &&
    f.selector != sig:closeExposureOnRolloverExisting(address,uint256).selector &&
    f.selector != sig:liquidatorCoverExposure(address,address,uint256).selector &&
    f.selector != sig:liquidatorCoverExposureWithRepoToken(address,address,uint256).selector &&
    f.selector != sig:redeemTermRepoTokens(address,uint256).selector &&
    f.selector != sig:burnCollapseExposure(uint256).selector
} {
    uint256 repurchaseExposureLedgerBefore = repurchaseExposureLedger(borrower);
    f(e, args);
    uint256 repurchaseExposureLedgerAfter = repurchaseExposureLedger(borrower);

    assert repurchaseExposureLedgerAfter == repurchaseExposureLedgerBefore,
        "repurchaseExposureLedger cannot be changed";
}
