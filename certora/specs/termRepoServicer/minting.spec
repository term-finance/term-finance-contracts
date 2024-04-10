using TermController as mintingController;
using TermRepoCollateralManagerHarness as mintingCollateralManager;
using TermRepoLocker as mintingLocker;
using TermRepoRolloverManager as mintingRolloverManager;
using TermRepoToken as mintingRepoToken;
using DummyERC20A as mintingToken;

methods {
    function SPECIALIST_ROLE() external returns (bytes32) envfree;
    function collateralBalance(address,uint256) external returns (uint256) envfree;
    function endOfRepurchaseWindow() external returns (uint256) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function hasRole(bytes32,address) external returns (bool) envfree;
    function isTokenCollateral(address) external returns (bool) envfree;
    function termControllerAddress() external returns (address) envfree;
    function termRepoCollateralManager() external returns(address) envfree;
    function termRepoLocker() external returns(address) envfree;
    function termRepoToken() external returns(address) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function totalRepurchaseCollected() external returns (uint256) envfree;
    function purchaseToken() external returns (address) envfree;
    function shortfallHaircutMantissa() external returns (uint256) envfree;

    // function TermController.getTreasuryAddress() external returns (address) => ALWAYS(100);
    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoCollateralManagerHarness.collateralTokens(uint256) external returns (address) envfree;
    function TermRepoCollateralManagerHarness.collateralTokensLength() external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.getCollateralBalance(address,address) external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoCollateralManagerHarness.isInCollateralTokenArray(address) external returns (bool) envfree;
    function TermRepoCollateralManagerHarness.numOfAcceptedCollateralTokens() external returns (uint8) envfree;


    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermRepoRolloverManager.getRolloverInstructions(address) external returns (TermRepoRolloverManager.TermRepoRolloverElection) envfree;
    function TermRepoToken.mintingPaused() external returns (bool) envfree;
    function TermRepoToken.totalSupply() external returns (uint256) envfree;
    function TermRepoToken.hasRole(bytes32, address) external returns (bool) envfree;
    function TermRepoToken.MINTER_ROLE() external returns (bytes32) envfree;
    function TermRepoToken.balanceOf(address) external returns(uint256) envfree;
    function TermRepoToken.mintExposureCap() external returns(uint256) envfree;
    function TermRepoToken.redemptionValue() external returns(uint256) envfree;
    function TermRepoToken.totalRedemptionValue() external returns(uint256) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns(uint256) envfree;
    function DummyERC20A.totalSupply() external returns(uint256) envfree;
}


rule mintOpenExposureMonotonicBehavior(env e) {
    uint256 amount;
	uint256[] collateralAmounts;
    address collateralTokenAddress;

    require(termRepoToken() == mintingRepoToken); //fixing connection 
    require(termRepoCollateralManager() == mintingCollateralManager); //fixing connection
    require(!isTokenCollateral(termRepoToken()));


    uint256 minterRepoTokenBalanceBefore = mintingRepoToken.balanceOf(e.msg.sender);
    uint256 minterRepoExposureBefore = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    uint256 collateralBalanceBefore = mintingCollateralManager.getCollateralBalance(e.msg.sender, collateralTokenAddress);

    require(minterRepoTokenBalanceBefore + amount <= max_uint256); // Repo Token balances do not overflow. Proved with invariant totalSupplyIsSumOfBalances and rule onlyAllowedMethodsMayChangeBalance from termRepoToken.erc20Full.
    
    mintOpenExposure(e, amount, collateralAmounts);

    uint256 minterRepoTokenBalanceAfter = mintingRepoToken.balanceOf(e.msg.sender);
    uint256 minterRepoExposureAfter = getBorrowerRepurchaseObligation(e.msg.sender);
    uint256 totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    uint256 collateralBalanceAfter = mintingCollateralManager.getCollateralBalance(e.msg.sender, collateralTokenAddress);


    assert minterRepoTokenBalanceBefore <= minterRepoTokenBalanceAfter; // Minter repo token balance monotonically increases after minting.
    assert minterRepoExposureBefore <= minterRepoExposureAfter; // Minter repo token balance monotonically increases repurchase obligation.
    assert totalOutstandingRepurchaseExposureBefore <= totalOutstandingRepurchaseExposureAfter; // Total outstanding repurchase exposure  monotonically increases after minting.
    assert collateralBalanceAfter >= collateralBalanceBefore; // Minter collateral balances should incerase after minting.
}

