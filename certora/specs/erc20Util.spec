methods {
    function totalSupply() external returns (uint256) envfree;
    function balanceOf(address) external returns (uint256) envfree;
}


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
hook Sload uint256 balance _balances[KEY address addr] STORAGE {
    require sumOfBalances >= to_mathint(balance);
}

hook Sstore _balances[KEY address addr] uint256 newValue (uint256 oldValue) STORAGE {
    sumOfBalances = sumOfBalances - oldValue + newValue;
    numberOfChangesOfBalances = numberOfChangesOfBalances + 1;
}

/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Invariant: totalSupply is the sum of all balances                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/
invariant totalSupplyIsSumOfBalances()
    to_mathint(totalSupply()) == sumOfBalances;

/*