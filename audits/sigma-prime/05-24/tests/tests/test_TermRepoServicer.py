import brownie
import pytest

from brownie import (
    # Brownie helpers
    accounts,
    web3,
    reverts,
    Wei,
    chain,
    Contract
)
from helpers import custom_error, get_encoded_termRepoId, make_term_auth, make_term_auth_no_sig

 ####################################################
 # +  TermRepoServicer (ITermRepoServicer, ITermRepoServicerErrors, Initializable, UUPSUpgradeable, AccessControlUpgradeable, ExponentialNoError)
 #    - [Ext] initialize #
 #       - modifiers: initializer
 #    - [Ext] pairTermContracts #
 #       - modifiers: onlyRole
 #    - [Ext] submitRepurchasePayment #
 #       - modifiers: userAuthenticated
 #    - [Ext] burnCollapseExposure #
 #       - modifiers: userAuthenticated
 #    - [Ext] getBorrowerRepurchaseObligation
 #    - [Ext] mintOpenExposure #
 #       - modifiers: userAuthenticated
 #    - [Ext] getTotalLockedOfferAmount
 #    - [Ext] redeemTermRepoTokens #
 #    - [Ext] isTermRepoBalanced
 #    - [Ext] lockOfferAmount #
 #       - modifiers: onlyRole
 #    - [Ext] unlockOfferAmount #
 #       - modifiers: onlyRole
 #    - [Ext] fulfillOffer #
 #       - modifiers: onlyRole
 #    - [Ext] fulfillBid #
 #       - modifiers: onlyRole
 #    - [Ext] openExposureOnRolloverNew #
 #       - modifiers: onlyRole
 #    - [Ext] approveRolloverAuction #
 #       - modifiers: onlyRole
 #    - [Ext] closeExposureOnRolloverExisting #
 #       - modifiers: onlyRole
 #    - [Ext] liquidatorCoverExposure #
 #       - modifiers: onlyRole
 #    - [Ext] grantMintExposureAccess #
 #       - modifiers: onlyRole
 #    - [Ext] reopenToNewAuction #
 #       - modifiers: onlyRole
 #    - [Int] _isTermRepoBalanced
 #    - [Int] _repay #
 #    - [Int] _parRedemption #
 #    - [Int] _proRataRedemption #
 #    - [Int] _authorizeUpgrade #
 #       - modifiers: onlyRole
 #
 #
 # ($) = payable function
 # # = non-constant function


