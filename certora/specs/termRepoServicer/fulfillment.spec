import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";

using TermRepoLocker as lockerFulfill;
using TermController as controllerFulfill;
using TermRepoToken as repoTokenFulfill;
using TermRepoCollateralManagerHarness as collateralManagerFulfill;
using DummyERC20A as tokenFulfill;


methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function AUCTIONEER() external returns (bytes32) envfree;
    function getBorrowerRepurchaseObligation(address) external returns (uint256) envfree;
    function termRepoToken() external returns (address) envfree;
    function termRepoLocker() external returns (address) envfree;
    function purchaseToken() external returns (address) envfree;
    function termControllerAddress() external returns (address) envfree;
    function termRepoCollateralManager() external returns (address) envfree;
    function servicingFee() external returns (uint256) envfree;
    function maturityTimestamp() external returns (uint256) envfree;
    function totalOutstandingRepurchaseExposure() external returns (uint256) envfree;
    function TermRepoToken.mintingPaused() external returns (bool) envfree;
    function TermRepoToken.balanceOf(address) external returns (uint256) envfree;
    function TermRepoToken.redemptionValue() external returns (uint256) envfree;
    function TermRepoToken.totalSupply() external returns (uint256) envfree;
    function TermRepoToken.hasRole(bytes32, address) external returns (bool) envfree;
    function TermRepoToken.MINTER_ROLE() external returns (bytes32) envfree;
    function TermRepoCollateralManagerHarness.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoCollateralManagerHarness.hasRole(bytes32, address) external returns (bool) envfree;
    function TermRepoCollateralManagerHarness.harnessLockedCollateralLedger(address, address) external returns (uint256) envfree;
    function TermRepoCollateralManagerHarness.encumberedCollateralBalance(address) external returns (uint256) envfree;
    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32, address) external returns (bool) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function DummyERC20A.balanceOf(address) external returns (uint256) envfree;
    function TermController.getTreasuryAddress() external returns (address) envfree => ALWAYS(100);
}

rule fulfillOfferIntegrity(
    env e,
    address offeror,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    bytes32 offerId
) {
    // Constrain input space such that repoTokenFullfill is the termRepoToken used by the termRepoServicer being tested.
    require(termRepoToken() == repoTokenFulfill);

    mathint tokensMinted = repoTokenFulfill.redemptionValue() == 0 ? 0 : (to_mathint(repurchasePrice) * 10^18) / to_mathint(repoTokenFulfill.redemptionValue());

    // Constrain input space such that the offeror's repoToken balance does not overflow.
    require(to_mathint(repoTokenFulfill.balanceOf(offeror)) + to_mathint(tokensMinted) < 2^256);

    mathint offerorRepoTokenBalanceBefore = to_mathint(repoTokenFulfill.balanceOf(offeror));
    fulfillOffer(e, offeror, purchasePrice, repurchasePrice, offerId);
    mathint offerorRepoTokenBalanceAfter = to_mathint(repoTokenFulfill.balanceOf(offeror));

    // Check that the offeror's repoToken balance has increased.
    assert offerorRepoTokenBalanceAfter == offerorRepoTokenBalanceBefore + tokensMinted,
        "offerorRepoTokenBalanceAfter == offerorRepoTokenBalanceBefore + tokensMinted";
}

