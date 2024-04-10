using TermRepoLocker as locker;
using TermRepoRolloverManager as rolloverManager;
using TermRepoCollateralManagerHarness as repaymentCollateralManager;
using TermRepoToken as repoToken;
using DummyERC20A as token;
using DummyERC20A as repaymentCollateralToken;


methods {
    
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function termRepoLocker() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;
    function isTermRepoBalanced() external returns (bool) envfree;
    function totalCollateral(address) external returns (uint256) envfree;

    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns(bytes32) envfree;
    function TermRepoCollateralManagerHarness.collateralTokensLength() external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.encumberedCollateralBalance(address) external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.getCollateralBalance(address,address) external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoCollateralManagerHarness.isInCollateralTokenArray(address) external returns (bool) envfree;

    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermRepoRolloverManager.getRolloverInstructions(address) external returns (TermRepoRolloverManager.TermRepoRolloverElection) envfree;
    function TermRepoToken.redemptionValue() external returns(uint256) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20A.totalSupply() external returns(uint256) envfree;
}

hook EXTCODESIZE(address addr) uint v {
    require v > 0;
}

rule repaymentsMonotonicBehavior(env e) {
    address borrower;
	uint256 repayment;

    uint256 balanceBefore = getBorrowerRepurchaseObligation(borrower);
    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    uint256 totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    mathint totalCollateralBefore = totalCollateral(borrower);


    submitRepurchasePayment(e, repayment);

    uint256 balanceAfter = getBorrowerRepurchaseObligation(borrower);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    uint256 totalRepurchaseCollectedAfter = totalRepurchaseCollected();
    mathint totalCollateralAfter = totalCollateral(borrower);


    assert balanceBefore >= balanceAfter; //Borrow Balances monotonically decrease after repayments.
    assert totalOutstandingRepurchaseExposureBefore >= totalOutstandingRepurchaseExposureAfter; // Total outstanding repurchase monotonically decreases after repayments
    assert totalRepurchaseCollectedBefore <= totalRepurchaseCollectedAfter; //Total repurchase collected monotonically increases after repayment.
    assert totalCollateralAfter <= totalCollateralBefore; // Total Collateral must be less than or equal to before after repayment.
}

rule repaymentsIntegrity(env e) {
    address borrower;
	uint256 repayment;

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    mathint rolloverAmount = rolloverManager.getRolloverInstructions(borrower).rolloverAmount;
    bool rolloverProcessed = rolloverManager.getRolloverInstructions(borrower).processed;
    mathint repaymentAmount = repayment;
    mathint totalCollateralBefore = totalCollateral(borrower);

    require(e.block.timestamp < endOfRepurchaseWindow());

    require(e.msg.sender == borrower); // Bounds for test
    require (totalOutstandingRepurchaseExposureBefore >= balanceBefore);
    require (rolloverAmount <= balanceBefore);
    require (totalRepurchaseCollectedBefore + repayment < max_uint256 ); // overflow protection proved in rule totalRepurchaseCollectedBefore

    mathint outstandingRolloverAmount; 
    if (rolloverProcessed){
        outstandingRolloverAmount = 0;
    }
    else {
        outstandingRolloverAmount = rolloverAmount;
    }
    
    mathint maxRepayment = balanceBefore - outstandingRolloverAmount;

    require(repaymentAmount <= maxRepayment); // Revert covered in repaymentsRevertingConditions
    
    submitRepurchasePayment(e, repayment);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    mathint totalRepurchaseCollectedAfter = totalRepurchaseCollected();
    mathint totalCollateralAfter = totalCollateral(borrower);

    assert balanceBefore == balanceAfter + repaymentAmount;
    assert totalOutstandingRepurchaseExposureBefore  == totalOutstandingRepurchaseExposureAfter + repaymentAmount; 
    assert totalRepurchaseCollectedBefore + repaymentAmount == totalRepurchaseCollectedAfter;
    assert balanceAfter == 0 => totalCollateralAfter == 0;
    assert balanceAfter != 0 => totalCollateralBefore == totalCollateralAfter;
}

rule repaymentsDoesNotAffectThirdParty(env e) {
    address borrower1;
	uint256 repayment;
    address borrower2;

    require (borrower1 != borrower2);
    require(e.msg.sender == borrower1);

    uint256 thirdPartyBalanceBefore = getBorrowerRepurchaseObligation(borrower2);

    submitRepurchasePayment(e, repayment);

    uint256 thirdPartyBalanceAfter = getBorrowerRepurchaseObligation(borrower2);

    assert thirdPartyBalanceBefore == thirdPartyBalanceAfter; // Third party borrow balance not affected by repayment;
}

