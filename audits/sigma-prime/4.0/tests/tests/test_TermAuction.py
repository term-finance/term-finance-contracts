import brownie
import pytest
import random

from brownie import (
    # Brownie helpers
    accounts,
    web3,
    reverts,
    Wei,
    chain,
    Contract,
)
from helpers import (
    get_encoded_termRepoId,
    make_n_bids,
    make_complete_auction,
    make_term_auth,
    make_term_auth_no_sig,
    custom_error
)

from eth_abi import encode_abi
from eth_abi.packed import encode_abi_packed

####################################################
# +  TermAuction (ITermAuctionErrors, UUPSUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, ExponentialNoError)
#    ✓ [Ext] initialize #
#       - modifiers: initializer
#    ✓ [Ext] pairTermContracts #
#       - modifiers: onlyRole
#    - [Int] _findBidIndexForPrice
#    - [Int] _findOfferIndexForPrice
#    - [Int] _minUint256
#    - [Int] _maxUint256
#    - [Int] _cumsumBidAmount
#    - [Int] _cumsumOfferAmount
#    - [Int] _calculateClearingPrice
#    - [Int] _findFirstIndexForPrice
#    - [Int] _findLastIndexForPrice
#    - [Int] _fullyAssignBid #
#       - modifiers: nonReentrant
#    - [Int] _fullyAssignOffer #
#       - modifiers: nonReentrant
#    - [Int] _partiallyAssignBid #
#       - modifiers: nonReentrant
#    - [Int] _partiallyAssignOffer #
#       - modifiers: nonReentrant
#    - [Int] _assignRolloverBid #
#    - [Int] _markRolloverAsProcessed #
#    - [Int] _assignBids #
#    - [Int] _assignOffers #
#    - [Int] _calculateRepurchasePrice
#    - [Int] _calculateAndStoreClearingPrice #
#       - modifiers: nonReentrant
#    - [Ext] completeAuction #
# NOTE: problems with crashing of ganache-cli
#       - modifiers: onlyWhileAuctionClosed,whenCompleteAuctionNotPaused
#    - [Pub] cancelAuction #
# TODO: rollovers
#       - modifiers: onlyWhileAuctionClosed,onlyRole
#    ✓ [Pub] getAssignedBidIds
#    ✓ [Pub] getAssignedOfferIds
#    ✓ [Ext] pauseCompleteAuction #
#       - modifiers: onlyRole
#    ✓ [Ext] unpauseCompleteAuction #
#       - modifiers: onlyRole
#    - [Int] _authorizeUpgrade
#       - modifiers: onlyRole
#
#
# ($) = payable function
# # = non-constant function


def test_initialize(setup_protocol, owner):
    auction = setup_protocol["auction"]
    purchaseToken_usdc = setup_protocol["purchaseToken_usdc"]

    assert auction.termRepoId() == get_encoded_termRepoId("TestTermRepo")
    assert auction.termAuctionId() == get_encoded_termRepoId("TestTermAuction")
    assert auction.purchaseToken() == purchaseToken_usdc
    assert auction.auctionCompleted() == False
    assert auction.completeAuctionPaused() == False