rule fulfillBidIntegrity(
    env e,
    address bidder,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    address[] collateralTokens,
    uint256[] collateralAmounts,
    uint256 dayCountFractionMantissa,
    address treasury
) {
    // Constrain input space such that repoTokenFullfill is the termRepoToken used by the termRepoServicer being tested.
    require(purchaseToken() == tokenFulfill);
    require(termControllerAddress() == controllerFulfill);
    require(termRepoLocker() == lockerFulfill);
    require(controllerFulfill.getTreasuryAddress() == treasury);

    require(bidder != treasury);
    require(bidder != lockerFulfill);
    require(treasury != lockerFulfill);

    // See: TermRepoServicer.sol:524
    mathint protocolShare = to_mathint(dayCountFractionMantissa) * to_mathint(servicingFee()) * to_mathint(purchasePrice);

    // TODO: Link rule for this invariant
    require(protocolShare < to_mathint(purchasePrice));

    mathint bidderTokenBalanceBefore = to_mathint(tokenFulfill.balanceOf(bidder));
    mathint protocolTokenBalanceBefore = to_mathint(tokenFulfill.balanceOf(treasury));
    fulfillBid(e, bidder, purchasePrice, repurchasePrice, collateralTokens, collateralAmounts, dayCountFractionMantissa);
    mathint bidderTokenBalanceAfter = to_mathint(tokenFulfill.balanceOf(bidder));
    mathint protocolTokenBalanceAfter = to_mathint(tokenFulfill.balanceOf(treasury));

    // Check that the bidder's token balance has decreased.
    assert bidderTokenBalanceAfter == bidderTokenBalanceBefore + (to_mathint(purchasePrice) - protocolShare),
        "bidderTokenBalanceAfter == bidderTokenBalanceBefore + (to_mathint(purchasePrice) - protocolShare)";

    // Check that the protocol's token balance has increased.
    assert protocolTokenBalanceAfter == protocolTokenBalanceBefore + protocolShare,
        "protocolTokenBalanceAfter == protocolTokenBalanceBefore + protocolShare";
}

rule fulfillOfferRevertsIfNotValid(
    env e,
    address offeror,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    bytes32 offerId
) {
    require(termRepoToken() == repoTokenFulfill);

    bool notAuctioneer = !hasRole(AUCTIONEER(), e.msg.sender);
    bool servicerNotMinterRole = !repoTokenFulfill.hasRole(repoTokenFulfill.MINTER_ROLE(), currentContract);
    bool msgHasValue = e.msg.value != 0;
    bool divByZero = repoTokenFulfill.redemptionValue() == 0;
    bool overflow = (repurchasePrice * 10 ^ 36) > 2^256
        || ((repoTokenFulfill.redemptionValue() > 0) && (repoTokenFulfill.totalSupply() + (repurchasePrice * 10^18) / repoTokenFulfill.redemptionValue()) >= 2^256);
    bool mintingPaused = repoTokenFulfill.mintingPaused();
    bool zeroAddress = offeror == 0;
    fulfillOffer@withrevert(e, offeror, purchasePrice, repurchasePrice, offerId);
    assert lastReverted == (
        notAuctioneer ||
        msgHasValue ||
        divByZero ||
        servicerNotMinterRole ||
        overflow ||
        mintingPaused ||
        zeroAddress
    ), "fulfillOffer should revert if not valid";
}

