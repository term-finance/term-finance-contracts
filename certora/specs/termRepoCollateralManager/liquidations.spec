using TermPriceConsumerV3 as oracleLiquidations;
using TermRepoLocker as lockerLiquidations;
using TermRepoServicer as servicerLiquidations;
using TermRepoToken as repoTokenLiquidations;
using TermController as controllerLiquidations;
using DummyERC20A as purchaseTokenLiquidations;
using DummyERC20B as collateralTokenLiquidations;

methods {
    function termPriceOracleAddress() external returns (address) envfree => CONSTANT;
    function termRepoServicerAddress() external returns (address) envfree => CONSTANT;
    function termControllerAddress() external returns (address) envfree => CONSTANT;
    function termRepoLocker() external returns (address) envfree => CONSTANT;
    function purchaseToken() external returns (address) envfree => CONSTANT;
    function collateralTokens(uint256 index) external returns (address) envfree;
    function netExposureCapOnLiquidation() external returns (uint256) envfree => CONSTANT;
    function getCollateralBalance(address,address) external returns (uint256) envfree;
    function encumberedCollateralBalance(address) external returns (uint256) envfree;
    function harnessLockedCollateralLedger(address, address) external returns (uint256) envfree;
    function isBorrowerInShortfall(address) external returns (bool) envfree;
    function deMinimisMarginThreshold() external returns (uint256) envfree;
    function liquidatedDamages(address) external returns (uint256) envfree;
    function liquidateDamangesDueToProtocol() external returns (uint256) envfree => CONSTANT;
    function initialCollateralRatios(address) external returns (uint256) envfree;
    function maintenanceCollateralRatios(address) external returns (uint256) envfree;
    function harnessCollateralTokensLength() external returns (uint256) envfree;
    function liquidationsPaused() external returns (bool) envfree;

    function allowFullLiquidation(address,uint256[]) external returns (bool);
    function harnessCollateralSeizureAmounts(uint256, address) external returns (uint256, uint256) envfree;
    function harnessWithinNetExposureCapOnLiquidation(address) external returns (bool) envfree;
    function willBeWithinNetExposureCapOnLiquidation(address,uint256,address,uint256) external returns (bool) envfree;


    function TermRepoServicer.purchaseToken() external returns (address) envfree => CONSTANT;
    function TermRepoServicer.getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function TermRepoServicer.isTermRepoBalanced() external returns (bool) envfree;
    function TermRepoServicer.shortfallHaircutMantissa() external returns (uint256) envfree;
    function TermRepoServicer.termRepoLocker() external returns (address) envfree;
    function TermRepoServicer.totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function TermRepoServicer.totalRepurchaseCollected() external returns (uint256) envfree;



    function TermRepoServicer.COLLATERAL_MANAGER() external returns (bytes32) envfree;
    function TermRepoServicer.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoServicer.termRepoToken() external returns (address) envfree => CONSTANT;
    function TermRepoServicer.endOfRepurchaseWindow() external returns (uint256) envfree;

    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;

    function DummyERC20A.allowance(address,address) external returns (uint256) envfree;
    function DummyERC20A.decimals() external returns (uint256) envfree => CONSTANT;
    function DummyERC20A.balanceOf(address) external returns (uint256) envfree;
    function DummyERC20B.decimals() external returns (uint256) envfree => ALWAYS(18);
    function DummyERC20B.balanceOf(address) external returns (uint256) envfree;
    function TermRepoToken.BURNER_ROLE() external returns (bytes32) envfree;
    function TermRepoToken.allowance(address,address) external returns (uint256) envfree;
    function TermRepoToken.decimals() external returns (uint8) envfree => CONSTANT;
    function TermRepoToken.balanceOf(address) external returns (uint256) envfree;
    function TermRepoToken.burningPaused() external returns (bool) envfree;
    function TermRepoToken.hasRole(bytes32,address) external returns (bool) envfree;

    function TermRepoToken.redemptionValue() external returns (uint256) envfree => CONSTANT;
    function TermRepoToken.mintExposureCap() external returns (uint256) envfree;
    function TermRepoToken.totalSupply() external returns (uint256) envfree;


    function TermController.getProtocolReserveAddress() external returns (address) envfree => ALWAYS(100);
}