# @pytest.mark.xfail(reason="Wrong refund amount (see wrong_refund.tex)")
def test_cancelAuction(setup_protocol, constants, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    bid_price1 = 258
    bid_amount1 = 40
    collateral_amount1 = bid_amount1 * 100_000
    bid_price2 = 5435
    bid_amount2 = 55
    collateral_amount2 = bid_amount2 * 100_000
    bid_price3 = 8714
    bid_amount3 = 951
    collateral_amount3 = bid_amount3 * 100_000

    offer_amount1 = 40
    offer_price1 = 258
    offer_amount2 = 65
    offer_price2 = 3841384
    offer_amount3 = 50_000
    offer_price3 = 2551555

    # Give alice some collateral
    wbtc.transfer(
        alice, (collateral_amount1 + collateral_amount2 + collateral_amount3) * 100, {"from": owner}
    )
    weth.transfer(alice, collateral_amount1 * 100, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token
    usdc.transfer(bob, (offer_amount1 + offer_amount2 + offer_amount3) * 100, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_id1_hash =  web3.keccak(encode_abi(["bytes32", "address", "address"], [bid_id1, alice.address, termAuctionBidLocker.address]))
    bid_nonce1 = 10
    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_id1_hash =  web3.keccak(encode_abi(["bytes32", "address", "address"], [bid_id2, alice.address, termAuctionBidLocker.address]))
    bid_nonce2 = 20
    bid_id3 = web3.keccak(text="alice-bid-three")
    bid_id1_hash =  web3.keccak(encode_abi(["bytes32", "address", "address"], [bid_id3, alice.address, termAuctionBidLocker.address]))
    bid_nonce3 = 30
    bid_price_hash1 = web3.keccak(encode_abi(["uint256","uint256"], [bid_price1, bid_nonce1]))
    bid_price_hash2 = web3.keccak(encode_abi(["uint256","uint256"], [bid_price2, bid_nonce2]))
    bid_price_hash3 = web3.keccak(encode_abi(["uint256","uint256"], [bid_price3, bid_nonce3]))
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
    bid_submission3 = [
        bid_id3,
        alice.address,
        bid_price_hash3,
        bid_amount3,
        [collateral_amount3],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # nonce = 1
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionBidLocker.address
    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1, bid_submission2, bid_submission3], termAuth_nosig)
    # term_auth = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit alice's bids
    tx = termAuctionBidLocker.lockBids(
        [bid_submission1, bid_submission2, bid_submission3], {"from": alice}
    )

    bid_id1_hash = tx.events[1][0]["id"]
    bid_id2_hash = tx.events[3][0]["id"]
    bid_id3_hash = tx.events[5][0]["id"]

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 10
    offer_price_hash1 = web3.keccak(encode_abi(["uint256","uint256"], [offer_price1, offer_nonce1]))
    offer_submission1 = [
        offer_id1,
        bob.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]
    offer_id2 = web3.keccak(text="bob-offer-two")
    offer_nonce2 = 20
    offer_price_hash2 = web3.keccak(encode_abi(["uint256","uint256"], [offer_price2, offer_nonce2]))
    offer_submission2 = [
        offer_id2,
        bob.address,
        offer_price_hash2,
        offer_amount2,
        usdc,
    ]

    offer_id3 = web3.keccak(text="bob-offer-three")
    offer_nonce3 = 30
    offer_price_hash3 = web3.keccak(encode_abi(["uint256","uint256"], [offer_price3, offer_nonce3]))
    offer_submission3 = [
        offer_id3,
        bob.address,
        offer_price_hash3,
        offer_amount3,
        usdc,
    ]

    # nonce = 2
    # expirationTimestamp = chain.time() + 300    # + 5m
    # txContract = termAuctionOfferLocker.address
    # termAuth_nosig = make_term_auth_no_sig(bob, nonce, expirationTimestamp)
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input([offer_submission1, offer_submission2, offer_submission3], termAuth_nosig)
    # term_auth = make_term_auth(bob, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit bob's offers
    tx = termAuctionOfferLocker.lockOffers(
        [offer_submission1, offer_submission2, offer_submission3], {"from": bob}
    )

    offer_id1_hash = tx.events[2][0]["id"]
    offer_id2_hash = tx.events[5][0]["id"]
    offer_id3_hash = tx.events[8][0]["id"]

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id1_hash, bid_id3_hash],
        [],
        [bid_id2_hash],
        [offer_id1_hash, offer_id3_hash],
        [offer_id2_hash],
    ]

    with reverts(custom_error("AuctionNotClosed()")):
        tx = auction.cancelAuction(complete_auction_input, {"from": owner})

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker.revealBids(
        [bid_id1_hash, bid_id3_hash], [bid_price1, bid_price3], [bid_nonce1, bid_nonce3], {"from": alice}
    )
    tx = termAuctionOfferLocker.revealOffers(
        [offer_id1_hash, offer_id3_hash], [offer_price1, offer_price3], [offer_nonce1, offer_nonce3], {"from": bob}
    )

    # Cancel the auction
    tx = auction.cancelAuction(complete_auction_input, {"from": owner})

    # Events. First the revealed bids unlock, then the revealed offers, then unrevealed bids, then unrevealed offers
    i = 0
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "BidUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == bid_id1_hash
    i += 1
    assert tx.events[i].address == wbtc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == alice
    assert tx.events[i]["value"] == collateral_amount1
    # i += 1
    # assert tx.events[i].address == eventEmitter
    # assert tx.events[i].name == "CollateralUnlocked"
    # assert tx.events[i]["termRepoId"] == termRepoId
    # assert tx.events[i]["borrower"] == alice
    # assert tx.events[i]["collateralToken"] == wbtc
    # assert tx.events[i]["amount"] == collateral_amount1
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "BidUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == bid_id3_hash
    i += 1
    assert tx.events[i].address == wbtc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == alice
    assert tx.events[i]["value"] == collateral_amount3
    # i += 1
    # assert tx.events[i].address == eventEmitter
    # assert tx.events[i].name == "CollateralUnlocked"
    # assert tx.events[i]["termRepoId"] == termRepoId
    # assert tx.events[i]["borrower"] == alice
    # assert tx.events[i]["collateralToken"] == wbtc
    # assert tx.events[i]["amount"] == collateral_amount3
    i += 1
    assert tx.events[i].address == usdc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == bob
    assert tx.events[i]["value"] == offer_amount1
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlockedByServicer"
    assert tx.events[i]["termRepoId"] == termRepoId
    assert tx.events[i]["offeror"] == bob
    assert tx.events[i]["amount"] == offer_amount1
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == offer_id1_hash
    i += 1
    assert tx.events[i].address == usdc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == bob
    assert tx.events[i]["value"] == offer_amount3
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlockedByServicer"
    assert tx.events[i]["termRepoId"] == termRepoId
    assert tx.events[i]["offeror"] == bob
    assert tx.events[i]["amount"] == offer_amount3
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == offer_id3_hash
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "BidUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == bid_id2_hash
    i += 1
    assert tx.events[i].address == wbtc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == alice
    assert tx.events[i]["value"] == collateral_amount2
    # i += 1
    # assert tx.events[i].address == eventEmitter
    # assert tx.events[i].name == "CollateralUnlocked"
    # assert tx.events[i]["termRepoId"] == termRepoId
    # assert tx.events[i]["borrower"] == alice
    # assert tx.events[i]["collateralToken"] == wbtc
    # assert tx.events[i]["amount"] == collateral_amount2
    i += 1
    assert tx.events[i].address == usdc
    assert tx.events[i].name == "Transfer"
    assert tx.events[i]["from"] == termRepoLocker
    assert tx.events[i]["to"] == bob
    assert tx.events[i]["value"] == offer_amount2
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlockedByServicer"
    assert tx.events[i]["termRepoId"] == termRepoId
    assert tx.events[i]["offeror"] == bob
    assert tx.events[i]["amount"] == offer_amount2
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "OfferUnlocked"
    assert tx.events[i]["termAuctionId"] == auction_id
    assert tx.events[i]["id"] == offer_id2_hash
    i += 1
    assert tx.events[i].address == eventEmitter
    assert tx.events[i].name == "AuctionCancelled"
    assert tx.events[i]["termAuctionId"] == auction_id