def test_initialize(setup_protocol, owner):
    termRepoServicer = setup_protocol["termRepoServicer"]
    purchaseToken = setup_protocol["purchaseToken_usdc"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    rolloverManager = setup_protocol["rolloverManager"]
    termRepoToken = setup_protocol["termRepoToken"]
    servicingFee = 3000000000000000                     # 0.3%

    assert termRepoServicer.purchaseToken() == purchaseToken
    assert termRepoServicer.termRepoId() == get_encoded_termRepoId("TestTermRepo")
    assert termRepoServicer.totalOutstandingRepurchaseExposure() == 0
    assert termRepoServicer.totalRepurchaseCollected() == 0
    assert termRepoServicer.servicingFee() == servicingFee
    assert termRepoServicer.termRepoRolloverManager() == rolloverManager
    assert termRepoServicer.termRepoToken() == termRepoToken
    assert termRepoServicer.termRepoLocker() == termRepoLocker
    assert termRepoServicer.termRepoCollateralManager() == termRepoCollateralManager

# @pytest.mark.xfail(reason="Lack of maturity checks?")
def test_submitRepurchasePayment_premature_repayment(
    setup_protocol,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]

    amount = 900

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    with reverts(custom_error("ZeroBorrowerRepurchaseObligation")):
        servicer.submitRepurchasePayment(amount, {"from": alice})

def test_submitRepurchasePayment_no_obligation(setup_protocol, owner, alice):
    servicer = setup_protocol["termRepoServicer"]

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = 900

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    with reverts(custom_error("ZeroBorrowerRepurchaseObligation")):
        servicer.submitRepurchasePayment(amount, {"from": alice})

def test_submitRepurchasePayment_after_repurchase_window(
    setup_protocol,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]

    # fast-forward to induce repo repurchase window expiry
    chain.sleep(1766103841)

    amount = 900
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    with reverts(custom_error("AfterRepurchaseWindow")):
        servicer.submitRepurchasePayment(amount, {"from": alice})

def test_submitRepurchasePayment_repayment_exceeds_obligation(
    setup_protocol,
    constants,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]
    controller = setup_protocol["termController"]
    locker = setup_protocol["termRepoLocker"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]

    obligation = 100

    # give Alice some collateral
    wbtc.transfer(alice, obligation, {"from": owner})

    # approvals
    wbtc.approve(locker, constants.MAX_UINT256, {"from": alice})
    weth.approve(locker, constants.MAX_UINT256, {"from": alice})
    wbtc.approve(servicer, constants.MAX_UINT256, {"from": alice})
    weth.approve(servicer, constants.MAX_UINT256, {"from": alice})

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.mintOpenExposure.encode_input(obligation, [obligation, 0], termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    # mint open exposure for Alice
    controller.grantMintExposureAccess(alice, {"from": owner})
    servicer.mintOpenExposure(
        obligation,
        [obligation, 0],
        # auth,
        {"from": alice}
    )

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = obligation + 1
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    with reverts(custom_error("RepurchaseAmountTooHigh")):
        servicer.submitRepurchasePayment(amount, {"from": alice})


@pytest.mark.xfail(reason="Should revert for repayment amount == 0")
def test_submitRepurchasePayment_repayment_amount_zero(
    setup_protocol,
    constants,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]
    controller = setup_protocol["termController"]
    locker = setup_protocol["termRepoLocker"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]

    obligation = 100

    # give Alice some collateral
    wbtc.transfer(alice, obligation, {"from": owner})

    # approvals
    wbtc.approve(locker, constants.MAX_UINT256, {"from": alice})
    weth.approve(locker, constants.MAX_UINT256, {"from": alice})
    wbtc.approve(servicer, constants.MAX_UINT256, {"from": alice})
    weth.approve(servicer, constants.MAX_UINT256, {"from": alice})

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.mintOpenExposure.encode_input(obligation, [obligation, 0], termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    # mint open exposure for Alice
    controller.grantMintExposureAccess(alice, {"from": owner})
    servicer.mintOpenExposure(
        obligation,
        [obligation, 0],
        # auth,
        {"from": alice}
    )

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = 0
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    with reverts():
        servicer.submitRepurchasePayment(amount, {"from": alice})


def test_submitRepurchasePayment_normal_partial_repayment(
    setup_protocol,
    constants,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]
    locker = setup_protocol["termRepoLocker"]
    controller = setup_protocol["termController"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]
    usdc = setup_protocol["usdc"]

    obligation_collateral = 100
    obligation_purchase = 88

    # give Alice some collateral
    wbtc.transfer(alice, obligation_collateral, {"from": owner})

    # give Alice some purchasing tokens
    usdc.transfer(alice, obligation_purchase, {"from": owner})

    # approvals
    wbtc.approve(locker, constants.MAX_UINT256, {"from": alice})
    weth.approve(locker, constants.MAX_UINT256, {"from": alice})
    usdc.approve(locker, constants.MAX_UINT256, {"from": alice})
    wbtc.approve(servicer, constants.MAX_UINT256, {"from": alice})
    weth.approve(servicer, constants.MAX_UINT256, {"from": alice})
    usdc.approve(servicer, constants.MAX_UINT256, {"from": alice})

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.mintOpenExposure.encode_input(obligation_collateral, [obligation_collateral, 0], termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    # mint open exposure for Alice
    controller.grantMintExposureAccess(alice, {"from": owner})
    servicer.mintOpenExposure(
        obligation_collateral,
        [obligation_collateral, 0],
        # auth,
        {"from": alice}
    )

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = obligation_purchase - 1
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    tx = servicer.submitRepurchasePayment(amount, {"from": alice})

    assert usdc.balanceOf(alice) == obligation_purchase - amount
    assert wbtc.balanceOf(alice) == 0
    assert tx.events[1].address == setup_protocol["eventEmitter"].address
    assert tx.events[1].name == "RepurchasePaymentSubmitted"
    assert tx.events[1]["termRepoId"] == servicer.termRepoId()
    assert tx.events[1]["borrower"] == alice
    assert tx.events[1]["repurchaseAmount"] == amount

def test_submitRepurchasePayment_normal_full_repayment(
    setup_protocol,
    constants,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]
    locker = setup_protocol["termRepoLocker"]
    controller = setup_protocol["termController"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]
    usdc = setup_protocol["usdc"]

    obligation_collateral = 100
    obligation_purchase = 88

    # give Alice some collateral
    wbtc.transfer(alice, obligation_collateral, {"from": owner})

    # give Alice some purchasing tokens
    usdc.transfer(alice, obligation_purchase, {"from": owner})

    # approvals
    wbtc.approve(locker, constants.MAX_UINT256, {"from": alice})
    weth.approve(locker, constants.MAX_UINT256, {"from": alice})
    usdc.approve(locker, constants.MAX_UINT256, {"from": alice})
    wbtc.approve(servicer, constants.MAX_UINT256, {"from": alice})
    weth.approve(servicer, constants.MAX_UINT256, {"from": alice})
    usdc.approve(servicer, constants.MAX_UINT256, {"from": alice})

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.mintOpenExposure.encode_input(obligation_collateral, [obligation_collateral, 0], termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    # mint open exposure for Alice
    controller.grantMintExposureAccess(alice, {"from": owner})
    servicer.mintOpenExposure(
        obligation_collateral,
        [obligation_collateral, 0],
        # auth,
        {"from": alice}
    )

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = obligation_purchase
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    tx = servicer.submitRepurchasePayment(amount, {"from": alice})

    assert usdc.balanceOf(alice) == obligation_purchase - amount
    assert wbtc.balanceOf(alice) == 0
    assert tx.events[1].address == setup_protocol["eventEmitter"].address
    assert tx.events[1].name == "RepurchasePaymentSubmitted"
    assert tx.events[1]["termRepoId"] == servicer.termRepoId()
    assert tx.events[1]["borrower"] == alice
    assert tx.events[1]["repurchaseAmount"] == amount



def test_burnCollapseExposure_zero_obligation(
    setup_protocol,
    constants,
    owner,
    alice
):
    servicer = setup_protocol["termRepoServicer"]
    locker = setup_protocol["termRepoLocker"]
    controller = setup_protocol["termController"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]
    usdc = setup_protocol["usdc"]

    obligation_collateral = 100
    obligation_purchase = 88

    # give Alice some collateral
    wbtc.transfer(alice, obligation_collateral, {"from": owner})

    # give Alice some purchasing tokens
    usdc.transfer(alice, obligation_purchase, {"from": owner})

    # approvals
    wbtc.approve(locker, constants.MAX_UINT256, {"from": alice})
    weth.approve(locker, constants.MAX_UINT256, {"from": alice})
    usdc.approve(locker, constants.MAX_UINT256, {"from": alice})
    wbtc.approve(servicer, constants.MAX_UINT256, {"from": alice})
    weth.approve(servicer, constants.MAX_UINT256, {"from": alice})
    usdc.approve(servicer, constants.MAX_UINT256, {"from": alice})

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.mintOpenExposure.encode_input(obligation_collateral, [obligation_collateral, 0], termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    # mint open exposure for Alice
    controller.grantMintExposureAccess(alice, {"from": owner})
    servicer.mintOpenExposure(
        obligation_collateral,
        [obligation_collateral, 0],
        # auth,
        {"from": alice}
    )

    # fast-forward to induce repo maturation
    chain.mine(timedelta=86400 * 31)

    amount = obligation_purchase
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = servicer.submitRepurchasePayment.encode_input(amount, termAuth_nosig)
    # auth = make_term_auth(alice, nonce, expirationTimestamp, servicer.address, txMsgData_nosig)

    tx = servicer.submitRepurchasePayment(amount, {"from": alice})

    assert usdc.balanceOf(alice) == obligation_purchase - amount
    assert wbtc.balanceOf(alice) == 0
    assert tx.events[1].address == setup_protocol["eventEmitter"].address
    assert tx.events[1].name == "RepurchasePaymentSubmitted"
    assert tx.events[1]["termRepoId"] == servicer.termRepoId()
    assert tx.events[1]["borrower"] == alice
    assert tx.events[1]["repurchaseAmount"] == amount

    tx = servicer.burnCollapseExposure(amount, {"from": alice})

    with reverts(custom_error("ZeroBorrowerRepurchaseObligation()")):
        tx = servicer.burnCollapseExposure(amount, {"from": alice})