// See: https://docs.term.finance/protocol/fees-and-penalties/liquidated-damages
function liquidatedCollateral(
    mathint liquidatedDamages,
    mathint liquidateDamangesDueToProtocol,
    mathint closureAmount,
    mathint collateralTokenDecimals
) returns (mathint, mathint) {
    if (collateralTokenDecimals > 18 || tokenPricesPerAmount[collateralTokenLiquidations][assert_uint256(10 ^ collateralTokenDecimals)] == 0) {
        return (0, 0);
    }

    uint256 d = require_uint256(tokenPricesPerAmount[collateralTokenLiquidations][assert_uint256(10 ^ collateralTokenDecimals)]);
    uint256 fairValueLiquidation = mulDivDownAbstract(require_uint256(tokenPricesPerAmount[purchaseTokenLiquidations][assert_uint256(closureAmount)]), 10 ^ 18, d);
    uint256 divisor = require_uint256(10 ^ (18 - collateralTokenDecimals));

    return (
        require_uint256(mulDivDownAbstract(fairValueLiquidation, require_uint256(10 ^ 18 + liquidatedDamages), 10 ^ 18) / divisor),
        require_uint256(mulDivDownAbstract(fairValueLiquidation, require_uint256(liquidateDamangesDueToProtocol),  10 ^ 18) / divisor)
    );
    // fairValueLiquidation * (10 ^ 18 + liquidatedDamages) / divisor,
    // fairValueLiquidation * liquidateDamangesDueToProtocol / divisor
}

function mulDivDownAbstract(uint256 x, uint256 y, uint256 z) returns uint256 {
    uint256 res;
    require z != 0;
    uint256 xy = require_uint256(x * y);
    uint256 fz = require_uint256(res * z);

    require xy >= fz;
    require fz + z > to_mathint(xy);
    return res; 
}

function positionInShortfall(
    mathint maintenanceCollateralRatio,
    mathint haircutUSDTotalCollateralValue
) returns bool {
    return haircutUSDTotalCollateralValue < (maintenanceCollateralRatio * haircutUSDTotalCollateralValue);
}

rule batchLiquidationSuccessfullyLiquidates(
    env e,
    address borrower,
    uint256 closureAmount
) {
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(repoTokenLiquidations.redemptionValue() > 0); // Redemption Value will always be greater than 0


    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());

    // Prevents Overflow
    require(closureAmount < 2 ^ 255);

    require(servicerLiquidations.getBorrowerRepurchaseObligation(borrower) > 0);
    require(liquidateDamangesDueToProtocol() < 10 ^ 18);
    require(liquidatedDamages(collateralTokenLiquidations) >= liquidateDamangesDueToProtocol());

    require(purchaseTokenLiquidations.decimals() <= 18);
    require(purchaseTokenLiquidations.decimals() > 0);
    require(collateralTokenLiquidations.decimals() == 18);
    require(collateralTokenLiquidations.decimals() > 0);
    require(tokenPrices[purchaseTokenLiquidations] > 0);
    require(tokenPrices[collateralTokenLiquidations] > 0);

    require(to_mathint(initialCollateralRatios(collateralTokenLiquidations)) > (100 * (10 ^ 18)));

    mathint liquidationIncentiveAmount;
    mathint protocolLiquidatedDamagesAmount;
    liquidationIncentiveAmount, protocolLiquidatedDamagesAmount = liquidatedCollateral(
        to_mathint(liquidatedDamages(collateralTokenLiquidations)),
        to_mathint(liquidateDamangesDueToProtocol()),
        to_mathint(closureAmount),
        to_mathint(collateralTokenLiquidations.decimals())
    );


    // Record borrower and msg.sender's balances before liquidation.
    mathint lockerCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint lockerPurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorPurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(e.msg.sender);
    mathint reservePurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());

    batchLiquidation(e, borrower, [closureAmount]);

    // Record borrower and msg.sender's balances after liquidation.
    mathint lockerCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint lockerPurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorPurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(e.msg.sender);
    mathint reservePurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());


    // Assert that the locker's balances have changed by the correct amount.
    assert(lockerCollateralTokenBalanceBefore - lockerCollateralTokenBalanceAfter == liquidationIncentiveAmount);
    assert(lockerPurchaseTokenBalanceAfter - lockerPurchaseTokenBalanceBefore == to_mathint(closureAmount));

    // Assert that the liquidator's balances have changed by the correct amount.
    assert(liquidatorCollateralTokenBalanceAfter - liquidatorCollateralTokenBalanceBefore == liquidationIncentiveAmount - protocolLiquidatedDamagesAmount);
    assert(liquidatorPurchaseTokenBalanceBefore - liquidatorPurchaseTokenBalanceAfter == to_mathint(closureAmount));

    // Assert that the reserve's balances have changed by the correct amount.
    assert(reserveCollateralTokenBalanceAfter - reserveCollateralTokenBalanceBefore == protocolLiquidatedDamagesAmount);
}