def test_completeAuction(setup_protocol, constants, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # NOTE to run with higher values, use anvil
    alice_bid_count = 25
    assert alice_bid_count > 1

    bid_amounts = [x for x in range(600, 600 + alice_bid_count)]
    collateral_amounts = [x * 1_000 for x in bid_amounts]
    bid_prices = random.sample(range(1, alice_bid_count * 10), alice_bid_count)
    bid_prices = [x * 10**9 for x in bid_prices]
    bid_prices.sort()   # TODO: need to be sorted?
    bid_nonces = random.sample(range(1, alice_bid_count * 10), alice_bid_count)
    collateral_sum = 600 * alice_bid_count * 200_000

    bob_offer_count = 25
    assert bob_offer_count > 1

    offer_amounts = [x for x in range(200, 200 + bob_offer_count)]
    offer_prices = random.sample(range(1, bob_offer_count * 10), bob_offer_count)
    offer_prices = [x * 10**9 for x in offer_prices]
    offer_prices.sort()   # TODO: need to be sorted?
    offer_nonces = random.sample(range(1, bob_offer_count * 10), bob_offer_count)
    offer_sum = 200 * bob_offer_count * 200

    # Give alice some collateral
    wbtc.transfer(alice, collateral_sum, {"from": owner})
    # Multiply up the WETH amount
    weth.transfer(alice, collateral_sum * 10**10, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token
    usdc.transfer(bob, offer_sum, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_ids = [web3.keccak(text="alice-bid-" + str(x + 1)) for x in range(len(bid_prices))]
    bid_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(bid_prices, bid_nonces)]

    bid_submissions = [
        [
            bid_ids[i],
            alice.address,
            bid_price_hashes[i],
            bid_amounts[i],
            [collateral_amounts[i]],
            usdc,
            [wbtc],
        ]
        for i in range(len(bid_prices))
    ]

    # Submit alice's bids
    # lock the bids in a loop to avoid crashing RPC
    nonce_counter = 1
    bid_ids_hashes = []
    for bid_submission in bid_submissions:
    #     # expirationTimestamp = chain.time() + 300    # + 5m
    #     # txContract = termAuctionBidLocker.address
    #     # termAuth_nosig = make_term_auth_no_sig(alice, nonce_counter, expirationTimestamp)
    #     # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
    #     # term_auth = make_term_auth(alice, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        # nonce_counter += 1

        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
        bid_ids_hashes.append(tx.events[1]["id"])

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_ids = [web3.keccak(text="bob-offer-" + str(x + 1)) for x in range(len(offer_prices))]
    offer_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(offer_prices, offer_nonces)]

    offer_submissions = [
        [
            offer_ids[i],
            bob.address,
            offer_price_hashes[i],
            offer_amounts[i],
            usdc,
        ]
        for i in range(len(offer_prices))
    ]

    # Submit bob's offers
    # lock the offers in a loop to avoid crashing RPC
    offer_ids_hashes = []
    for offer_submission in offer_submissions:
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionOfferLocker.address
        # termAuth_nosig = make_term_auth_no_sig(bob, nonce_counter, expirationTimestamp)
        # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
        # term_auth = make_term_auth(bob, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        nonce_counter += 1
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": bob})
        offer_ids_hashes.append(tx.events[2]["id"])

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        bid_ids_hashes,
        [],
        [],
        offer_ids_hashes,
        [],
    ]

    # with reverts(custom_error("AuctionNotClosed()")):
    #     tx = auction.completeAuction(complete_auction_input, {"from": owner})

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal alice's bids
    # for i in range(len(bid_ids)):
    tx = termAuctionBidLocker.revealBids(bid_ids_hashes, bid_prices, bid_nonces, {"from": alice})

    # Reveal bob's offers
    tx = termAuctionOfferLocker.revealOffers(offer_ids_hashes, offer_prices, offer_nonces, {"from": bob})

    # assigned_bid_ids = auction.getAssignedBidIds({"from": alice})
    # assert len(assigned_bid_ids) == 0
    #
    # assigned_offer_ids = auction.getAssignedOfferIds({"from": alice})
    # assert len(assigned_offer_ids) == 0

    # Complete the auction
    ###
    tx = auction.completeAuction(complete_auction_input, {"from": owner})
    # print("Gas Used: ",tx.gas_used)

    # The first event should be CollateralLocked from TermCollateralManager.journalBidCollateralToCollateralManager()
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "CollateralLocked"
    assert tx.events[0]["termRepoId"] == termRepoId
    assert tx.events[0]["borrower"] == alice.address

    # Check assigned bids/offers and check against events
    # assigned_bid_ids = auction.getAssignedBidIds({"from": alice})
    # assigned_offer_ids = auction.getAssignedOfferIds({"from": alice})
    #
    # for i, assigned_bid_id in enumerate(assigned_bid_ids):
    #     assert tx.events["BidAssigned"][i]["termAuctionId"] == auction_id
    #     assert tx.events["BidAssigned"][i]["id"] == assigned_bid_id
    #
    # for i, assigned_offer_id in enumerate(assigned_offer_ids):
    #     assert tx.events["OfferAssigned"][i]["termAuctionId"] == auction_id
    #     assert tx.events["OfferAssigned"][i]["id"] == assigned_offer_id


