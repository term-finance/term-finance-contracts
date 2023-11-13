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
from helpers import get_encoded_termRepoId, make_term_auth

 ####################################################
 # +  TermRepoLocker (ITermRepoLocker, ITermRepoLockerErrors, Initializable, UUPSUpgradeable, AccessControlUpgradeable)
 #    ✓ [Ext] initialize #
 #       - modifiers: initializer
 #    ✓ [Ext] pairTermContracts #
 #       - modifiers: onlyRole
 #    ✓ [Ext] transferTokenFromWallet #
 #       - modifiers: whileTransfersNotPaused,onlyRole
 #    ✓ [Ext] transferTokenToWallet #
 #       - modifiers: whileTransfersNotPaused,onlyRole
 #    ✓ [Ext] pauseTransfers #
 #       - modifiers: onlyRole
 #    ✓ [Ext] unpauseTransfers #
 #       - modifiers: onlyRole
 #    ✓ [Int] _authorizeUpgrade
 #       - modifiers: onlyRole
 #
 #
 # ($) = payable function
 # # = non-constant function


def test_initialize(setup_protocol, owner):
    termRepoLocker = setup_protocol["termRepoLocker"]

    assert termRepoLocker.termRepoId() == get_encoded_termRepoId("TestTermRepo")
    assert termRepoLocker.transfersPaused() == False


def test_transfers(setup_protocol, owner, alice):
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    purchaseToken = setup_protocol["purchaseToken_usdc"]
    purchaseToken_amount = 10**purchaseToken.decimals()

    # Give Alice some tokens to spend
    tx = purchaseToken.transfer(alice, purchaseToken_amount, {"from": owner})
    assert purchaseToken.balanceOf(alice) == purchaseToken_amount

    assert termRepoLocker.transfersPaused() == False

    # Only SERVICES_ROLE can do it
    with reverts():
        tx = termRepoLocker.transferTokenFromWallet(alice,
                                                    purchaseToken,
                                                    purchaseToken_amount,
                                                    {"from": alice})
    with reverts():
        tx = termRepoLocker.transferTokenToWallet(alice,
                                                  purchaseToken,
                                                  purchaseToken_amount,
                                                  {"from": alice})

    assert purchaseToken.balanceOf(termRepoLocker) == 0
    tx = purchaseToken.approve(termRepoLocker, purchaseToken_amount, {"from": alice})
    tx = termRepoLocker.transferTokenFromWallet(alice,
                                                purchaseToken,
                                                purchaseToken_amount,
                                                {"from": termRepoCollateralManager})
    assert purchaseToken.balanceOf(termRepoLocker) == purchaseToken_amount
    assert purchaseToken.balanceOf(alice) == 0

    tx = termRepoLocker.transferTokenToWallet(alice,
                                              purchaseToken,
                                              purchaseToken_amount,
                                              {"from": termRepoCollateralManager})
    assert purchaseToken.balanceOf(termRepoLocker) == 0
    assert purchaseToken.balanceOf(alice) == purchaseToken_amount


def test_pause_unpause(setup_protocol, owner, alice):
    termRepoLocker = setup_protocol["termRepoLocker"]

    assert termRepoLocker.transfersPaused() == False

    with reverts():
        tx = termRepoLocker.pauseTransfers({"from": alice})
    tx = termRepoLocker.pauseTransfers({"from": owner})

    assert termRepoLocker.transfersPaused() == True

    with reverts():
        tx = termRepoLocker.unpauseTransfers({"from": alice})
    tx = termRepoLocker.unpauseTransfers({"from": owner})

    assert termRepoLocker.transfersPaused() == False
