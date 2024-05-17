"""
Helpers for tests

Purposes:
- Handles custom error messages
- Handles "(unknown)" events which are not properly handled by Brownie

"""

import random
from eth_abi import encode_abi, encode_single
from eth_abi.packed import encode_single_packed,encode_abi_packed
import re
from brownie import (
    # Brownie helpers
    web3,
    chain,
)

###########################
##### Revert Messages #####
###########################

# Custom error message with or without parameter(s)
# If the error has no parameter, you can either include the brackets or not
"""
Examples:
with reverts(custom_error("RewardAlreadyInitialized")):
with reverts(custom_error("InvalidMaxStakeAmount(uint256)", max_operator_stake_amount_new)):
with reverts(custom_error("InvalidPoolStatus(bool,bool)", [False, True])):
with reverts(custom_error("UintArrayError(uint256[])", [[1, 2, 3]])):
with reverts(custom_error("StringArrayArrayError(string[][])", [[["hello", "world"], ["play", "board", "games"]]])):
"""
def custom_error(error_name, var_values=None):
    try:
        # we search using a regex and make sure we only have one match
        var_types = re.findall(r'\(.+?\)', error_name)[0]
        # Remove brackets
        var_types = var_types[1:-1]
        # Break into a list on commas
        var_types = var_types.split(",")
        # If var_values is not a list, make it one
        if not isinstance(var_values, list):
            var_values = [var_values]
    except:
        #Does this have empty brackets?
        if error_name[-2:] != "()":
            # No, this has no brackets, so we add them
            error_name = error_name + "()"

    sig = web3.solidityKeccak(["string"], [error_name])[:4]

    if var_values is None:
        return "typed error: " + str(web3.toHex(sig))
    else:
        return "typed error: " + str(web3.toHex(sig)) + str(
            web3.toHex(encode_abi(var_types, var_values))
        )[2:]


##########################
##### Unknown Events #####
##########################


# Returns both event header and data
# When dealing with Libraries, Brownie cannot catch the exact event name and data so it will return "(unknown)" as the event name
# The function can handle zero or more parameters
"""
Example:
assert tx.events["(unknown)"] == error_unknown("RewardInitialized(uint256,uint256,uint256,uint256)", [initial_reward_rate, reward_amount, s_reward.start_timestamp, s_reward.end_timestamp])
assert tx.events["(unknown)"] == event_unknown("PoolOpened()", formatted=True)
"""


def event_unknown(event_name="", var_values=None, formatted=True):
    topic1 = web3.keccak(text=event_name).hex()

    if var_values is None:
        data = web3.toHex(bytes(0))
    else:
        # we search using regex and make sure we only have one match
        var_types = re.findall(r"\(.*?\)", event_name)[0]

        # Remove brackets if it only has one variable
        if "," not in var_types:
            var_types = var_types[1:-1]

        data = web3.toHex(encode_single(var_types, var_values))

    if formatted:
        return {
            "topic1": topic1,
            "data": data,
        }
    else:
        return topic1, data


##########################
##### Signatures     #####
##########################
def message_hash_sign(ownerAddress, privKey, msgHash):
    signature = web3.eth.account.signHash(msgHash, privKey)
    assert web3.eth.account.recoverHash(msgHash, signature=signature.signature) == ownerAddress

    return signature

####################
# struct TermAuth {
#     /// @dev The address of the user submitting transaction
#     address user;
#     /// @dev A unique nonce associated with the transaction
#     uint256 nonce;
#     ///@dev The expiration timestamp
#     uint256 expirationTimestamp;
#     /// @dev The signature submitted by user for the transaction
#     bytes signature;
#     /// @dev True if this auth struct came from a smart contract wallet
#     bool isContractWallet;
# }

# Create authentication token with dummy signature (which gets stripped later on)
def make_term_auth_no_sig(account, nonce, expirationTimestamp, isContractWallet):
    # return term auth with dummy signature (0x0) which will be stripped later on
    return [account.address, nonce, expirationTimestamp, bytes(bytearray(65)), isContractWallet]


# Create the authentication token (address user, uint256 nonce, bytes signature)
def make_term_auth(account, nonce, expirationTimestamp, txContract, txMsgData, isContractWallet):
    assert len(txMsgData) >= 96*2
    txMsgData_nosig = txMsgData[:len(txMsgData) - 96*2]

    chainId = web3.chain_id

    msgHash = web3.keccak(
        encode_abi_packed(
            ["string", "bytes32"],
            [
                "\x19Ethereum Signed Message:\n32",
                web3.keccak(encode_abi_packed(["int", "address", "bytes"], [chainId, txContract, bytes.fromhex(txMsgData_nosig[2:])])),
            ],
        )
    )

    signature = web3.eth.account.signHash(msgHash, account.private_key)
    assert web3.eth.account.recoverHash(msgHash, signature=signature.signature) == account.address

    return [account.address, nonce, expirationTimestamp, signature.signature, isContractWallet]