rule mintOpenExposureIntegrity(
    env e,
    uint256 amount,
	uint256[] collateralAmounts
) {
    require(collateralAmounts.length >= 1); // must be at least one collateral type

    uint256 expScale = 1000000000000000000;

    // Bind term contracts to servicer fields.
    require(termRepoToken() == mintingRepoToken);
    require(termControllerAddress() == mintingController);
    require(termRepoCollateralManager() == mintingCollateralManager);
    require(mintingController.getTreasuryAddress() != e.msg.sender );
    require(servicingFee() == 3000000000000000);


    // Require collateral tokens to not be overlapping
    require(mintingCollateralManager.collateralTokens(0) != mintingCollateralManager.collateralTokens(1));

    require(!isTokenCollateral(mintingRepoToken));
    require(mintingRepoToken.redemptionValue() > 0);
    require(e.msg.sender != 100); // treasury address will not participate in minting allowlist.

    mathint minterRepoTokenBalanceBefore = mintingRepoToken.balanceOf(e.msg.sender);
    mathint protocolRepoTokenBalanceBefore = mintingRepoToken.balanceOf(100); // TREASURY address fixed to 100 in methods
    mathint minterRepoExposureBefore = getBorrowerRepurchaseObligation(e.msg.sender);
    mathint totalOutstandingRepurchaseExposureBefore = totalOutstandingRepurchaseExposure();
    mathint collateralToken0BalanceBefore = collateralBalance(e.msg.sender, 0);
    mathint collateralToken1BalanceBefore = collateralBalance(e.msg.sender, 1);

    mathint protocolShareDayCountFraction = ((maturityTimestamp() - e.block.timestamp) * expScale) / (31104000); // 1 year in seconds
    mathint protocolShareFee = (protocolShareDayCountFraction * 3000000000000000) / expScale;

    mathint protocolShare = (protocolShareFee * amount) / (expScale);
    mathint expectedMinterRepoTokens = amount - protocolShare;

    require(minterRepoTokenBalanceBefore + expectedMinterRepoTokens <= max_uint256); // Repo Token balances do not overflow. Proved with invariant totalSupplyIsSumOfBalances and rule onlyAllowedMethodsMayChangeBalance from termRepoToken.erc20Full.
    require(protocolRepoTokenBalanceBefore + protocolShare <= max_uint256); // Repo Token balances do not overflow. Proved with invariant totalSupplyIsSumOfBalances and rule onlyAllowedMethodsMayChangeBalance from termRepoToken.erc20Full.


    mathint expectedRepurchaseExposureFromProtocolShare = protocolShare * mintingRepoToken.redemptionValue() / expScale;
    mathint expectedRepurchaseExposureFromMinterShare = expectedMinterRepoTokens * mintingRepoToken.redemptionValue() / expScale; 
    mathint expectedRepurchaseExposure = expectedRepurchaseExposureFromProtocolShare + expectedRepurchaseExposureFromMinterShare;


    require(minterRepoTokenBalanceBefore + amount <= max_uint256); // Repo Token balances do not overflow. Proved with invariant totalSupplyIsSumOfBalances and rule onlyAllowedMethodsMayChangeBalance from termRepoToken.erc20Full.
    
    mintOpenExposure(e, amount, collateralAmounts);

    mathint minterRepoTokenBalanceAfter = mintingRepoToken.balanceOf(e.msg.sender);
    mathint protocolRepoTokenBalanceAfter = mintingRepoToken.balanceOf(100); // TREASURY address fixed to 100 in methods
    mathint minterRepoExposureAfter = getBorrowerRepurchaseObligation(e.msg.sender);
    mathint totalOutstandingRepurchaseExposureAfter = totalOutstandingRepurchaseExposure();
    uint256 mintExposureCapAfter = mintingRepoToken.mintExposureCap();
    mathint collateralToken0BalanceAfter = collateralBalance(e.msg.sender, 0);
    mathint collateralToken1BalanceAfter = collateralBalance(e.msg.sender, 1);


    assert minterRepoTokenBalanceAfter - minterRepoTokenBalanceBefore == expectedMinterRepoTokens; // Minter repo token balance increases by expected amount
    assert minterRepoExposureAfter - minterRepoExposureBefore == expectedRepurchaseExposure; // Minter borrow repurchase obligation increases by expected amount
    assert totalOutstandingRepurchaseExposureAfter - totalOutstandingRepurchaseExposureBefore == expectedRepurchaseExposure; // Total outstanding repurchase exposure increases by expected amount.
    assert protocolRepoTokenBalanceAfter - protocolShare == protocolRepoTokenBalanceBefore; //Protocol treasury increments correct amount of protocol share
    assert collateralToken0BalanceAfter == collateralToken0BalanceBefore + collateralAmounts[0]; // Collateral locked as expected
    assert (collateralAmounts.length <= 1) || (collateralToken1BalanceAfter == collateralToken1BalanceBefore + collateralAmounts[1]); // Collateral locked as expected
}