rule fulfillBidRevertsIfNotValid(
    env e,
    address bidder,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    address[] collateralTokens,
    uint256[] collateralAmounts,
    uint256 dayCountFractionMantissa
) {
    require(termRepoCollateralManager() == collateralManagerFulfill);
    require(termRepoLocker() == lockerFulfill);
    require(termControllerAddress() == controllerFulfill);
    require(collateralAmounts.length == 1);
    require(collateralTokens.length == 1);

    require(lockerFulfill != 100);
    require(lockerFulfill != bidder);
    require(bidder != 100);
    require(purchaseToken() != termRepoToken());

    bool notAuctioneer = !hasRole(AUCTIONEER(), e.msg.sender);
    bool servicerNotServicerRole = !collateralManagerFulfill.hasRole(collateralManagerFulfill.SERVICER_ROLE(), currentContract)
        || !lockerFulfill.hasRole(lockerFulfill.SERVICER_ROLE(), currentContract);
    bool afterMaturity = e.block.timestamp >= maturityTimestamp();
    bool msgHasValue = e.msg.value != 0;
    bool overflowRepurchaseExposureLedger = getBorrowerRepurchaseObligation(bidder) + repurchasePrice >= 2^256;
    bool overflowTotalOutstandingRepurchaseExposure = totalOutstandingRepurchaseExposure() + repurchasePrice >= 2^256;
    bool overflowLockedCollateralLedger0 = collateralManagerFulfill.harnessLockedCollateralLedger(bidder, collateralTokens[0]) + collateralAmounts[0] >= 2^256;
    bool overflowEncumberedCollateralBalance0 = collateralManagerFulfill.encumberedCollateralBalance(collateralTokens[0]) + collateralAmounts[0] >= 2^256;
    mathint dcfServicingFee = dayCountFractionMantissa * servicingFee();
    bool overflowDcfServicingFee = dcfServicingFee >= 2^256;
    mathint dcfServicingFeePrice = (dcfServicingFee / 10^18) * purchasePrice;
    bool overflowDcfServicingFeePrice = dcfServicingFeePrice >= 2^256;
    mathint protocolShare = dcfServicingFeePrice / 10^18;
    bool insufficientBalance = tokenFulfill.balanceOf(lockerFulfill) < purchasePrice;
    bool purchasePriceLessThanProtocolShare = to_mathint(purchasePrice) < protocolShare;
    bool transfersPaused = lockerFulfill.transfersPaused();
    bool overflowTreasuryBalance = tokenFulfill.balanceOf(100) + protocolShare >= 2^256;
    bool overflowBidderBalance = tokenFulfill.balanceOf(bidder) + purchasePrice - protocolShare >= 2^256;
    fulfillBid@withrevert(e, bidder, purchasePrice, repurchasePrice, collateralTokens, collateralAmounts, dayCountFractionMantissa);
    assert lastReverted == (
        notAuctioneer ||
        afterMaturity ||
        msgHasValue ||
        servicerNotServicerRole ||
        overflowRepurchaseExposureLedger ||
        overflowTotalOutstandingRepurchaseExposure ||
        overflowLockedCollateralLedger0 ||
        overflowEncumberedCollateralBalance0 ||
        overflowDcfServicingFee ||
        overflowDcfServicingFeePrice ||
        purchasePriceLessThanProtocolShare ||
        transfersPaused ||
        overflowBidderBalance ||
        overflowTreasuryBalance ||
        overflowBidderBalance ||
        insufficientBalance
    ), "fulfillBid should revert if not valid";
}

rule fulfillOfferDoesNotAffectThirdParty(
    env e,
    address offeror,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    bytes32 offerId,
    address thirdParty
) {
    // Constrain input space such that repoTokenFullfill is the termRepoToken used by the termRepoServicer being tested.
    require(termRepoToken() == repoTokenFulfill);
    require(thirdParty != offeror);
    require(thirdParty != 100);

    mathint thirdPartyRepoTokenBalanceBefore = repoTokenFulfill.balanceOf(thirdParty);
    fulfillOffer(e, offeror, purchasePrice, repurchasePrice, offerId);
    mathint thirdPartyRepoTokenBalanceAfter = repoTokenFulfill.balanceOf(thirdParty);

    // Check that the thirdParty's repoToken balance has not changed.
    assert thirdPartyRepoTokenBalanceBefore == thirdPartyRepoTokenBalanceAfter,
        "thirdPartyRepoTokenBalanceBefore == thirdPartyRepoTokenBalanceAfter";
}

rule fulfillBidDoesNotAffectThirdParty(
    env e,
    address bidder,
    uint256 purchasePrice,
    uint256 repurchasePrice,
    address[] collateralTokens,
    uint256[] collateralAmounts,
    uint256 dayCountFractionMantissa,
    address thirdParty
) {
    // Constrain input space such that repoTokenFullfill is the termRepoToken used by the termRepoServicer being tested.
    require(purchaseToken() == tokenFulfill);
    require(termRepoLocker() == lockerFulfill);
    require(thirdParty != bidder);
    require(thirdParty != 100); // Treasury is always 100
    require(thirdParty != lockerFulfill);

    mathint thirdPartyTokenBalanceBefore = tokenFulfill.balanceOf(thirdParty);
    fulfillBid(e, bidder, purchasePrice, repurchasePrice, collateralTokens, collateralAmounts, dayCountFractionMantissa);
    mathint thirdPartyTokenBalanceAfter = tokenFulfill.balanceOf(thirdParty);

    // Check that the thirdParty's token balance has not changed.
    assert thirdPartyTokenBalanceBefore == thirdPartyTokenBalanceAfter,
        "thirdPartyTokenBalanceBefore == thirdPartyTokenBalanceAfter";
}