rule repaymentsRevertingConditions(env e){
    address borrower = e.msg.sender;
    uint256 repayment;

    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);

    mathint rolloverAmount = rolloverManager.getRolloverInstructions(borrower).rolloverAmount;
    bool rolloverProcessed = rolloverManager.getRolloverInstructions(borrower).processed;
    mathint repaymentAmount = repayment;

    require (termRepoLocker() == locker); // No proof necessary. Bounds for test.
    require (termRepoCollateralManager() == repaymentCollateralManager); // Bounds for Test
    require (repaymentCollateralManager.collateralTokensLength() == 1); // Bounds for Test
    require(repaymentCollateralManager.isInCollateralTokenArray(repaymentCollateralToken)); // Bounds for Test
    require (locker.hasRole(locker.SERVICER_ROLE(), repaymentCollateralManager)); //Proved in onlyRoleCanCallRevert in termRepoLocker/rules.spec
    require (repaymentCollateralManager.hasRole(repaymentCollateralManager.SERVICER_ROLE(), currentContract)); // Proved in onlyRoleCanCallRevert in termRepoCollateralManager/accessRoles.spec
    require(purchaseToken() == token); //No proof necessary. Bounds for test.
    require(e.msg.sender != 0); // Safe assumption given difficulty of breaking keccak256 hash
    require(totalRepurchaseCollected() + repayment <= max_uint256); // Assumption proven in rule totalRepurchaseCollectedNeverOverflows in stateVariables.spec
    require(token.totalSupply() + repayment <= max_uint256); // Assumption from proven fact that erc20 total supply does not overflow
    require(token.totalSupply() >= token.balanceOf(locker)); // Assumption from proven totalSupplyIsSumOfBalances invariant for erc20s
    require (shortfallHaircutMantissa() == 0 ); // Assumption proven in rule shortfallHaircutMantissaAlwaysZeroBeforeRedemption in stateVariables.spec
    require(isTermRepoBalanced()); // Safe assumption that term repo must be balanced before transaction due to assertion.
    require(repaymentCollateralManager.getCollateralBalance(e.msg.sender, repaymentCollateralToken) <= repaymentCollateralManager.encumberedCollateralBalance(repaymentCollateralToken));  // Proved in sumOfCollateralBalancesLessThanEncumberedBalances in ../termRepoCollateralManager/stateVariables.spec
    require(repaymentCollateralToken.balanceOf(locker) >= repaymentCollateralManager.getCollateralBalance(e.msg.sender, repaymentCollateralToken));  // Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance in ../termRepoCollateralManager/stateVariables.spec
    require(repaymentCollateralToken.balanceOf(e.msg.sender) + repaymentCollateralManager.getCollateralBalance(e.msg.sender, repaymentCollateralToken) <= max_uint256); // Prevent overflow
    mathint outstandingRolloverAmount; 
    if (rolloverProcessed){
        outstandingRolloverAmount = 0;
    }
    else {
        outstandingRolloverAmount = rolloverAmount;
    }
    
    mathint maxRepayment;

    if (balanceBefore - outstandingRolloverAmount < repaymentAmount  ) {
        maxRepayment = balanceBefore - outstandingRolloverAmount;
    } else {
        maxRepayment = repaymentAmount;
    }

    bool payable = e.msg.value > 0;
    bool lockerTransfersPaused = locker.transfersPaused();
    bool noLockerServicerAccess = !locker.hasRole(locker.SERVICER_ROLE(), currentContract);
    bool allowanceTooLow = token.allowance( borrower, termRepoLocker()) < repayment;
    bool borrowTokenBalanceTooLow = token.balanceOf(borrower) < repayment;
    bool afterRepurchaseWindow = e.block.timestamp >= endOfRepurchaseWindow();
    bool borrowerZeroObligation = getBorrowerRepurchaseObligation(borrower) == 0;
    bool uintMaxRepayment = repayment == max_uint256;
    bool repaymentGreaterThanMax = repaymentAmount > maxRepayment;
    bool noServicerRoleOnCollateralManager = !repaymentCollateralManager.hasRole(repaymentCollateralManager.SERVICER_ROLE(), currentContract);

    bool isExpectedToRevert = payable || lockerTransfersPaused || noLockerServicerAccess || borrowTokenBalanceTooLow || allowanceTooLow || afterRepurchaseWindow || borrowerZeroObligation || uintMaxRepayment || repaymentGreaterThanMax || noServicerRoleOnCollateralManager;

    submitRepurchasePayment@withrevert(e, repayment);
    
    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;
}