def test_completeAuction_noBids(setup_protocol, constants, owner, alice, bob):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    # NOTE to run with higher values, use anvil
    alice_bid_count = 5
    assert alice_bid_count >= 1

    bid_amounts = [x for x in range(600, 600 + alice_bid_count)]
    collateral_amounts = [x * 1_000 for x in bid_amounts]
    bid_prices = random.sample(range(1, alice_bid_count * 10), alice_bid_count)     # Alice's bid from 1 to 50
    bid_prices = [x * 10**9 for x in bid_prices]
    bid_prices.sort()
    bid_nonces = random.sample(range(1, alice_bid_count * 10), alice_bid_count)
    collateral_sum = 600 * alice_bid_count * 200_000

    bob_offer_count = 5
    assert bob_offer_count >= 1

    offer_amounts = [x for x in range(200, 200 + bob_offer_count)]
    offer_prices = random.sample(range((alice_bid_count * 10) + 1, bob_offer_count * 100), bob_offer_count)  # Bob's offer from 51 to 500
    offer_prices = [x * 10**9 for x in offer_prices]
    offer_prices.sort()
    offer_nonces = random.sample(range(1, bob_offer_count * 10), bob_offer_count)
    offer_sum = 200 * bob_offer_count * 200

    # Give alice some collateral
    wbtc.transfer(alice, collateral_sum, {"from": owner})
    # Multiply up the WETH amount
    weth.transfer(alice, collateral_sum * 10**10, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token
    usdc.transfer(bob, offer_sum, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_ids = [web3.keccak(text="alice-bid-" + str(x + 1)) for x in range(len(bid_prices))]
    bid_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(bid_prices, bid_nonces)]

    bid_submissions = [
        [
            bid_ids[i],
            alice.address,
            bid_price_hashes[i],
            bid_amounts[i],
            [collateral_amounts[i]],
            usdc,
            [wbtc],
        ]
        for i in range(len(bid_prices))
    ]

    # Submit alice's bids
    # lock the bids in a loop to avoid crashing RPC
    nonce_counter = 1
    bid_ids_hashes = []
    for bid_submission in bid_submissions:
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionBidLocker.address
        # termAuth_nosig = make_term_auth_no_sig(alice, nonce_counter, expirationTimestamp)
        # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
        # term_auth = make_term_auth(alice, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        nonce_counter += 1
        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
        bid_ids_hashes.append(tx.events[1]["id"])

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_ids = [web3.keccak(text="bob-offer-" + str(x + 1)) for x in range(len(offer_prices))]
    offer_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(offer_prices, offer_nonces)]

    offer_submissions = [
        [
            offer_ids[i],
            bob.address,
            offer_price_hashes[i],
            offer_amounts[i],
            usdc,
        ]
        for i in range(len(offer_prices))
    ]

    # Submit bob's offers
    # lock the offers in a loop to avoid crashing RPC
    offer_ids_hashes = []
    for offer_submission in offer_submissions:
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionOfferLocker.address
        # termAuth_nosig = make_term_auth_no_sig(bob, nonce_counter, expirationTimestamp)
        # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
        # term_auth = make_term_auth(bob, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        nonce_counter += 1
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": bob})
        offer_ids_hashes.append(tx.events[2]["id"])

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        bid_ids_hashes,
        [],
        [],
        offer_ids_hashes,
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal alice's bids
    tx = termAuctionBidLocker.revealBids(bid_ids_hashes, bid_prices, bid_nonces, {"from": alice})

    # Reveal bob's offers
    tx = termAuctionOfferLocker.revealOffers(offer_ids_hashes, offer_prices, offer_nonces, {"from": bob})

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})

    # Cancelled as non-viable auction due to not reaching a bid larger than or equal to an offer
    assert tx.events[25].name == "AuctionCancelled"
    assert tx.events[25]["nonViableAuction"] == True


