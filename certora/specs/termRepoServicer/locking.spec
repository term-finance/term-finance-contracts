import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";

using TermRepoLocker as lockerLocking;
using DummyERC20A as purchaseTokenLocking;
using TermController as termControllerLocking;

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function AUCTION_LOCKER() external returns (bytes32) envfree;
    function termRepoLocker() external returns (address) envfree => CONSTANT;
    function purchaseToken() external returns (address) envfree;
    function DummyERC20A.allowance(address,address) external returns(uint256) envfree;
    function DummyERC20A.balanceOf(address) external returns (uint256) envfree;
    function DummyERC20A.allowance(address,address) external returns (uint256) envfree;
    function TermRepoLocker.transfersPaused() external returns (bool) envfree;
    function TermRepoLocker.SERVICER_ROLE() external returns (bytes32) envfree;
    function TermRepoLocker.hasRole(bytes32,address) external returns (bool) envfree;
    function termControllerAddress() external returns (address) envfree;
}

rule lockOfferAmountIntegrity(
    env e,
    address sender,
    address offeror,
    uint256 amount
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(termRepoLocker() != sender);
    require(hasRole(AUCTION_LOCKER(), e.msg.sender));

    mathint senderPurchaseTokenBalanceBefore = purchaseTokenLocking.balanceOf(sender);
    lockOfferAmount(e, sender, offeror, amount);
    mathint senderPurchaseTokenBalanceAfter = purchaseTokenLocking.balanceOf(sender);

    // Check that the sender's purchaseToken balance has decreased.
    assert senderPurchaseTokenBalanceAfter == senderPurchaseTokenBalanceBefore - to_mathint(amount),
        "senderPurchaseTokenBalanceAfter == senderPurchaseTokenBalanceBefore - to_mathint(amount)";
}

rule unlockOfferAmountIntegrity(
    env e,
    address offeror,
    uint256 amount
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(termRepoLocker() != offeror);
    require(hasRole(AUCTION_LOCKER(), e.msg.sender));

    mathint offerorPurchaseTokenBalanceBefore = purchaseTokenLocking.balanceOf(offeror);
    unlockOfferAmount(e, offeror, amount);
    mathint offerorPurchaseTokenBalanceAfter = purchaseTokenLocking.balanceOf(offeror);

    // Check that the offeror's purchaseToken balance has increased.
    assert offerorPurchaseTokenBalanceAfter == offerorPurchaseTokenBalanceBefore + to_mathint(amount),
        "offerorPurchaseTokenBalanceAfter == offerorPurchaseTokenBalanceBefore + to_mathint(amount)";
}

rule lockOfferAmountDoesNotAffectThirdParty(
    env e,
    address sender,
    address offeror,
    uint256 amount,
    address thirdParty
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(thirdParty != sender);
    require(thirdParty != purchaseTokenLocking);
    require(thirdParty != termRepoLocker());

    mathint thirdPartyPurchaseTokenBalanceBefore = purchaseTokenLocking.balanceOf(thirdParty);
    lockOfferAmount(e, sender, offeror, amount);
    mathint thirdPartyPurchaseTokenBalanceAfter = purchaseTokenLocking.balanceOf(thirdParty);

    // Check that the thirdParty's purchaseToken balance has not changed.
    assert thirdPartyPurchaseTokenBalanceBefore == thirdPartyPurchaseTokenBalanceAfter,
        "thirdPartyPurchaseTokenBalanceBefore == thirdPartyPurchaseTokenBalanceAfter";
}

rule unlockOfferAmountDoesNotAffectThirdParty(
    env e,
    address offeror,
    uint256 amount,
    address thirdParty
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(thirdParty != offeror);
    require(thirdParty != purchaseTokenLocking);
    require(thirdParty != termRepoLocker());

    mathint thirdPartyPurchaseTokenBalanceBefore = purchaseTokenLocking.balanceOf(thirdParty);
    unlockOfferAmount(e, offeror, amount);
    mathint thirdPartyPurchaseTokenBalanceAfter = purchaseTokenLocking.balanceOf(thirdParty);

    // Check that the thirdParty's purchaseToken balance has not changed.
    assert thirdPartyPurchaseTokenBalanceBefore == thirdPartyPurchaseTokenBalanceAfter,
        "thirdPartyPurchaseTokenBalanceBefore == thirdPartyPurchaseTokenBalanceAfter";
}

rule lockOfferAmountRevertsWhenInvalid(
    env e,
    address sender,
    address offeror,
    uint256 amount
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(termRepoLocker() == lockerLocking);
    require(termRepoLocker() != sender);

    bool includesValue = e.msg.value > 0;
    bool isAuctionLocker = hasRole(AUCTION_LOCKER(), e.msg.sender);
    bool servicerNotServicerRole = !lockerLocking.hasRole(lockerLocking.SERVICER_ROLE(), currentContract);
    bool isLockerPaused = lockerLocking.transfersPaused();
    bool insufficientBalance = purchaseTokenLocking.balanceOf(sender) < amount;
    bool insufficientAllowance = purchaseTokenLocking.allowance(sender, lockerLocking) < amount;
    bool overflow = amount + purchaseTokenLocking.balanceOf(lockerLocking) > 2 ^ 256 - 1 && amount > 0;

    require(termControllerAddress() == termControllerLocking); // Bounds for test
    bool globalPaused = termControllerLocking.termContractsPaused(e);

    lockOfferAmount@withrevert(e, sender, offeror, amount);

    // Check that the transaction reverted if it was invalid.
    assert (
        !isAuctionLocker ||
        includesValue ||
        isLockerPaused ||
        servicerNotServicerRole ||
        insufficientBalance ||
        insufficientAllowance ||
        overflow ||
        globalPaused
    ) == lastReverted,
        "isAuctionLocker == lastReverted";
}

rule unlockOfferAmountRevertsWhenInvalid(
    env e,
    address offeror,
    uint256 amount
) {
    require(purchaseToken() == purchaseTokenLocking);
    require(termRepoLocker() == lockerLocking);
    require(termRepoLocker() != offeror);

    bool includesValue = e.msg.value > 0;
    bool isAuctionLocker = hasRole(AUCTION_LOCKER(), e.msg.sender);
    bool servicerNotServicerRole = !lockerLocking.hasRole(lockerLocking.SERVICER_ROLE(), currentContract);
    bool isLockerPaused = lockerLocking.transfersPaused();
    bool insufficientBalance = purchaseTokenLocking.balanceOf(lockerLocking) < amount;
    bool overflow = amount + purchaseTokenLocking.balanceOf(offeror) > 2 ^ 256 - 1 && amount > 0;

    require(termControllerAddress() == termControllerLocking); // Bounds for test
    bool globalPausedUnlock = termControllerLocking.termContractsPaused(e);

    unlockOfferAmount@withrevert(e, offeror, amount);

    // Check that the transaction reverted if it was invalid.
    assert (
        !isAuctionLocker ||
        includesValue ||
        isLockerPaused ||
        servicerNotServicerRole ||
        insufficientBalance ||
        overflow ||
        globalPausedUnlock
    ) == lastReverted,
        "isAuctionLocker == lastReverted";
}
