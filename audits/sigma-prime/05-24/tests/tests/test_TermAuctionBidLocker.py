"""
✅ test done and should pass
⛔ test done but there's an issue
❎ test not required or n/a

External Functions:
initialize ✅
pairTermContracts ✅
pairRolloverManager ✅
lockBid ✅
lockRolloverBid
lockBids ✅
lockedBid ✅
revealBid ✅
revealBids ✅
unlockBid ✅
unlockBids ✅
getAllBids ⛔
auctionUnlockBid ✅
isAuctionBidLocker ✅
pauseLocking ✅
unpauseLocking ✅
pauseUnlocking ✅
unpauseUnlocking ✅

Internal Functions:
_lock ✅
_lockRolloverBid
_unlock ✅
_revealBid ✅
_processRevealedBidsForShortfall
_isInInitialCollateralShortFall ✅
_fillRevealedBidsForAuctionClearing
_processBidForAuction
_quickSortBids
_authorizeUpgrade ❎

Modifiers:
onlyWhileAuctionOpen ✅
onlyWhileAuctionRevealing ✅
onlyAuthenticated ✅
onlyBidder ✅
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
import random

from eth_abi import encode_abi
from eth_abi.packed import encode_abi_packed
from helpers import make_term_auth, make_term_auth_no_sig, custom_error


def test_initialize(setup_protocol, constants, owner, devOps, controllerAdmin):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termInitializer = setup_protocol["termInitializer"]
    usdc = setup_protocol["usdc"]
    wbtc = setup_protocol["wbtc"]
    weth = setup_protocol["weth"]
    maturityTimestamp = setup_protocol["maturityTimestamp"]

    assert (
        termAuctionBidLocker.termRepoId()
        == web3.keccak(encode_abi_packed(["string"], ["TestTermRepo"])).hex()
    )
    assert (
        termAuctionBidLocker.termAuctionId()
        == web3.keccak(encode_abi_packed(["string"], ["TestTermAuction"])).hex()
    )

    chain_time = termAuctionBidLocker.auctionStartTime() + 60

    auctionEndTime = termAuctionBidLocker.auctionEndTime()
    assert termAuctionBidLocker.revealTime() == chain_time + 86400
    assert auctionEndTime == chain_time + 600
    assert termAuctionBidLocker.minimumTenderAmount() == 10
    assert termAuctionBidLocker.dayCountFractionMantissa() == (maturityTimestamp - auctionEndTime) * 10**18 // (
        60 * 60 * 24 * 360
    )
    assert termAuctionBidLocker.purchaseToken() == usdc
    assert termAuctionBidLocker.collateralTokens(wbtc) == True
    assert termAuctionBidLocker.collateralTokens(weth) == True
    assert termAuctionBidLocker.collateralTokens(usdc) == False

    # Printing role admins
    # print(termAuctionBidLocker.getRoleAdmin(0x00))
    # print(termAuctionBidLocker.getRoleAdmin(constants.ADMIN_ROLE))
    # print(termAuctionBidLocker.getRoleAdmin(constants.DEVOPS_ROLE))
    # print(termAuctionBidLocker.getRoleAdmin(constants.INITIALIZER_ROLE))


def test_pairTermContracts(setup_protocol):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]

    assert (
        termAuctionBidLocker.termRepoCollateralManager()
        == setup_protocol["termRepoCollateralManager"]
    )


def test_pairRolloverManager(setup_protocol, constants, owner, alice):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    rolloverManager = setup_protocol["rolloverManager"]

    assert termAuctionBidLocker.hasRole(constants.ROLLOVER_MANAGER, alice) == False

    termAuctionBidLocker.pairRolloverManager(alice, {"from": owner})

    assert termAuctionBidLocker.hasRole(constants.ROLLOVER_MANAGER, alice) == True


# Does not exist anymore...
# def test_isAuctionBidLocker(setup_protocol, owner, alice):
#     termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
#
#     assert termAuctionBidLocker.isAuctionBidLocker() == True


## 23/10/2023 "lockBid()" doesn't exist anymore...
#
# def test_lockBid(setup_protocol, owner, alice):
#     auction = setup_protocol["auction"]
#     termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
#     termRepoLocker = setup_protocol["termRepoLocker"]
#     eventEmitter = setup_protocol["eventEmitter"]
#     usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
#     wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

#     bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
#     price = 258
#     collateral_amount = bid_amount * 100_000

#     # Give alice some collateral
#     wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
#     # allow transfer by the locker
#     wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

#     # The bid submission struct (lib/TermAuctionBidSubmission.sol)
#     bid_id = web3.keccak(text="alice-bid-one")
#     bid_nonce = 1337
#     bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     # Create the authentication token (address user, uint256 nonce, bytes signature)
#     # nonce = 1
#     # expirationTimestamp = chain.time() + 300    # + 5m
#     # txContract = termAuctionBidLocker.address
#     # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     tx = termAuctionBidLocker.lockBid(bid_submission, {"from": alice})

#     # confirm the events
#     assert tx.events[0].address == wbtc
#     assert tx.events[0].name == "Transfer"
#     assert tx.events[0]["from"] == alice
#     assert tx.events[0]["to"] == termRepoLocker
#     assert tx.events[0]["value"] == collateral_amount

#     # assert tx.events[1].address == eventEmitter
#     # assert tx.events[1].name == "CollateralLocked"
#     # assert tx.events[1]["borrower"] == alice
#     # assert tx.events[1]["collateralToken"] == wbtc
#     # assert tx.events[1]["amount"] == collateral_amount

#     assert tx.events[1].address == eventEmitter
#     assert tx.events[1].name == "BidLocked"
#     assert tx.events[1]["bidder"] == alice
#     assert tx.events[1]["token"] == usdc
#     assert tx.events[1]["amount"] == bid_amount
#     assert tx.events[1]["collateralTokens"][0] == wbtc
#     assert tx.events[1]["collateralAmounts"][0] == collateral_amount

#     # Now increase the bid
#     bid_amount2 = 75
#     collateral_amount2 = bid_amount2 * 100_000

#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount2,
#         [collateral_amount2],
#         usdc,
#         [wbtc],
#     ]

#     # Create the authentication token (address user, uint256 nonce, bytes signature)
#     # nonce = 2
#     # expirationTimestamp = chain.time() + 300    # + 5m
#     # txContract = termAuctionBidLocker.address
#     # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     tx = termAuctionBidLocker.lockBid(bid_submission, {"from": alice})

#     # confirm the events
#     assert tx.events[0].address == wbtc
#     assert tx.events[0].name == "Transfer"
#     assert tx.events[0]["from"] == alice
#     assert tx.events[0]["to"] == termRepoLocker
#     assert tx.events[0]["value"] == collateral_amount2

#     # assert tx.events[1].address == eventEmitter
#     # assert tx.events[1].name == "CollateralLocked"
#     # assert tx.events[1]["borrower"] == alice
#     # assert tx.events[1]["collateralToken"] == wbtc
#     # assert tx.events[1]["amount"] == collateral_amount2 - collateral_amount

#     assert tx.events[1].address == eventEmitter
#     assert tx.events[1].name == "BidLocked"
#     assert tx.events[1]["bidder"] == alice
#     assert tx.events[1]["token"] == usdc
#     assert tx.events[1]["amount"] == bid_amount2
#     assert tx.events[1]["collateralTokens"][0] == wbtc
#     assert tx.events[1]["collateralAmounts"][0] == collateral_amount2

#     # Now decrease the bid
#     bid_amount3 = 50
#     collateral_amount3 = bid_amount3 * 100_000

#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount3,
#         [collateral_amount3],
#         usdc,
#         [wbtc],
#     ]

#     # Create the authentication token (address user, uint256 nonce, bytes signature)
#     # nonce = 3
#     # expirationTimestamp = chain.time() + 300    # + 5m
#     # txContract = termAuctionBidLocker.address
#     # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     tx = termAuctionBidLocker.lockBid(bid_submission, {"from": alice})

#     # confirm the events
#     assert tx.events[0].address == wbtc
#     assert tx.events[0].name == "Transfer"
#     assert tx.events[0]["from"] == alice
#     assert tx.events[0]["to"] == termRepoLocker
#     assert tx.events[0]["value"] == collateral_amount3
#     #
#     # assert tx.events[1].address == eventEmitter
#     # assert tx.events[1].name == "CollateralUnlocked"
#     # assert tx.events[1]["borrower"] == alice
#     # assert tx.events[1]["collateralToken"] == wbtc
#     # assert tx.events[1]["amount"] == collateral_amount2 - collateral_amount3

#     assert tx.events[1].address == eventEmitter
#     assert tx.events[1].name == "BidLocked"
#     assert tx.events[1]["bidder"] == alice
#     assert tx.events[1]["token"] == usdc
#     assert tx.events[1]["amount"] == bid_amount3
#     assert tx.events[1]["collateralTokens"][0] == wbtc
#     assert tx.events[1]["collateralAmounts"][0] == collateral_amount3


# def test_lockBid_reverts(setup_protocol, owner, alice, bob):
#     auction = setup_protocol["auction"]
#     termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
#     termRepoLocker = setup_protocol["termRepoLocker"]
#     usdc = setup_protocol["usdc"]
#     wbtc = setup_protocol["wbtc"]
#     weth = setup_protocol["weth"]

#     bid_amount = 4_000
#     price = 258
#     collateral_amount = bid_amount * 100_000

#     wbtc.transfer(alice, collateral_amount, {"from": owner})
#     wbtc.approve(termRepoLocker, collateral_amount, {"from": alice})

#     bid_id = web3.keccak(text="alice-bid-one")
#     bid_nonce = 1337
#     bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))

#     # Not enough collateral
#     collateral_amount = 1
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     nonce = 1
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     with reverts(custom_error("CollateralAmountTooLow")):
#         termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     collateral_amount = bid_amount * 100_000

#     # Wrong purchase token
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         weth,
#         [wbtc],
#     ]

#     nonce = 2
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     with reverts(custom_error("PurchaseTokenNotApproved(address)", weth.address)):
#         termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     # Wrong collateral token
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [usdc],
#     ]

#     nonce = 3
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     with reverts(custom_error("CollateralTokenNotApproved(address)", usdc.address)):
#         termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     # bid too low
#     bid_amount = 4
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     nonce = 4
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     with reverts(custom_error("BidAmountTooLow(uint256)", bid_amount)):
#         termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     bid_amount = 40

#     # bid not owned
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     nonce = 5
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     nonce = 6
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     with reverts(custom_error("BidNotOwned")):
#         termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": bob})


def test_lockBids(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount1 = 40
    collateral_amount1 = bid_amount1 * 100_000
    bid_amount2 = 55
    collateral_amount2 = bid_amount2 * 100_000
    price = 258

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount1 * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash,
        bid_amount1,
        [collateral_amount1],
        usdc,
        [wbtc],
    ]
    bid_submission2 = [
        bid_id2,
        alice.address,
        bid_price_hash,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1, bid_submission2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids(
        [bid_submission1, bid_submission2], {"from": alice}
    )

    # confirm the events
    assert tx.events[0].address == wbtc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == collateral_amount1

    # assert tx.events[1].address == eventEmitter
    # assert tx.events[1].name == "CollateralLocked"
    # assert tx.events[1]["borrower"] == alice
    # assert tx.events[1]["collateralToken"] == wbtc
    # assert tx.events[1]["amount"] == collateral_amount1

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "BidLocked"
    assert tx.events[1]["bidder"] == alice
    assert tx.events[1]["token"] == usdc
    assert tx.events[1]["amount"] == bid_amount1
    assert tx.events[1]["collateralTokens"][0] == wbtc
    assert tx.events[1]["collateralAmounts"][0] == collateral_amount1

    assert tx.events[2].address == wbtc
    assert tx.events[2].name == "Transfer"
    assert tx.events[2]["from"] == alice
    assert tx.events[2]["to"] == termRepoLocker
    assert tx.events[2]["value"] == collateral_amount2

    # assert tx.events[4].address == eventEmitter
    # assert tx.events[4].name == "CollateralLocked"
    # assert tx.events[4]["borrower"] == alice
    # assert tx.events[4]["collateralToken"] == wbtc
    # assert tx.events[4]["amount"] == collateral_amount2

    assert tx.events[3].address == eventEmitter
    assert tx.events[3].name == "BidLocked"
    assert tx.events[3]["bidder"] == alice
    assert tx.events[3]["token"] == usdc
    assert tx.events[3]["amount"] == bid_amount2
    assert tx.events[3]["collateralTokens"][0] == wbtc
    assert tx.events[3]["collateralAmounts"][0] == collateral_amount2


def test_lockBidsWithReferral(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount1 = 40
    collateral_amount1 = bid_amount1 * 100_000
    bid_amount2 = 55
    collateral_amount2 = bid_amount2 * 100_000
    price = 258

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount1 * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash,
        bid_amount1,
        [collateral_amount1],
        usdc,
        [wbtc],
    ]
    bid_submission2 = [
        bid_id2,
        alice.address,
        bid_price_hash,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBidsWithReferral.encode_input([bid_submission1, bid_submission2], alice.address, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("InvalidSelfReferral()")):
        tx = termAuctionBidLocker.lockBidsWithReferral(
            [bid_submission1, bid_submission2], alice.address, {"from": alice}
        )

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBidsWithReferral.encode_input([bid_submission1, bid_submission2], bob.address, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBidsWithReferral(
        [bid_submission1, bid_submission2], bob.address, {"from": alice}
    )

    # confirm the events
    assert tx.events[0].address == wbtc
    assert tx.events[0].name == "Transfer"
    assert tx.events[0]["from"] == alice
    assert tx.events[0]["to"] == termRepoLocker
    assert tx.events[0]["value"] == collateral_amount1

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "BidLocked"
    assert tx.events[1]["bidder"] == alice
    assert tx.events[1]["token"] == usdc
    assert tx.events[1]["amount"] == bid_amount1
    assert tx.events[1]["collateralTokens"][0] == wbtc
    assert tx.events[1]["collateralAmounts"][0] == collateral_amount1

    assert tx.events[2].address == wbtc
    assert tx.events[2].name == "Transfer"
    assert tx.events[2]["from"] == alice
    assert tx.events[2]["to"] == termRepoLocker
    assert tx.events[2]["value"] == collateral_amount2

    assert tx.events[3].address == eventEmitter
    assert tx.events[3].name == "BidLocked"
    assert tx.events[3]["bidder"] == alice
    assert tx.events[3]["token"] == usdc
    assert tx.events[3]["amount"] == bid_amount2
    assert tx.events[3]["collateralTokens"][0] == wbtc
    assert tx.events[3]["collateralAmounts"][0] == collateral_amount2


# @pytest.mark.skip(reason="Due to number of bid submissions, this takes way too long to execute.")
def test_lockBids_max(setup_protocol, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258
    collateral_amount = bid_amount * 100_000

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount * 100_000_000, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount * 100_000_000, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    MAX_BID_COUNT = 150
    for i in range(0, MAX_BID_COUNT):
        bid_id = web3.keccak(text="alice-bid-one-" + str(i))
        bid_nonce = i
        bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
        bid_submission = [
            bid_id,
            alice.address,
            bid_price_hash,
            bid_amount,
            [collateral_amount],
            usdc,
            [wbtc]
        ]

        # Create the authentication token (address user, uint256 nonce, bytes signature)
        # nonce = i
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionBidLocker.address
        # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
        # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
        # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

        if i == MAX_BID_COUNT:
            with reverts(custom_error("MaxBidCountReached()")):
                tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
        else:
            tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})


def test_lockedBid(setup_protocol, owner, alice, constants):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount = 40
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})

    bid_id = tx.events[1]["id"]
    bid = termAuctionBidLocker.lockedBid(bid_id, {"from": alice})

    assert bid[0] == bid_id
    assert bid[1] == alice
    assert bid[2] == bid_price_hash.hex()
    assert bid[3] == 0
    assert bid[4] == bid_amount
    assert bid[5][0] == collateral_amount
    assert bid[6] == usdc
    assert bid[7][0] == wbtc
    assert bid[8] == False
    assert bid[9] == constants.ZERO_ADDRESS
    assert bid[10] == False

def test_revealBid_nonexistant_bid(setup_protocol, constants, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    nonexistant_bid_id = web3.keccak(text="foobar")
    collateral_amount = 9999999

    # hand out funds and approvals
    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    with reverts(custom_error("BidPriceModified(bytes32)", nonexistant_bid_id)):
        termAuctionBidLocker.revealBids([nonexistant_bid_id], [0], [0], {"from": alice})

def test_revealBid(setup_protocol, constants, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258
    collateral_amount = bid_amount * 100_000

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
    bid_id = tx.events[1]["id"]

    # reveal too soon
    with reverts(custom_error("AuctionNotRevealing()")):
        tx = termAuctionBidLocker.revealBids([bid_id], [price], [bid_nonce], {"from": alice})

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # price is wrong
    with reverts(custom_error("BidPriceModified(bytes32)", bid_id)):
        tx = termAuctionBidLocker.revealBids([bid_id], [price + 1], [bid_nonce], {"from": alice})

    tx = termAuctionBidLocker.revealBids([bid_id], [price], [bid_nonce], {"from": alice})

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidRevealed"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == bid_id
    assert tx.events[0]["bidPrice"] == price


def test_revealBid_high_price(setup_protocol, constants, owner, alice):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = constants.MAX_BID_PRICE + 1
    collateral_amount = bid_amount * 100_000

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
    bid_id = tx.events[1]["id"]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # price is too high
    with reverts(
        custom_error("TenderPriceTooHigh(bytes32,uint256)", [bid_id, constants.MAX_BID_PRICE])
    ):
        tx = termAuctionBidLocker.revealBids([bid_id], [price], [bid_nonce], {"from": alice})


def test_revealBids(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    price1 = 257
    price2 = 259
    bid_amount1 = 40
    collateral_amount1 = bid_amount1 * 100_000
    bid_amount2 = 55
    collateral_amount2 = bid_amount2 * 100_000

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount1 * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_nonce1 = 1337
    bid_nonce2 = 31337
    bid_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [price1, bid_nonce1]))
    bid_price_hash2 = web3.keccak(encode_abi(["uint256", "uint256"], [price2, bid_nonce2]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash1,
        bid_amount1,
        [collateral_amount1],
        usdc,
        [wbtc],
    ]
    bid_submission2 = [
        bid_id2,
        alice.address,
        bid_price_hash2,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1, bid_submission2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids(
        [bid_submission1, bid_submission2], {"from": alice}
    )
    bid_id1 = tx.events[1]["id"]
    bid_id2 = tx.events[3]["id"]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    tx = termAuctionBidLocker.revealBids([bid_id1, bid_id2], [price1, price2], [bid_nonce1, bid_nonce2], {"from": alice})


def test_unlockBid(setup_protocol, owner, alice, constants):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    bid_amount = 40
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
    bid_id = tx.events[1]["id"]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.unlockBid.encode_input(bid_id, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.unlockBids([bid_id], {"from": alice})

    # confirm the events
    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "BidUnlocked"
    assert tx.events[1]["termAuctionId"] == auction_id
    assert tx.events[1]["id"] == bid_id

    # assert tx.events[1].address == wbtc
    # assert tx.events[1].name == "Transfer"
    # assert tx.events[1]["from"] == termRepoLocker
    # assert tx.events[1]["to"] == alice
    # assert tx.events[1]["value"] == collateral_amount
    #
    # assert tx.events[2].address == eventEmitter
    # assert tx.events[2].name == "CollateralUnlocked"
    # assert tx.events[2]["termRepoId"] == termRepoId
    # assert tx.events[2]["borrower"] == alice
    # assert tx.events[2]["collateralToken"] == wbtc
    # assert tx.events[2]["amount"] == collateral_amount


def test_unlockBids(setup_protocol, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    price = 258
    bid_amount1 = 40
    collateral_amount1 = bid_amount1 * 100_000
    bid_amount2 = 55
    collateral_amount2 = bid_amount2 * 100_000

    # Give alice some collateral
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, collateral_amount1 * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash,
        bid_amount1,
        [collateral_amount1],
        usdc,
        [wbtc],
    ]
    bid_submission2 = [
        bid_id2,
        alice.address,
        bid_price_hash,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1, bid_submission2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids(
        [bid_submission1, bid_submission2], {"from": alice}
    )
    bid_id1 = tx.events[1]["id"]
    bid_id2 = tx.events[3]["id"]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.unlockBids.encode_input([bid_id1, bid_id2], termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("BidNotOwned()")):
        termAuctionBidLocker.unlockBids([bid_id1, bid_id2], {"from": bob})

    # nonce = 3
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.unlockBids.encode_input([bid_id1, bid_id2], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.unlockBids([bid_id1, bid_id2], {"from": alice})

    # confirm the events
    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "BidUnlocked"
    assert tx.events[1]["termAuctionId"] == auction_id
    assert tx.events[1]["id"] == bid_id1

    # assert tx.events[1].address == wbtc
    # assert tx.events[1].name == "Transfer"
    # assert tx.events[1]["from"] == termRepoLocker
    # assert tx.events[1]["to"] == alice
    # assert tx.events[1]["value"] == collateral_amount1
    #
    # assert tx.events[2].address == eventEmitter
    # assert tx.events[2].name == "CollateralUnlocked"
    # assert tx.events[2]["termRepoId"] == termRepoId
    # assert tx.events[2]["borrower"] == alice
    # assert tx.events[2]["collateralToken"] == wbtc
    # assert tx.events[2]["amount"] == collateral_amount1

    assert tx.events[3].address == eventEmitter
    assert tx.events[3].name == "BidUnlocked"
    assert tx.events[3]["termAuctionId"] == auction_id
    assert tx.events[3]["id"] == bid_id2

    # assert tx.events[4].address == wbtc
    # assert tx.events[4].name == "Transfer"
    # assert tx.events[4]["from"] == termRepoLocker
    # assert tx.events[4]["to"] == alice
    # assert tx.events[4]["value"] == collateral_amount2
    #
    # assert tx.events[5].address == eventEmitter
    # assert tx.events[5].name == "CollateralUnlocked"
    # assert tx.events[5]["termRepoId"] == termRepoId
    # assert tx.events[5]["borrower"] == alice
    # assert tx.events[5]["collateralToken"] == wbtc
    # assert tx.events[5]["amount"] == collateral_amount2


def test_auctionUnlockBid(setup_protocol, owner, alice, constants):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    bid_amount = 40
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
    bid_id = tx.events[1]["id"]

    tx = termAuctionBidLocker.auctionUnlockBid(
        bid_id, alice, [wbtc], [collateral_amount], {"from": auction}
    )

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidUnlocked"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["id"] == bid_id

    assert tx.events[1].address == wbtc
    assert tx.events[1].name == "Transfer"
    assert tx.events[1]["from"] == termRepoLocker
    assert tx.events[1]["to"] == alice
    assert tx.events[1]["value"] == collateral_amount

    # assert tx.events[2].address == eventEmitter
    # assert tx.events[2].name == "CollateralUnlocked"
    # assert tx.events[2]["termRepoId"] == termRepoId
    # assert tx.events[2]["borrower"] == alice
    # assert tx.events[2]["collateralToken"] == wbtc
    # assert tx.events[2]["amount"] == collateral_amount


def test_pausing(setup_protocol, owner, devOps, alice, constants):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    auction_id = termAuctionBidLocker.termAuctionId()
    termRepoId = termAuctionBidLocker.termRepoId()

    bid_amount = 40
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # Test pauseLocking()
    tx = termAuctionBidLocker.pauseLocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidLockingPaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionBidLocker.lockingPaused() == True

    # Locking a bid should fail
    nonce = 1
    expirationTimestamp = chain.time() + 300    # + 5m

    with reverts(custom_error("LockingPaused()")):
        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})

    # Test unpauseLocking()
    tx = termAuctionBidLocker.unpauseLocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidLockingUnpaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionBidLocker.lockingPaused() == False

    # We should now be able to lock our bid
    tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
    bid_id = tx.events[1]["id"]

    # Test pauseUnlocking()
    tx = termAuctionBidLocker.pauseUnlocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidUnlockingPaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionBidLocker.unlockingPaused() == True

    # Unlocking a bid should fail
    nonce = 2
    expirationTimestamp = chain.time() + 300    # + 5m

    with reverts(custom_error("UnlockingPaused()")):
        tx = termAuctionBidLocker.unlockBids([bid_id], {"from": alice})

    # Test unpauseUnlocking()
    tx = termAuctionBidLocker.unpauseUnlocking({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidUnlockingUnpaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert termAuctionBidLocker.unlockingPaused() == False

    # We should now be able to unlock our bid
    tx = termAuctionBidLocker.unlockBids([bid_id], {"from": alice})


def test_onlyWhileAuctionOpen(setup_protocol, owner, alice):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    with reverts(custom_error("AuctionNotOpen()")):
        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})


## 23/10/2023 - does not use termAuth anymore
#
# def test_onlyAuthenticated(setup_protocol, owner, alice, bob):
#     termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
#     termRepoLocker = setup_protocol["termRepoLocker"]
#     usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
#     wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

#     bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
#     price = 258
#     collateral_amount = bid_amount * 100_000

#     wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
#     wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

#     bid_id = web3.keccak(text="alice-bid-one")
#     bid_nonce = 1337
#     bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
#     bid_submission = [
#         bid_id,
#         alice.address,
#         bid_price_hash,
#         bid_amount,
#         [collateral_amount],
#         usdc,
#         [wbtc],
#     ]

#     nonce = 1
#     expirationTimestamp = chain.time() + 300    # + 5m
#     txContract = termAuctionBidLocker.address
#     termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
#     txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
#     term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

#     # Modify the term_auth token to be invalid
#     term_auth[0] = alice

#     with reverts(custom_error("InvalidSignature()")):
#         tx = termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})


def test_onlyBidder(setup_protocol, owner, alice, bob):
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_amount = 40  # The maximum amount of purchase tokens that can be borrowed
    price = 258
    collateral_amount = bid_amount * 100_000

    wbtc.transfer(alice, collateral_amount * 100, {"from": owner})
    wbtc.approve(termRepoLocker, collateral_amount * 100, {"from": alice})

    bid_id = web3.keccak(text="alice-bid-one")
    bid_nonce = 1337
    bid_price_hash = web3.keccak(encode_abi(["uint256", "uint256"], [price, bid_nonce]))
    bid_submission = [
        bid_id,
        alice.address,
        bid_price_hash,
        bid_amount,
        [collateral_amount],
        usdc,
        [wbtc],
    ]

    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    with reverts(custom_error("BidNotOwned()")):
        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": bob})

"""
This test causes problems with ganache so it is commented out.
"""
#
# def test_getAllBids(setup_protocol, constants, owner, alice, bob):
#     auction = setup_protocol["auction"]
#     termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
#     termRepoLocker = setup_protocol["termRepoLocker"]
#     eventEmitter = setup_protocol["eventEmitter"]
#     usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
#     wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

#     # Total bids will be twice this number
#     half_bid_count = 10
#     assert half_bid_count > 9

#     bid_amounts = [x for x in range(600,600+half_bid_count)]
#     collateral_amounts = [x * 1_000 for x in bid_amounts]
#     bid_prices = random.sample(range(1, half_bid_count * 10), half_bid_count)
#     bid_prices = [x * 10**9 for x in bid_prices]

#     auction_id = "0x" + termAuctionBidLocker.termAuctionId().hex()
#     termRepoId = "0x" + termAuctionBidLocker.termRepoId().hex()

#     # Give users some purchase token
#     wbtc.transfer(alice, 10_000 * 10**8, {"from": owner})
#     wbtc.transfer(bob, 10_000 * 10**8, {"from": owner})
#     # allow transfer by the locker
#     wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
#     wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

#     # The bid submission struct (lib/TermAuctionBidSubmission.sol)
#     bid_ids = [web3.keccak(text="alice-bid-" + str(x + 1)) for x in range(len(bid_prices))]
#     bid_price_hashes = [web3.keccak(encode_abi(["uint256"], [x])) for x in bid_prices]

#     bid_submissions = [
#         [
#             bid_ids[i],
#             alice.address,
#             bid_price_hashes[i],
#             bid_amounts[i],
#             [collateral_amounts[i]],
#             usdc,
#             [wbtc],
#         ]
#         for i in range(len(bid_prices))
#     ]

#     bob_bid_ids = [web3.keccak(text="bob-bid-" + str(x + 1)) for x in range(len(bid_prices))]
#     bob_bid_submissions = [
#         [
#             bob_bid_ids[i],
#             bob.address,
#             bid_price_hashes[i],
#             bid_amounts[i],
#             [collateral_amounts[i]],
#             usdc,
#             [wbtc],
#         ]
#         for i in range(len(bid_prices))
#     ]

#     # lock the bids in a loop to avoid crashing RPC
#     nonce_counter = 1
#     for bid_submission in bid_submissions:
#         term_auth = make_term_auth(alice, nonce_counter)
#         nonce_counter+=1
#         tx = termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": alice})

#     for bid_submission in bob_bid_submissions:
#         term_auth = make_term_auth(bob, nonce_counter)
#         nonce_counter+=1
#         tx = termAuctionBidLocker.lockBid(bid_submission, term_auth, {"from": bob})

#     # Advance past the reveal time
#     chain.mine(timedelta=86500)

#     # We only reveal alice's bids
#     for i in range(len(bid_ids)):
#         tx = termAuctionBidLocker.revealBid(bid_ids[i], bid_prices[i], {"from": alice})

#     # Wrong user
#     with reverts():
#         tx = termAuctionBidLocker.getAllBids(bid_ids, [], bob_bid_ids, {"from": alice})

#     # Not all the bids
#     with reverts(custom_error("BidCountIncorrect(uint256)", len(bid_ids) + len(bob_bid_ids))):
#         tx = termAuctionBidLocker.getAllBids(bid_ids, [], [], {"from": auction})

#     # Nonexistent bids (causes RPC crash for me)
#     nonexistent_bid_ids = [
#         web3.keccak(text="nonexistent-bid-" + str(x + 1)) for x in range(len(bid_prices))
#     ]
#     with reverts(custom_error("NonExistentBid(bytes32)", nonexistent_bid_ids[0])):
#         tx = termAuctionBidLocker.getAllBids(bid_ids, [], nonexistent_bid_ids, {"from": auction})
#     with reverts(custom_error("NonExistentBid(bytes32)", nonexistent_bid_ids[0])):
#         tx = termAuctionBidLocker.getAllBids(
#             nonexistent_bid_ids, [], bob_bid_ids, {"from": auction}
#         )

#     # Unrevealed bid submitted as revealed
#     with reverts(custom_error("BidNotRevealed(bytes32)", bob_bid_ids[0])):
#         tx = termAuctionBidLocker.getAllBids(bob_bid_ids, [], bid_ids, {"from": auction})

#     # Revealed bid submitted as unrevealed
#     # We do the first 8 revealed bids as revealed and then move the rest into the unrevealed list
#     with reverts(custom_error("BidRevealed(bytes32)", bid_ids[8])):
#         tx = termAuctionBidLocker.getAllBids(
#             bid_ids[0:8], [], bid_ids[8:len(bid_ids)] + bob_bid_ids, {"from": auction}
#         )

#     # Before, we have stored bids
#     bid = termAuctionBidLocker.lockedBid(bid_ids[4], {"from": alice})
#     assert bid[0] == bid_ids[4].hex()
#     assert bid[1] == alice
#     assert bid[2] == bid_price_hashes[4].hex()

#     bid = termAuctionBidLocker.lockedBid(bob_bid_ids[6], {"from": alice})
#     assert bid[0] == bob_bid_ids[6].hex()
#     assert bid[1] == bob
#     assert bid[2] == bid_price_hashes[6].hex()

#     # Call from the auction contract
#     tx = termAuctionBidLocker.getAllBids(bid_ids, [], bob_bid_ids, {"from": auction})
#     print(tx.info())

#     # After, the bids are all blank
#     bid = termAuctionBidLocker.lockedBid(bid_ids[4], {"from": alice})
#     assert bid[0] == hex(0)
#     assert bid[1] == constants.ZERO_ADDRESS
#     assert bid[2] == hex(0)

#     bid = termAuctionBidLocker.lockedBid(bob_bid_ids[6], {"from": alice})
#     assert bid[0] == hex(0)
#     assert bid[1] == constants.ZERO_ADDRESS
#     assert bid[2] == hex(0)