rule batchLiquidateWithRepoTokenSuccessfullyLiquidates(
    env e,
    address borrower,
    uint256 closureRepoTokenAmount,
    uint256 fairValueLiquidationPrinter
) {
    require(termPriceOracleAddress() == oracleLiquidations);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    mathint redemptionVal = repoTokenLiquidations.redemptionValue();
    require(redemptionVal > 0); // Redemption Value will always be greater than 0
    // require(servicerLiquidations.purchaseToken() == purchaseToken());

    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());

    require(servicerLiquidations.getBorrowerRepurchaseObligation(borrower) > 0);
    require(liquidateDamangesDueToProtocol() < 10 ^ 18);

    require(liquidatedDamages(collateralTokenLiquidations) >= liquidateDamangesDueToProtocol());

    require(purchaseTokenLiquidations.decimals() <= 18);
    require(purchaseTokenLiquidations.decimals() > 0);
    require(collateralTokenLiquidations.decimals() == 18);
    require(collateralTokenLiquidations.decimals() > 0);
    require(tokenPrices[purchaseTokenLiquidations] > 0);
    require(tokenPrices[collateralTokenLiquidations] > 0);

    require(to_mathint(initialCollateralRatios(collateralTokenLiquidations)) > (100 * (10 ^ 18)));

    uint256 closureAmount = require_uint256(closureRepoTokenAmount * 10 ^ 18 * redemptionVal / (10 ^ 36));

    mathint collateralTokenDecimals = collateralTokenLiquidations.decimals();

    uint256 d = require_uint256(tokenPricesPerAmount[collateralTokenLiquidations][assert_uint256(10 ^ collateralTokenDecimals)]);
    uint256 fairValueLiquidation = mulDivDownAbstract(require_uint256(tokenPricesPerAmount[purchaseTokenLiquidations][closureAmount]), 10 ^ 18, d);
    uint256 divisor = require_uint256(10 ^ (18 - collateralTokenDecimals));
    require(fairValueLiquidationPrinter == fairValueLiquidation);
    mathint liquidationIncentiveAmount;
    mathint protocolLiquidatedDamagesAmount ;

    
    liquidationIncentiveAmount, protocolLiquidatedDamagesAmount = liquidatedCollateral(
        to_mathint(liquidatedDamages(collateralTokenLiquidations)),
        to_mathint(liquidateDamangesDueToProtocol()),
        to_mathint(closureAmount),
        to_mathint(collateralTokenLiquidations.decimals())
    );


    // Record borrower and msg.sender's balances before liquidation.
    mathint lockerCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint liquidatorRepoTokenBalanceBefore = repoTokenLiquidations.balanceOf(e.msg.sender);

    batchLiquidationWithRepoToken(e, borrower, [closureRepoTokenAmount]);

    // Record borrower and msg.sender's balances after liquidation.
    mathint lockerCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint liquidatorRepoTokenBalanceAfter = repoTokenLiquidations.balanceOf(e.msg.sender);


    // Assert that the locker's balances have changed by the correct amount.
    assert(lockerCollateralTokenBalanceBefore - lockerCollateralTokenBalanceAfter == liquidationIncentiveAmount);

    // Assert that the liquidator's balances have changed by the correct amount.
    assert(liquidatorCollateralTokenBalanceAfter - liquidatorCollateralTokenBalanceBefore == liquidationIncentiveAmount - protocolLiquidatedDamagesAmount);
    assert(liquidatorRepoTokenBalanceBefore - liquidatorRepoTokenBalanceAfter == to_mathint(closureRepoTokenAmount));

    // Assert that the reserve's balances have changed by the correct amount.
    assert(reserveCollateralTokenBalanceAfter - reserveCollateralTokenBalanceBefore == protocolLiquidatedDamagesAmount);
}

