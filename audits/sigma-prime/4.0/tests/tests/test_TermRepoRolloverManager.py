"""
✅ test done and should pass
⛔ test done but there's an issue
❎ test not required or n/a

constructor ❎

External Functions:
initialize ✅
pairTermContracts ✅
electRollover ✅
getRolloverInstructions ✅ (in electRollover)
cancelRollover ✅
fulfillRollover ✅
approveRolloverAuction ✅
revokeRolloverApproval ✅ (in test_fulfillRollover)

Internal Functions:
_processRollover ✅ (in electRollover)
_authorizeUpgrade ❎

Modifiers:
notTermContractPaired
whileNotMatured ✅
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
    do_auction,
    do_auction_multicollateral,
)


def test_initialize(setup_protocol, constants, owner, alice):
    rolloverManager = setup_protocol["rolloverManager"]
    termInitializer = setup_protocol["termInitializer"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]

    termRepoId = "0x" + termAuctionBidLocker.termRepoId().hex()

    assert rolloverManager.termRepoId() == termRepoId

    assert rolloverManager.hasRole(constants.INITIALIZER_ROLE, termInitializer)


def test_pairTermContracts(setup_protocol, constants, owner, devOps):
    rolloverManager = setup_protocol["rolloverManager"]
    termInitializer = setup_protocol["termInitializer"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    assert rolloverManager.hasRole(constants.ROLLOVER_BID_FULFILLER_ROLE, termRepoServicer)
    assert rolloverManager.hasRole(constants.DEVOPS_ROLE, devOps)
    assert rolloverManager.hasRole(constants.ADMIN_ROLE, owner)


def test_electRollover(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = setup_protocol["termAuctionOfferLocker2"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    auction_id2 = "0x" + termAuctionOfferLocker2.termAuctionId().hex()
    repo_id1 = "0x" + termAuctionOfferLocker.termRepoId().hex()
    repo_id2 = "0x" + termAuctionOfferLocker2.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 10  # min. tender amount
    collateral_amount1 = 1
    bid_price1_hash = web3.keccak(encode_abi(["uint256"], [bid_price1]))

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 10  # min. tender amount

    # Give alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give alice some purchase token and allow transfer by the locker
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    do_auction(
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
    )

    # Alice now has repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # tests/contracts/lib/TermRepoRolloverElectionSubmission.sol
    # Note that the first param is the bid locker, not the auction
    rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bid_price1_hash]

    # Before approval
    with reverts(
        custom_error("RolloverAddressNotApproved(address)", termAuctionBidLocker2.address)
    ):
        rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Now approve
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    with reverts(custom_error("ZeroBorrowerRepurchaseObligation()")):
        rolloverManager.electRollover(rollover_submission, {"from": bob})

    zero_rollover_submission = [termAuctionBidLocker2, 0, bid_price1_hash]

    with reverts(custom_error("InvalidParameters(string)", "Rollover amount cannot be 0")):
        rolloverManager.electRollover(zero_rollover_submission, {"from": alice})

    excess_rollover_submission = [
        termAuctionBidLocker2,
        alice_repayment_amount * 2,
        bid_price1_hash,
    ]

    with reverts(custom_error("BorrowerRepurchaseObligationInsufficient()")):
        rolloverManager.electRollover(excess_rollover_submission, {"from": alice})

    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "RolloverElection"
    assert tx.events[0]["termRepoId"] == repo_id1
    assert tx.events[0]["rolloverTermRepoId"] == repo_id2
    assert tx.events[0]["borrower"] == alice
    assert tx.events[0]["rolloverAuction"] == termAuctionBidLocker2
    assert tx.events[0]["rolloverAmount"] == alice_repayment_amount
    assert tx.events[0]["hashedBidPrice"] == bid_price1_hash.hex()

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "BidLocked"
    assert tx.events[1]["termAuctionId"] == auction_id2
    assert (
        tx.events[1]["id"]
        == web3.keccak(
            encode_abi_packed(["address", "address"], [rolloverManager.address, alice.address])
        ).hex()
    )
    assert tx.events[1]["bidder"] == alice
    assert tx.events[1]["bidPrice"] == bid_price1_hash.hex()
    assert tx.events[1]["amount"] == alice_repayment_amount
    assert tx.events[1]["token"] == usdc
    assert tx.events[1]["collateralTokens"][0] == wbtc
    assert (
        tx.events[1]["collateralAmounts"][0] == 0
    )  # @NOTE All collateral amounts will be zero because of line 359 of TermRepoRolloverManager
    assert tx.events[1]["collateralTokens"][1] == weth
    assert tx.events[1]["collateralAmounts"][1] == 0
    assert tx.events[1]["isRollover"] == True
    assert tx.events[1]["rolloverPairOffTermRepoServicer"] == termRepoServicer
    assert tx.events[1]["referralAddress"] == constants.ZERO_ADDRESS

    # Test getRolloverInstructions
    rollover_instructions = rolloverManager.getRolloverInstructions(alice)

    # tests/contracts/lib/TermRepoRolloverElection.sol
    assert rollover_instructions[0] == termAuctionBidLocker2
    assert rollover_instructions[1] == alice_repayment_amount
    assert rollover_instructions[2] == bid_price1_hash.hex()
    assert rollover_instructions[3] == False


def test_cancelRollover(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = setup_protocol["termAuctionOfferLocker2"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    auction_id2 = "0x" + termAuctionOfferLocker2.termAuctionId().hex()
    repo_id = "0x" + termAuctionOfferLocker.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 10  # min. tender amount
    collateral_amount1 = 1
    bid_price1_hash = web3.keccak(encode_abi(["uint256"], [bid_price1]))

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 10  # min. tender amount

    # Give alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give alice some purchase token and allow transfer by the locker
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    do_auction(
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
    )

    # Alice now has repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # tests/contracts/lib/TermRepoRolloverElectionSubmission.sol
    # Note that the first param is the bid locker, not the auction
    rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bid_price1_hash]

    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    with reverts(custom_error("ZeroBorrowerRepurchaseObligation()")):
        rolloverManager.cancelRollover({"from": bob})

    tx = rolloverManager.cancelRollover({"from": alice})

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "BidUnlocked"
    assert tx.events[0]["termAuctionId"] == auction_id2
    assert (
        tx.events[0]["id"]
        == web3.keccak(
            encode_abi_packed(["address", "address"], [rolloverManager.address, alice.address])
        ).hex()
    )

    assert tx.events[1].address == eventEmitter
    assert tx.events[1].name == "RolloverCancellation"
    assert tx.events[1]["termRepoId"] == repo_id
    assert tx.events[1]["borrower"] == alice

    # Now there is no rollover, we get this revert
    with reverts(custom_error("NoRolloverToCancel()")):
        rolloverManager.cancelRollover({"from": alice})


def test_fulfillRollover(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = setup_protocol["termAuctionOfferLocker2"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    repo_id = "0x" + termAuctionOfferLocker.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 10  # min. tender amount
    collateral_amount1 = 1
    bid_price1_hash = web3.keccak(encode_abi(["uint256"], [bid_price1]))

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 10  # min. tender amount

    # Give alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give alice some purchase token and allow transfer by the locker
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    do_auction(
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
    )

    # Alice now has repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # tests/contracts/lib/TermRepoRolloverElectionSubmission.sol
    # Note that the first param is the bid locker, not the auction
    rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bid_price1_hash]

    # Now approve
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    # Test revoke
    tx = rolloverManager.revokeRolloverApproval(termAuctionBidLocker2, {"from": owner})

    with reverts(
        custom_error("RolloverAddressNotApproved(address)", termAuctionBidLocker2.address)
    ):
        tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Approve again
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Before fulfilment
    rollover_instructions = rolloverManager.getRolloverInstructions(alice)
    assert rollover_instructions[0] == termAuctionBidLocker2
    assert rollover_instructions[1] == alice_repayment_amount
    assert rollover_instructions[2] == bid_price1_hash.hex()
    assert rollover_instructions[3] == False  # Processed

    tx = rolloverManager.fulfillRollover(alice, {"from": termRepoServicer})

    # confirm the events
    assert tx.events[0].address == eventEmitter
    assert tx.events[0].name == "RolloverProcessed"
    assert tx.events[0]["termRepoId"] == repo_id
    assert tx.events[0]["borrower"] == alice

    # Before fulfilment
    rollover_instructions = rolloverManager.getRolloverInstructions(alice)
    assert rollover_instructions[0] == termAuctionBidLocker2
    assert rollover_instructions[1] == alice_repayment_amount
    assert rollover_instructions[2] == bid_price1_hash.hex()
    assert rollover_instructions[3] == True  # Processed


def test_approveRolloverAuction(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    auction_id2 = "0x" + termAuctionBidLocker2.termAuctionId().hex()
    repo_id = "0x" + termAuctionOfferLocker.termRepoId().hex()

    tx = rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    role = web3.keccak(text="ROLLOVER_BID_FULFILLER_ROLE").hex()

    # confirm the events
    assert tx.events[0].address == termRepoServicer
    assert tx.events[0].name == "RoleGranted"
    assert tx.events[0]["role"] == termRepoServicer.ROLLOVER_TARGET_AUCTIONEER_ROLE()
    assert tx.events[0]["account"] == auction2
    assert tx.events[0]["sender"] == rolloverManager

    assert tx.events[1].address == termRepoCollateralManager
    assert tx.events[1].name == "RoleGranted"
    assert tx.events[1]["role"] == termRepoCollateralManager.ROLLOVER_TARGET_AUCTIONEER_ROLE()
    assert tx.events[1]["account"] == auction2
    assert tx.events[1]["sender"] == rolloverManager

    assert tx.events[2].address == rolloverManager
    assert tx.events[2].name == "RoleGranted"
    assert tx.events[2]["role"] == role
    assert tx.events[2]["account"] == auction2
    assert tx.events[2]["sender"] == owner

    assert tx.events[3].address == eventEmitter
    assert tx.events[3].name == "RolloverTermApproved"
    assert tx.events[3]["termRepoId"] == repo_id
    assert tx.events[3]["rolloverTermAuctionId"] == auction_id2


def test_approveRolloverAuction_reverts(
    setup_protocol,
    constants,
    owner,
    controllerAdmin,
    alice,
    TermAuctionBidLocker,
    UUPS_proxy_deploy_and_initialize,
):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termController = setup_protocol["termController"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    termInitializer = setup_protocol["termInitializer"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id2 = "0x" + termAuctionBidLocker2.termAuctionId().hex()
    repo_id = termAuctionOfferLocker.termRepoId()

    # Invalid contracts
    with reverts(custom_error("NotTermContract(address)", alice.address)):
        tx = rolloverManager.approveRolloverAuction(alice, auction2, {"from": owner})
    with reverts(custom_error("NotTermContract(address)", alice.address)):
        tx = rolloverManager.approveRolloverAuction(termAuctionBidLocker2, alice, {"from": owner})

    # Bidlocker auction ends after servicer repurchase
    termRepoId = "TestTermRepo"
    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60
    auctionEndDate = termRepoServicer.endOfRepurchaseWindow() + 600
    auctionRevealDate = auctionEndDate + 6_400
    maturityTimestamp = auctionEndDate + 2_592_000
    minimumTenderAmount = 10
    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        maturityTimestamp,
        minimumTenderAmount,
        usdc.address,
        [wbtc.address],
        termInitializer,
    ]
    termAuctionBidLocker3, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker3.address, {"from": controllerAdmin})

    with reverts(custom_error("AuctionEndsAfterRepayment()")):
        tx = rolloverManager.approveRolloverAuction(
            termAuctionBidLocker3, auction2, {"from": owner}
        )

    # Bidlocker auctions ends before servicer maturityTimestamp
    termAuctionBidLocker4 = TermAuctionBidLocker.deploy({"from": owner})
    termRepoId = "TestTermRepo"
    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60
    auctionEndDate = termRepoServicer.maturityTimestamp() - 600
    auctionRevealDate = auctionEndDate + 6_400
    maturityTimestamp = auctionEndDate + 2_592_000
    minimumTenderAmount = 10
    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        maturityTimestamp,
        minimumTenderAmount,
        usdc.address,
        [wbtc.address],
        termInitializer,
    ]
    termAuctionBidLocker4, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker4.address, {"from": controllerAdmin})

    with reverts(custom_error("AuctionEndsBeforeMaturity()")):
        tx = rolloverManager.approveRolloverAuction(
            termAuctionBidLocker4, auction2, {"from": owner}
        )

    # Wrong purchase token
    termRepoId = "TestTermRepo"
    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60
    auctionEndDate = termRepoServicer.maturityTimestamp() + 60
    auctionRevealDate = auctionEndDate + 60
    maturityTimestamp = auctionEndDate + 200
    minimumTenderAmount = 10
    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        maturityTimestamp,
        minimumTenderAmount,
        weth.address,
        [wbtc.address],
        termInitializer,
    ]
    termAuctionBidLocker5, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker5.address, {"from": controllerAdmin})

    with reverts(
        custom_error("DifferentPurchaseToken(address,address)", [usdc.address, weth.address])
    ):
        tx = rolloverManager.approveRolloverAuction(
            termAuctionBidLocker5, auction2, {"from": owner}
        )

    # Leavng out a collateral token
    termRepoId = "TestTermRepo"
    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60
    auctionEndDate = termRepoServicer.maturityTimestamp() + 60
    auctionRevealDate = auctionEndDate + 60
    maturityTimestamp = auctionEndDate + 200
    minimumTenderAmount = 10
    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        maturityTimestamp,
        minimumTenderAmount,
        usdc.address,
        [wbtc.address],
        termInitializer,
    ]
    termAuctionBidLocker6, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker6.address, {"from": controllerAdmin})

    with reverts(custom_error("CollateralTokenNotSupported(address)", weth.address)):
        tx = rolloverManager.approveRolloverAuction(
            termAuctionBidLocker6, auction2, {"from": owner}
        )

    # Servicer past maturity
    past_mature = termRepoServicer.maturityTimestamp() + 100
    chain.mine(timestamp=past_mature)

    with reverts(custom_error("MaturityReached()")):
        tx = rolloverManager.approveRolloverAuction(
            termAuctionBidLocker2, auction2, {"from": owner}
        )


def test_whileNotMatured(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    termRepoServicer = setup_protocol["termRepoServicer"]

    # Servicer past maturity
    past_mature = termRepoServicer.maturityTimestamp() + 100
    chain.mine(timestamp=past_mature)

    with reverts(custom_error("MaturityReached()")):
        tx = rolloverManager.electRollover(
            [rolloverManager, 1, constants.DEVOPS_ROLE], # These arguments are complete nonsense. They just match the param types.
              {"from": alice}
        )


def test_electRollover_bogus_price_hash(setup_protocol, constants, owner, alice, bob):
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = setup_protocol["termAuctionOfferLocker2"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    eventEmitter = setup_protocol["eventEmitter"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionOfferLocker.termAuctionId().hex()
    repo_id = "0x" + termAuctionOfferLocker.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 10  # min. tender amount
    collateral_amount1 = 1
    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 10  # min. tender amount

    arbitrary_price = 99999
    bogus_price = arbitrary_price * 2
    bogus_hash = web3.keccak(encode_abi(["uint256"], [bogus_price]))

    # hand out funds and approvals
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    do_auction(
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
    )

    # give Alice repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # approve the rollover auction
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    bogus_rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bogus_hash]

    # submit the rollover submission with the bogus price hash
    rolloverManager.electRollover(bogus_rollover_submission, {"from": alice})

    chain.mine(timestamp=termAuctionBidLocker2.revealTime())

    # generate bid ID (see TermRepoRolloverManager.sol:388-390)
    bid_id = web3.keccak(
        encode_abi_packed(["address", "address"], [rolloverManager.address, alice.address])
    )

    with reverts(custom_error("BidPriceModified(bytes32)", bid_id)):
        # reveal bid with bogus price hash
        termAuctionBidLocker2.revealBids([bid_id], [arbitrary_price], [31337], {"from": alice})


def test_rollovers(setup_protocol, constants, owner, alice, bob, carol):
    """
    Process a complete rollover from one auction to another
    """
    rolloverManager = setup_protocol["rolloverManager"]
    auction = setup_protocol["auction"]
    auction2 = setup_protocol["auction2"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionBidLocker2 = setup_protocol["termAuctionBidLocker2"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termAuctionOfferLocker2 = setup_protocol["termAuctionOfferLocker2"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoLocker2 = setup_protocol["termRepoLocker2"]
    eventEmitter = setup_protocol["eventEmitter"]
    termInitializer = setup_protocol["termInitializer"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    termRepoServicer2 = setup_protocol["termRepoServicer2"]
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    termRepoCollateralManager2 = setup_protocol["termRepoCollateralManager2"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    weth = setup_protocol["weth"]  # Collateral Token (18 decimals)

    auction_id = "0x" + termAuctionBidLocker2.termAuctionId().hex()
    repo_id = "0x" + termAuctionBidLocker2.termRepoId().hex()

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_nonce1 = 31337
    bid_amount1 = 10  # min. tender amount
    collateral_tokens1 = [wbtc]
    collateral_amount1 = 1
    bid_price2 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount2 = 10  # min. tender amount
    collateral_tokens2 = [weth]
    collateral_amount2 = 1 * 10**18
    bid_price1_hash = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price1, bid_nonce1]))

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 20  # min. tender amount

    # Give alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})
    weth.transfer(alice, collateral_amount2 * 10, {"from": owner})
    weth.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give carol some collateral and allow transfer by locker number 2 (carol participates in the second auction)
    wbtc.transfer(carol, collateral_amount1 * 100, {"from": owner})
    wbtc.approve(termRepoLocker2, constants.MAX_UINT256, {"from": carol})
    weth.transfer(carol, collateral_amount2 * 10, {"from": owner})
    weth.approve(termRepoLocker2, constants.MAX_UINT256, {"from": carol})

    # Give alice some purchase token and allow transfer by the locker
    usdc.transfer(alice, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give bob some purchase token and allow transfer by the lockers
    usdc.transfer(bob, offer_amount1 * 100, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})
    usdc.approve(termRepoLocker2, constants.MAX_UINT256, {"from": bob})

    # Configure sample auction
    (bid_id1, bid_id2, offer_id1) = do_auction_multicollateral(
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
    )

    # Alice now has repurchase obligations
    alice_repayment_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)
    print("alice_repayment_amount:", alice_repayment_amount)

    # tests/contracts/lib/TermRepoRolloverElectionSubmission.sol
    # Note that the first param is the bid locker, not the auction
    rollover_submission = [termAuctionBidLocker2, alice_repayment_amount, bid_price1_hash]

    # Rollover Bid id generated line 387 of TermRepoRolloverManager
    rollover_bid_id = web3.keccak(
        encode_abi_packed(["address", "address"], [rolloverManager.address, alice.address])
    )

    # The owner sets auction2 as a valid auction to rollover to
    rolloverManager.approveRolloverAuction(termAuctionBidLocker2, auction2, {"from": owner})

    # Alice tells the rollover manager from the first auction that she wants to rollover to the second auction
    tx = rolloverManager.electRollover(rollover_submission, {"from": alice})

    # Advance past the 2nd auction's start time
    target_time = termAuctionBidLocker2.auctionStartTime() + 10
    chain.mine(timestamp=target_time)

    termAuctionGroup = (auction2, termAuctionBidLocker2, termAuctionOfferLocker2)
    termRepoCollateralManager.reopenToNewAuction(termAuctionGroup, {"from": termInitializer})
    termRepoServicer.reopenToNewAuction(termAuctionGroup, {"from": termInitializer})

    # We need another bid in the system to prevent the action being cancelled (see:rollover_cancel)
    # Set a very low price so it doesn't win
    bid_price3 = 123  # (9 decimal places)
    bid_nonce3 = 555
    bid_amount3 = 10  # min. tender amount
    collateral_amount3 = 100
    bid_id3 = web3.keccak(text="carol-bid-one")
    bid_price_hash3 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price3, bid_nonce3]))
    bid_submission3 = [
        bid_id3,
        carol.address,
        bid_price_hash3,
        bid_amount3,
        [collateral_amount3],
        usdc,
        [wbtc],
    ]

    tx = termAuctionBidLocker2.lockBids([bid_submission3], {"from": carol})
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

    # Advance past the 2nd auction's reveal time
    target_time = termAuctionBidLocker2.revealTime() + 10
    chain.mine(timestamp=target_time)

    # Reveal (some) bids and offers
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

    # Complete the second auction
    tx = auction2.completeAuction(complete_auction_input, {"from": owner})
    print(tx.info())
