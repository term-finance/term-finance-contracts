using TermController as rolloverExposureController;
using TermRepoLocker as rolloverExposureLocker;
using TermRepoRolloverManager as rolloverExposureRolloverManager;
using TermRepoCollateralManagerHarness as rolloverExposureRepaymentCollateralManager;
using TermRepoToken as rolloverExposureRepoToken;
using DummyERC20A as rolloverExposureToken;

methods {
    
    function AUCTIONEER() external returns (bytes32) envfree;
    function ROLLOVER_TARGET_AUCTIONEER_ROLE() external returns (bytes32) envfree;
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
    function maturityTimestamp() external returns (uint256) envfree;
    function termRepoLocker() external returns(address) envfree;
    function termRepoRolloverManager() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    
    function shortfallHaircutMantissa() external returns (uint256) envfree;
    function isTermRepoBalanced() external returns (bool) envfree;

    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns(bytes32) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermRepoRolloverManager.ROLLOVER_BID_FULFILLER_ROLE() external returns (bytes32) envfree;
    function TermRepoRolloverManager.getRolloverInstructions(address) external returns (TermRepoRolloverManager.TermRepoRolloverElection) envfree;
    function TermRepoRolloverManager.hasRole(bytes32,address) external returns (bool) envfree;

    function TermRepoToken.redemptionValue() external returns(uint256) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20A.totalSupply() external returns(uint256) envfree;

}

rule openExposureOnRolloverNewIntegrity(env e) {
    address borrower;
    uint256 purchasePrice;
    uint256 repurchasePrice;
    address previousTermRepoLocker;
    uint256 dayCountFractionMantissa;

    uint256 expScale = 10 ^ 18;

    require(purchaseToken() == rolloverExposureToken); // bounds for test
    require(termRepoLocker() == rolloverExposureLocker); // bounds for test
    require(rolloverExposureLocker != previousTermRepoLocker);
    require(rolloverExposureLocker != 100); // Protecting locker from using treasury address;
    require(previousTermRepoLocker != 100); // Protecting previous locker from using treasury address;
    require(e.msg.sender != 0); // Protecting from zero address

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint tokenBalanceTermRepoLockerBefore = rolloverExposureToken.balanceOf(rolloverExposureLocker);
    mathint tokenBalancePreviousTermRepoLockerBefore = rolloverExposureToken.balanceOf(previousTermRepoLocker);
    mathint tokenBalanceTreasuryBefore = rolloverExposureToken.balanceOf(100);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();

    mathint protocolShareFee = (dayCountFractionMantissa * servicingFee()) / expScale;
    mathint protocolShare = (protocolShareFee * purchasePrice) / (expScale);

    mathint previousRepoLockerRepayment = purchasePrice - protocolShare;

    openExposureOnRolloverNew(e, borrower, purchasePrice, repurchasePrice, previousTermRepoLocker, dayCountFractionMantissa);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    mathint tokenBalanceTermRepoLockerAfter = rolloverExposureToken.balanceOf(rolloverExposureLocker);
    mathint tokenBalancePreviousTermRepoLockerAfter = rolloverExposureToken.balanceOf(previousTermRepoLocker);
    mathint tokenBalanceTreasuryAfter = rolloverExposureToken.balanceOf(100);

    assert balanceAfter == balanceBefore + repurchasePrice;
    assert totalOutstandingRepurchaseExposureAfter == totalOutstandingRepurchaseExposureBefore + repurchasePrice;
    assert tokenBalanceTermRepoLockerAfter + purchasePrice == tokenBalanceTermRepoLockerBefore;
    assert tokenBalancePreviousTermRepoLockerAfter == tokenBalancePreviousTermRepoLockerBefore + previousRepoLockerRepayment;
    assert  tokenBalanceTreasuryAfter == tokenBalanceTreasuryBefore + protocolShare;
}

rule openExposureOnRolloverNewDoesNotAffectThirdParty(env e) {
    address borrower;
    address borrower2;
    uint256 purchasePrice;
    uint256 repurchasePrice;
    address previousTermRepoLocker;
    uint256 dayCountFractionMantissa;

    require (borrower != borrower2);

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower2);

    openExposureOnRolloverNew(e, borrower, purchasePrice, repurchasePrice, previousTermRepoLocker, dayCountFractionMantissa);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower2);

    assert balanceAfter == balanceBefore;
}