rule batchDefaultSuccessfullyDefaults(
    env e,
    address borrower,
    uint256 closureAmount
) {
    require(termPriceOracleAddress() == oracleLiquidations);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(repoTokenLiquidations.redemptionValue() > 0); 

    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());
    require(e.block.timestamp > servicerLiquidations.endOfRepurchaseWindow());

    require(closureAmount < 2 ^ 255); // Prevents Overflows

    require(servicerLiquidations.getBorrowerRepurchaseObligation(borrower) > 0);
    require(liquidateDamangesDueToProtocol() < 10 ^ 18);
    require(liquidatedDamages(collateralTokenLiquidations) >= liquidateDamangesDueToProtocol());

    require(purchaseTokenLiquidations.decimals() <= 18);
    require(purchaseTokenLiquidations.decimals() > 0);
    require(collateralTokenLiquidations.decimals() == 18);
    require(collateralTokenLiquidations.decimals() > 0);
    require(tokenPrices[purchaseTokenLiquidations] > 0);
    require(tokenPrices[collateralTokenLiquidations] > 0);

    require(to_mathint(initialCollateralRatios(collateralTokenLiquidations)) > (100 * (10 ^ 18)));

    mathint liquidationIncentiveAmount;
    mathint protocolLiquidatedDamagesAmount;
    liquidationIncentiveAmount, protocolLiquidatedDamagesAmount = liquidatedCollateral(
        to_mathint(liquidatedDamages(collateralTokenLiquidations)),
        to_mathint(liquidateDamangesDueToProtocol()),
        to_mathint(closureAmount),
        to_mathint(collateralTokenLiquidations.decimals())
    );


    // Record borrower and msg.sender's balances before liquidation.
    mathint lockerCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceBefore = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint lockerPurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorPurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(e.msg.sender);
    mathint reservePurchaseTokenBalanceBefore = purchaseTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());

    batchDefault(e, borrower, [closureAmount]);

    // Record borrower and msg.sender's balances after liquidation.
    mathint lockerCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(e.msg.sender);
    mathint reserveCollateralTokenBalanceAfter = collateralTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());
    mathint lockerPurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(termRepoLocker());
    mathint liquidatorPurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(e.msg.sender);
    mathint reservePurchaseTokenBalanceAfter = purchaseTokenLiquidations.balanceOf(controllerLiquidations.getProtocolReserveAddress());


    // Assert that the locker's balances have changed by the correct amount.
    assert(lockerCollateralTokenBalanceBefore - lockerCollateralTokenBalanceAfter == liquidationIncentiveAmount);
    assert(lockerPurchaseTokenBalanceAfter - lockerPurchaseTokenBalanceBefore == to_mathint(closureAmount));

    // Assert that the liquidator's balances have changed by the correct amount.
    assert(liquidatorCollateralTokenBalanceAfter - liquidatorCollateralTokenBalanceBefore == liquidationIncentiveAmount - protocolLiquidatedDamagesAmount);
    assert(liquidatorPurchaseTokenBalanceBefore - liquidatorPurchaseTokenBalanceAfter == to_mathint(closureAmount));

    // Assert that the reserve's balances have changed by the correct amount.
    assert(reserveCollateralTokenBalanceAfter - reserveCollateralTokenBalanceBefore == protocolLiquidatedDamagesAmount);
    // assert(reservePurchaseTokenBalanceAfter == reservePurchaseTokenBalanceBefore);
}

rule batchLiquidationDoesNotAffectThirdParty(
    env e,
    address borrower,
    uint256 closureAmount
) {
    address borrower2;

    require (borrower != borrower2);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(repoTokenLiquidations.redemptionValue() > 0); // Redemption Value will always be greater than 0


    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());
    require(borrower != 100);
    require(borrower2 != 100);
    require(e.msg.sender != borrower2);
    require (borrower2 != termRepoLocker());
    
    uint256 otherBorrowerRepurchaseObligationBefore = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceBefore = getCollateralBalance(borrower2, collateralTokenLiquidations);

    batchLiquidation(e, borrower, [closureAmount]);

    uint256 otherBorrowerRepurchaseObligationAfter = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceAfter = getCollateralBalance(borrower2, collateralTokenLiquidations);

    assert(otherBorrowerRepurchaseObligationBefore == otherBorrowerRepurchaseObligationAfter);
    assert(otherBorrowerCollateralBalanceBefore == otherBorrowerCollateralBalanceAfter);
}

rule batchLiquidationWithRepoTokenDoesNotAffectThirdParty(
    env e,
    address borrower,
    uint256 closureAmount
) {
    address borrower2;

    require (borrower != borrower2);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(repoTokenLiquidations.redemptionValue() > 0); // Redemption Value will always be greater than 0


    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());
    require(borrower != 100);
    require(borrower2 != 100);
    require(e.msg.sender != borrower2);
    require (borrower2 != termRepoLocker());
    
    uint256 otherBorrowerRepurchaseObligationBefore = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceBefore = getCollateralBalance(borrower2, collateralTokenLiquidations);

    batchLiquidationWithRepoToken(e, borrower, [closureAmount]);

    uint256 otherBorrowerRepurchaseObligationAfter = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceAfter = getCollateralBalance(borrower2, collateralTokenLiquidations);

    assert(otherBorrowerRepurchaseObligationBefore == otherBorrowerRepurchaseObligationAfter);
    assert(otherBorrowerCollateralBalanceBefore == otherBorrowerCollateralBalanceAfter);
}

