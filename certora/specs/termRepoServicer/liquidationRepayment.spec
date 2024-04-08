using TermRepoLocker as liquidationRepaymentExposureLocker;
using TermRepoRolloverManager as liquidationRepaymentExposureRolloverManager;
using TermRepoCollateralManagerHarness as liquidationRepaymentExposureRepaymentCollateralManager;
using TermRepoToken as liquidationRepaymentExposureRepoToken;
using DummyERC20A as liquidationRepaymentExposureToken;

methods {
    
    function COLLATERAL_MANAGER() external returns (bytes32) envfree;
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
    function termRepoLocker() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function isTermRepoBalanced() external returns (bool) envfree;

    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns(bytes32) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermRepoRolloverManager.getRolloverInstructions(address) external returns (TermRepoRolloverManager.TermRepoRolloverElection) envfree;
    function TermRepoToken.BURNER_ROLE() external returns (bytes32) envfree;
    function TermRepoToken.burningPaused() external returns (bool) envfree;
    function TermRepoToken.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoToken.mintExposureCap() external returns(uint256) envfree;
    function TermRepoToken.redemptionValue() external returns(uint256) envfree;
    function TermRepoToken.totalRedemptionValue() external returns(uint256) envfree;

    function TermRepoToken.totalSupply() external returns(uint256) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20A.totalSupply() external returns(uint256) envfree;
}

rule liquidatorCoverExposureIntegrity(env e) {
    address borrower;
    address liquidator;
    uint256 amountToCover;

    require(purchaseToken() == liquidationRepaymentExposureToken); // Bounds for test
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    mathint liquidatorPurchaseTokenBalanceBefore = liquidationRepaymentExposureToken.balanceOf(liquidator);
    mathint lockerPurchaseTokenBalanceBefore = liquidationRepaymentExposureToken.balanceOf(termRepoLocker());


    liquidatorCoverExposure(e, borrower, liquidator, amountToCover);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    mathint totalRepurchaseCollectedAfter = totalRepurchaseCollected();
    mathint liquidatorPurchaseTokenBalanceAfter = liquidationRepaymentExposureToken.balanceOf(liquidator);
    mathint lockerPurchaseTokenBalanceAfter = liquidationRepaymentExposureToken.balanceOf(termRepoLocker());


    assert balanceBefore == balanceAfter + amountToCover;
    assert totalOutstandingRepurchaseExposureBefore == totalOutstandingRepurchaseExposureAfter + amountToCover;
    assert totalRepurchaseCollectedAfter == totalRepurchaseCollectedBefore + amountToCover;
    assert liquidatorPurchaseTokenBalanceBefore == liquidatorPurchaseTokenBalanceAfter + amountToCover;
    assert lockerPurchaseTokenBalanceAfter == lockerPurchaseTokenBalanceBefore + amountToCover;
}

rule liquidatorCoverExposureDoesNotAffectThirdParty(env e) {
    address borrower;
    address liquidator;
    uint256 amountToCover;

    address borrower2;
    address liquidator2;

    require(purchaseToken() == liquidationRepaymentExposureToken); // Bounds for test
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(liquidator2 != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(borrower != borrower2);
    require(liquidator != liquidator2);

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower2);
    mathint liquidatorPurchaseTokenBalanceBefore = liquidationRepaymentExposureToken.balanceOf(liquidator2);


    liquidatorCoverExposure(e, borrower, liquidator, amountToCover);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower2);
    mathint liquidatorPurchaseTokenBalanceAfter = liquidationRepaymentExposureToken.balanceOf(liquidator2);


    assert balanceBefore == balanceAfter;
    assert liquidatorPurchaseTokenBalanceBefore == liquidatorPurchaseTokenBalanceAfter;
}

