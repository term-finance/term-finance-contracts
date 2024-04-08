import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";


using DummyERC20A as token;


methods {
    function transfersPaused() external returns (bool) envfree;

    // Needed as we use this to check balance changes and want those calls to be envfree.
    function token.balanceOf(address) external returns (uint256) envfree;
}


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Definitions                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

definition canIncreaseTreasuryBalance(method f) returns bool = 
	f.selector == sig:transferTokenFromWallet(address,address,uint256).selector;

definition canDecreaseTreasuryBalance(method f) returns bool = 
	f.selector == sig:transferTokenToWallet(address,address,uint256).selector;

definition notInitializeOrUpgrade(method f) returns bool = 
    f.selector != sig:initialize(string,address).selector && 
    f.selector != sig:upgradeToAndCall(address,bytes).selector;

definition notTokenMethod(method f) returns bool = f.contract != token;


/*
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Rules                                                                                                               |
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*/

rule onlyAllowedMethodsMayChangeBalance(
    env e,
    method f
) filtered {
    f -> notInitializeOrUpgrade(f) && notTokenMethod(f)
} {
    if (canIncreaseTreasuryBalance(f)) {
        address sender;
        uint256 amount;

        uint256 balanceBefore = token.balanceOf(currentContract);
        transferTokenFromWallet(e, sender, token, amount);
        uint256 balanceAfter = token.balanceOf(currentContract);

        assert balanceAfter > balanceBefore  => (sender != currentContract) && (amount != 0);
        assert balanceAfter == balanceBefore => (sender == currentContract) || (amount == 0);
    } else if (canDecreaseTreasuryBalance(f)) {
        address recipient;
        uint256 amount;

        uint256 balanceBefore = token.balanceOf(currentContract);
        transferTokenToWallet(e, recipient, token, amount);
        uint256 balanceAfter = token.balanceOf(currentContract);

        assert balanceAfter < balanceBefore  => (recipient != currentContract) && (amount != 0);
        assert balanceAfter == balanceBefore => (recipient == currentContract) || (amount == 0);
    } else {
        calldataarg args;

        uint256 balanceBefore = token.balanceOf(currentContract);
        f(e, args);
        uint256 balanceAfter = token.balanceOf(currentContract);

        assert balanceAfter == balanceBefore;
    }
}

rule reachability(
    env e,
    method f,
    calldataarg args
) filtered {
    f -> notInitializeOrUpgrade(f) && f.contract == currentContract
} {
	f(e,args);

	satisfy true;
}

rule transferTokenFromWalletIntegrity(
    env e,
    address sender,
    uint256 amount
) {
    mathint treasuryBalanceBefore = to_mathint(token.balanceOf(currentContract));
    mathint senderBalanceBefore   = to_mathint(token.balanceOf(sender));
    bool transfersPaused = transfersPaused();
    bool isServicer = hasRole(SERVICER_ROLE(), e.msg.sender);
    bool isSelf = currentContract == sender;
    bool isOverspend = senderBalanceBefore < to_mathint(amount);

    transferTokenFromWallet(e, sender, token, amount);

    // balances of treasury and sender are updated
    mathint treasuryBalanceAfter = to_mathint(token.balanceOf(currentContract));
    mathint senderBalanceAfter   = to_mathint(token.balanceOf(sender));   
    mathint expectedDiff = (isSelf || !isServicer || transfersPaused || isOverspend) ? 0 : to_mathint(amount);
    assert treasuryBalanceAfter == treasuryBalanceBefore + expectedDiff;
    assert senderBalanceAfter   == senderBalanceBefore   - expectedDiff;
    assert transfersPaused() == transfersPaused;
}

rule transferTokenToWalletIntegrity(
    env e,
    address recipient,
    uint256 amount
) {
    mathint treasuryBalanceBefore  = to_mathint(token.balanceOf(currentContract));
    mathint recipientBalanceBefore = to_mathint(token.balanceOf(recipient));
    bool transfersPaused = transfersPaused();
    bool isServicer = hasRole(SERVICER_ROLE(), e.msg.sender);
    bool isSelf = currentContract == recipient;
    bool isOverspend = treasuryBalanceBefore < to_mathint(amount);

    transferTokenToWallet(e, recipient, token, amount);

    // balances of treasury and recipient are updated
    mathint treasuryBalanceAfter  = to_mathint(token.balanceOf(currentContract));
    mathint recipientBalanceAfter = to_mathint(token.balanceOf(recipient));   
    mathint expectedDiff = (isSelf || !isServicer || transfersPaused || isOverspend) ? 0 : to_mathint(amount);
    assert recipientBalanceAfter == recipientBalanceBefore + expectedDiff;
    assert treasuryBalanceAfter  == treasuryBalanceBefore  - expectedDiff;
    assert transfersPaused() == transfersPaused;
}

rule pauseTransfersIntegrity(
    env e
) {
    pauseTransfers(e);
    assert transfersPaused();
}

rule unpauseTransfersIntegrity(
    env e
) {
    unpauseTransfers(e);
    assert !transfersPaused();
}
