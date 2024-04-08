using TermController as collapsingController;
using TermRepoCollateralManagerHarness as collapsingCollateralManager;
using TermRepoLocker as collapsingLocker;
using TermRepoRolloverManager as collapsingRolloverManager;
using TermRepoToken as collapsingRepoToken;
using DummyERC20A as collapsingToken;

methods {
    
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function isTokenCollateral(address) external returns (bool) envfree;
    function maturityTimestamp() external returns (uint256) envfree;
    function termControllerAddress() external returns (address) envfree;
    function termRepoCollateralManager() external returns(address) envfree;
    function termRepoLocker() external returns(address) envfree;
    function termRepoToken() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function servicingFee() external returns (uint256) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;
    function totalCollateral(address) external returns (uint256) envfree;
    function isTermRepoBalanced() external returns (bool) envfree;



    function TermController.getTreasuryAddress() external returns (address) envfree;
    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoCollateralManagerHarness.collateralTokens(uint256) external returns (address) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoCollateralManagerHarness.encumberedCollateralBalance(address) external returns (uint256) envfree;

    function TermRepoCollateralManagerHarness.termRepoLocker() external returns (address) envfree;
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
    function DummyERC20A.decimals() external returns(uint256) envfree;
    function DummyERC20A.totalSupply() external returns(uint256) envfree;
}

rule burnCollapseExposureMonotonicBehavior(env e) {
    uint256 amount;

    require(termRepoToken() == collapsingRepoToken); //fixing connection 
    require(termRepoCollateralManager() == collapsingCollateralManager); //fixing connection
    require(!isTokenCollateral(collapsingRepoToken)); 


    uint256 collapserRepoTokenBalanceBefore = collapsingRepoToken.balanceOf(e.msg.sender);
    uint256 collapserRepoExposureBefore = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    
    burnCollapseExposure(e, amount);

    uint256 collapserRepoTokenBalanceAfter = collapsingRepoToken.balanceOf(e.msg.sender);
    uint256 collapserRepoExposureAfter = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();

    assert collapserRepoTokenBalanceBefore >= collapserRepoTokenBalanceAfter; // Collapser repo token balance monotonically decreases after collapsing.
    assert collapserRepoExposureBefore >= collapserRepoExposureAfter; // Collapser repo token balance monotonically decreases repurchase obligation.
    assert totalOutstandingRepurchaseExposureBefore >= totalOutstandingRepurchaseExposureAfter; // Total outstanding repurchase exposure  monotonically decreases after collapsing.
}

rule burnCollapseExposureIntegrity(env e) {
    uint256 amount;

    uint256 expScale = 1000000000000000000;

    require(termRepoToken() == collapsingRepoToken); //fixing connection 
    require(termRepoCollateralManager() == collapsingCollateralManager); //fixing connection
    require(purchaseToken() == collapsingToken); //fixing connection
    require(!isTokenCollateral(collapsingRepoToken)); 

    require(collapsingRepoToken.redemptionValue() > 0); 


    uint256 purchaseTokenDecimals = collapsingToken.decimals();
    require (purchaseTokenDecimals <= 18);

    uint256 collapserRepoTokenBalanceBefore = collapsingRepoToken.balanceOf(e.msg.sender);
    uint256 collapserRepoExposureBefore = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint rolloverAmount = collapsingRolloverManager.getRolloverInstructions(e.msg.sender).rolloverAmount;
    bool rolloverProcessed = collapsingRolloverManager.getRolloverInstructions(e.msg.sender).processed;
    mathint collapseAmount = amount;

    mathint outstandingRolloverAmount; 
    if (rolloverProcessed){
        outstandingRolloverAmount = 0;
    }
    else {
        outstandingRolloverAmount = rolloverAmount;
    }
    
    mathint maxRepayment = collapserRepoExposureBefore - outstandingRolloverAmount;

    mathint repaymentFromRepoTokenAmount = ((amount * expScale * collapsingRepoToken.redemptionValue()) / expScale ) / expScale;
    
    mathint maxRepaymentInRepoTokens = ((maxRepayment * 10 ^ (18 - purchaseTokenDecimals) * expScale) / collapsingRepoToken.redemptionValue()) / (10 ^ (18 - purchaseTokenDecimals));
    
    mathint repaymentInTokens = collapseAmount < maxRepaymentInRepoTokens ? collapseAmount : maxRepaymentInRepoTokens;

    mathint repaymentInPurchaseToken = collapseAmount < maxRepaymentInRepoTokens ?  repaymentFromRepoTokenAmount : maxRepayment;
    
    burnCollapseExposure(e, amount);

    uint256 collapserRepoTokenBalanceAfter = collapsingRepoToken.balanceOf(e.msg.sender);
    uint256 collapserRepoExposureAfter = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();

    assert collapserRepoTokenBalanceBefore - collapserRepoTokenBalanceAfter == repaymentInTokens; // Collapser repo token balance decreases after collapsing by expected amount.
    assert collapserRepoExposureBefore - collapserRepoExposureAfter == repaymentInPurchaseToken; // Collapser repo token balance  decreases repurchase obligation by expected amount.
    assert totalOutstandingRepurchaseExposureBefore - totalOutstandingRepurchaseExposureAfter == repaymentInPurchaseToken; // Total outstanding repurchase exposure   decreases after collapsing by expected amount.
}

