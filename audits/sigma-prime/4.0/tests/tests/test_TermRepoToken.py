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
from helpers import get_encoded_termRepoId

 ####################################################
 # +  TermRepoToken (Initializable, ERC20Upgradeable, UUPSUpgradeable, AccessControlUpgradeable, ExponentialNoError, ITermRepoTokenErrors, ITermRepoToken)
 #    ✓ [Ext] initialize #
 #       - modifiers: initializer
 #    ✓ [Ext] pairTermContracts #
 #       - modifiers: onlyRole
 #    ✓ [Ext] resetMintExposureCap #
 #       - modifiers: onlyRole
 #    ✓ [Ext] totalRedemptionValue
 #    ✓ [Ext] burn #
 #       - modifiers: onlyRole,whileBurningNotPaused
 #    ✓ [Ext] burnAndReturnValue #
 #       - modifiers: onlyRole,whileBurningNotPaused
 #    ✓ [Ext] mintRedemptionValue #
 #       - modifiers: whileMintingNotPaused,onlyRole
 #    ✓ [Ext] mintTokens #
 #       - modifiers: whileMintingNotPaused,onlyRole
 #    ✓ [Ext] decrementMintExposureCap #
 #       - modifiers: onlyRole
 #    ✓ [Pub] decimals
 #    ✓ [Ext] pauseMinting #
 #       - modifiers: onlyRole
 #    ✓ [Ext] unpauseMinting #
 #       - modifiers: onlyRole
 #    ✓ [Ext] pauseBurning #
 #       - modifiers: onlyRole
 #    ✓ [Ext] unpauseBurning #
 #       - modifiers: onlyRole
 #    ✓ [Int] _authorizeUpgrade
 #       - modifiers: onlyRole
 #
 #
 # ($) = payable function
 # # = non-constant function


def test_deployment(setup_protocol, owner):
    termRepoToken = setup_protocol["termRepoToken"]
    purchaseToken_usdc = setup_protocol["purchaseToken_usdc"]

    assert termRepoToken.termRepoId() == get_encoded_termRepoId("TestTermRepo")
    assert termRepoToken.name() == "TermRepoToken"
    assert termRepoToken.symbol() == "TESTTF"
    assert termRepoToken.decimals() == purchaseToken_usdc.decimals()
    assert termRepoToken.redemptionValue() == 1000000000000000000
    assert termRepoToken.mintExposureCap() == 1000000000000000000
    assert termRepoToken.mintingPaused() == False
    assert termRepoToken.burningPaused() == False


def test_resetMintExposureCap(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]

    newMintExposureCap = 250_000
    tx = termRepoToken.resetMintExposureCap(newMintExposureCap, {"from": owner})
    assert termRepoToken.mintExposureCap() == newMintExposureCap

    with reverts():
        tx = termRepoToken.resetMintExposureCap(newMintExposureCap, {"from": alice})


def test_decrementMintExposureCap(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    currMintExposureCap = termRepoToken.mintExposureCap()
    decrMintExposureCap = 100_000
    with reverts():
        tx = termRepoToken.decrementMintExposureCap(decrMintExposureCap, {"from": alice})

    with reverts():
        tx = termRepoToken.decrementMintExposureCap(currMintExposureCap + 1, {"from": termRepoServicer})

    tx = termRepoToken.decrementMintExposureCap(decrMintExposureCap, {"from": termRepoServicer})
    assert termRepoToken.mintExposureCap() == currMintExposureCap - decrMintExposureCap


def test_totalRedemptionValue(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    mintAmount = 100_000
    tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})

    assert termRepoToken.totalRedemptionValue() == mintAmount       # Redemption value 1:1


def test_mintTokens(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    mintAmount = 100_000
    tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})
    assert termRepoToken.balanceOf(alice) == mintAmount

    with reverts():
        tx = termRepoToken.mintTokens(alice, mintAmount, {"from": alice})


def test_mintRedemptionValue(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    mintAmount = 100_000
    tx = termRepoToken.mintRedemptionValue(alice, mintAmount, {"from": termRepoServicer})
    assert termRepoToken.balanceOf(alice) == mintAmount     # Redemption value 1:1

    with reverts():
        tx = termRepoToken.mintTokens(alice, mintAmount, {"from": alice})


def test_burn(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    currMintExposureCap = termRepoToken.mintExposureCap()

    mintAmount = 100_000
    burnAmount = 50_000
    with reverts("ERC20: burn amount exceeds balance"):
        tx = termRepoToken.burn(alice, burnAmount, {"from": termRepoServicer})

    tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})
    with reverts():
        tx = termRepoToken.burn(alice, burnAmount, {"from": alice})
    tx = termRepoToken.burn(alice, burnAmount, {"from": termRepoServicer})

    assert termRepoToken.mintExposureCap() == currMintExposureCap + burnAmount


def test_burnAndReturnValue(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    currMintExposureCap = termRepoToken.mintExposureCap()

    mintAmount = 100_000
    burnAmount = 50_000
    tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})
    with reverts():
        tx = termRepoToken.burnAndReturnValue(alice, burnAmount, {"from": alice})
    tx = termRepoToken.burnAndReturnValue(alice, burnAmount, {"from": termRepoServicer})

    # assert tx.return_value == burnAmount        # Redemption value 1:1
    assert termRepoToken.mintExposureCap() == currMintExposureCap + burnAmount


def test_pauseUnpause(setup_protocol, owner, alice):
    termRepoToken = setup_protocol["termRepoToken"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mintAmount = 100_000
    burnAmount = 50_000

    with reverts():
        tx = termRepoToken.pauseMinting({"from": alice})
    with reverts():
        tx = termRepoToken.unpauseMinting({"from": alice})
    with reverts():
        tx = termRepoToken.pauseBurning({"from": alice})
    with reverts():
        tx = termRepoToken.unpauseBurning({"from": alice})

    tx = termRepoToken.pauseMinting({"from": owner})
    with reverts():
        tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})
    tx = termRepoToken.unpauseMinting({"from": owner})
    tx = termRepoToken.mintTokens(alice, mintAmount, {"from": termRepoServicer})
    assert termRepoToken.balanceOf(alice) == mintAmount

    tx = termRepoToken.pauseBurning({"from": owner})
    with reverts():
        tx = termRepoToken.burn(alice, burnAmount, {"from": termRepoServicer})
    tx = termRepoToken.unpauseBurning({"from": owner})
    tx = termRepoToken.burn(alice, burnAmount, {"from": termRepoServicer})
    assert termRepoToken.balanceOf(alice) == mintAmount - burnAmount
