using DummyERC20A as lockingCollateralToken;
using TermRepoLocker as lockingCollateralLocker;


methods {
    function AUCTION_LOCKER() external returns (bytes32) envfree;
    function SERVICER_ROLE() external returns (bytes32) envfree;
    function encumberedCollateralBalance(address) external returns (uint256) envfree;
    function getCollateralBalance(address,address) external returns (uint256) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;

    function isTokenCollateral(address) external returns (bool) envfree;
    function termRepoLocker() external returns (address) envfree;

    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;

    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
}

rule auctionLockCollateralIntegrity(env e){
    address bidder;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(bidder != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker

    mathint bidderCollateralBalanceBefore = getCollateralBalance(bidder, lockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(bidder);
    mathint lockerCollateralBalanceBefore = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    auctionLockCollateral(e, bidder, lockingCollateralToken, amount);

    mathint bidderCollateralBalanceAfter = getCollateralBalance(bidder, lockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(bidder);
    mathint lockerCollateralBalanceAfter = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    assert bidderCollateralBalanceAfter == bidderCollateralBalanceBefore;
    assert encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore;
    assert bidderCollateralTokenBalanceAfter + amount == bidderCollateralTokenBalanceBefore;
    assert lockerCollateralBalanceBefore + amount == lockerCollateralBalanceAfter;
}

rule auctionLockCollateralThirdParty(env e){
    address bidder;
    address bidder2;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(bidder != bidder2);
    require(bidder != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker
    require(bidder2 != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker


    mathint thirdPartyBidderCollateralBalanceBefore = getCollateralBalance(bidder2, lockingCollateralToken);
    mathint thirdPartyBidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(bidder2);

    auctionLockCollateral(e, bidder, lockingCollateralToken, amount);

    mathint thirdPartyBidderCollateralBalanceAfter = getCollateralBalance(bidder2, lockingCollateralToken);
    mathint thirdPartyBidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(bidder2);

    assert thirdPartyBidderCollateralBalanceAfter == thirdPartyBidderCollateralBalanceBefore;
    assert thirdPartyBidderCollateralTokenBalanceAfter == thirdPartyBidderCollateralTokenBalanceBefore;
}

rule auctionLockCollateralRevertConditions(env e){
    address bidder;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test

    require(lockingCollateralToken.balanceOf(lockingCollateralLocker) + amount <= max_uint256); // erc20 balances do not overflow

    bool payable = e.msg.value > 0;
    bool lockerTransfersPaused = lockingCollateralLocker.transfersPaused();
    bool lockerNotPaired = !lockingCollateralLocker.hasRole(lockingCollateralLocker.SERVICER_ROLE(), currentContract);
    bool allowanceTooLow = lockingCollateralToken.allowance( bidder, termRepoLocker()) < amount;
    bool borrowTokenBalanceTooLow = lockingCollateralToken.balanceOf(bidder) < amount;
    bool notAuctionLocker = !hasRole(AUCTION_LOCKER(), e.msg.sender);

    bool isExpectedToRevert = payable || lockerTransfersPaused || lockerNotPaired ||  borrowTokenBalanceTooLow || allowanceTooLow || notAuctionLocker;

    auctionLockCollateral@withrevert(e, bidder, lockingCollateralToken, amount);

    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

rule auctionUnlockCollateralIntegrity(env e){
    address bidder;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(bidder != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker

    mathint bidderCollateralBalanceBefore = getCollateralBalance(bidder, lockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(bidder);
    mathint lockerCollateralBalanceBefore = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    auctionUnlockCollateral(e, bidder, lockingCollateralToken, amount);

    mathint bidderCollateralBalanceAfter = getCollateralBalance(bidder, lockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(bidder);
    mathint lockerCollateralBalanceAfter = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    assert bidderCollateralBalanceAfter == bidderCollateralBalanceBefore;
    assert encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore;
    assert bidderCollateralTokenBalanceAfter == bidderCollateralTokenBalanceBefore + amount;
    assert lockerCollateralBalanceBefore == lockerCollateralBalanceAfter + amount;
}

rule auctionUnlockCollateralThirdParty(env e){
    address bidder;
    address bidder2;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(bidder != bidder2);
    require(bidder != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker
    require(bidder2 != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker


    mathint thirdPartyBidderCollateralBalanceBefore = getCollateralBalance(bidder2, lockingCollateralToken);
    mathint thirdPartyBidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(bidder2);

    auctionUnlockCollateral(e, bidder, lockingCollateralToken, amount);

    mathint thirdPartyBidderCollateralBalanceAfter = getCollateralBalance(bidder2, lockingCollateralToken);
    mathint thirdPartyBidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(bidder2);

    assert thirdPartyBidderCollateralBalanceAfter == thirdPartyBidderCollateralBalanceBefore;
    assert thirdPartyBidderCollateralTokenBalanceAfter == thirdPartyBidderCollateralTokenBalanceBefore;
}

rule auctionUnlockCollateralRevertConditions(env e){
    address bidder;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test

    require(lockingCollateralToken.balanceOf(bidder) + amount <= max_uint256); // erc20 balances do not overflow

    bool payable = e.msg.value > 0;
    bool lockerTransfersPaused = lockingCollateralLocker.transfersPaused();
    bool lockerNotPaired = !lockingCollateralLocker.hasRole(lockingCollateralLocker.SERVICER_ROLE(), currentContract);
    bool lockerTokenBalanceTooLow = lockingCollateralToken.balanceOf(lockingCollateralLocker) < amount;
    bool notAuctionLocker = !hasRole(AUCTION_LOCKER(), e.msg.sender);

    bool isExpectedToRevert = payable || lockerTransfersPaused || lockerNotPaired ||  lockerTokenBalanceTooLow || notAuctionLocker;

    auctionUnlockCollateral@withrevert(e, bidder, lockingCollateralToken, amount);

    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}

rule journalBidCollateralToCollateralManagerIntegrity(env e){
    address borrower;
    uint256 amount;

    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(borrower != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker

    mathint bidderCollateralBalanceBefore = getCollateralBalance(borrower, lockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(borrower);
    mathint lockerCollateralBalanceBefore = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    address[] collateralTokens;
    require(collateralTokens.length == 1);
    require(collateralTokens[0] == lockingCollateralToken);

    uint256[] amounts;
    require(amounts.length == 1);
    require(amounts[0] == amount);

    journalBidCollateralToCollateralManager(e, borrower, collateralTokens, amounts);

    uint256 bidderCollateralBalanceAfter = getCollateralBalance(borrower, lockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(borrower);
    mathint lockerCollateralBalanceAfter = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    assert bidderCollateralBalanceAfter == require_uint256(bidderCollateralBalanceBefore + amount);
    assert encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore + amount;
    assert bidderCollateralTokenBalanceAfter == bidderCollateralTokenBalanceBefore;
    assert lockerCollateralBalanceBefore == lockerCollateralBalanceAfter;
}

rule journalBidCollateralToCollateralManagerThirdParty(env e){
    address borrower;
    uint256 amount;
    address borrower2;


    require(termRepoLocker() == lockingCollateralLocker); // Bounds for test
    require(isTokenCollateral(lockingCollateralToken)); // Bounds for test
    require(borrower != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker
    require(borrower != borrower2); // borrowers are not the same
    require(borrower2 != lockingCollateralLocker); // auctionLockCollateral() is never called in the repo locker

    mathint bidderCollateralBalanceBefore = getCollateralBalance(borrower2, lockingCollateralToken);
    mathint encumberedCollateralBalanceBefore = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceBefore = lockingCollateralToken.balanceOf(borrower2);
    mathint lockerCollateralBalanceBefore = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    address[] collateralTokens;
    require(collateralTokens.length == 1);
    require(collateralTokens[0] == lockingCollateralToken);

    uint256[] amounts;
    require(amounts.length == 1);
    require(amounts[0] == amount);

    journalBidCollateralToCollateralManager(e, borrower, collateralTokens, amounts);

    mathint bidderCollateralBalanceAfter = getCollateralBalance(borrower2, lockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(borrower2);
    mathint lockerCollateralBalanceAfter = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    assert bidderCollateralBalanceAfter == bidderCollateralBalanceBefore;
    assert bidderCollateralTokenBalanceAfter == bidderCollateralTokenBalanceBefore;
}


rule journalBidCollateralToCollateralManagerRevertConditions(env e, calldataarg args){
    address borrower;
    uint256 amount;

    address[] collateralTokens;
    require(collateralTokens.length == 1);
    require(collateralTokens[0] == lockingCollateralToken);

    uint256[] amounts;
    require(amounts.length == 1);
    require(amounts[0] == amount);

    require(getCollateralBalance(borrower, lockingCollateralToken) + amount <= max_uint256); // Proved in lockedCollateralLedgerDoesNotOverflow of stateVariables.spec
    require(encumberedCollateralBalance(lockingCollateralToken) + amount <= max_uint256); // Proved in stateVariables.spec encumberedCollateralBalancesNeverOverflows



    bool payable = e.msg.value > 0;
    bool notServicerRole = !hasRole(SERVICER_ROLE(), e.msg.sender);

    bool isExpectedToRevert = payable ||  notServicerRole;

    journalBidCollateralToCollateralManager@withrevert(e, borrower, collateralTokens, amounts);

    assert lastReverted <=> isExpectedToRevert;
}