def test_pausing(setup_protocol, constants, owner, alice, bob, devOps):
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    termRepoId = "0x" + termAuctionOfferLocker.termRepoId().hex()

    alice_bid_count = 5
    assert alice_bid_count > 1

    bid_amounts = [x for x in range(600, 600 + alice_bid_count)]
    collateral_amounts = [x * 1_000 for x in bid_amounts]
    bid_prices = random.sample(range(1, alice_bid_count * 10), alice_bid_count)
    bid_prices = [x * 10**9 for x in bid_prices]
    bid_prices.sort()      # TODO: need to be sorted?
    bid_nonces = random.sample(range(1, alice_bid_count * 10), alice_bid_count)
    collateral_sum = 600 * alice_bid_count * 200_000

    bob_offer_count = 5
    assert bob_offer_count > 1

    offer_amounts = [x for x in range(200, 200 + bob_offer_count)]
    offer_prices = random.sample(range(1, bob_offer_count * 10), bob_offer_count)
    offer_prices = [x * 10**9 for x in offer_prices]
    offer_prices.sort()    # TODO: need to be sorted?
    offer_nonces = random.sample(range(1, bob_offer_count * 10), bob_offer_count)
    offer_sum = 200 * bob_offer_count * 200

    # Give alice some collateral
    wbtc.transfer(alice, collateral_sum, {"from": owner})
    # Multiply up the WETH amount
    weth.transfer(alice, collateral_sum * 10**10, {"from": owner})
    # allow transfer by the locker
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token
    usdc.transfer(bob, offer_sum, {"from": owner})
    # allow transfer by the locker
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_ids = [web3.keccak(text="alice-bid-" + str(x + 1)) for x in range(len(bid_prices))]
    bid_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(bid_prices, bid_nonces)]

    bid_submissions = [
        [
            bid_ids[i],
            alice.address,
            bid_price_hashes[i],
            bid_amounts[i],
            [collateral_amounts[i]],
            usdc,
            [wbtc],
        ]
        for i in range(len(bid_prices))
    ]

    # Submit alice's bids
    # lock the bids in a loop to avoid crashing RPC
    nonce_counter = 1
    bid_ids_hashes = []
    for bid_submission in bid_submissions:
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionBidLocker.address
        # termAuth_nosig = make_term_auth_no_sig(alice, nonce_counter, expirationTimestamp)
        # txMsgData_nosig = termAuctionBidLocker.lockBid.encode_input(bid_submission, termAuth_nosig)
        # term_auth = make_term_auth(alice, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        nonce_counter += 1
        tx = termAuctionBidLocker.lockBids([bid_submission], {"from": alice})
        bid_ids_hashes.append(tx.events[1]["id"])

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_ids = [web3.keccak(text="bob-offer-" + str(x + 1)) for x in range(len(offer_prices))]
    offer_price_hashes = [web3.keccak(encode_abi(["uint256", "uint256"], [x, y])) for (x, y) in zip(offer_prices, offer_nonces)]

    offer_submissions = [
        [
            offer_ids[i],
            bob.address,
            offer_price_hashes[i],
            offer_amounts[i],
            usdc,
        ]
        for i in range(len(offer_prices))
    ]

    # Submit bob's offers
    # lock the offers in a loop to avoid crashing RPC
    offer_ids_hashes = []
    for offer_submission in offer_submissions:
        # expirationTimestamp = chain.time() + 300    # + 5m
        # txContract = termAuctionOfferLocker.address
        # termAuth_nosig = make_term_auth_no_sig(bob, nonce_counter, expirationTimestamp)
        # txMsgData_nosig = termAuctionOfferLocker.lockOffer.encode_input(offer_submission, termAuth_nosig)
        # term_auth = make_term_auth(bob, nonce_counter, expirationTimestamp, txContract, txMsgData_nosig)

        nonce_counter += 1
        tx = termAuctionOfferLocker.lockOffers([offer_submission], {"from": bob})
        offer_ids_hashes.append(tx.events[2]["id"])

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        bid_ids_hashes,
        [],
        [],
        offer_ids_hashes,
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal alice's bids
    tx = termAuctionBidLocker.revealBids(bid_ids_hashes, bid_prices, bid_nonces, {"from": alice})

    # Reveal bob's offers
    tx = termAuctionOfferLocker.revealOffers(offer_ids_hashes, offer_prices, offer_nonces, {"from": bob})

    # Test pauseCompleteAuction()
    tx = auction.pauseCompleteAuction({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "CompleteAuctionPaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert auction.completeAuctionPaused() == True

    with reverts(custom_error("CompleteAuctionPaused()")):
        tx = auction.completeAuction(complete_auction_input, {"from": owner})

    # Test pauseCompleteAuction()
    tx = auction.unpauseCompleteAuction({"from": owner})

    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "CompleteAuctionUnpaused"
    assert tx.events[0]["termAuctionId"] == auction_id
    assert tx.events[0]["termRepoId"] == termRepoId

    assert auction.completeAuctionPaused() == False

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})