rule liquidatorCoverExposureRevertConditions(env e) {
    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;
    address borrower;
    address liquidator;
    uint256 amountToCover;

    require(purchaseToken() == liquidationRepaymentExposureToken); // Bounds for test
    require(termRepoLocker() == liquidationRepaymentExposureLocker); // Bounds for test
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(totalRepurchaseCollected() + amountToCover <= max_uint256 ); // Prevents totalRepurchaseCollected overflow errors;
    require(liquidationRepaymentExposureToken.balanceOf(liquidationRepaymentExposureLocker) + amountToCover <= max_uint256); // Prevents locker token balance from overflowing. ERC20 balances do not overflow.
    require(liquidationRepaymentExposureToken.totalSupply() + amountToCover <= max_uint256); // Prevents token total supply from overflowing; ERC20 balances do not overflow.
    require (shortfallHaircutMantissa() == 0 ); // Assumption proven in rule shortfallHaircutMantissaAlwaysZeroBeforeRedemption in stateVariables.spec
    require(isTermRepoBalanced()); // Safe assumption that term repo must be balanced before transaction due to assertion in code.

    bool payable = e.msg.value > 0;
    bool callerNotCollateralManager = !hasRole(COLLATERAL_MANAGER(), e.msg.sender);
    bool servicerDoesNotHaveLockerServicerRole = !liquidationRepaymentExposureLocker.hasRole(liquidationRepaymentExposureLocker.SERVICER_ROLE(), currentContract);
    bool lockerTransfersPaused = liquidationRepaymentExposureLocker.transfersPaused();
    bool allowanceTooLow = liquidationRepaymentExposureToken.allowance( liquidator, termRepoLocker()) < amountToCover;
    bool liquidatorTokenBalanceTooLow = liquidationRepaymentExposureToken.balanceOf(liquidator) < amountToCover;
    bool borrowBalancecLowerThanCoverAmount = getBorrowerRepurchaseObligation(borrower) < amountToCover;

    bool isExpectedToRevert = payable || callerNotCollateralManager || servicerDoesNotHaveLockerServicerRole  || lockerTransfersPaused || liquidatorTokenBalanceTooLow || allowanceTooLow || borrowBalancecLowerThanCoverAmount ;

    liquidatorCoverExposure@withrevert(e, borrower, liquidator, amountToCover);

    assert lastReverted <=> isExpectedToRevert;
}

rule liquidatorCoverExposureWithRepoTokenIntegrity(env e) {
    address borrower;
    address liquidator;
    uint256 amountOfRepoToken;

    uint256 expScale = 10 ^ 18;

    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

    require(termRepoToken() == liquidationRepaymentExposureRepoToken); // Bounds for test
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint liquidatorRepoTokenBalanceBefore = liquidationRepaymentExposureRepoToken.balanceOf(liquidator);
    mathint repoTokenTotalSupplyBefore = liquidationRepaymentExposureRepoToken.totalSupply();

    require(liquidatorRepoTokenBalanceBefore + amountOfRepoToken <= max_uint256); // Repo Token balances do not overflow. Proved by rule totalSupplyNeverOverflow and invariant totalSupplyIsSumOfBalances in termRepoToken/erc20Full.spec

    mathint amountCovered = (amountOfRepoToken * expScale * liquidationRepaymentExposureRepoToken.redemptionValue() / expScale) / expScale;

    liquidatorCoverExposureWithRepoToken(e, borrower, liquidator, amountOfRepoToken);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    mathint liquidatorRepoTokenBalanceAfter = liquidationRepaymentExposureRepoToken.balanceOf(liquidator);
    mathint repoTokenTotalSupplyAfter = liquidationRepaymentExposureRepoToken.totalSupply();

    assert balanceBefore == balanceAfter + amountCovered;
    assert totalOutstandingRepurchaseExposureBefore == totalOutstandingRepurchaseExposureAfter + amountCovered;
    assert liquidatorRepoTokenBalanceBefore == liquidatorRepoTokenBalanceAfter + amountOfRepoToken;
    assert repoTokenTotalSupplyBefore == repoTokenTotalSupplyAfter + amountOfRepoToken;
}

