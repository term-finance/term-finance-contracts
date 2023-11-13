"""
✅ test done and should pass
⛔ test done but there's an issue
❎ test not required or n/a

External Functions:
initialize ✅
pairTermContracts ✅
lockOffer ✅
lockOffers ✅
lockedOffer ✅
revealOffer ✅
revealOffers ✅
unlockOffer ⛔
unlockOffers ⛔
getAllOffers ✅
unlockOfferPartial
pauseLocking ✅
unpauseLocking ✅
pauseUnlocking ✅
unpauseUnlocking ✅

Internal Functions:
_lock ✅
_unlock ⛔
_processOfferForAuction ✅
_revealOffer ✅
_quickSortOffers
_authorizeUpgrade ❎

Modifiers:
onlyWhileAuctionOpen ✅
onlyWhileAuctionRevealing ✅ (test_revealOffer)
onlyAuthenticated ✅
onlyOfferor ✅
onlyExistingOffer ✅ (test_unlockOffer)
whenLockingNotPaused ✅
whenUnlockingNotPaused ✅
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

from eth_abi import encode_abi
from eth_abi.packed import encode_abi_packed
from helpers import make_term_auth, make_term_auth_no_sig, custom_error


def test_initialize(setup_protocol, owner, alice):
    TermAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    usdc = setup_protocol["usdc"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]

    assert (
        TermAuctionOfferLocker.termRepoId()
        == web3.keccak(encode_abi_packed(["string"], ["TestTermRepo"])).hex()
    )
    assert (
        TermAuctionOfferLocker.termAuctionId()
        == web3.keccak(encode_abi_packed(["string"], ["TestTermAuction"])).hex()
    )

    chain_time = TermAuctionOfferLocker.auctionStartTime() + 60

    assert TermAuctionOfferLocker.revealTime() == chain_time + 86400
    assert TermAuctionOfferLocker.auctionEndTime() == chain_time + 600
    assert TermAuctionOfferLocker.minimumTenderAmount() == 10
    assert TermAuctionOfferLocker.purchaseToken() == usdc
    assert TermAuctionOfferLocker.collateralTokens(wbtc) == True
    assert TermAuctionOfferLocker.collateralTokens(weth) == True
    assert TermAuctionOfferLocker.collateralTokens(usdc) == False


def test_pairTermContracts(setup_protocol, owner, alice):
    TermAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]

    assert TermAuctionOfferLocker.termRepoServicer() == setup_protocol["termRepoServicer"]


def test_lockOffer(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # confirm the events
    assert tx.events[0].address == usdc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == offer_amount

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferLockedByServicer"
    assert tx.events[1]["offeror"] == alice
    assert tx.events[1]["termRepoId"] == termRepoId
    assert tx.events[1]["amount"] == offer_amount

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferLocked"
    assert tx.events[2]["termAuctionId"] == auction_id
    assert tx.events[2]["id"] == offer_id
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[2]["amount"] == offer_amount
    assert tx.events[2]["token"] == usdc

    # Now increase the offer
    offer_amount2 = 75

    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount2,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # confirm the events
    assert tx.events[0].address == usdc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == offer_amount2 - offer_amount

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferLockedByServicer"
    assert tx.events[1]["offeror"] == alice
    assert tx.events[1]["termRepoId"] == termRepoId
    assert tx.events[1]["amount"] == offer_amount2 - offer_amount

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferLocked"
    assert tx.events[2]["termAuctionId"] == auction_id
    assert tx.events[2]["id"] == offer_id
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[2]["amount"] == offer_amount2
    assert tx.events[2]["token"] == usdc

    # Now decrease the offer
    offer_amount3 = 50

    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount3,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 3
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # confirm the events
    assert tx.events[0].address == usdc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == termRepoLocker
    assert tx.events[0]["to"] == alice
    assert tx.events[0]["value"] == offer_amount2 - offer_amount3

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferUnlockedByServicer"
    assert tx.events[1]["offeror"] == alice
    assert tx.events[1]["termRepoId"] == termRepoId
    assert tx.events[1]["amount"] == offer_amount2 - offer_amount3

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferLocked"
    assert tx.events[2]["termAuctionId"] == auction_id
    assert tx.events[2]["id"] == offer_id
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[2]["amount"] == offer_amount3
    assert tx.events[2]["token"] == usdc


@pytest.mark.skip(reason="Due to number of offer submissions, this takes way too long to execute.")
def test_lockOffers_max(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100_000_000, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100_000_000, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    MAX_OFFER_COUNT = 1000
    for i in range(0, MAX_OFFER_COUNT):
        offer_id = web3.keccak(text="alice-offer-" + str(i))
        offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
        offer_submission = [
            offer_id,
            alice.address,
            offer_price_hash,
            offer_amount,
            usdc,
        ]

        # Create the authentication token (address user, uint256 nonce, bytes signature)
        # nonce = i
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionOfferLocker.address
        # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
        # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
        # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

        if i == MAX_OFFER_COUNT:
            with reverts(custom_error("MaxOfferCountReached()")):
                tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
        else:
            tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})


def test_lockOffer_reverts(setup_protocol, constants, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # Wrong purchase token
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        wbtc,
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("PurchaseTokenNotApproved(address)", wbtc.address)):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})

    # Offer too low
    offer_amount = 5

    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("OfferAmountTooLow(uint256)", offer_amount)):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})

    # Offer not owned
    offer_amount = 40

    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # nonce = 3
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})

    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # nonce = 4
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("OfferNotOwned()")):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": bob})


def test_lockOffers(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    price = 258
    offer_amount1 = 40
    offer_amount2 = 55

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount1 * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="alice-offer-one")
    offer_id2 = web3.keccak(text="alice-offer-two")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission1 = [
        offer_id1,
        alice.address,
        offer_price_hash,
        offer_amount1,
        usdc,
    ]

    offer_submission2 = [
        offer_id2,
        alice.address,
        offer_price_hash,
        offer_amount2,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input([offer_submission1, offer_submission2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers(
        [offer_submission1, offer_submission2], {"from": alice}
    )
    offer_id1 = tx.events[2]["id"]
    offer_id2 = tx.events[5]["id"]

    # confirm the events
    assert tx.events[0].address == usdc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == offer_amount1

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferLockedByServicer"
    assert tx.events[1]["offeror"] == alice
    assert tx.events[1]["termRepoId"] == termRepoId
    assert tx.events[1]["amount"] == offer_amount1

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferLocked"
    assert tx.events[2]["termAuctionId"] == auction_id
    assert tx.events[2]["id"] == offer_id1
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[2]["amount"] == offer_amount1
    assert tx.events[2]["token"] == usdc

    assert tx.events[3].address == usdc
    assert tx.events[3].name == "Transfer"
    assert tx.events[3]["from"] == alice
    assert tx.events[3]["to"] == termRepoLocker
    assert tx.events[3]["value"] == offer_amount2

    assert tx.events[4].address == eventEmitter
    assert tx.events[4].name == "OfferLockedByServicer"
    assert tx.events[4]["offeror"] == alice
    assert tx.events[4]["termRepoId"] == termRepoId
    assert tx.events[4]["amount"] == offer_amount2

    assert tx.events[5].address == eventEmitter
    assert tx.events[5].name == "OfferLocked"
    assert tx.events[5]["termAuctionId"] == auction_id
    assert tx.events[5]["id"] == offer_id2
    assert tx.events[5]["offeror"] == alice
    assert tx.events[5]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[5]["amount"] == offer_amount2
    assert tx.events[5]["token"] == usdc


def test_lockOffersWithReferral(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    price = 258
    offer_amount1 = 40
    offer_amount2 = 55

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount1 * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="alice-offer-one")
    offer_id2 = web3.keccak(text="alice-offer-two")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission1 = [
        offer_id1,
        alice.address,
        offer_price_hash,
        offer_amount1,
        usdc,
    ]

    offer_submission2 = [
        offer_id2,
        alice.address,
        offer_price_hash,
        offer_amount2,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffersWithReferral.encode_input([offer_submission1, offer_submission2], alice.address, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("InvalidSelfReferral()")):
        tx = termAuctionOfferLocker.lockOffersWithReferral(
            [offer_submission1, offer_submission2], alice.address, {"from": alice}
        )

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffersWithReferral.encode_input([offer_submission1, offer_submission2], bob.address, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffersWithReferral(
        [offer_submission1, offer_submission2], bob.address, {"from": alice}
    )

    offer_id1 = tx.events[2]["id"]
    offer_id2 = tx.events[5]["id"]

    # confirm the events
    assert tx.events[0].address == usdc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == offer_amount1

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferLockedByServicer"
    assert tx.events[1]["offeror"] == alice
    assert tx.events[1]["termRepoId"] == termRepoId
    assert tx.events[1]["amount"] == offer_amount1

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferLocked"
    assert tx.events[2]["termAuctionId"] == auction_id
    assert tx.events[2]["id"] == offer_id1
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[2]["amount"] == offer_amount1
    assert tx.events[2]["token"] == usdc

    assert tx.events[3].address == usdc
    assert tx.events[3].name == "Transfer"
    assert tx.events[3]["from"] == alice
    assert tx.events[3]["to"] == termRepoLocker
    assert tx.events[3]["value"] == offer_amount2

    assert tx.events[4].address == eventEmitter
    assert tx.events[4].name == "OfferLockedByServicer"
    assert tx.events[4]["offeror"] == alice
    assert tx.events[4]["termRepoId"] == termRepoId
    assert tx.events[4]["amount"] == offer_amount2

    assert tx.events[5].address == eventEmitter
    assert tx.events[5].name == "OfferLocked"
    assert tx.events[5]["termAuctionId"] == auction_id
    assert tx.events[5]["id"] == offer_id2
    assert tx.events[5]["offeror"] == alice
    assert tx.events[5]["offerPrice"] == offer_price_hash.hex()
    assert tx.events[5]["amount"] == offer_amount2
    assert tx.events[5]["token"] == usdc


def test_lockedOffer(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    offer = termAuctionOfferLocker.lockedOffer(offer_id, {"from": alice})

    assert offer[0] == offer_id
    assert offer[1] == alice
    assert offer[2] == offer_price_hash.hex()
    assert offer[3] == 0
    assert offer[4] == offer_amount
    assert offer[5] == usdc
    assert offer[6] == False


def test_revealOffer(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_nonce = 1337
    offer_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, offer_nonce]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # reveal too soon (tests onlyWhileAuctionRevealing)
    with reverts(custom_error("AuctionNotRevealing()")):
        tx = termAuctionOfferLocker.revealOffers([offer_id], [price], [offer_nonce], {"from": alice})

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # price is wrong
    with reverts(custom_error("OfferPriceModified()")):
        tx = termAuctionOfferLocker.revealOffers([offer_id], [price + 1], [offer_nonce], {"from": alice})

    tx = termAuctionOfferLocker.revealOffers([offer_id], [price], [offer_nonce], {"from": alice})

    # confirm the event
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferRevealed"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == offer_id
    assert tx.events[0]["offerPrice"] == price


def test_revealOffer_high_price(setup_protocol, constants, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = constants.MAX_OFFER_PRICE + 1

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_nonce = 1337
    offer_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, offer_nonce]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # price is wrong
    with reverts(
        custom_error("TenderPriceTooHigh(bytes32,uint256)", [offer_id, constants.MAX_OFFER_PRICE])
    ):
        tx = termAuctionOfferLocker.revealOffers([offer_id], [price], [offer_nonce], {"from": alice})


def test_revealOffers(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount1 = 40
    price1 = 258
    offer_amount2 = 65
    price2 = 3841384

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount1 * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="alice-offer-one")
    offer_nonce1 = 1337
    offer_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [price1, offer_nonce1]))
    offer_submission1 = [
        offer_id1,
        alice.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]
    offer_id2 = web3.keccak(text="alice-offer-two")
    offer_nonce2 = 31337
    offer_price_hash2 = web3.keccak(encode_abi(["uint256", "uint256"], [price2, offer_nonce2]))
    offer_submission2 = [
        offer_id2,
        alice.address,
        offer_price_hash2,
        offer_amount2,
        usdc,
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission1, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": alice})
    offer_id1 = tx.events[2]["id"]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission2, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission2], {"from": alice})
    offer_id2 = tx.events[2]["id"]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    tx = termAuctionOfferLocker.revealOffers(
        [offer_id1, offer_id2], [price1, price2], [offer_nonce1, offer_nonce2], {"from": alice}
    )

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferRevealed"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == offer_id1
    assert tx.events[0]["offerPrice"] == price1

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "OfferRevealed"
    assert tx.events[1]["termAuctionId"] == auction_id
    assert tx.events[1]["id"] == offer_id2
    assert tx.events[1]["offerPrice"] == price2


# @pytest.mark.xfail(reason="Not returning tokens")
def test_unlockOffer(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    offer_id_nonexistent = web3.keccak(text="offer-nonexistent")

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffer.encode_input(offer_id_nonexistent, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Non existent offer (tests onlyExistingOffer)
    with reverts(custom_error("NonExistentOffer(bytes32)", offer_id_nonexistent)):
        tx = termAuctionOfferLocker.unlockOffers([offer_id_nonexistent], {"from": alice})

    # nonce = 3
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffer.encode_input(offer_id, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.unlockOffers([offer_id], {"from": alice})
    print(tx.info())

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferUnlocked"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == offer_id

    assert tx.events[1].address == usdc
    assert tx.events[1].name == "Transfer"
    assert tx.events[1]["from"] == termRepoLocker
    assert tx.events[1]["to"] == alice
    assert tx.events[1]["value"] == offer_amount

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferUnlockedByServicer"
    assert tx.events[2]["termRepoId"] == termRepoId
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["amount"] == offer_amount


# @pytest.mark.xfail(reason="Not returning tokens")
def test_unlockOffers(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount1 = 40
    price1 = 258
    offer_amount2 = 65
    price2 = 3841384

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount1 * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="alice-offer-one")
    offer_price_hash1 = web3.keccak(encode_abi(["uint256"], [price1]))
    offer_submission1 = [
        offer_id1,
        alice.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]
    offer_id2 = web3.keccak(text="alice-offer-two")
    offer_price_hash2 = web3.keccak(encode_abi(["uint256"], [price2]))
    offer_submission2 = [
        offer_id2,
        alice.address,
        offer_price_hash2,
        offer_amount2,
        usdc,
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission1, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": alice})
    offer_id1 = tx.events[2]["id"]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission2, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers([offer_submission2], {"from": alice})
    offer_id2 = tx.events[2]["id"]

    offer_id_nonexistent = web3.keccak(text="offer-nonexistent")

    # nonce = 3
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffers.encode_input([offer_id_nonexistent], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("NonExistentOffer(bytes32)", offer_id_nonexistent)):
        tx = termAuctionOfferLocker.unlockOffers([offer_id_nonexistent], {"from": alice})

    # nonce = 4
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffers.encode_input([offer_id1, offer_id2], termAuth_nosig)
    # term_auth_bob = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("OfferNotOwned()")):
        tx = termAuctionOfferLocker.unlockOffers(
            [offer_id1, offer_id2], {"from": bob}
        )

    # nonce = 5
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffers.encode_input([offer_id1, offer_id2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.unlockOffers([offer_id1, offer_id2], {"from": alice})

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferUnlocked"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == offer_id1

    assert tx.events[1].address == usdc
    assert tx.events[1].name == "Transfer"
    assert tx.events[1]["from"] == termRepoLocker
    assert tx.events[1]["to"] == alice
    assert tx.events[1]["value"] == offer_amount1

    assert tx.events[2].address == eventEmitter
    assert tx.events[2].name == "OfferUnlockedByServicer"
    assert tx.events[2]["termRepoId"] == termRepoId
    assert tx.events[2]["offeror"] == alice
    assert tx.events[2]["amount"] == offer_amount1

    assert tx.events[3].address == eventEmitter
    assert tx.events[3].name == "OfferUnlocked"
    assert tx.events[3]["termAuctionId"] == auction_id
    assert tx.events[3]["id"] == offer_id2

    assert tx.events[4].address == usdc
    assert tx.events[4].name == "Transfer"
    assert tx.events[4]["from"] == termRepoLocker
    assert tx.events[4]["to"] == alice
    assert tx.events[4]["value"] == offer_amount2

    assert tx.events[5].address == eventEmitter
    assert tx.events[5].name == "OfferUnlockedByServicer"
    assert tx.events[5]["termRepoId"] == termRepoId
    assert tx.events[5]["offeror"] == alice
    assert tx.events[5]["amount"] == offer_amount2


def test_pausing(setup_protocol, owner, alice, devOps):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Test pauseLocking()
    tx = termAuctionOfferLocker.pauseLocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferLockingPaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionOfferLocker.lockingPaused() == True

    # Locking a offer should fail
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("LockingPaused()")):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})

    # Test unpauseLocking()
    tx = termAuctionOfferLocker.unpauseLocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferLockingUnpaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionOfferLocker.lockingPaused() == False

    # We should now be able to lock our offer
    tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})
    offer_id = tx.events[2]["id"]

    # Test pauseUnlocking()
    tx = termAuctionOfferLocker.pauseUnlocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferUnlockingPaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionOfferLocker.unlockingPaused() == True

    # Unlocking a offer should fail
    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.unlockOffer.encode_input(offer_id, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("UnlockingPaused()")):
        tx = termAuctionOfferLocker.unlockOffers([offer_id], {"from": alice})

    # Test unpauseUnlocking()
    tx = termAuctionOfferLocker.unpauseUnlocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "OfferUnlockingUnpaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionOfferLocker.unlockingPaused() == False

    # We should now be able to unlock our offer
    tx = termAuctionOfferLocker.unlockOffers([offer_id], {"from": alice})


def test_onlyWhileAuctionOpen(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    with reverts(custom_error("AuctionNotOpen()")):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": alice})

## 23/10/2023 - not in use

# def test_onlyAuthenticated(setup_protocol, owner, alice, bob):
#     auction = setup_protocol["auction"]
#     termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
#     termRepoLocker = setup_protocol["termRepoLocker"]
#     eventEmitter = setup_protocol["eventEmitter"]
#     usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

#     offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
#     price = 258

#     auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
#     termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

#     # Give alice some purchase token
#     usdc.transfer(alice, offer_amount * 100, {"from": owner})
#     # allow transfer by the locker
#     usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

#     # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
#     offer_id = web3.keccak(text="alice-offer-one")
#     offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
#     offer_submission = [
#         offer_id,
#         alice.address,
#         offer_price_hash,
#         offer_amount,
#         usdc,
#     ]

#     nonce = 1
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionOfferLocker.address
#     termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
#     term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)
#     # Modify the term_auth token to be invalid
#     term_auth[0] = alice

#     with reverts(custom_error("InvalidSignature()")):
#         tx = termAuctionOfferLocker.lockOffer(offer_submission, term_auth, {"from": alice})


def test_onlyOfferor(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give alice some purchase token
    usdc.transfer(alice, offer_amount * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, offer_amount * 100, {"from": alice})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id = web3.keccak(text="alice-offer-one")
    offer_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    offer_submission = [
        offer_id,
        alice.address,
        offer_price_hash,
        offer_amount,
        usdc,
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("OfferNotOwned()")):
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": bob})


def test_getAllOffers(setup_protocol, constants, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    offer_amounts = [600, 601, 602, 603, 604, 605, 606, 607, 608, 609]
    offer_prices = [5, 2, 6, 4, 7, 8, 1, 9, 3, 0]
    offer_prices = [x * 10**9 for x in offer_prices]
    offer_prices.sort()
    offer_nonces = [x * 1337 for x in offer_prices]

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # Give users some purchase token
    usdc.transfer(alice, 10_000 * 10**6, {"from": owner})
    usdc.transfer(bob, 10_000 * 10**6, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_ids = [web3.keccak(text="alice-offer-" + str(x + 1)) for x in range(len(offer_prices))]
    offer_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(offer_prices, offer_nonces)]

    offer_submissions = [
        [
            offer_ids[i],
            alice.address,
            offer_price_hashes[i],
            offer_amounts[i],
            usdc,
        ]
        for i in range(len(offer_prices))
    ]

    bob_offer_ids = [web3.keccak(text="bob-offer-" + str(x + 1)) for x in range(len(offer_prices))]
    bob_offer_submissions = [
        [
            bob_offer_ids[i],
            bob.address,
            offer_price_hashes[i],
            offer_amounts[i],
            usdc,
        ]
        for i in range(len(offer_prices))
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input(offer_submissions, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers(offer_submissions, {"from": alice})
    offer_ids = []
    i = 2
    for offer_submission in offer_submissions:
        offer_ids.append(tx.events[i]["id"])
        i += 3

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input(bob_offer_submissions, termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionOfferLocker.lockOffers(bob_offer_submissions, {"from": bob})
    bob_offer_ids = []
    i = 2
    for offer_submission in bob_offer_submissions:
        bob_offer_ids.append(tx.events[i]["id"])
        i += 3

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # We only reveal alice's offers
    tx = termAuctionOfferLocker.revealOffers(offer_ids, offer_prices, offer_nonces, {"from": alice})

    # Wrong user
    with reverts():
        tx = termAuctionOfferLocker.getAllOffers(offer_ids, bob_offer_ids, {"from": alice})

    # Not all the offers
    with reverts(custom_error("OfferCountIncorrect(uint256)", len(offer_ids) + len(bob_offer_ids))):
        tx = termAuctionOfferLocker.getAllOffers(offer_ids, [], {"from": auction})

    # Nonexistent offers
    nonexistent_offer_ids = [
        web3.keccak(text="nonexistent-offer-" + str(x + 1)) for x in range(len(offer_prices))
    ]
    with reverts(custom_error("NonExistentOffer(bytes32)", nonexistent_offer_ids[0])):
        tx = termAuctionOfferLocker.getAllOffers(
            offer_ids, nonexistent_offer_ids, {"from": auction}
        )
    with reverts(custom_error("NonExistentOffer(bytes32)", nonexistent_offer_ids[0])):
        tx = termAuctionOfferLocker.getAllOffers(
            nonexistent_offer_ids, bob_offer_ids, {"from": auction}
        )

    # Unrevealed offer submitted as revealed
    with reverts(custom_error("OfferNotRevealed(bytes32)", bob_offer_ids[0])):
        tx = termAuctionOfferLocker.getAllOffers(bob_offer_ids, offer_ids, {"from": auction})

    # Revealed offer submitted as unrevealed
    with reverts(custom_error("OfferRevealed(bytes32)", offer_ids[8])):
        tx = termAuctionOfferLocker.getAllOffers(offer_ids[0:8], offer_ids[8:10]+bob_offer_ids, {"from": auction})

    # Before, we have stored offers
    offer = termAuctionOfferLocker.lockedOffer(offer_ids[4], {"from": alice})
    assert offer[0] == offer_ids[4]
    assert offer[1] == alice
    assert offer[2] == offer_price_hashes[4].hex()

    offer = termAuctionOfferLocker.lockedOffer(bob_offer_ids[6], {"from": alice})
    assert offer[0] == bob_offer_ids[6]
    assert offer[1] == bob
    assert offer[2] == offer_price_hashes[6].hex()

    # Call from the auction contract
    tx = termAuctionOfferLocker.getAllOffers(offer_ids, bob_offer_ids, {"from": auction})
    print(tx.info())

    # After, the offers are all blank
    offer = termAuctionOfferLocker.lockedOffer(offer_ids[4], {"from": alice})
    assert offer[0] == hex(0)
    assert offer[1] == constants.ZERO_ADDRESS
    assert offer[2] == hex(0)

    offer = termAuctionOfferLocker.lockedOffer(bob_offer_ids[6], {"from": alice})
    assert offer[0] == hex(0)
    assert offer[1] == constants.ZERO_ADDRESS
    assert offer[2] == hex(0)