rule batchDefaultDoesNotAffectThirdParty(
    env e,
    address borrower,
    uint256 closureAmount
) {
    address borrower2;

    require (borrower != borrower2);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(repoTokenLiquidations.redemptionValue() > 0); // Redemption Value will always be greater than 0


    require(controllerLiquidations.getProtocolReserveAddress() == 100);
    require(controllerLiquidations.getProtocolReserveAddress() != e.msg.sender);
    require(e.msg.sender != 100);
    require(termRepoLocker() != 100);
    require(controllerLiquidations.getProtocolReserveAddress() != borrower);
    require(termRepoLocker() != e.msg.sender);
    require(controllerLiquidations.getProtocolReserveAddress() != termRepoLocker());
    require(borrower != 100);
    require(borrower2 != 100);
    require(e.msg.sender != borrower2);
    require (borrower2 != termRepoLocker());
    
    uint256 otherBorrowerRepurchaseObligationBefore = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceBefore = getCollateralBalance(borrower2, collateralTokenLiquidations);

    batchDefault(e, borrower, [closureAmount]);

    uint256 otherBorrowerRepurchaseObligationAfter = servicerLiquidations.getBorrowerRepurchaseObligation(borrower2);
    uint256 otherBorrowerCollateralBalanceAfter = getCollateralBalance(borrower2, collateralTokenLiquidations);

    assert(otherBorrowerRepurchaseObligationBefore == otherBorrowerRepurchaseObligationAfter);
    assert(otherBorrowerCollateralBalanceBefore == otherBorrowerCollateralBalanceAfter);
}


rule batchLiquidationRevertsIfInvalid(
    env e,
    address borrower,
    uint256[] closureAmounts
) {
    uint256 expScale = 10 ^ 18;
    require(termPriceOracleAddress() == oracleLiquidations);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoLocker() == lockerLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(liquidateDamangesDueToProtocol() < expScale); //Protocol share will always be less than 1.
    require(servicerLiquidations.totalOutstandingRepurchaseExposure() >= servicerLiquidations.getBorrowerRepurchaseObligation(borrower)); //Proved in totalOutstandingRepurchaseExposureIsSumOfRepurchases of   termRepoServicer/stateVariables.spec 
    require(closureAmounts.length == 1);
    require(servicerLiquidations.shortfallHaircutMantissa() == 0); // Value must be 0 when liquidations are still available
    require(servicerLiquidations.totalRepurchaseCollected() + closureAmounts[0] <= max_uint256); // Prevents overflow
    require(repoTokenLiquidations.totalSupply() * expScale * repoTokenLiquidations.redemptionValue() <= max_uint256); // Prevents overflow
    require(servicerLiquidations.isTermRepoBalanced()); // Pre-tx state must be term repo balanced
    require(purchaseTokenLiquidations.balanceOf(lockerLiquidations) + closureAmounts[0] <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(lockerLiquidations) >= getCollateralBalance(borrower, collateralTokenLiquidations)); //Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance of stateVariables.spec
    require(getCollateralBalance(borrower, collateralTokenLiquidations) <= encumberedCollateralBalance(collateralTokenLiquidations)); // True if liquidatable encumbered collateral remaining
    mathint borrowerUSDValue = tokenPricesPerAmount[purchaseTokenLiquidations][servicerLiquidations.getBorrowerRepurchaseObligation(borrower)];
    require(borrowerUSDValue + deMinimisMarginThreshold() <= max_uint256);
    uint256 collateralSeizure;
    uint256 protocolShare;
    collateralSeizure, protocolShare = harnessCollateralSeizureAmounts(closureAmounts[0], collateralTokenLiquidations);
    require(collateralSeizure <= max_uint256);
    require(protocolShare <= max_uint256);

    require(collateralTokenLiquidations.balanceOf(e.msg.sender) + collateralSeizure <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(100) + collateralSeizure <= max_uint256); // Prevents overflow

    bool liquidationsClosed = e.block.timestamp > servicerLiquidations.endOfRepurchaseWindow();
    bool selfLiquidation = borrower == e.msg.sender;
    bool invalidParameters = harnessCollateralTokensLength() != closureAmounts.length;
    bool zeroBorrowerRepurchaseObligation = servicerLiquidations.getBorrowerRepurchaseObligation(borrower) == 0;
    bool borrowerNotInShortfall = !isBorrowerInShortfall(borrower);
    bool exceedsNetExposureCapOnLiquidation = !willBeWithinNetExposureCapOnLiquidation(borrower,  closureAmounts[0], collateralTokenLiquidations, collateralSeizure) && !allowFullLiquidation(e, borrower, closureAmounts);
    bool servicerNoLockerAccess = !lockerLiquidations.hasRole(lockerLiquidations.SERVICER_ROLE(), servicerLiquidations);
    bool noLockerAccess = !lockerLiquidations.hasRole(lockerLiquidations.SERVICER_ROLE(), currentContract);
    bool lockerTransfersPaused = lockerLiquidations.transfersPaused();
    bool totalClosureIsZero = closureAmounts[0] == 0;
    bool closureAmountIsUIntMax = closureAmounts[0] == max_uint256;
    bool closureAmountMoreThanBorrowObligation = closureAmounts[0] > servicerLiquidations.getBorrowerRepurchaseObligation(borrower);
    bool noAccessToServicer = !servicerLiquidations.hasRole(servicerLiquidations.COLLATERAL_MANAGER(), currentContract);
    bool liquidatorDoesNotHaveEnoughFunds = purchaseTokenLiquidations.balanceOf(e.msg.sender) < closureAmounts[0];
    bool liquidatorAllowanceFoLockerTooLow = purchaseTokenLiquidations.allowance(e.msg.sender, lockerLiquidations) < closureAmounts[0];
    bool notEnoughCollateralToLiquidate = collateralSeizure > getCollateralBalance(borrower,collateralTokenLiquidations);
    bool msgHasValue = e.msg.value != 0;

    batchLiquidation@withrevert(e, borrower, closureAmounts);
    assert lastReverted == (
        liquidationsClosed ||
        selfLiquidation ||
        invalidParameters ||
        zeroBorrowerRepurchaseObligation ||
        borrowerNotInShortfall ||
        exceedsNetExposureCapOnLiquidation ||
        servicerNoLockerAccess ||
        noLockerAccess ||
        lockerTransfersPaused ||
        totalClosureIsZero ||
        closureAmountIsUIntMax ||
        closureAmountMoreThanBorrowObligation ||
        noAccessToServicer ||
        liquidatorDoesNotHaveEnoughFunds ||
        liquidatorAllowanceFoLockerTooLow ||
        notEnoughCollateralToLiquidate ||
        liquidationsPaused() ||
        msgHasValue
    ), "Expected revert";
}