rule liquidatorCoverExposureWithRepoTokenDoesNotAffectThirdParty(env e) {
    address borrower;
    address liquidator;
    uint256 amountOfRepoToken;

    address borrower2;
    address liquidator2;

    require(termRepoToken() == liquidationRepaymentExposureRepoToken); // Bounds for test
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(liquidator2 != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(borrower != borrower2);
    require(liquidator != liquidator2);

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower2);
    mathint liquidatorRepoTokenBalanceBefore = liquidationRepaymentExposureRepoToken.balanceOf(liquidator2);


    liquidatorCoverExposureWithRepoToken(e, borrower, liquidator, amountOfRepoToken);


    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower2);
    mathint liquidatorRepoTokenBalanceAfter = liquidationRepaymentExposureRepoToken.balanceOf(liquidator2);


    assert balanceBefore == balanceAfter;
    assert liquidatorRepoTokenBalanceBefore == liquidatorRepoTokenBalanceAfter;
}

rule liquidatorCoverExposureWithRepoTokenRevertConditions(env e) {
    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;
    address borrower;
    address liquidator;
    uint256 amountOfRepoToken;

    mathint expScale = 10 ^ 18;

    mathint amountToCover = ((amountOfRepoToken * expScale * liquidationRepaymentExposureRepoToken.redemptionValue()) / expScale ) / expScale;
    mathint borrowerBalance = getBorrowerRepurchaseObligation(borrower);

    require(termRepoToken() == liquidationRepaymentExposureRepoToken); // Bounds for test
    require(termRepoLocker() == liquidationRepaymentExposureLocker); // Bounds for test
    require (borrower != liquidator); // Not allowed from upstream calls.
    require(liquidator != termRepoLocker()); // Term Repo Locker contract has no function call to liquidate
    require(totalRepurchaseCollected() + amountOfRepoToken <= max_uint256 ); // Prevents totalRepurchaseCollected overflow errors;
    require (shortfallHaircutMantissa() == 0 ); // Assumption proven in rule shortfallHaircutMantissaAlwaysZeroBeforeRedemption in stateVariables.spec
    require(isTermRepoBalanced()); // Safe assumption that term repo must be balanced before transaction due to assertion in code.
    require(liquidationRepaymentExposureRepoToken.totalSupply() * expScale <= max_uint256); // Prevents overflow of repo token redemption value calculation
    require(liquidationRepaymentExposureRepoToken.mintExposureCap() + amountOfRepoToken <= max_uint256); // Prevents overflow of repo token mint exposure cap
    require(liquidationRepaymentExposureRepoToken.redemptionValue() > 10 ^ 4); // necessary for term repo balance to never fail

    bool payable = e.msg.value > 0;
    bool callerNotCollateralManager = !hasRole(COLLATERAL_MANAGER(), e.msg.sender);
    bool liquidatorIsAddressZero = liquidator == 0;
    bool servicerNotHaveRepoTokenBurnerRole = !liquidationRepaymentExposureRepoToken.hasRole(liquidationRepaymentExposureRepoToken.BURNER_ROLE(), currentContract);
    bool liquidatorTokenBalanceTooLow = liquidationRepaymentExposureRepoToken.balanceOf(liquidator) < amountOfRepoToken;
    bool repoTokenBurningPaused = liquidationRepaymentExposureRepoToken.burningPaused();
    bool termPoolBalanceThresholdBreached = ((totalOutstandingRepurchaseExposure() - amountToCover + totalRepurchaseCollected()) / 10 ^ 4) != (((((liquidationRepaymentExposureRepoToken.totalSupply() -  amountOfRepoToken) * expScale * liquidationRepaymentExposureRepoToken.redemptionValue()) / expScale ) / expScale) / 10 ^ 4);
    bool borrowBalanceLowerThanCoverAmount = borrowerBalance < amountToCover;

    bool isExpectedToRevert = payable ||   callerNotCollateralManager || liquidatorIsAddressZero || servicerNotHaveRepoTokenBurnerRole  || liquidatorTokenBalanceTooLow  || repoTokenBurningPaused  ||  termPoolBalanceThresholdBreached ||  borrowBalanceLowerThanCoverAmount;

    liquidatorCoverExposureWithRepoToken@withrevert(e, borrower, liquidator, amountOfRepoToken);

    assert lastReverted <=> isExpectedToRevert;
}
