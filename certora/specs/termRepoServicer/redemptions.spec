using TermRepoLocker as lockerRedempt;
using TermRepoRolloverManager as rolloverManagerRedempt;
using TermRepoCollateralManagerHarness as collateralManagerRedempt;
using TermRepoToken as repoTokenRedempt;
using DummyERC20A as tokenRedempt;


methods {
    
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function isTermRepoBalanced() external returns (bool) envfree;

    function termRepoLocker() external returns(address) envfree;
    function termRepoToken() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;

    function TermRepoCollateralManagerHarness.encumberedCollateralRemaining() external returns (bool) envfree;
    function lockerRedempt.SERVICER_ROLE() external returns (bytes32) envfree;
    function lockerRedempt.hasRole(bytes32,address) external returns (bool) envfree;
    function lockerRedempt.transfersPaused() external returns (bool) envfree;
    function rolloverManagerRedempt.getRolloverInstructions(address) external returns (TermRepoRolloverManager.TermRepoRolloverElection) envfree;
    function repoTokenRedempt.balanceOf(address) external returns(uint256) envfree;
    function repoTokenRedempt.redemptionValue() external returns(uint256) envfree;
    function repoTokenRedempt.totalRedemptionValue() external returns(uint256) envfree;
    function TermRepoToken.BURNER_ROLE() external returns (bytes32) envfree;
    function TermRepoToken.burningPaused() external returns (bool) envfree;
    function TermRepoToken.mintExposureCap() external returns (uint256) envfree;
    function TermRepoToken.totalSupply() external returns (uint256) envfree;
    function TermRepoToken.hasRole(bytes32,address) external returns (bool) envfree;
    function tokenRedempt.allowance(address,address) external returns(uint256) envfree;
    function tokenRedempt.balanceOf(address) external returns(uint256) envfree;
    function tokenRedempt.totalSupply() external returns(uint256) envfree;
}

rule redemptionsMonotonicBehavior(env e) {
    address redeemer;
	uint256 amount;

    require(termRepoLocker() == lockerRedempt); //fixing connection 
    require(termRepoToken() == repoTokenRedempt); //fixing connection 
    require(purchaseToken() == tokenRedempt); //fixing connection

    uint256 redeemerRepoTokenBalanceBefore = repoTokenRedempt.balanceOf(redeemer);
    uint256 totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    uint256 redeemerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(redeemer);
    uint256 lockerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(lockerRedempt);


    redeemTermRepoTokens(e, redeemer, amount);

    uint256 redeemerRepoTokenBalanceAfter = repoTokenRedempt.balanceOf(redeemer);
    uint256 totalRepurchaseCollectedAfter = totalRepurchaseCollected();
    uint256 redeemerPurchaseTokenBalanceAfter = tokenRedempt.balanceOf(redeemer);
    uint256 lockerPurchaseTokenBalanceAfter = tokenRedempt.balanceOf(lockerRedempt);

    assert redeemerRepoTokenBalanceBefore >= redeemerRepoTokenBalanceAfter; // Redeemer repo token balance monotonically decrease after redemption.
    assert totalRepurchaseCollectedBefore >= totalRepurchaseCollectedAfter; // Total repurchase collected monotonically decreases after redemption.
    assert redeemerPurchaseTokenBalanceBefore <= redeemerPurchaseTokenBalanceAfter; // Redeemer purchase token balance monotonically increases after redemption.
    assert lockerPurchaseTokenBalanceBefore >= lockerPurchaseTokenBalanceAfter; // RepoLocker purchase token balance monotonically decreases after redemption.
}