rule batchLiquidationWithRepoTokenRevertsIfInvalid(
    env e,
    address borrower,
    uint256[] closureAmounts
) {
    uint256 expScale = 10 ^ 18;
    mathint redemptionVal = repoTokenLiquidations.redemptionValue();
    mathint value = closureAmounts[0] * expScale * redemptionVal;
    mathint scaledSupply = repoTokenLiquidations.totalSupply() * expScale;

    require(termPriceOracleAddress() == oracleLiquidations);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(servicerLiquidations.termRepoLocker() == lockerLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(liquidateDamangesDueToProtocol() < expScale); //Protocol share will always be less than 1.
    require(repoTokenLiquidations.mintExposureCap() + closureAmounts[0] <= max_uint256); // prevent mint exposure cap from overflowing
    require(servicerLiquidations.totalOutstandingRepurchaseExposure() >= servicerLiquidations.getBorrowerRepurchaseObligation(borrower)); //Proved in totalOutstandingRepurchaseExposureIsSumOfRepurchases of   termRepoServicer/stateVariables.spec 
    require(closureAmounts.length == 1);
    require(servicerLiquidations.shortfallHaircutMantissa() == 0); // Value must be 0 when liquidations are still available
    require(value < max_uint256); // prevent overflow
    uint256 closureAmountInPurchaseToken = assert_uint256((value) / (10 ^ 36));
    require (redemptionVal > 0);
    require(servicerLiquidations.totalRepurchaseCollected() + closureAmountInPurchaseToken <= max_uint256); // Prevents overflow
    require(scaledSupply  <= max_uint256); // Prevents overflow
    require(scaledSupply * redemptionVal <= max_uint256); // Prevents overflow
    require(servicerLiquidations.isTermRepoBalanced()); // Pre-tx state must be term repo balanced
    require(purchaseTokenLiquidations.balanceOf(lockerLiquidations) + closureAmountInPurchaseToken <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(lockerLiquidations) >= getCollateralBalance(borrower, collateralTokenLiquidations)); //Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance of stateVariables.spec
    require(getCollateralBalance(borrower, collateralTokenLiquidations) <= encumberedCollateralBalance(collateralTokenLiquidations)); // True if liquidatable encumbered collateral remaining
    mathint borrowerUSDValue = tokenPricesPerAmount[purchaseTokenLiquidations][servicerLiquidations.getBorrowerRepurchaseObligation(borrower)];
    require(borrowerUSDValue + deMinimisMarginThreshold() <= max_uint256);

    require(repoTokenLiquidations.totalSupply() * 10 ^ 18 * redemptionVal <= max_uint256 ); // prevents overflow
    uint256 collateralSeizure;
    uint256 protocolShare;
    collateralSeizure, protocolShare = harnessCollateralSeizureAmounts(closureAmountInPurchaseToken, collateralTokenLiquidations);
    require(collateralSeizure <= max_uint256);
    require(protocolShare <= max_uint256);

    require(collateralTokenLiquidations.balanceOf(e.msg.sender) + collateralSeizure <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(100) + collateralSeizure <= max_uint256); // Prevents overflow


    bool liquidationsClosed = e.block.timestamp > servicerLiquidations.endOfRepurchaseWindow();
    bool selfLiquidation = borrower == e.msg.sender;
    bool invalidParameters = harnessCollateralTokensLength() != closureAmounts.length;
    bool zeroBorrowerRepurchaseObligation = servicerLiquidations.getBorrowerRepurchaseObligation(borrower) == 0;
    bool borrowerNotInShortfall = !isBorrowerInShortfall(borrower);
    bool exceedsNetExposureCapOnLiquidation = !willBeWithinNetExposureCapOnLiquidation(borrower,  closureAmountInPurchaseToken, collateralTokenLiquidations, collateralSeizure) && !allowFullLiquidation(e, borrower, closureAmounts);
    bool noLockerAccess = !lockerLiquidations.hasRole(lockerLiquidations.SERVICER_ROLE(), currentContract);
    bool burningPaused = repoTokenLiquidations.burningPaused();
    bool noServicerAccessToTokenBurns = !repoTokenLiquidations.hasRole(repoTokenLiquidations.BURNER_ROLE(), servicerLiquidations);
    bool lockerTransfersPaused = lockerLiquidations.transfersPaused();
    bool totalClosureIsZero = closureAmounts[0] == 0;
    bool closureAmountIsUIntMax = closureAmounts[0] == max_uint256;
    bool closureAmountMoreThanBorrowObligation = closureAmountInPurchaseToken > servicerLiquidations.getBorrowerRepurchaseObligation(borrower);
    bool noAccessToServicer = !servicerLiquidations.hasRole(servicerLiquidations.COLLATERAL_MANAGER(), currentContract);
    bool liquidatorDoesNotHaveEnoughFunds = repoTokenLiquidations.balanceOf(e.msg.sender) < closureAmounts[0];
    bool notEnoughCollateralToLiquidate = collateralSeizure > getCollateralBalance(borrower,collateralTokenLiquidations);
    bool servicerIsNotTermRepoBalanced = (servicerLiquidations.totalOutstandingRepurchaseExposure() - closureAmountInPurchaseToken + servicerLiquidations.totalRepurchaseCollected() ) / (10 ^ 4) != (((((repoTokenLiquidations.totalSupply() -  closureAmounts[0]) * expScale * redemptionVal) / expScale ) / expScale) / 10 ^ 4);
    bool msgHasValue = e.msg.value != 0;
    bool liquidatorIsZero = e.msg.sender == 0;


    batchLiquidationWithRepoToken@withrevert(e, borrower, closureAmounts);
    assert lastReverted == (
        liquidationsClosed ||
        selfLiquidation ||
        invalidParameters ||
        zeroBorrowerRepurchaseObligation ||
        borrowerNotInShortfall ||
        exceedsNetExposureCapOnLiquidation ||
        noLockerAccess ||
        burningPaused ||
        noServicerAccessToTokenBurns ||
        lockerTransfersPaused ||
        totalClosureIsZero ||
        closureAmountIsUIntMax ||
        closureAmountMoreThanBorrowObligation ||
        noAccessToServicer ||
        liquidatorDoesNotHaveEnoughFunds ||
        notEnoughCollateralToLiquidate ||
        liquidationsPaused() ||
        servicerIsNotTermRepoBalanced ||
        msgHasValue || liquidatorIsZero
    ), "Expected revert";
}

rule batchDefaultRevertsIfInvalid(
    env e,
    address borrower,
    uint256[] closureAmounts
) {
    uint256 expScale = 10 ^ 18;
    require(e.msg.sender != lockerLiquidations); // locker contract does not call liquidations
    require(termPriceOracleAddress() == oracleLiquidations);
    require(termRepoServicerAddress() == servicerLiquidations);
    require(servicerLiquidations.termRepoLocker() == lockerLiquidations);
    require(servicerLiquidations.termRepoToken() == repoTokenLiquidations);
    require(termControllerAddress() == controllerLiquidations);
    require(collateralTokens(0) == collateralTokenLiquidations);
    require(purchaseToken() == purchaseTokenLiquidations);
    require(servicerLiquidations.purchaseToken() == purchaseTokenLiquidations);
    require(liquidateDamangesDueToProtocol() < expScale); //Protocol share will always be less than 1.
    require(servicerLiquidations.totalOutstandingRepurchaseExposure() >= servicerLiquidations.getBorrowerRepurchaseObligation(borrower)); //Proved in totalOutstandingRepurchaseExposureIsSumOfRepurchases of   termRepoServicer/stateVariables.spec 
    require(closureAmounts.length == 1);
    require(servicerLiquidations.shortfallHaircutMantissa() == 0); // Value must be 0 when defaults are still available
    require(servicerLiquidations.totalRepurchaseCollected() + closureAmounts[0] <= max_uint256); // Prevents overflow
    require(repoTokenLiquidations.totalSupply() * expScale * repoTokenLiquidations.redemptionValue() <= max_uint256); // Prevents overflow
    require(servicerLiquidations.isTermRepoBalanced()); // Pre-tx state must be term repo balanced
    require(purchaseTokenLiquidations.balanceOf(lockerLiquidations) + closureAmounts[0] <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(lockerLiquidations) >= getCollateralBalance(borrower, collateralTokenLiquidations)); //Proved in lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance of stateVariables.spec
    require(getCollateralBalance(borrower, collateralTokenLiquidations) <= encumberedCollateralBalance(collateralTokenLiquidations)); // True if liquidatable encumbered collateral remaining

    uint256 collateralSeizure;
    uint256 protocolShare;
    collateralSeizure, protocolShare = harnessCollateralSeizureAmounts(closureAmounts[0], collateralTokenLiquidations);
    require(collateralSeizure <= max_uint256);
    require(protocolShare <= max_uint256);

    require(collateralTokenLiquidations.balanceOf(e.msg.sender) + collateralSeizure <= max_uint256); // Prevents overflow
    require(collateralTokenLiquidations.balanceOf(100) + collateralSeizure <= max_uint256); // Prevents overflow



    bool defaultsClosed = e.block.timestamp <= servicerLiquidations.endOfRepurchaseWindow();
    bool selfLiquidation = borrower == e.msg.sender;
    bool invalidParameters = harnessCollateralTokensLength() != closureAmounts.length;
    bool zeroBorrowerRepurchaseObligation = servicerLiquidations.getBorrowerRepurchaseObligation(borrower) == 0;
    bool servicerNoLockerAccess = !lockerLiquidations.hasRole(lockerLiquidations.SERVICER_ROLE(), servicerLiquidations);
    bool noLockerAccess = !lockerLiquidations.hasRole(lockerLiquidations.SERVICER_ROLE(), currentContract);
    bool lockerTransfersPaused = lockerLiquidations.transfersPaused();
    bool totalClosureIsZero = closureAmounts[0] == 0;
    bool closureAmountIsUIntMax = closureAmounts[0] == max_uint256;
    bool closureAmountMoreThanBorrowObligation = closureAmounts[0] > servicerLiquidations.getBorrowerRepurchaseObligation(borrower);
    bool noAccessToServicer = !servicerLiquidations.hasRole(servicerLiquidations.COLLATERAL_MANAGER(), currentContract);
    bool liquidatorDoesNotHaveEnoughFunds = purchaseTokenLiquidations.balanceOf(e.msg.sender) < closureAmounts[0];
    bool liquidatorAllowanceFoLockerTooLow = purchaseTokenLiquidations.allowance(e.msg.sender, lockerLiquidations) < closureAmounts[0];
    bool notEnoughCollateralToLiquidate = collateralSeizure > getCollateralBalance(borrower,collateralTokenLiquidations);

    bool msgHasValue = e.msg.value != 0;

    batchDefault@withrevert(e, borrower, closureAmounts);
    assert lastReverted == (
        defaultsClosed ||
        selfLiquidation ||
        invalidParameters ||
        zeroBorrowerRepurchaseObligation ||
        liquidationsPaused() ||
        servicerNoLockerAccess ||
        noLockerAccess ||
        lockerTransfersPaused || 
        totalClosureIsZero ||
        closureAmountIsUIntMax ||
        closureAmountMoreThanBorrowObligation ||
        noAccessToServicer ||
        liquidatorDoesNotHaveEnoughFunds ||
        liquidatorAllowanceFoLockerTooLow ||
        notEnoughCollateralToLiquidate || 
        msgHasValue
    ), "Expected revert";
}

rule pauseLiquidationsIntegrity(
    env e
) {
    require(liquidationsPaused() == false);
    pauseLiquidations(e);
    assert(liquidationsPaused() == true, "Expected liquidations to be paused");
}

rule unpauseLiquidationsIntegrity(
    env e
) {
    require(liquidationsPaused() == true);
    unpauseLiquidations(e);
    assert(liquidationsPaused() == false, "Expected liquidations to be unpaused");
}
