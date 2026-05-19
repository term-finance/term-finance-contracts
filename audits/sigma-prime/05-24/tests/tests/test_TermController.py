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
 #  +  TermController (ITermController, ITermControllerEvents, Initializable, AccessControlUpgradeable, UUPSUpgradeable)
 #    ✓ [Ext] initialize #
 #       - modifiers: initializer
 #    ✓ [Ext] getTreasuryAddress
 #    ✓ [Ext] getProtocolReserveAddress
 #    ✓ [Ext] isTermDeployed
 #    ✓ [Ext] updateTreasuryAddress #
 #       - modifiers: onlyRole
 #    ✓ [Ext] updateProtocolReserveAddress #
 #       - modifiers: onlyRole
 #    ✓ [Ext] markTermDeployed #
 #       - modifiers: onlyRole
 #    ✓ [Prv] _isTermDeployed
 #    ✓ [Int] _authorizeUpgrade
 #       - modifiers: onlyRole
 #
 #
 # ($) = payable function
 # # = non-constant function


def test_initialize(setup_protocol, treasuryAddress, protocolReserveAddress):
    termController = setup_protocol["termController"]

    assert termController.getTreasuryAddress() == treasuryAddress
    assert termController.getProtocolReserveAddress() == protocolReserveAddress


def test_updates(setup_protocol, devOps, alice):
    termController = setup_protocol["termController"]

    with reverts():
        tx = termController.updateTreasuryAddress(alice, {"from": alice})

    tx = termController.updateTreasuryAddress(alice, {"from": devOps})
    assert termController.getTreasuryAddress() == alice

    with reverts():
        tx = termController.updateProtocolReserveAddress(alice, {"from": alice})

    tx = termController.updateProtocolReserveAddress(alice, {"from": devOps})
    assert termController.getProtocolReserveAddress() == alice


def test_termDeployed(setup_protocol, controllerAdmin, alice):
    termController = setup_protocol["termController"]

    with reverts():
        tx = termController.markTermDeployed(brownie.ZERO_ADDRESS, {"from": alice})

    tx = termController.markTermDeployed(brownie.ZERO_ADDRESS, {"from": controllerAdmin})
    assert termController.isTermDeployed(brownie.ZERO_ADDRESS) == True
    assert termController.isTermDeployed(alice) == False