rule redemptionsIntegrity(env e) {
    address redeemer;
	uint256 amount;

    uint256 expScale = 1000000000000000000;
    
    require(termRepoLocker() == lockerRedempt); //fixing connection 
    require(termRepoToken() == repoTokenRedempt); //fixing connection 
    require(purchaseToken() == tokenRedempt); //fixing connection
    require (shortfallHaircutMantissa() < expScale); // Mathematically the ceiling of this value

    require(repoTokenRedempt.redemptionValue() > 0);

    uint256 redeemerRepoTokenBalanceBefore = repoTokenRedempt.balanceOf(redeemer);
    mathint totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    mathint redeemerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(redeemer);
    mathint lockerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(lockerRedempt);
    mathint totalRedemptionValue = repoTokenRedempt.totalRedemptionValue();

    require(lockerPurchaseTokenBalanceBefore >= totalRepurchaseCollectedBefore); //Proved in totalRepurchaseCollectedLessThanOrEqualToLockerPurchaseTokenBalance in ./stateVariables.spec

    redeemTermRepoTokens(e, redeemer, amount);

    mathint expectedPurchaseTokens;
    if (totalRedemptionValue <= totalRepurchaseCollectedBefore + 10000){
        mathint nonShortfallHaircutPurchaseTokenValue = (amount * expScale * repoTokenRedempt.redemptionValue()) / (expScale * expScale);
        expectedPurchaseTokens = nonShortfallHaircutPurchaseTokenValue < totalRepurchaseCollectedBefore ? nonShortfallHaircutPurchaseTokenValue : totalRepurchaseCollectedBefore;

    } else {
        mathint nonShortfallHaircutPurchaseTokenValue = (amount * expScale * repoTokenRedempt.redemptionValue()) / (expScale * expScale);
        mathint shortfallHaircutPurchaseTokenValue = (shortfallHaircutMantissa() * nonShortfallHaircutPurchaseTokenValue ) / expScale;
        expectedPurchaseTokens = shortfallHaircutPurchaseTokenValue < totalRepurchaseCollectedBefore ? shortfallHaircutPurchaseTokenValue : totalRepurchaseCollectedBefore;
    }
    

    uint256 redeemerRepoTokenBalanceAfter = repoTokenRedempt.balanceOf(redeemer);
    mathint totalRepurchaseCollectedAfter = totalRepurchaseCollected();
    mathint redeemerPurchaseTokenBalanceAfter = tokenRedempt.balanceOf(redeemer);
    mathint lockerPurchaseTokenBalanceAfter = tokenRedempt.balanceOf(lockerRedempt);

   
    assert redeemerRepoTokenBalanceAfter == assert_uint256(redeemerRepoTokenBalanceBefore - amount);
    assert totalRepurchaseCollectedAfter  == totalRepurchaseCollectedBefore - expectedPurchaseTokens; 
    assert redeemer != termRepoLocker() => redeemerPurchaseTokenBalanceAfter ==  redeemerPurchaseTokenBalanceBefore + expectedPurchaseTokens;
    assert redeemer != termRepoLocker() => lockerPurchaseTokenBalanceAfter ==  lockerPurchaseTokenBalanceBefore - expectedPurchaseTokens;
}

rule redemptionsDoesNotAffectThirdParty(env e) {
    address redeemer1;
	uint256 amount;
    address redeemer2;

    require (redeemer1 != redeemer2);
    require(termRepoToken() == repoTokenRedempt); //fixing connection 
    require(purchaseToken() == tokenRedempt); //fixing connection

    uint256 thirdPartyBalanceBefore = repoTokenRedempt.balanceOf(redeemer2);
    uint256 purchaseTokenBalanceBefore = tokenRedempt.balanceOf(redeemer2);

    redeemTermRepoTokens(e, redeemer1, amount);

    uint256 thirdPartyBalanceAfter = repoTokenRedempt.balanceOf(redeemer2);
    uint256 purchaseTokenBalanceAfter = tokenRedempt.balanceOf(redeemer2);


    assert thirdPartyBalanceBefore == thirdPartyBalanceAfter; // Third party term token balance not affected by redemption;
    assert redeemer2 != termRepoLocker() => purchaseTokenBalanceBefore == purchaseTokenBalanceAfter; // Third party purchase token balance not affected by redemption;
}