####################
## Helper functions
####################
def get_encoded_termRepoId(repoId):
    # termRepoId = keccak256(abi.encodePacked(termRepoId_));
    return web3.keccak(encode_abi_packed(["string"], [repoId])).hex()

def make_bid_submission(setup_protocol, bidder, name, price, quantity, collateral_quantity):
    bid_id = web3.keccak(text=name)
    bid_price_hash = web3.keccak(encode_abi(["uint256"], [price]))
    return [
        bid_id,
        bidder.address,
        bid_price_hash,
        quantity,
        [collateral_quantity],
        setup_protocol["usdc"],
        [setup_protocol["wbtc"]],
    ]

def make_n_bids(setup_protocol, alice, n):
    names = list(map(lambda i: f"alice-bid-{i}", range(n)))
    prices = [random.randint(1, 100) for i in range(n)]
    quantities = [random.randint(1, 100) for i in range(n)]
    collateral_quantities = list(map(lambda q: q * 100_000, quantities))

    return [
        make_bid_submission(
            setup_protocol,
            alice,
            names[i],
            prices[i],
            quantities[i],
            collateral_quantities[i]
        ) for i in range(n)
    ]

def make_complete_auction(bids, offers):
    return [
        list(map(lambda bid: bid[0], bids)),
        [],
        [],
        list(map(lambda offer: offer[0], offers)),
        []
    ]

def do_auction(
    setup_protocol,
    auction,
    termAuctionBidLocker,
    termAuctionOfferLocker,
    constants,
    owner,
    alice,
    bob,
    bid_price1,
    bid_amount1,
    collateral_amount1,
    offer_price1,
    offer_amount1,
):
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    ############################################################################
    ## BEGIN SAMPLE AUCTION
    ############################################################################

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_nonce1 = 555
    bid_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price1, bid_nonce1]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash1,
        bid_amount1,
        [collateral_amount1],
        usdc,
        [wbtc],
    ]

    # Submit alice's bids
    tx = termAuctionBidLocker.lockBids([bid_submission1], {"from": alice})
    bid_id1 = tx.events[1]["id"]

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 333
    offer_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [offer_price1, offer_nonce1]))
    offer_submission1 = [
        offer_id1,
        bob.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]

    # Submit bob's offers
    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": bob})
    offer_id1 = tx.events[2]["id"]

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id1],
        [],
        [],
        [offer_id1],
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker.revealBids([bid_id1], [bid_price1], [bid_nonce1], {"from": alice})
    tx = termAuctionOfferLocker.revealOffers([offer_id1], [offer_price1], [offer_nonce1], {"from": bob})

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})


def do_auction_multicollateral(
    setup_protocol,
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
):
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)

    ############################################################################
    ## BEGIN SAMPLE AUCTION
    ############################################################################

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id1 = web3.keccak(text="alice-bid-one")
    bid_nonce1 = 555
    bid_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price1, bid_nonce1]))
    bid_submission1 = [
        bid_id1,
        alice.address,
        bid_price_hash1,
        bid_amount1,
        [collateral_amount1],
        usdc,
        collateral_tokens1,
    ]

    bid_id2 = web3.keccak(text="alice-bid-two")
    bid_nonce2 = 999
    bid_price_hash2 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price2, bid_nonce2]))
    bid_submission2 = [
        bid_id2,
        alice.address,
        bid_price_hash2,
        bid_amount2,
        [collateral_amount2],
        usdc,
        collateral_tokens2,
    ]

    # Submit alice's bids
    tx = termAuctionBidLocker.lockBids(
        [bid_submission1, bid_submission2], {"from": alice}
    )
    # Bid IDs are changed in the contract, so we need to get them from the events
    bid_id1 = tx.events["BidLocked"][0]["id"]
    bid_id2 = tx.events["BidLocked"][1]["id"]

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 888
    offer_price_hash1 = web3.keccak(encode_abi(["uint256", "uint256"], [offer_price1, offer_nonce1]))
    offer_submission1 = [
        offer_id1,
        bob.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]

    # Submit bob's offers
    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": bob})
    # Offer IDs are changed in the contract, so we need to get them from the events
    offer_id1 = tx.events["OfferLocked"][0]["id"]

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id1,bid_id2],
        [],
        [],
        [offer_id1],
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker.revealBids([bid_id1,bid_id2], [bid_price1,bid_price2], [bid_nonce1, bid_nonce2], {"from": alice})
    tx = termAuctionOfferLocker.revealOffers([offer_id1], [offer_price1], [offer_nonce1], {"from": bob})

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})

    return (
        bid_id1,
        bid_id2,
        offer_id1,
    )
