"""
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
from helpers import (
    custom_error,
    do_auction_multicollateral,
)

def test_rolloverCollateral(protocol_another_auction, constants, owner, alice, bob, carol):
    """
    Alice bids in the first auction in WBTC, then adds some collateral in WETH.
    Alice submits a rollover election to the second auction, refrencing the entire amount of her
    WBTC backed initial bid. 
    In completeAuction(), all of Alice's WBTC and WETH is transferred to the second auction and
    locked there as collateral.
    """
    rolloverManager = protocol_another_auction["rolloverManager"]
    auction = protocol_another_auction["auction"]
    auction2 = protocol_another_auction["auction2"]
    auction3 = protocol_another_auction["auction3"]
    termAuctionBidLocker = protocol_another_auction["termAuctionBidLocker"]
    termAuctionBidLocker2 = protocol_another_auction["termAuctionBidLocker2"]
    termAuctionBidLocker3 = protocol_another_auction["termAuctionBidLocker3"]
    termAuctionOfferLocker = protocol_another_auction["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = protocol_another_auction["termAuctionOfferLocker2"]
    termAuctionOfferLocker3 = protocol_another_auction["termAuctionOfferLocker3"]
    termRepoLocker = protocol_another_auction["termRepoLocker"]
    termRepoLocker2 = protocol_another_auction["termRepoLocker2"]
    termRepoLocker3 = protocol_another_auction["termRepoLocker3"]
    eventEmitter = protocol_another_auction["eventEmitter"]
    termInitializer = protocol_another_auction["termInitializer"]
    termRepoServicer = protocol_another_auction["termRepoServicer"]
    termRepoServicer2 = protocol_another_auction["termRepoServicer2"]
    termRepoCollateralManager = protocol_another_auction["termRepoCollateralManager"]
    termRepoCollateralManager2 = protocol_another_auction["termRepoCollateralManager2"]
    usdc = protocol_another_auction["usdc"]  # Purchase Token (6 decimals)
    wbtc = protocol_another_auction["wbtc"]  # Collateral Token (8 decimals)
    weth = protocol_another_auction["weth"]  # Collateral Token (18 decimals)

    auction_id1 = "0x" + termAuctionBidLocker.termAuctionId().hex()
    repo_id1 = "0x" + termAuctionBidLocker.termRepoId().hex()
    auction_id2 = "0x" + termAuctionBidLocker2.termAuctionId().hex()
    repo_id2 = "0x" + termAuctionBidLocker2.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_nonce1 = 31337
    bid_amount1 = 1000
    collateral_tokens1 = [wbtc]
    collateral_amount1 = 100
    bid_price2 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount2 = 1000
    collateral_tokens2 = [wbtc]
    collateral_amount2 = 100
    bid_price1_hash = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price1, bid_nonce1]))

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 1000

    # Give alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, collateral_amount1 * 10, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.transfer(alice, collateral_amount2 * 10, {"from": owner})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker2, constants.MAX_UINT256, {"from": alice})
    weth.approve(termRepoLocker3, constants.MAX_UINT256, {"from": alice})

    # Give carol some collateral and allow transfer by locker number 2 (carol participates in the second auction)
    wbtc.transfer(carol, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker2, constants.MAX_UINT256, {"from": carol})
    wbtc.approve(termRepoLocker3, constants.MAX_UINT256, {"from": carol})
    weth.transfer(carol, collateral_amount2 * 10, {"from": owner})
    weth.approve(termRepoLocker2, constants.MAX_UINT256, {"from": carol})
    weth.approve(termRepoLocker3, constants.MAX_UINT256, {"from": carol})

    # Give alice some purchase token and allow transfer by the locker
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token and allow transfer by the lockers
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})
    usdc.approve(termRepoLocker2, constants.MAX_UINT256, {"from": bob})
    usdc.approve(termRepoLocker3, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    (bid_id1, bid_id2, offer_id1) = do_auction_multicollateral(
        protocol_another_auction,
        auction,
        termAuctionBidLocker,
        termAuctionOfferLocker,
        constants,
        owner,
        alice,
        bob,
        bid_price1,
        bid_price2,
        bid_amount1,
        bid_amount2,
        collateral_tokens1,
        collateral_tokens2,
        collateral_amount1,
        collateral_amount2,
        offer_price1,
        offer_amount1,
    )

    # Alice now has repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # tests/contracts/lib/TermRepoRolloverElectionSubmission.sol
    # Note that the first param is the bid locker, not the auction
    rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bid_price1_hash]

    # Rollover Bid id generated line 387 of TermRepoRolloverManager
    rollover_bid_id = web3.keccak(
        encode_abi_packed(["address", "address"], [rolloverManager.address, alice.address])
    )

    # The owner sets auction2 and 3 as valid auctions to rollover to
    # [!] No verification, can use arbitrary termAuctionBidLocker to approve arbitrary auction.
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction3, {"from": owner})
    rolloverManager.approveRolloverAuction(termAuctionBidLocker3, auction2, {"from": owner})

    # Alice tells the rollover manager from the first auction that she wants to rollover to the second auction
    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Now she does it for the third, too
    rollover_submission = [termAuctionBidLocker3, alice_repayment_amount, bid_price1_hash]
    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Advance past the 2nd auction's start time
    target_time = termAuctionBidLocker2.auctionStartTime() + 10
    chain.mine(timestamp=target_time)

    termAuctionGroup = (auction2, termAuctionBidLocker2, termAuctionOfferLocker2)
    termRepoCollateralManager.reopenToNewAuction(termAuctionGroup, {"from": termInitializer})
    termRepoServicer.reopenToNewAuction(termAuctionGroup, {"from": termInitializer})

    # We need another bid in the system to prevent the action being cancelled (see:rollover_cancel)
    # This time, alice bids with weth
    bid_price3 = 123  # (9 decimal places)
    bid_nonce3 = 555
    bid_amount3 = 10  # min. tender amount
    collateral_amount3 = 1 * 10**18
    bid_id3 = web3.keccak(text="alice-bid-three")
    bid_price_hash3 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price3, bid_nonce3]))
    bid_submission3 = [
        bid_id3,
        alice.address,
        bid_price_hash3,
        bid_amount3,
        [collateral_amount3],
        usdc,
        [weth],
    ]

    # Give alice some weth collateral
    weth.transfer(alice, collateral_amount3 * 10, {"from": owner})

    tx = termAuctionBidLocker2.lockBids([bid_submission3], {"from": alice})
    bid_id3 = tx.events["BidLocked"][0]["id"]

    # Make an offer from bob to match alice's rollover
    offer_id_b1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 1337
    offer_price_hash1 = web3.keccak(
        encode_abi(["uint256", "uint256"], [offer_price1, offer_nonce1])
    )
    offer_submission1 = [
        offer_id_b1,
        bob.address,
        offer_price_hash1,
        alice_repayment_amount,
        usdc,
    ]

    # Submit bob's offers
    tx = termAuctionOfferLocker2.lockOffers([offer_submission1], {"from": bob})
    offer_id_b1 = tx.events["OfferLocked"][0]["id"]

    # And again for auction 3:

    tx = termAuctionBidLocker3.lockBids([bid_submission3], {"from": alice})
    bid_id3_auction3 = tx.events["BidLocked"][0]["id"]

    # Submit bob's offers
    tx = termAuctionOfferLocker3.lockOffers([offer_submission1], {"from": bob})
    offer_id_b1_auction3 = tx.events["OfferLocked"][0]["id"]

    # Advance past the 2nd auction's reveal time
    target_time = termAuctionBidLocker2.revealTime() + 10
    chain.mine(timestamp=target_time)

    # Reveal (some) bids and offers
    with reverts(custom_error("BidPriceModified(bytes32)", rollover_bid_id)):
        tx = termAuctionBidLocker2.revealBids([rollover_bid_id], [bid_price1], [bid_nonce1], {"from": alice})

    tx = termAuctionOfferLocker2.revealOffers(
        [offer_id_b1], [offer_price1], [offer_nonce1], {"from": bob}
    )
    tx = termAuctionBidLocker2.revealBids([bid_id3], [bid_price3], [bid_nonce3], {"from": carol})

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id3, rollover_bid_id],
        [],
        [],
        [offer_id_b1],
        [],
    ]

    (tokens,balances) = termRepoCollateralManager.getCollateralBalances(alice)
    print("alice collateral manager 1 balances", tokens, balances)

    termRepoCollateralManager.externalLockCollateral(weth, collateral_amount3, {"from": alice})

    (tokens,balances) = termRepoCollateralManager.getCollateralBalances(alice)
    print("alice collateral manager 1 balances", tokens, balances)

    # Complete the second auction
    with reverts():
        tx = auction2.completeAuction(complete_auction_input, {"from": owner})
        print(tx.info())

    (tokens,balances) = termRepoCollateralManager.getCollateralBalances(alice)
    print("alice collateral manager 1 balances", tokens, balances)

    # Complete the third auction

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker3.revealBids([rollover_bid_id], [bid_price1], [bid_nonce1], {"from": alice})
    tx = termAuctionOfferLocker3.revealOffers(
        [offer_id_b1_auction3], [offer_price1], [offer_nonce1], {"from": bob}
    )
    tx = termAuctionBidLocker3.revealBids([bid_id3_auction3], [bid_price3], [bid_nonce3], {"from": carol})

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id3_auction3, rollover_bid_id],
        [],
        [],
        [offer_id_b1_auction3],
        [],
    ]

    (tokens,balances) = termRepoCollateralManager.getCollateralBalances(alice)
    print("alice collateral manager 1 balances", tokens, balances)

    # Complete the third auction
    tx = auction3.completeAuction(complete_auction_input, {"from": owner})
    print(tx.info())

    (tokens,balances) = termRepoCollateralManager.getCollateralBalances(alice)
    print("alice collateral manager 1 balances", tokens, balances)