rule redemptionsRevertConditions(env e) {
    address redeemer;
	uint256 amount;

    uint256 expScale = 10^18;

    mathint value = amount * expScale * repoTokenRedempt.redemptionValue();
    require(termRepoLocker() == lockerRedempt); //fixing connection 
    require(termRepoToken() == repoTokenRedempt); //fixing connection 
    require(purchaseToken() == tokenRedempt); //fixing connection
    require(redeemer != lockerRedempt);
    require(totalRepurchaseCollected() + 10 ^ 4 <= max_uint256); // Preventing overflow
    require(isTermRepoBalanced()); // Term pool must start out balanced;
    require(repoTokenRedempt.redemptionValue() != 0); // Will not have a zero redemptionValue for repo token
    require(repoTokenRedempt.totalSupply() >= repoTokenRedempt.balanceOf(redeemer)); // Common ERC20 invariant that total Supply is sum of balances.
    require(repoTokenRedempt.totalSupply() * expScale * repoTokenRedempt.redemptionValue() <= max_uint256); // Prevents overflow
    require(repoTokenRedempt.mintExposureCap() + amount <= max_uint256); // Prevents overflow;
    require((totalRepurchaseCollected() + totalOutstandingRepurchaseExposure()) * expScale <= max_uint256); // Prevents overflow
    require(value<= max_uint256); // Prevent overflow
    require (shortfallHaircutMantissa() < expScale); // shortfallHaircutMantissaAlwaysZeroBeforeRedemptionAndLessThanExpScaleAfter certora/specs/termRepoServicer/stateVariables.spec
    require(shortfallHaircutMantissa() * ((value) / (expScale * expScale)) <= max_uint256); // Prevents overflow
    require(totalOutstandingRepurchaseExposure() > 0 && totalRepurchaseCollected() > 0); // There will be no open term where both of these are 0.
    require(tokenRedempt.balanceOf(redeemer) + ((value) / (expScale * expScale)) <= max_uint256); // Prevents overflow

    uint256 redeemerRepoTokenBalanceBefore = repoTokenRedempt.balanceOf(redeemer);
    mathint totalRepurchaseCollectedBefore = totalRepurchaseCollected();
    mathint redeemerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(redeemer);
    mathint lockerPurchaseTokenBalanceBefore = tokenRedempt.balanceOf(lockerRedempt);
    mathint totalRedemptionValue = repoTokenRedempt.totalRedemptionValue();

    require(lockerPurchaseTokenBalanceBefore >= totalRepurchaseCollectedBefore); //Proved in totalRepurchaseCollectedLessThanOrEqualToLockerPurchaseTokenBalance in ./stateVariables.spec

    mathint expectedShortfallHaircutMantissa = shortfallHaircutMantissa() == 0 && totalRedemptionValue > totalRepurchaseCollected() + 10000 ? (totalRepurchaseCollected() * expScale * expScale) / ((totalRepurchaseCollected() + totalOutstandingRepurchaseExposure()) * expScale) : shortfallHaircutMantissa();

    mathint expectedPurchaseTokens;
    if (totalRedemptionValue <= totalRepurchaseCollected() + 10000){
        mathint nonShortfallHaircutPurchaseTokenValue = (value) / (expScale * expScale);
        expectedPurchaseTokens = nonShortfallHaircutPurchaseTokenValue < totalRepurchaseCollectedBefore? nonShortfallHaircutPurchaseTokenValue : totalRepurchaseCollectedBefore;

    } else {
        mathint nonShortfallHaircutPurchaseTokenValue = (value) / (expScale * expScale);
        mathint shortfallHaircutPurchaseTokenValue = (expectedShortfallHaircutMantissa * nonShortfallHaircutPurchaseTokenValue ) / expScale;
        expectedPurchaseTokens = shortfallHaircutPurchaseTokenValue < totalRepurchaseCollectedBefore ? shortfallHaircutPurchaseTokenValue : totalRepurchaseCollectedBefore;
    }

    mathint totalSupplyExpected = repoTokenRedempt.totalSupply() -  amount;
    mathint totalRedemptionValueExpected =  expectedShortfallHaircutMantissa == 0 ? (((totalSupplyExpected * expScale * repoTokenRedempt.redemptionValue()) / expScale ) / expScale) : (((((totalSupplyExpected * expScale * repoTokenRedempt.redemptionValue()) / expScale ) / expScale) * expectedShortfallHaircutMantissa) / expScale);
    mathint termRepoUnbalancedLeftSide = (expectedShortfallHaircutMantissa == 0) ? totalOutstandingRepurchaseExposure() - expectedPurchaseTokens + totalRepurchaseCollected() : totalRepurchaseCollected() - expectedPurchaseTokens ;

    bool payable = e.msg.value > 0;
    bool zeroAddress = redeemer == 0;
    bool beforeRedemption = e.block.timestamp <= redemptionTimestamp();
    bool zeroRepoTokens = repoTokenRedempt.balanceOf(redeemer) == 0;
    bool encumberedCollateralRemaining = collateralManagerRedempt.encumberedCollateralRemaining() && (repoTokenRedempt.totalRedemptionValue() > assert_uint256(totalRepurchaseCollected() + 10 ^ 4));
    bool servicerNotHaveRepoTokenBurnerRole = !repoTokenRedempt.hasRole(repoTokenRedempt.BURNER_ROLE(), currentContract);
    bool repoTokenBurningPaused = repoTokenRedempt.burningPaused();
    bool noServicerAccessToLocker = !lockerRedempt.hasRole(lockerRedempt.SERVICER_ROLE(), currentContract);
    bool lockerTransfersPaused = lockerRedempt.transfersPaused();
    bool notEnoughRepoTokens = repoTokenRedempt.balanceOf(redeemer) < amount; 
    bool termRepoUnbalanced = (termRepoUnbalancedLeftSide) / (10 ^ 4) != (totalRedemptionValueExpected / 10 ^ 4);

    bool isExpectedToRevert = payable || zeroAddress || beforeRedemption || zeroRepoTokens || encumberedCollateralRemaining || servicerNotHaveRepoTokenBurnerRole || repoTokenBurningPaused || lockerTransfersPaused || noServicerAccessToLocker ||  notEnoughRepoTokens || termRepoUnbalanced;

    redeemTermRepoTokens@withrevert(e, redeemer, amount);
        
    assert lastReverted <=> isExpectedToRevert;
}