using DummyERC20A as lockingCollateralToken;
using TermRepoLocker as lockingCollateralLocker;
using TermRepoServicer as journalCollateralServicer;


methods {
    function AUCTION_LOCKER() external returns (bytes32) envfree;
    function SERVICER_ROLE() external returns (bytes32) envfree;
    function encumberedCollateralBalance(address) external returns (uint256) envfree;
    function getCollateralBalance(address,address) external returns (uint256) envfree;
    function collateralTokens(uint256) external returns (address) envfree;
    function collateralTokensLength() external returns (uint256) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoServicer.getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;

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
    // auctionLockCollateral -> termRepoLocker.transferTokenFromWallet, which has whileTermContractsNotPaused
    // (direct call, not try/catch), so a globally-paused controller reverts.
    bool globalPaused = controllerLiquidations.termContractsPaused(e);

    bool isExpectedToRevert = payable || lockerTransfersPaused || lockerNotPaired ||  borrowTokenBalanceTooLow || allowanceTooLow || notAuctionLocker || globalPaused;

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
    // auctionUnlockCollateral -> termRepoLocker.transferTokenToWallet, which has whileTermContractsNotPaused
    // (direct call, not try/catch), so a globally-paused controller reverts.
    bool globalPaused = controllerLiquidations.termContractsPaused(e);

    bool isExpectedToRevert = payable || lockerTransfersPaused || lockerNotPaired ||  lockerTokenBalanceTooLow || notAuctionLocker || globalPaused;

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

    // _encumberExistingCollateralInternal iterates the contract's OWN collateralTokens array. Bind that array to a single
    // collateral token == lockingCollateralToken so the existing-locked re-encumbering applies to this token exactly once
    // (and so the prover can't pick a state where lockingCollateralToken is "collateral" but not in the iterated array).
    require(collateralTokensLength() == 1);
    require(collateralTokens(0) == lockingCollateralToken);

    address[] inputCollateralTokens;
    require(inputCollateralTokens.length == 1);
    require(inputCollateralTokens[0] == lockingCollateralToken);

    uint256[] amounts;
    require(amounts.length == 1);
    require(amounts[0] == amount);

    journalBidCollateralToCollateralManager(e, borrower, inputCollateralTokens, amounts);

    uint256 bidderCollateralBalanceAfter = getCollateralBalance(borrower, lockingCollateralToken);
    mathint encumberedCollateralBalanceAfter = encumberedCollateralBalance(lockingCollateralToken);
    mathint bidderCollateralTokenBalanceAfter = lockingCollateralToken.balanceOf(borrower);
    mathint lockerCollateralBalanceAfter = lockingCollateralToken.balanceOf(lockingCollateralLocker);

    // When the borrower's repurchase obligation is zero, journalBidCollateralToCollateralManager first calls
    // _encumberExistingCollateralInternal, which re-encumbers the borrower's existing locked balance for this token
    // (bidderCollateralBalanceBefore) before the new amount is added. So encumbered grows by (existing + amount) in
    // that case, and by just (amount) otherwise. The per-borrower ledger still increases by exactly amount (the
    // internal re-encumber only touches encumberedCollateralBalances, not lockedCollateralLedger).
    bool journalZeroObligation = journalCollateralServicer.getBorrowerRepurchaseObligation(borrower) == 0;
    assert bidderCollateralBalanceAfter == require_uint256(bidderCollateralBalanceBefore + amount);
    assert encumberedCollateralBalanceAfter == encumberedCollateralBalanceBefore + amount + (journalZeroObligation ? bidderCollateralBalanceBefore : 0);
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

    // _encumberExistingCollateralInternal iterates the contract's OWN collateralTokens array and re-encumbers each token's
    // existing locked balance. Bind that array to a single collateral token == lockingCollateralToken so it only re-encumbers
    // this token (otherwise the re-encumber of a second token, encumbered[token1] += locked[borrower][token1], can overflow).
    require(collateralTokensLength() == 1);
    require(collateralTokens(0) == lockingCollateralToken);

    address[] inputCollateralTokens;
    require(inputCollateralTokens.length == 1);
    require(inputCollateralTokens[0] == lockingCollateralToken);

    uint256[] amounts;
    require(amounts.length == 1);
    require(amounts[0] == amount);

    require(getCollateralBalance(borrower, lockingCollateralToken) + amount <= max_uint256); // Proved in lockedCollateralLedgerDoesNotOverflow of stateVariables.spec
    // When the borrower's obligation is zero, _encumberExistingCollateralInternal re-encumbers the existing locked
    // balance (encumbered += locked) before the main loop adds the new amount (encumbered += amount). Bound
    // encumbered + existing + amount so neither checked add overflow-reverts in a way isExpectedToRevert doesn't model.
    require(encumberedCollateralBalance(lockingCollateralToken) + getCollateralBalance(borrower, lockingCollateralToken) + amount <= max_uint256); // Proved in stateVariables.spec encumberedCollateralBalancesNeverOverflows



    bool payable = e.msg.value > 0;
    bool notServicerRole = !hasRole(SERVICER_ROLE(), e.msg.sender);

    bool isExpectedToRevert = payable ||  notServicerRole;

    journalBidCollateralToCollateralManager@withrevert(e, borrower, inputCollateralTokens, amounts);

    assert lastReverted <=> isExpectedToRevert;
}