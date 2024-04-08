using DummyERC20A as extLockingCollateralToken;
using TermRepoLocker as extLockingCollateralLocker;
using TermRepoServicer as extLockingRepoServicer;


methods {
    function AUCTION_LOCKER() external returns (bytes32) envfree;
    function SERVICER_ROLE() external returns (bytes32) envfree;
    function collateralTokens(uint256) external returns(address)  envfree;

    function encumberedCollateralBalance(address) external returns (uint256) envfree;
    function getCollateralBalance(address,address) external returns (uint256) envfree;
    function willBorrowerBeInShortfall(address,uint256,address,uint256) external returns (bool) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
    function repoServicer() external returns (address) envfree;

    function isTokenCollateral(address) external returns (bool) envfree;
    function termRepoLocker() external returns (address) envfree;

    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;

    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;

    function TermRepoServicer.endOfRepurchaseWindow() external returns (uint256) envfree;
    function TermRepoServicer.redemptionTimestamp() external returns (uint256) envfree;
    function TermRepoServicer.getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;

    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
}

hook EXTCODESIZE(address addr) uint v {
    require v > 0;
}

rule externalLockCollateralIntegrity(env e){
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(extLockingCollateralToken)); // Bounds for test
    require(e.msg.sender != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker

    mathint borrowerCollateralBalanceBefore = getCollateralBalance(e.msg.sender, extLockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(extLockingCollateralToken);
    mathint borrowerCollateralTokenBalanceBefore = extLockingCollateralToken.balanceOf(e.msg.sender);
    mathint lockerCollateralBalanceBefore = extLockingCollateralToken.balanceOf(extLockingCollateralLocker);

    externalLockCollateral(e, extLockingCollateralToken, amount);

    mathint borrowerCollateralBalanceAfter = getCollateralBalance(e.msg.sender, extLockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(extLockingCollateralToken);
    mathint borrowerCollateralTokenBalanceAfter = extLockingCollateralToken.balanceOf(e.msg.sender);
    mathint lockerCollateralBalanceAfter = extLockingCollateralToken.balanceOf(extLockingCollateralLocker);

    assert borrowerCollateralBalanceAfter == borrowerCollateralBalanceBefore + amount;
    assert encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore + amount;
    assert borrowerCollateralTokenBalanceAfter + amount == borrowerCollateralTokenBalanceBefore;
    assert lockerCollateralBalanceBefore + amount == lockerCollateralBalanceAfter;
}

rule externalLockCollateralThirdParty(env e){
    address borrower2;
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(extLockingCollateralToken)); // Bounds for test
    require(e.msg.sender != borrower2);
    require(e.msg.sender != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker
    require(borrower2 != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker


    mathint thirdPartyBorrowerCollateralBalanceBefore = getCollateralBalance(borrower2, extLockingCollateralToken);
    mathint thirdPartyBorrowerCollateralTokenBalanceBefore = extLockingCollateralToken.balanceOf(borrower2);

    externalLockCollateral(e, extLockingCollateralToken, amount);

    mathint thirdPartyBorrowerCollateralBalanceAfter = getCollateralBalance(borrower2, extLockingCollateralToken);
    mathint thirdPartyBorrowerCollateralTokenBalanceAfter = extLockingCollateralToken.balanceOf(borrower2);

    assert thirdPartyBorrowerCollateralBalanceAfter == thirdPartyBorrowerCollateralBalanceBefore;
    assert thirdPartyBorrowerCollateralTokenBalanceAfter == thirdPartyBorrowerCollateralTokenBalanceBefore;
}

rule externalLockCollateralRevertConditions(env e){
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(repoServicer() == extLockingRepoServicer); // Bounds for test

    require(extLockingCollateralToken.balanceOf(extLockingCollateralLocker) + amount <= max_uint256); // erc20 balances do not overflow
    require(getCollateralBalance(e.msg.sender, extLockingCollateralToken) + amount <= max_uint256); // Proved in lockedCollateralLedgerDoesNotOverflow of stateVariables.spec
    require(encumberedCollateralBalance(extLockingCollateralToken) + amount <= max_uint256); // Proved in stateVariables.spec encumberedCollateralBalancesNeverOverflows


    bool payable = e.msg.value > 0;
    bool isNotCollateralToken = !isTokenCollateral(extLockingCollateralToken);
    bool collateralDepositClosed = e.block.timestamp > extLockingRepoServicer.endOfRepurchaseWindow();
    bool zeroBorrowerRepurchaseObligation = extLockingRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) == 0;
    bool lockerTransfersPaused = extLockingCollateralLocker.transfersPaused();
    bool lockerNotPaired = !extLockingCollateralLocker.hasRole(extLockingCollateralLocker.SERVICER_ROLE(), currentContract);
    bool allowanceTooLow = extLockingCollateralToken.allowance( e.msg.sender, termRepoLocker()) < amount;
    bool borrowTokenBalanceTooLow = extLockingCollateralToken.balanceOf(e.msg.sender) < amount;

    bool isExpectedToRevert = payable || isNotCollateralToken || collateralDepositClosed || zeroBorrowerRepurchaseObligation || lockerTransfersPaused || lockerNotPaired ||  borrowTokenBalanceTooLow || allowanceTooLow ;

    externalLockCollateral@withrevert(e, extLockingCollateralToken, amount);

    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

rule externalUnlockCollateralIntegrity(env e){
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(extLockingCollateralToken)); // Bounds for test
    require(repoServicer() == extLockingRepoServicer); // Bounds for test

    require(e.msg.sender != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker

    mathint borrowerCollateralBalanceBefore = getCollateralBalance(e.msg.sender, extLockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(extLockingCollateralToken);
    mathint borrowerCollateralTokenBalanceBefore = extLockingCollateralToken.balanceOf(e.msg.sender);
    mathint lockerCollateralBalanceBefore = extLockingCollateralToken.balanceOf(extLockingCollateralLocker);

    externalUnlockCollateral(e, extLockingCollateralToken, amount);

    mathint borrowerCollateralBalanceAfter = getCollateralBalance(e.msg.sender, extLockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(extLockingCollateralToken);
    mathint borrowerCollateralTokenBalanceAfter = extLockingCollateralToken.balanceOf(e.msg.sender);
    mathint lockerCollateralBalanceAfter = extLockingCollateralToken.balanceOf(extLockingCollateralLocker);

    assert borrowerCollateralBalanceAfter + amount == borrowerCollateralBalanceBefore;
    assert (extLockingRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) != 0) => encumberedCollateralBalanceAfter + amount  == encumberedCollateralBalanceBefore;
    assert (extLockingRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) == 0) => encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore;
    assert borrowerCollateralTokenBalanceAfter == borrowerCollateralTokenBalanceBefore + amount;
    assert lockerCollateralBalanceBefore == lockerCollateralBalanceAfter + amount;
}

rule externalUnlockCollateralThirdParty(env e){
    address borrower2;
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(extLockingCollateralToken)); // Bounds for test
    require(e.msg.sender != borrower2);
    require(e.msg.sender != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker
    require(borrower2 != extLockingCollateralLocker); // externalLockCollateral() is never called in the repo locker


    mathint thirdPartyBorrowerCollateralBalanceBefore = getCollateralBalance(borrower2, extLockingCollateralToken);
    mathint thirdPartyBorrowerCollateralTokenBalanceBefore = extLockingCollateralToken.balanceOf(borrower2);

    externalUnlockCollateral(e, extLockingCollateralToken, amount);

    mathint thirdPartyBorrowerCollateralBalanceAfter = getCollateralBalance(borrower2, extLockingCollateralToken);
    mathint thirdPartyBorrowerCollateralTokenBalanceAfter = extLockingCollateralToken.balanceOf(borrower2);

    assert thirdPartyBorrowerCollateralBalanceAfter == thirdPartyBorrowerCollateralBalanceBefore;
    assert thirdPartyBorrowerCollateralTokenBalanceAfter == thirdPartyBorrowerCollateralTokenBalanceBefore;
}

rule externalUnlockCollateralRevertConditions(env e){
    uint256 amount;

    require(termRepoLocker() == extLockingCollateralLocker); // Bounds for test
    require(repoServicer() == extLockingRepoServicer); // Bounds for test
    require(collateralTokens(0) == extLockingCollateralToken);

    require(extLockingRepoServicer.getBorrowerRepurchaseObligation(e.msg.sender) == 0 || getCollateralBalance(e.msg.sender, extLockingCollateralToken) < encumberedCollateralBalance(extLockingCollateralToken) ); // Proved in sumOfCollateralBalancesLessThanEncumberedBalances in ./stateVariables.spec
    require(extLockingCollateralToken.balanceOf(extLockingCollateralLocker) >= getCollateralBalance(e.msg.sender, extLockingCollateralToken)); // Proved lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in stateVariables.spec
    require(extLockingCollateralToken.balanceOf(e.msg.sender) + amount <= max_uint256); // erc20 balances do not overflow

    bool payable = e.msg.value > 0;
    bool zeroAmount = amount == 0;
    bool isNotCollateralToken = !isTokenCollateral(extLockingCollateralToken);
    bool borrowerEndsUpInShortfall = willBorrowerBeInShortfall(e.msg.sender,0,extLockingCollateralToken,amount); 
    bool collateralDepositClosed = e.block.timestamp >= extLockingRepoServicer.endOfRepurchaseWindow() && e.block.timestamp < extLockingRepoServicer.redemptionTimestamp();
    bool zeroBorrowerCollateralBalance = getCollateralBalance(e.msg.sender, extLockingCollateralToken) == 0;
    bool notEnoughCollateralToUnlock = getCollateralBalance(e.msg.sender, extLockingCollateralToken) < amount;
    bool lockerTransfersPaused = extLockingCollateralLocker.transfersPaused();
    bool lockerNotPaired = !extLockingCollateralLocker.hasRole(extLockingCollateralLocker.SERVICER_ROLE(), currentContract);

    bool isExpectedToRevert = payable || zeroAmount || isNotCollateralToken || borrowerEndsUpInShortfall || collateralDepositClosed || zeroBorrowerCollateralBalance || notEnoughCollateralToUnlock || lockerTransfersPaused || lockerNotPaired  ;

    externalUnlockCollateral@withrevert(e, extLockingCollateralToken, amount);

    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

