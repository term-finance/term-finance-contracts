"""
✅ test done and should pass
⛔ test done but there's an issue
❎ test not required or n/a

Due to the highly repetitive nature of this contract,
We are testing one event function only:

initialize
pairTermContract
emitTermAuctionInitialized
"""

from brownie import (
    # Brownie helpers
    accounts,
    web3,
    reverts,
    Wei,
    chain,
    Contract,
)
import brownie
import pytest
import random

from eth_abi import encode_abi
from eth_abi.packed import encode_abi_packed
from helpers import make_term_auth, custom_error, do_auction, do_auction_multicollateral


def test_TermEventEmitter(setup_protocol, TermEventEmitter, constants, owner, alice, bob, carol, UUPS_proxy_deploy_and_initialize):
    term_event_emitter = setup_protocol["eventEmitter"]
    termInitializer = setup_protocol["termInitializer"]
    term_contract_role = web3.keccak(text="TERM_CONTRACT")

    # Alice is now a term contract
    tx = term_event_emitter.pairTermContract(alice, {"from": termInitializer})

    assert tx.events[0].address == term_event_emitter
    assert tx.events[0].name == "RoleGranted"
    assert tx.events[0]["role"] == term_contract_role.hex()
    assert tx.events[0]["account"] == alice
    assert tx.events[0]["sender"] == termInitializer

    termRepoId = web3.keccak(text="termRepoId")
    termAuctionId = web3.keccak(text="termAuctionId")
    termAuction = carol
    auctionEndTime = chain.time() + 600

    # Bob is not a contract
    with reverts():
        tx = term_event_emitter.emitTermAuctionInitialized(
            termRepoId, termAuctionId, termAuction, auctionEndTime, "version", {"from": bob}
        )

    # But Alice is
    tx = term_event_emitter.emitTermAuctionInitialized(
        termRepoId, termAuctionId, termAuction, auctionEndTime, "version", {"from": alice}
    )

    assert tx.events[0].address == term_event_emitter
    assert tx.events[0].name == "TermAuctionInitialized"
    assert tx.events[0]["termRepoId"] == termRepoId.hex()
    assert tx.events[0]["termAuctionId"] == termAuctionId.hex()
    assert tx.events[0]["termAuction"] == termAuction
    assert tx.events[0]["auctionEndTime"] == auctionEndTime
    assert tx.events[0]["version"] == "version"
