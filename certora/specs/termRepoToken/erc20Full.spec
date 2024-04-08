
/***
 https://github.com/Certora/Examples/blob/master/DEFI/ERC20/certora/specs/ERC20Full.spec
 */
methods {
    function totalSupply() external returns (uint256) envfree;
    function balanceOf(address) external returns (uint256) envfree;
    function allowance(address,address) external returns (uint256) envfree;
    function approve(address,uint256) external returns bool;
    function transfer(address,uint256) external returns bool;
    function transferFrom(address,address,uint256) external returns bool;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function BURNER_ROLE() external returns (bytes32) envfree;
    function burningPaused() external returns (bool) envfree;
    function mintingPaused() external returns (bool) envfree;
    function mintExposureCap() external returns (uint256) envfree;
    function redemptionValue() external returns(uint256) envfree;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Definitions                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

// functionality 
definition canIncreaseAllowance(method f) returns bool = 
	f.selector == sig:approve(address,uint256).selector || 
    f.selector == sig:increaseAllowance(address,uint256).selector
;
    

definition canDecreaseAllowance(method f) returns bool = 
	f.selector == sig:approve(address,uint256).selector ||
    f.selector == sig:decreaseAllowance(address,uint256).selector || 
	f.selector == sig:transferFrom(address,address,uint256).selector
;

definition canIncreaseBalance(method f) returns bool = 
	f.selector == sig:mintRedemptionValue(address,uint256).selector || 
    f.selector == sig:mintTokens(address,uint256).selector || 
	f.selector == sig:transfer(address,uint256).selector ||
	f.selector == sig:transferFrom(address,address,uint256).selector;

definition canDecreaseBalance(method f) returns bool = 
	f.selector == sig:burn(address,uint256).selector || 
    f.selector == sig:burnAndReturnValue(address,uint256).selector || 
	f.selector == sig:transfer(address,uint256).selector ||
	f.selector == sig:transferFrom(address,address,uint256).selector;

definition canIncreaseTotalSupply(method f) returns bool = 
	f.selector == sig:mintRedemptionValue(address,uint256).selector || 
    f.selector == sig:mintTokens(address,uint256).selector;

definition canDecreaseTotalSupply(method f) returns bool = 
	f.selector == sig:burn(address,uint256).selector || 
    f.selector == sig:burnAndReturnValue(address,uint256).selector;

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ghost & hooks: sum of all balances                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

ghost mathint sumOfBalances {
    init_state axiom sumOfBalances == 0;
}

ghost mathint numberOfChangesOfBalances {
	init_state axiom numberOfChangesOfBalances == 0;
}

// having an initial state where Alice initial balance is larger than totalSupply, which 
// overflows Alice's balance when receiving a transfer. This is not possible unless the contract is deployed into an 
// already used address (or upgraded from corrupted state).
// We restrict such behavior by making sure no balance is greater than the sum of balances.
hook Sload uint256 balance _balances[KEY address addr] {
    require sumOfBalances >= to_mathint(balance);
}

hook Sstore _balances[KEY address addr] uint256 newValue (uint256 oldValue) {
    sumOfBalances = sumOfBalances - oldValue + newValue;
    numberOfChangesOfBalances = numberOfChangesOfBalances + 1;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Invariant: totalSupply is the sum of all balances                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
invariant totalSupplyIsSumOfBalances()
    to_mathint(totalSupply()) == sumOfBalances
    filtered { f ->
        f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector &&
        f.selector != sig:upgradeToAndCall(address,bytes).selector
    }

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rule: totalSupply never overflow                                                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule totalSupplyNeverOverflow(env e, method f, calldataarg args) filtered{f -> canIncreaseTotalSupply(f) }{
	uint256 totalSupplyBefore = totalSupply();

	f(e, args);

	uint256 totalSupplyAfter = totalSupply();

	assert totalSupplyBefore <= totalSupplyAfter;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rule: max num of balances changes in single call is 2                                                               │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule noMethodChangesMoreThanTwoBalances(method f) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
	env e;
	mathint numberOfChangesOfBalancesBefore = numberOfChangesOfBalances;
	calldataarg args;
	f(e,args);
	mathint numberOfChangesOfBalancesAfter = numberOfChangesOfBalances;
	assert numberOfChangesOfBalancesAfter <= numberOfChangesOfBalancesBefore + 2;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: only approve, permit and transferFrom can change allowance                                                   |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule onlyAllowedMethodsMayChangeAllowance(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
	address addr1;
	address addr2;
	uint256 allowanceBefore = allowance(addr1, addr2);
	
    calldataarg args;
	
    f(e,args);
	
    uint256 allowanceAfter = allowance(addr1, addr2);
	
    assert allowanceAfter > allowanceBefore => canIncreaseAllowance(f), "should not increase allowance";
	assert allowanceAfter < allowanceBefore => canDecreaseAllowance(f), "should not decrease allowance";
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: only mint, burn, transfer and transferFrom can change user balance                                           |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule onlyAllowedMethodsMayChangeBalance(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
}{
    requireInvariant totalSupplyIsSumOfBalances();

    calldataarg args;

    address holder;
    uint256 balanceBefore = balanceOf(holder);
    f(e, args);
    uint256 balanceAfter = balanceOf(holder);
    
    assert balanceAfter > balanceBefore => canIncreaseBalance(f);
    assert balanceAfter < balanceBefore => canDecreaseBalance(f);
}
/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: only mint and burn can change total supply                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule onlyAllowedMethodsMayChangeTotalSupply(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    requireInvariant totalSupplyIsSumOfBalances();

    calldataarg args;

    uint256 totalSupplyBefore = totalSupply();
    f(e, args);
    uint256 totalSupplyAfter = totalSupply();

    assert totalSupplyAfter > totalSupplyBefore => canIncreaseTotalSupply(f);
    assert totalSupplyAfter < totalSupplyBefore => canDecreaseTotalSupply(f);
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: Find and show a path for each method.                                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule reachability(method f) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
}
{
	env e;
	calldataarg args;
	f(e,args);
	satisfy true;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: only the token holder or an approved third party can reduce an account's balance                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule onlyAuthorizedCanTransfer(env e, method f) filtered { f -> canDecreaseBalance(f) &&
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    requireInvariant totalSupplyIsSumOfBalances();

    calldataarg args;
    address account;

    uint256 allowanceBefore = allowance(account, e.msg.sender);
    uint256 balanceBefore   = balanceOf(account);
    f(e, args);
    uint256 balanceAfter    = balanceOf(account);

    assert (
        balanceAfter < balanceBefore
    ) => (
        f.selector == sig:burn(address,uint256).selector ||
        f.selector == sig:burnAndReturnValue(address,uint256).selector ||
        e.msg.sender == account ||
        balanceBefore - balanceAfter <= to_mathint(allowanceBefore)
    );
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: only the token holder (or a permit) can increase allowance. The spender can decrease it by using it          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule onlyHolderOfSpenderCanChangeAllowance(method f, env e) filtered { f ->
    f.selector != sig:initialize(string,string,string,uint8,uint256,uint256,address,TermRepoTokenHarness.TermRepoTokenConfig).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector
} {
    calldataarg args;
    address holder;
    address spender;

    uint256 allowanceBefore = allowance(holder, spender);
    f(e, args);
    uint256 allowanceAfter = allowance(holder, spender);

    assert (
        allowanceAfter > allowanceBefore
    ) => (
        ((f.selector == sig:approve(address,uint256).selector || f.selector == sig:increaseAllowance(address,uint256).selector) && e.msg.sender == holder)

    );

    assert (
        allowanceAfter < allowanceBefore
    ) => (
        (f.selector == sig:transferFrom(address,address,uint256).selector && e.msg.sender == spender) ||
        ((f.selector == sig:approve(address,uint256).selector || f.selector == sig:decreaseAllowance(address,uint256).selector) && e.msg.sender == holder )
    );
}
/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: mint behavior and side effects                                                                               │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule mintTokensIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();

    address to;
    uint256 amount;

    // cache state
    uint256 toBalanceBefore    = balanceOf(to);
    uint256 totalSupplyBefore  = totalSupply();

    // run transaction
    mintTokens(e, to, amount);

    // updates balance and totalSupply
    assert to_mathint(balanceOf(to)) == toBalanceBefore   + amount;
    assert to_mathint(totalSupply()) == totalSupplyBefore + amount;
}

rule mintRedemptionValueIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();

    address to;
    uint256 amount;

    require (redemptionValue() > 0);

    mathint expScale = 1000000000000000000;


    // cache state
    uint256 balanceBefore    = balanceOf(to);

    mathint redemptValue = redemptionValue();
    mathint expectedBalanceAfter = (balanceBefore + ( amount * expScale * expScale / redemptValue) / expScale);
    mathint expectedTotalSupplyAfter = (totalSupply() + ( amount * expScale * expScale / redemptValue) / expScale);

        // run transaction
    mintRedemptionValue(e, to, amount);

    mathint balanceAfter = balanceOf(to);
    mathint totalSupplyAfter = totalSupply();

    assert balanceAfter == expectedBalanceAfter;
    assert totalSupplyAfter == expectedTotalSupplyAfter;
}


rule mintTokensRevertingConditions(env e) {
	address account;
    uint256 amount;

    mathint expScale = 1000000000000000000;

	require totalSupply() + amount <= max_uint; // proof in totalSupplyNeverOverflow
    require (amount * expScale < max_uint256 && amount * expScale * redemptionValue() < max_uint256);
    require(!hasRole(MINTER_ROLE(), 0)); // not possible for zero address to have minter role;

	bool paused = mintingPaused() == true;
    bool payable = e.msg.value > 0;
    bool toZeroAccount = account == 0;
    bool notMinterRole = !hasRole(MINTER_ROLE(), e.msg.sender);

    bool isExpectedToRevert = paused || payable || notMinterRole || toZeroAccount;

    mintTokens@withrevert(e, account, amount);
    
    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

rule mintRedemptionValueRevertingConditions(env e) {
	address account;
    uint256 amount;

    mathint expScale = 1000000000000000000;

	require(redemptionValue() > 0);
    require totalSupply() + (amount * expScale / redemptionValue()) <= max_uint; // proof in totalSupplyNeverOverflow
    require (amount * expScale * expScale < max_uint256); // prevents expscale.div_ from overflowing
    require(!hasRole(MINTER_ROLE(), 0)); // not possible for zero address to have minter role;

	bool paused = mintingPaused() == true;
    bool payable = e.msg.value > 0;
    bool toZeroAccount = account == 0;
    bool notMinterRole = !hasRole(MINTER_ROLE(), e.msg.sender);

    bool isExpectedToRevert = paused || payable || notMinterRole || toZeroAccount;

    mintRedemptionValue@withrevert(e, account, amount);
    
    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

rule mintRedemptionValueDoesNotAffectThirdParty(env e)  {
	address addr1;
	uint256 amount;
    
    address addr2;
    require addr1 != addr2;
	
	uint256 before = balanceOf(addr2);
	
    mintRedemptionValue(e, addr1, amount);
    assert balanceOf(addr2) == before;
}

rule mintTokensDoesNotAffectThirdParty(env e) {
	address addr1;
	uint256 amount;
    
    address addr2;
    require addr1 != addr2;
	
	uint256 before = balanceOf(addr2);
	
    mintTokens(e, addr1, amount);
    assert balanceOf(addr2) == before;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules: burn behavior and side effects                                                                               │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule burnIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();

    address from;
    uint256 amount;

    // cache state
    uint256 fromBalanceBefore  = balanceOf(from);
    uint256 totalSupplyBefore  = totalSupply();

    // run transaction
    burn(e, from, amount);

    // updates balance and totalSupply
    assert to_mathint(balanceOf(from)) == fromBalanceBefore   - amount;
    assert to_mathint(totalSupply())   == totalSupplyBefore - amount;
}

rule burnAndReturnValueIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();

    address from;
    uint256 amount;

    // cache state
    uint256 fromBalanceBefore  = balanceOf(from);
    uint256 totalSupplyBefore  = totalSupply();

    // run transaction
    burnAndReturnValue(e, from, amount);

    // updates balance and totalSupply
    assert to_mathint(balanceOf(from)) == fromBalanceBefore   - amount;
    assert to_mathint(totalSupply())   == totalSupplyBefore - amount;
}

rule burnRevertingConditions(env e) {
	address account;
    uint256 amount;

    require(mintExposureCap() + amount < max_uint256); //mint exposure cap never overflows, proof in ./stateVariables.spec mintExposureCapNeverOverflow
    require(!hasRole(BURNER_ROLE(), 0)); //not possible for zero address to have the burner role
    bool payable = e.msg.value > 0;
    bool notEnoughBalance = balanceOf(account) < amount;
    bool notBurnerRole = !hasRole(BURNER_ROLE(), e.msg.sender);
    bool fromZeroAccount = account == 0;
    bool paused = burningPaused();
    bool isExpectedToRevert = notEnoughBalance || notBurnerRole || paused || fromZeroAccount || payable;

    burn@withrevert(e, account, amount);
    // if(lastReverted) {
    //     assert isExpectedToRevert;
    // } 
    // else {
    //     assert !isExpectedToRevert;
    // }

    assert lastReverted <=> isExpectedToRevert;
}

rule burnDoesNotAffectThirdParty( env e) {
	address addr1;
	uint256 amount;

    address addr2;
    require addr1 != addr2;

    uint256 before = balanceOf(addr2);

	burn(e, addr1, amount);
    assert balanceOf(addr2) == before;
}

rule burnAndReturnValueDoesNotAffectThirdParty( env e) {
	address addr1;
	uint256 amount;

    address addr2;
    require addr1 != addr2;

    uint256 before = balanceOf(addr2);

	burnAndReturnValue(e, addr1, amount);
    assert balanceOf(addr2) == before;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rule: transfer behavior and side effects                                                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule transferIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();
   
    address holder = e.msg.sender;
    address recipient;
    uint256 amount;

    // cache state
    uint256 holderBalanceBefore    = balanceOf(holder);
    uint256 recipientBalanceBefore = balanceOf(recipient);

    // run transaction
    transfer(e, recipient, amount);

    // check outcome
   
    // balances of holder and recipient are updated
    assert to_mathint(balanceOf(holder))    == holderBalanceBefore    - (holder == recipient ? 0 : amount);
    assert to_mathint(balanceOf(recipient)) == recipientBalanceBefore + (holder == recipient ? 0 : amount);
}

// We are checking just that if transfer(10) works, then also transfer(5);transfer(5) works. 
//We do not check the other direction (does not make sense becase of overflow reverts, i.e. does not hold)
rule transferIsOneWayAdditive(env e) {
	address recipient;
	uint256 amount_a;
    uint256 amount_b;
	mathint sum = amount_a + amount_b;
	require sum < max_uint256;
	storage init = lastStorage; // saves storage
	
	transfer(e, recipient, assert_uint256(sum));
	storage after1 = lastStorage;

	transfer@withrevert(e, recipient, amount_a) at init; // restores storage
		assert !lastReverted;	//if the transfer passed with sum, it should pass with both summands individually
	transfer@withrevert(e, recipient, amount_b);
		assert !lastReverted;
	storage after2 = lastStorage;

	assert after1[currentContract] == after2[currentContract];
}

// overflow is not possible (sumOfBlances = totalSupply <= maxuint)
rule transferRevertingConditions(env e) {
	uint256 amount;
	address account;

    require (e.msg.sender != 0);

	bool payable = e.msg.value != 0;
    bool zeroTo = account == 0;
    bool notEnoughBalance = balanceOf(e.msg.sender) < amount;
    bool isExpectedToRevert = payable || zeroTo || notEnoughBalance;

    transfer@withrevert(e, account, amount);
    // if(lastReverted) {
    //     assert isExpectedToRevert;
    // } 
    // else {
    //     assert !isExpectedToRevert;
    // }

    assert lastReverted <=> isExpectedToRevert;
}

rule transferDoesNotAffectThirdParty( env e) {
	address addr1;
	uint256 amount;

    address addr2;
    require addr1 != addr2 && addr2 != e.msg.sender;

    uint256 before = balanceOf(addr2);

	transfer(e, addr1, amount);
    assert balanceOf(addr2) == before;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rule: transferFrom behavior and side effects                                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule transferFromIntegrity(env e) {
    requireInvariant totalSupplyIsSumOfBalances();

    address spender = e.msg.sender;
    address holder;
    address recipient;
    uint256 amount;

    // cache state
    uint256 allowanceBefore        = allowance(holder, spender);
    uint256 holderBalanceBefore    = balanceOf(holder);
    uint256 recipientBalanceBefore = balanceOf(recipient);

    // run transaction
    transferFrom(e, holder, recipient, amount);

    // allowance is valid & updated
    assert allowanceBefore >= amount;
    assert to_mathint(allowance(holder, spender)) == (allowanceBefore == max_uint256 ? max_uint256 : allowanceBefore - amount);

    // balances of holder and recipient are updated
    assert to_mathint(balanceOf(holder))    == holderBalanceBefore    - (holder == recipient ? 0 : amount);
    assert to_mathint(balanceOf(recipient)) == recipientBalanceBefore + (holder == recipient ? 0 : amount);
}

// overflow is not possible (sumOfBlances = totalSupply <= maxuint)
rule transferFromRevertingConditions(env e) {
    require(e.msg.sender != 0);
    address owner;
	address spender = e.msg.sender;
	address recepient;

	uint256 allowed = allowance(owner, spender);
	uint256 transfered;

	bool sendEthToNotPayable = e.msg.value != 0;
    bool ownerZero = owner == 0;
    bool recepientZero = recepient == 0;
	bool allowanceIsLow = allowed < transfered;
    bool notEnoughBalance = balanceOf(owner) < transfered;

    bool isExpectedToRevert = sendEthToNotPayable  || allowanceIsLow || notEnoughBalance || ownerZero || recepientZero;

    transferFrom@withrevert(e, owner, recepient, transfered);   

    // if(lastReverted) {
    //     assert isExpectedToRevert;
    // } else {
    //     assert !(isExpectedToRevert);
    // }

    assert lastReverted <=> isExpectedToRevert;
}

rule transferFromDoesNotAffectThirdParty(env e) {
	address spender = e.msg.sender;
	address owner;
	address recepient;
	address thirdParty;
    address everyUser;

	require thirdParty != owner && thirdParty != recepient && thirdParty != spender;

	uint256 thirdPartyBalanceBefore = balanceOf(thirdParty);
    uint256 thirdPartyAllowanceBefore = allowance(thirdParty, everyUser);
	
    uint256 transfered;

	transferFrom(e, owner, recepient, transfered);
    
	uint256 thirdPartyBalanceAfter = balanceOf(thirdParty);
	uint256 thirdPartyAllowanceAfter = allowance(thirdParty, everyUser);
	
	assert thirdPartyBalanceBefore == thirdPartyBalanceAfter;
    assert thirdPartyAllowanceBefore == thirdPartyAllowanceAfter;
}

// We are checking just that if transfer(10) works, then also transfer(5);transfer(5) works. 
//We do not check the other direction (does not make sense becase of overflow reverts, i.e. does not hold)
rule transferFromIsOneWayAdditive(env e) {
	address recipient;
    address owner;
    address spender = e.msg.sender;
	uint256 amount_a;
    uint256 amount_b;
	mathint sum = amount_a + amount_b;
	require sum < max_uint256;
	storage init = lastStorage; // saves storage
	
	transferFrom(e, owner, recipient, assert_uint256(sum));
	storage after1 = lastStorage;

	transferFrom@withrevert(e, owner, recipient, amount_a) at init; // restores storage
		assert !lastReverted;	//if the transfer passed with sum, it should pass with both summands individually
	transferFrom@withrevert(e, owner, recipient, amount_b);
		assert !lastReverted;
	storage after2 = lastStorage;

	assert after1[currentContract] == after2[currentContract];
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rule: approve behavior and side effects                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
rule approveIntegrity(env e) {
    address holder = e.msg.sender;
    address spender;
    uint256 amount;

    approve(e, spender, amount);

    assert allowance(holder, spender) == amount;
}

rule approveRevertingConditions(env e) {
	address spender;
	address owner = e.msg.sender;
	uint256 amount;

    require (e.msg.sender != 0);

	bool payable = e.msg.value != 0;
    bool spenderIsZero = spender == 0;
	bool isExpectedToRevert = payable || spenderIsZero;

	approve@withrevert(e, spender, amount);

	// if(lastReverted){
	// 	assert isExpectedToRevert;
	// } else {
	// 	assert !isExpectedToRevert;
	// }

    assert lastReverted <=> isExpectedToRevert;
}

rule approveDoesNotAffectThirdParty(env e) {
	address spender;
	address owner = e.msg.sender;
	address thirdParty;
    address everyUser; 
    
    require thirdParty != owner && thirdParty != spender;
    
    uint amount;
	uint256 thirdPartyAllowanceBefore = allowance(thirdParty, everyUser);

	approve(e, spender, amount);

	uint256 thirdPartyAllowanceAfter = allowance(thirdParty, everyUser);

    assert thirdPartyAllowanceBefore == thirdPartyAllowanceBefore;
}
