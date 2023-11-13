import brownie
import pytest

from brownie import (
    # Brownie helpers
    accounts,
    web3,
    reverts,
    Wei,
    chain,
    Contract,
)
from helpers import get_encoded_termRepoId, make_term_auth, custom_error

#####################################################
# +  TermInitializer (Initializable, UUPSUpgradeable, AccessControlUpgradeable)
#     - [Ext] initialize #
#        - modifiers: initializer
#     - [Ext] pairTermContracts #
#        - modifiers: onlyRole
#     - [Ext] setupTerm #
#        - modifiers: onlyRole,whileDeployingNotPaused
#     ✓ [Ext] pauseDeploying #
#        - modifiers: onlyRole
#     - [Ext] unpauseDeploying #
#        - modifiers: onlyRole
#     ✓ [Int] _authorizeUpgrade
#        - modifiers: onlyRole
#
#
#  ($) = payable function
#  # = non-constant function

## No initialize() function anymore...
#
# def test_initialize(setup_protocol, owner, alice):
#     termInitializer = setup_protocol["termInitializer"]
#
#     # already initialized (in conftest.py)
#     with reverts():
#         tx = termInitializer.initialize({"from": owner})
#
#     # only admin
#     with reverts():
#         # ZERO addresses just for this test case
#         tx = termInitializer.pairTermContracts(
#             brownie.ZERO_ADDRESS,
#             brownie.ZERO_ADDRESS,
#             brownie.ZERO_ADDRESS,
#             brownie.ZERO_ADDRESS,
#             {"from": alice},
#         )
#
#     tx = termInitializer.pairTermContracts(
#         brownie.ZERO_ADDRESS,
#         brownie.ZERO_ADDRESS,
#         brownie.ZERO_ADDRESS,
#         brownie.ZERO_ADDRESS,
#         {"from": owner},
#     )


def test_setupTerm(deploy_protocol, owner, devOps):
    termInitializer = deploy_protocol["termInitializer"]
    termRepoLocker = deploy_protocol["termRepoLocker"]
    termRepoServicer = deploy_protocol["termRepoServicer"]
    termRepoCollateralManager = deploy_protocol["termRepoCollateralManager"]
    rolloverManager = deploy_protocol["rolloverManager"]
    termRepoToken = deploy_protocol["termRepoToken"]
    termAuctionOfferLocker = deploy_protocol["termAuctionOfferLocker"]
    termAuctionBidLocker = deploy_protocol["termAuctionBidLocker"]
    auction = deploy_protocol["auction"]

    termContractGroup = [termRepoLocker, termRepoServicer, termRepoCollateralManager, rolloverManager, termRepoToken, termAuctionOfferLocker, termAuctionBidLocker, auction];

    tx = termInitializer.setupTerm(
        termContractGroup,
        devOps,
        owner,
        "test_term_version",
        "test_auction_version",
        {"from": owner},
    )

    # Check events for all the pairTermContracts() calls
    assert tx.events[4].name == "TermRepoLockerInitialized"
    assert tx.events[9].name == "TermRepoTokenInitialized"
    assert tx.events[13].name == "TermAuctionBidLockerInitialized"
    assert tx.events[17].name == "TermAuctionOfferLockerInitialized"
    assert tx.events[20].name == "TermAuctionInitialized"
    assert tx.events[27].name == "TermRepoServicerInitialized"
    assert tx.events[35].name == "TermRepoCollateralManagerInitialized"
    assert tx.events[39].name == "TermRepoRolloverManagerInitialized"


def test_pauseUnpause(deploy_protocol, owner, devOps):
    termInitializer = deploy_protocol["termInitializer"]
    termRepoLocker = deploy_protocol["termRepoLocker"]
    termRepoServicer = deploy_protocol["termRepoServicer"]
    termRepoCollateralManager = deploy_protocol["termRepoCollateralManager"]
    rolloverManager = deploy_protocol["rolloverManager"]
    termRepoToken = deploy_protocol["termRepoToken"]
    termAuctionOfferLocker = deploy_protocol["termAuctionOfferLocker"]
    termAuctionBidLocker = deploy_protocol["termAuctionBidLocker"]
    auction = deploy_protocol["auction"]

    termContractGroup = [termRepoLocker, termRepoServicer, termRepoCollateralManager, rolloverManager, termRepoToken, termAuctionOfferLocker, termAuctionBidLocker, auction];

    tx = termInitializer.pauseDeploying({"from": devOps})

    # We should not be able to deploy whilst paused
    with reverts(custom_error("DeployingPaused()")):
        
        tx = termInitializer.setupTerm(
            termContractGroup,
            devOps,
            owner,
            "test_term_version",
            "test_auction_version",
            {"from": owner},
        )

    tx = termInitializer.unpauseDeploying({"from": devOps})

    #Now we are unpaused we can deploy
    tx = termInitializer.setupTerm(
        termContractGroup,
        devOps,
        owner,
        "test_term_version",
        "test_auction_version",
        {"from": owner},
    )

    # Check events for all the pairTermContracts() calls
    assert tx.events[4].name == "TermRepoLockerInitialized"
    assert tx.events[9].name == "TermRepoTokenInitialized"
    assert tx.events[13].name == "TermAuctionBidLockerInitialized"
    assert tx.events[17].name == "TermAuctionOfferLockerInitialized"
    assert tx.events[20].name == "TermAuctionInitialized"
    assert tx.events[27].name == "TermRepoServicerInitialized"
    assert tx.events[35].name == "TermRepoCollateralManagerInitialized"
    assert tx.events[39].name == "TermRepoRolloverManagerInitialized"