rule mintOpenExposureDoesNotAffectThirdParty(
    env e,
	uint256 amount,
    uint256[] collateralAmounts,
    address minter2
) {
    // Bind term contracts to servicer fields.
    require(termRepoToken() == mintingRepoToken); //fixing connection 
    require(termControllerAddress() == mintingController); //fixing connection

    require(!isTokenCollateral(termRepoToken()));
    require (e.msg.sender != minter2);
    require(minter2 != 100); // treasury address will not participate in minting allowlist.

    uint256 thirdPartyBalanceBefore = mintingRepoToken.balanceOf(minter2);
    mintOpenExposure(e, amount, collateralAmounts);
    uint256 thirdPartyBalanceAfter = mintingRepoToken.balanceOf(minter2);

    assert thirdPartyBalanceBefore == thirdPartyBalanceAfter; // Third party term token balance not affected by minting;
}

rule mintOpenExposureRevertConditions(env e) {
    uint256 amount;
	uint256[] collateralAmounts;

    require(termRepoToken() == mintingRepoToken); //fixing connection 
    require(termRepoCollateralManager() == mintingCollateralManager); // fixing connection
    require(mintingCollateralManager.termRepoLocker() == mintingLocker); // fixing connection
    require(!isTokenCollateral(termRepoToken())); 
    require(isTermRepoBalanced()); // Pre-tx state must be termRepoBalanced.
    require(collateralAmounts.length == 1); // Simplify input space
    require(mintingCollateralManager.isInCollateralTokenArray(mintingToken)); // fixing connection
    require(to_mathint(mintingCollateralManager.numOfAcceptedCollateralTokens()) == to_mathint(mintingCollateralManager.collateralTokensLength()));


    uint256 minterRepoTokenBalanceBefore = mintingRepoToken.balanceOf(e.msg.sender);

    require(minterRepoTokenBalanceBefore + amount <= max_uint256); // Repo Token balances do not overflow. Proved with invariant totalSupplyIsSumOfBalances and rule onlyAllow
    require(mintingCollateralManager.encumberedCollateralBalance(mintingToken) + collateralAmounts[0] <= max_uint256 );
    require(mintingCollateralManager.getCollateralBalance(e.msg.sender, mintingToken) + collateralAmounts[0] <= max_uint256);
    bool payable = e.msg.value > 0;
    bool callerNotSpecialist = !hasRole(SPECIALIST_ROLE(), e.msg.sender);
    bool noMinterRole = !mintingRepoToken.hasRole(mintingRepoToken.MINTER_ROLE(), currentContract);
    bool noServicerRoleToCollatManager = !mintingCollateralManager.hasRole(mintingCollateralManager.SERVICER_ROLE(), currentContract);
    bool borrowerNotEnoughCollateralBalance = mintingToken.balanceOf(e.msg.sender) < collateralAmounts[0];
    bool lockerTransfersPaused = mintingLocker.transfersPaused();
    bool noLockerServicerAccessForCollatManager = !mintingLocker.hasRole(mintingLocker.SERVICER_ROLE(), mintingCollateralManager);
    bool collateralAmountsNotProperLength = assert_uint8(collateralAmounts.length) != mintingCollateralManager.numOfAcceptedCollateralTokens();
    bool afterMaturity = e.block.timestamp > maturityTimestamp();
    bool noServicerRoleOnCollateralManager = !mintingCollateralManager.hasRole(mintingCollateralManager.SERVICER_ROLE(), currentContract);

    bool isExpectedToRevert = payable || callerNotSpecialist || noMinterRole || noServicerRoleToCollatManager || borrowerNotEnoughCollateralBalance || lockerTransfersPaused || noLockerServicerAccessForCollatManager || collateralAmountsNotProperLength  || afterMaturity || noServicerRoleOnCollateralManager;

    mintOpenExposure@withrevert(e, amount, collateralAmounts);
        
    // if(lastReverted){
    //     assert isExpectedToRevert;
    // } else {
    //     assert !isExpectedToRevert;
    // }
    
    assert lastReverted <=> isExpectedToRevert;  
}