rule openExposureOnRolloverNewRevertConditions(env e) {
    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

    address borrower;
    uint256 purchasePrice;
    uint256 repurchasePrice;
    address previousTermRepoLocker;
    uint256 dayCountFractionMantissa;

    uint256 expScale = 10 ^ 18;


    require(termRepoLocker() == rolloverExposureLocker); // Bounds for test
    require(purchaseToken() == rolloverExposureToken); // Bounds for test
    require(rolloverExposureLocker != previousTermRepoLocker);
    require(rolloverExposureLocker != 100); // Protecting locker from using treasury address;
    require(previousTermRepoLocker != 100); // Protecting previous locker from using treasury address;

    mathint protocolShareFee = (dayCountFractionMantissa * servicingFee()) / expScale;
    mathint protocolShare = (protocolShareFee * purchasePrice) / (expScale);
    mathint purchasePriceForComparison = purchasePrice;

    require(protocolShare <= purchasePriceForComparison); //Is true as long as servicing fee is less than 100% and dayCountFractionMantissa isn't overly long.
    require(dayCountFractionMantissa * servicingFee() <= max_uint256); // Prevent overflow with excessively large dayCountFractions or Servicing Fees.
    require(protocolShareFee * purchasePrice <= max_uint256); // Prevent overflow with excessively large dayCountFractions or Servicing Fees.


    mathint previousRepoLockerRepayment = purchasePrice - protocolShare;


    require(getBorrowerRepurchaseObligation(borrower) + repurchasePrice <= max_uint256); // Prevent overflow errors
    require(totalOutstandingRepurchaseExposure() + repurchasePrice <= max_uint256); // Prevent overflow errors
    require(rolloverExposureToken.balanceOf(previousTermRepoLocker) + previousRepoLockerRepayment <= max_uint256); // Prevents locker token balance from overflowing. ERC20 balances do not overflow.
    require(rolloverExposureToken.balanceOf(100) + protocolShare <= max_uint256); // Prevents treasury token balance from overflowing. ERC20 balances do not overflow.



    bool payable = e.msg.value > 0;
    bool callerNotAuctioneer = !hasRole(AUCTIONEER(), e.msg.sender);
    bool afterMaturity = e.block.timestamp >= maturityTimestamp();
    bool lockerTransfersPaused = rolloverExposureLocker.transfersPaused();
    bool servicerNoLockerAccess = !rolloverExposureLocker.hasRole(rolloverExposureLocker.SERVICER_ROLE(), currentContract);

    bool lockerTokenBalanceTooLow = rolloverExposureToken.balanceOf(rolloverExposureLocker) < purchasePrice;


    bool isExpectedToRevert = payable ||   callerNotAuctioneer || afterMaturity || lockerTransfersPaused  || servicerNoLockerAccess  || lockerTokenBalanceTooLow;

    openExposureOnRolloverNew@withrevert(e, borrower, purchasePrice, repurchasePrice, previousTermRepoLocker, dayCountFractionMantissa);

    
    assert lastReverted <=> isExpectedToRevert;
}

rule closeExposureOnRolloverExistingIntegrity(env e) {
    address borrower;
    uint256 rolloverSettlementAmount;

    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

    require(termRepoRolloverManager() == rolloverExposureRolloverManager); // Bounds for test 

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint amountCollectedBefore = totalRepurchaseCollected();
    mathint actualRolloverSettlementAmount = assert_uint256(balanceBefore) < rolloverSettlementAmount ? balanceBefore : rolloverSettlementAmount;

    closeExposureOnRolloverExisting(e, borrower, rolloverSettlementAmount);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    mathint amountCollectedAfter = totalRepurchaseCollected();

    assert balanceBefore == balanceAfter + actualRolloverSettlementAmount;
    assert totalOutstandingRepurchaseExposureBefore == totalOutstandingRepurchaseExposureAfter + actualRolloverSettlementAmount;
    assert amountCollectedAfter == amountCollectedBefore + actualRolloverSettlementAmount;
    assert rolloverExposureRolloverManager.getRolloverInstructions(borrower).processed;
}

rule closeExposureOnRolloverExistingDoesNotAffectThirdParty(env e) {
    address borrower;
    address borrower2;
    uint256 rolloverSettlementAmount;

    require (borrower != borrower2);

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower2);

    closeExposureOnRolloverExisting(e, borrower, rolloverSettlementAmount);

    mathint balanceAfter = getBorrowerRepurchaseObligation(borrower2);

    assert balanceBefore == balanceAfter;
}

rule closeExposureOnRolloverExistingRevertConditions(env e) {
    address borrower;
    uint256 rolloverSettlementAmount;

    uint256 expScale = 10 ^ 18;


    requireInvariant totalOutstandingRepurchaseExposureIsSumOfRepurchases;

    require(termRepoRolloverManager() == rolloverExposureRolloverManager);

    require(totalRepurchaseCollected() + rolloverSettlementAmount <= max_uint256); // Prevent overflow errors
    require(totalRepurchaseCollected() + getBorrowerRepurchaseObligation(borrower) <= max_uint256); // Prevent overflow errors

    require(isTermRepoBalanced()); // Require that term repo is balanced before tx so that we are testing a valid state.
    require(shortfallHaircutMantissa() == 0); // Must be 0 during repayment period.

    require(rolloverSettlementAmount * expScale <= max_uint256); // Prevent overflows in calculation.

    mathint balanceBefore = getBorrowerRepurchaseObligation(borrower);
    mathint actualRolloverSettlementAmount = assert_uint256(balanceBefore) < rolloverSettlementAmount ? balanceBefore : rolloverSettlementAmount;



    bool payable = e.msg.value > 0;
    bool callerNotRolloverTargetAuctioneer = !hasRole(ROLLOVER_TARGET_AUCTIONEER_ROLE(), e.msg.sender);
    bool beforeMaturity = e.block.timestamp < maturityTimestamp();
    bool afterRepurchaseWindow = e.block.timestamp >= endOfRepurchaseWindow();
    bool servicerDoesNotHaveRolloverFulfillerRole = !rolloverExposureRolloverManager.hasRole(rolloverExposureRolloverManager.ROLLOVER_BID_FULFILLER_ROLE(), currentContract);

    bool isExpectedToRevert = payable ||   callerNotRolloverTargetAuctioneer || beforeMaturity || afterRepurchaseWindow || servicerDoesNotHaveRolloverFulfillerRole;

    closeExposureOnRolloverExisting@withrevert(e, borrower, rolloverSettlementAmount);
    
    assert lastReverted <=> isExpectedToRevert;
}