rule burnCollapseExposureDoesNotAffectThirdParty(env e) {
	uint256 amount;
    address collapser2;

    require (e.msg.sender != collapser2);
    require(termRepoToken() == collapsingRepoToken); //fixing connection 
    require(termRepoCollateralManager() == collapsingCollateralManager); //fixing connection
    require(purchaseToken() == collapsingToken); //fixing connection
    require(!isTokenCollateral(collapsingRepoToken)); 
    uint256 thirdPartyRepoTokenBalanceBefore = collapsingRepoToken.balanceOf(collapser2);
    uint256 collapserRepoExposureBefore = getBorrowerRepurchaseObligation(collapser2);

    burnCollapseExposure(e, amount);

    uint256 thirdPartyRepoTokenBalanceAfter = collapsingRepoToken.balanceOf(collapser2);
    uint256 collapserRepoExposureAfter = getBorrowerRepurchaseObligation(collapser2);

    assert thirdPartyRepoTokenBalanceBefore == thirdPartyRepoTokenBalanceAfter; // Third party term token balance not affected by collapsing;
    assert collapserRepoExposureBefore == collapserRepoExposureAfter; //Third party repo xposure not affect by collapsing.
}

rule burnCollapseExposureRevertConditions(env e) {
    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;
    uint256 amount;
    address collateralToken;

    uint256 expScale = 10 ^ 18;

    require(purchaseToken() == collapsingToken); // Bounds for test
    require(termRepoLocker() == collapsingLocker); // Bounds for test
    require(termRepoToken() == collapsingRepoToken); // Bounds for test
    require(!isTokenCollateral(collapsingRepoToken)); // Repo token will never be collateral
    require(termRepoCollateralManager() == collapsingCollateralManager); // Bounds for test
    require(collapsingCollateralManager.termRepoLocker() == collapsingLocker); // Bounds for test
    require (shortfallHaircutMantissa() == 0 ); // Assumption proven in rule shortfallHaircutMantissaAlwaysZeroBeforeRedemption in stateVariables.spec
    require(isTermRepoBalanced()); // Safe assumption that term repo must be balanced before transaction due to assertion in code.
    require(collapsingToken.decimals() <= 18); 
    require(collapsingRepoToken.redemptionValue() > 0); // Prevents div by 0 errors.
    require(getBorrowerRepurchaseObligation(e.msg.sender) >= collapsingRolloverManager.getRolloverInstructions(e.msg.sender).rolloverAmount); // Proved in electRolloverIntegrity in termRepoRolloverManager/election.spec 

    uint256 purchaseTokenDecimals = collapsingToken.decimals();

    mathint collapserRepoTokenBalanceBefore = collapsingRepoToken.balanceOf(e.msg.sender);
    mathint collapserRepoExposureBefore = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint rolloverAmount = collapsingRolloverManager.getRolloverInstructions(e.msg.sender).rolloverAmount;
    bool rolloverProcessed = collapsingRolloverManager.getRolloverInstructions(e.msg.sender).processed;
    mathint collapseAmount = amount;

    mathint outstandingRolloverAmount; 
    if (rolloverProcessed){
        outstandingRolloverAmount = 0;
    }
    else {
        outstandingRolloverAmount = rolloverAmount;
    }
    
    mathint maxRepayment = collapserRepoExposureBefore - outstandingRolloverAmount;

    mathint repaymentFromRepoTokenAmount = ((amount * expScale * collapsingRepoToken.redemptionValue()) / expScale ) / expScale;
    
    mathint maxRepaymentInRepoTokens = ((maxRepayment * 10 ^ (18 - purchaseTokenDecimals) * expScale) / collapsingRepoToken.redemptionValue()) / (10 ^ (18 - purchaseTokenDecimals));
    
    mathint repaymentInTokens = collapseAmount < maxRepaymentInRepoTokens ? collapseAmount : maxRepaymentInRepoTokens;

    mathint repaymentInPurchaseToken = collapseAmount < maxRepaymentInRepoTokens ?  repaymentFromRepoTokenAmount : maxRepayment;

    require(collapsingRepoToken.mintExposureCap() + repaymentInTokens <= max_uint256); // Prevent mint exposure cap from overflowing
    require(collapsingToken.balanceOf(e.msg.sender) + collapsingCollateralManager.getCollateralBalance(e.msg.sender, collapsingToken) <= max_uint256); // Prevent borrower collateral token balance from overflowing

    require(collapsingCollateralManager.getCollateralBalance(e.msg.sender, collapsingCollateralManager.collateralTokens(0)) <= collapsingCollateralManager.encumberedCollateralBalance(collapsingCollateralManager.collateralTokens(0))); // Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ../termRepoCollateralManager/stateVariables.spec
    require(collapsingCollateralManager.getCollateralBalance(e.msg.sender, collapsingCollateralManager.collateralTokens(1)) <= collapsingCollateralManager.encumberedCollateralBalance(collapsingCollateralManager.collateralTokens(1))); // Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ../termRepoCollateralManager/stateVariables.spec

    require(collapsingCollateralManager.getCollateralBalance(e.msg.sender, collapsingToken) <= collapsingToken.balanceOf(collapsingLocker)); // Repo Locker has enough balance.


    bool payable = e.msg.value > 0;
    bool zeroAddressSender = e.msg.sender == 0;
    bool pastRepurchaseWindow = e.block.timestamp >= endOfRepurchaseWindow();
    bool zeroBorrowerRepurchaseObligation = getBorrowerRepurchaseObligation(e.msg.sender) == 0;
    bool servicerNotHaveRepoTokenBurnerRole = !collapsingRepoToken.hasRole(collapsingRepoToken.BURNER_ROLE(), currentContract);
    bool borrowerRepoTokenBalanceTooLow = (collapserRepoTokenBalanceBefore < collapseAmount && repaymentInTokens == collapseAmount) || (collapserRepoTokenBalanceBefore < maxRepaymentInRepoTokens && maxRepaymentInRepoTokens <= collapseAmount);
    bool repoTokenBurningPaused = collapsingRepoToken.burningPaused();
    bool noServicerRoleOnCollateralManager = !collapsingCollateralManager.hasRole(collapsingCollateralManager.SERVICER_ROLE(), currentContract) && maxRepaymentInRepoTokens <= collapseAmount;
    bool collatManagerDoesNotHaveLockerServicerRole = !collapsingLocker.hasRole(collapsingLocker.SERVICER_ROLE(), collapsingCollateralManager) && maxRepaymentInRepoTokens <= collapseAmount && totalCollateral(e.msg.sender) > 0; 
    bool lockerTransfersPaused = collapsingLocker.transfersPaused() && maxRepaymentInRepoTokens <= collapseAmount && totalCollateral(e.msg.sender) > 0; // Only in the case of full repayment
    bool termRepoUnbalanced = (totalOutstandingRepurchaseExposure() - repaymentInPurchaseToken + totalRepurchaseCollected() ) / (10 ^ 4) != (((((collapsingRepoToken.totalSupply() -  repaymentInTokens) * expScale * collapsingRepoToken.redemptionValue()) / expScale ) / expScale) / 10 ^ 4);

    bool isExpectedToRevert = payable || zeroAddressSender || pastRepurchaseWindow  || zeroMaxRepayment || servicerNotHaveRepoTokenBurnerRole || borrowerRepoTokenBalanceTooLow || repoTokenBurningPaused || noServicerRoleOnCollateralManager ||  collatManagerDoesNotHaveLockerServicerRole || lockerTransfersPaused || termRepoUnbalanced ;

    burnCollapseExposure@withrevert(e, amount);

    assert lastReverted <=> isExpectedToRevert;
}