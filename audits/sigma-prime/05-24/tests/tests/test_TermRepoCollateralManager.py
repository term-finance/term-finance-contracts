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

from helpers import (
    get_encoded_termRepoId,
    make_term_auth,
    make_term_auth_no_sig,
    do_auction,
    custom_error,
)
from eth_abi import encode_abi

"""
This file contains the previous tests for batchLiquidation (as the code was refactored) and also the
new test for batchLiquidationWithRepoToken
"""


def test_batchLiquidation_full(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    termRepoToken = setup_protocol["termRepoToken"]

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == 22_000 * 10 ** usdc.decimals()
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 0
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Do first auction
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

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) == 0
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 22000003238
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 97167303  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == 1.5 * 10 ** wbtc.decimals()
    )  # Protocol holds Alice's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(14_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Fake some liquidity in TermRepoLocker
    wbtc.transfer(termRepoLocker, 10 * 10 ** wbtc.decimals(), {"from": owner})

    # Liquidate
    ##
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 1

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [termRepoServicer.getBorrowerRepurchaseObligation(alice) * 0.5, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    tx = termRepoCollateralManager.batchLiquidation(
        alice,
        [termRepoServicer.getBorrowerRepurchaseObligation(alice) * 0.5, 0],
        # term_auth_carol,
        {"from": carol},
    )

    assert usdc.balanceOf(carol) == 18999998381
    assert wbtc.balanceOf(carol) == 80142869
    assert usdc.balanceOf(termRepoLocker) == 11000001619

    # Liquidate again, this time full amount
    ##
    expirationTimestamp = chain.time() + 300  # + 5m
    txContract = termRepoCollateralManager.address
    nonce = 2

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    print(
        "Collateral Balance WBTC alice:",
        termRepoCollateralManager.getCollateralBalance(alice, wbtc),
    )

    # print(
    #     "Collateral Seizure Amounts alice:",
    #     termRepoCollateralManager._collateralSeizureAmounts(
    #         termRepoServicer.getBorrowerRepurchaseObligation(alice), wbtc.address
    #     ),
    # )

    print(
        "getCollateralMarketValue alice:", termRepoCollateralManager.getCollateralMarketValue(alice)
    )
    print(
        "submit estimate:",
        termRepoCollateralManager.getCollateralMarketValue(alice) // 1050000000000,
    )
    print(
        "getBorrowerRepurchaseObligation alice:",
        termRepoServicer.getBorrowerRepurchaseObligation(alice),
    )
    # print(
    #     termRepoCollateralManager._validateBatchLiquidationForFullLiquidation(
    #         alice, carol, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0]
    #     )
    # )
    # This is calculated from the values returned above
    amount_to_submit = 67499988 * 11000001619 // 82500012
    print("amount_to_submit", amount_to_submit)

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [amount_to_submit, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.batchLiquidation(
        alice,
        [amount_to_submit, 0],
        # term_auth_carol,
        {"from": carol},
    )
    print(tx.info())

    print(
        "Collateral Balance WBTC alice:",
        termRepoCollateralManager.getCollateralBalance(alice, wbtc),
    )

    # print(
    #     "Collateral Seizure Amounts alice:",
    #     termRepoCollateralManager._collateralSeizureAmounts(
    #         termRepoServicer.getBorrowerRepurchaseObligation(alice), wbtc.address
    #     ),
    # )

    print(
        "getCollateralMarketValue alice:", termRepoCollateralManager.getCollateralMarketValue(alice)
    )
    print(
        "getBorrowerRepurchaseObligation alice:",
        termRepoServicer.getBorrowerRepurchaseObligation(alice),
    )

    # Alice has no more collateral
    assert termRepoCollateralManager.getCollateralMarketValue(alice) == 0
    assert termRepoCollateralManager.getCollateralBalance(alice, wbtc) == 0

    # Carol now has most of the WBTC
    assert wbtc.balanceOf(carol) > collateral_amount1 * 0.9


def test_batchLiquidation_exceedexposure(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    termRepoToken = setup_protocol["termRepoToken"]

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == 22_000 * 10 ** usdc.decimals()
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 0
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Do first auction
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

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) == 0
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 22000003238
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 97167303  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == 1.5 * 10 ** wbtc.decimals()
    )  # Protocol holds Alice's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(14_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Fake some liquidity in TermRepoLocker
    wbtc.transfer(termRepoLocker, 10 * 10 ** wbtc.decimals(), {"from": owner})

    # Liquidate
    ##
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 1

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [termRepoServicer.getBorrowerRepurchaseObligation(alice) * 0.5, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    tx = termRepoCollateralManager.batchLiquidation(
        alice,
        [termRepoServicer.getBorrowerRepurchaseObligation(alice) * 0.5, 0],
        # term_auth_carol,
        {"from": carol},
    )

    assert usdc.balanceOf(carol) == 18999998381
    assert wbtc.balanceOf(carol) == 80142869
    assert usdc.balanceOf(termRepoLocker) == 11000001619

    # Liquidate again, this time full amount
    ##
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 2

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # Add collateral, just enough so we don't get insufficient collateral error, but still in shortfall
    ##
    expirationTimestamp = chain.time() + 300  # + 5m
    txContract = termRepoCollateralManager.address
    nonce = 3

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalLockCollateral.encode_input(
    #     wbtc, 0.3 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalLockCollateral(
        wbtc, 0.3 * 10 ** wbtc.decimals(), {"from": alice}
    )

    # Liquidate again, this time full amount
    ##
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 4

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # We are liquidating too many tokens, so we expect to revert with ExceedsNetExposureCapOnLiquidation()
    with reverts(custom_error("ExceedsNetExposureCapOnLiquidation()")):
        tx = termRepoCollateralManager.batchLiquidation(
            alice,
            [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0],
            # term_auth_carol,
            {"from": carol},
        )

    # Claim USDC by burning repo tokens
    #
    maturityTimestamp = 2592000  # 30 days (in s)
    repurchaseWindow = 86400  # 1 day (in s)
    redemptionBuffer = 300  # 5 minutes (in s)
    chain.mine(
        timedelta=maturityTimestamp + repurchaseWindow + redemptionBuffer + 360000000
    )  # advance past maturity

    # Burn repo tokens to receive USDC back - can't claim as there's still Alice's encumbered collateral
    with reverts(custom_error("EncumberedCollateralRemaining()")):
        tx = termRepoServicer.redeemTermRepoTokens(bob, termRepoToken.balanceOf(bob), {"from": bob})

    # Bob's USDC balance is still 0
    assert termRepoToken.balanceOf(bob) == 22000003238
    assert usdc.balanceOf(bob) == 0

    # Liquidate again, full amount this time
    ##
    expirationTimestamp = chain.time() + 300  # + 5m
    txContract = termRepoCollateralManager.address
    nonce = 5

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # Cannot liquidate as we're past repurchase window, but should be able to default
    with reverts(custom_error("ShortfallLiquidationsClosed()")):
        tx = termRepoCollateralManager.batchLiquidation(
            alice,
            [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0],
            # term_auth_carol,
            {"from": carol},
        )

    # Default
    ##
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 6

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchDefault.encode_input(
    #     alice, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # [!] This would revert with `InsufficientCollateralForLiquidationRepayment()` if additional
    # collateral wasn't added earlier on via `externalLockCollateral()`.
    tx = termRepoCollateralManager.batchDefault(
        alice,
        [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0],
        # term_auth_carol,
        {"from": carol},
    )

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) == 0

    # Claim USDC by burning repo tokens to receive USDC back
    tx = termRepoServicer.redeemTermRepoTokens(bob, termRepoToken.balanceOf(bob), {"from": bob})

    assert termRepoToken.balanceOf(bob) == 0
    assert usdc.balanceOf(bob) == 22000003238


def test_batchLiquidation(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    termRepoToken = setup_protocol["termRepoToken"]

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == 22_000 * 10 ** usdc.decimals()
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 0
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Do first auction
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

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) == 0
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 22000003238
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 97167303  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == 1.5 * 10 ** wbtc.decimals()
    )  # Protocol holds Alice's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Add collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 2

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalLockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalLockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price increase!
    tx = mockCollateralFeed_wbtc.setAnswer(22_000 * 10 ** usdc.decimals())

    # Remove collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 3

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalUnlockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalUnlockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Fake some liquidity in TermRepoLocker
    wbtc.transfer(termRepoLocker, 1 * 10 ** wbtc.decimals(), {"from": owner})

    # Liquidate
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 4

    liquidate_amount = 100000

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [liquidate_amount, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()
    assert wbtc.balanceOf(carol) == 0
    assert usdc.balanceOf(termRepoLocker) == 0

    tx = termRepoCollateralManager.batchLiquidation(
        alice,
        [liquidate_amount, 0],
        # term_auth_carol,
        {"from": carol},
    )

    # Check balances
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals() - liquidate_amount
    assert wbtc.balanceOf(carol) > 0
    assert usdc.balanceOf(termRepoLocker) > 0


def test_batchLiquidation_insufficientCollateral(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == 22_000 * 10 ** usdc.decimals()
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Do first auction
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

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) == 0
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 97167303  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == 1.5 * 10 ** wbtc.decimals()
    )  # Protocol holds Alice's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Add collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 2

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalLockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalLockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price increase!
    tx = mockCollateralFeed_wbtc.setAnswer(22_000 * 10 ** usdc.decimals())

    # Remove collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 3

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalUnlockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalUnlockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Huge price drop so the collateral is not enough to cover it
    tx = mockCollateralFeed_wbtc.setAnswer(4_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Liquidate
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 4

    liquidation_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.batchLiquidation.encode_input(
    #     alice, [liquidation_amount, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # This reverts with "InsufficientCollateralForLiquidationRepayment" error.
    # _collateralSeizureAmounts() calculates amounts based on current price and then transfers out
    # from termRepoLocker a portion for the protocol fee and then part for the liquidator.
    with reverts(custom_error("InsufficientCollateralForLiquidationRepayment(address)",[wbtc.address])):
        tx = termRepoCollateralManager.batchLiquidation(
            alice,
            [liquidation_amount, 0],
            # term_auth_carol,
            {"from": carol},
        )


def test_batchLiquidationWithRepoToken(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    digby,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    termRepoToken = setup_protocol["termRepoToken"]

    print(custom_error("ExceedsNetExposureCapOnLiquidation()"))  # 0x2d406e3a
    print(
        custom_error("InsufficientCollateralForLiquidationRepayment(address)", [wbtc.address])
    )  # 0x98de3335000000000000000000000000602c71e4dac47a042ee7f46e0aee17f94a3ba0b6
    print(custom_error("EncumberedCollateralRemaining()"))  # 0xfabbdb54
    print(custom_error("RepurchaseAmountTooHigh()"))  # 0xbcb83fa0

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    bid_price2 = bid_price1
    bid_amount2 = bid_amount1 * 100
    collateral_amount2 = collateral_amount1 * 100

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    offer_amount1 *= 200

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    # Give Digby some collateral and allow transfer by the locker
    wbtc.transfer(digby, 250 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": digby})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == offer_amount1  # 4,400,000
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0
    assert wbtc.balanceOf(digby) == 250 * 10 ** wbtc.decimals()

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 0
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

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

    alice_nonce = 0
    digby_nonce = 1
    bob_nonce = 2

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termAuctionBidLocker.address
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(alice, alice_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1], termAuth_nosig)
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(alice, alice_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit alice's bids
    tx = termAuctionBidLocker.lockBids([bid_submission1], {"from": alice})
    bid_id1 = tx.events[1]["id"]

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id2 = web3.keccak(text="digby-bid-one")
    bid_nonce2 = 666
    bid_price_hash2 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price2, bid_nonce2]))
    bid_submission2 = [
        bid_id2,
        digby.address,
        bid_price_hash2,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(digby, digby_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission2], termAuth_nosig)
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(digby, digby_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit digby's bids
    tx = termAuctionBidLocker.lockBids([bid_submission2], {"from": digby})
    bid_id2 = tx.events[1]["id"]

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 333
    offer_price_hash1 = web3.keccak(
        encode_abi(["uint256", "uint256"], [offer_price1, offer_nonce1])
    )
    offer_submission1 = [
        offer_id1,
        bob.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termAuctionOfferLocker.address
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(bob, bob_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input(
    #     [offer_submission1], termAuth_nosig
    # )
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(bob, bob_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit bob's offers
    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": bob})
    offer_id1 = tx.events[2]["id"]

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id1, bid_id2],
        [],
        [],
        [offer_id1],
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker.revealBids(
        [bid_id1, bid_id2], [bid_price1, bid_price2], [bid_nonce1, bid_nonce2], {"from": alice}
    )
    tx = termAuctionOfferLocker.revealOffers(
        [offer_id1], [offer_price1], [offer_nonce1], {"from": bob}
    )

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) < offer_amount1
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 2222000327129
    assert termRepoToken.balanceOf(carol) == 0

    # liquidation_token_amount = 1000000000
    liquidation_token_amount = 250000000 * 1000000000 // 5833333  # 42857145306.12259
    print("liquidation_token_amount", liquidation_token_amount)
    liquidation_token_amount = 42857145306

    # Bob gives his termRepoTokens to Carol so she can liquidate Alice
    termRepoToken.transfer(carol, liquidation_token_amount, {"from": bob})

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 9813897627  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == collateral_amount1 + collateral_amount2
    )  # Protocol holds Alice and Digby's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Add collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 2

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalLockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalLockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price increase!
    tx = mockCollateralFeed_wbtc.setAnswer(22_000 * 10 ** usdc.decimals())

    # Remove collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 3

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalUnlockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalUnlockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Fake some liquidity in TermRepoLocker
    wbtc.transfer(termRepoLocker, 1 * 10 ** wbtc.decimals(), {"from": owner})

    # Liquidate
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 4

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # Before liquidation, Carol should have no WBTC
    assert wbtc.balanceOf(carol) == 0

    print("WBTC Locker:", wbtc.balanceOf(termRepoLocker))
    print("Borrower Repurchase Obligation", termRepoServicer.getBorrowerRepurchaseObligation(alice))
    liquidation_token_amount = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # token_supply = termRepoToken.totalSupply()
    # print("total repo tokens", token_supply)
    # token_supply_value = termRepoToken.totalRedemptionValue()
    # print("total repo token value", token_supply_value)

    print(
        "Collateral Balance WBTC alice:",
        termRepoCollateralManager.getCollateralBalance(alice, wbtc),
    )

    # print(
    #     "Collateral Seizure Amounts alice:",
    #     termRepoCollateralManager._collateralSeizureAmounts(
    #         termRepoServicer.getBorrowerRepurchaseObligation(alice), wbtc.address
    #     ),
    # )

    print(
        "getCollateralMarketValue alice:", termRepoCollateralManager.getCollateralMarketValue(alice)
    )
    print(
        "submit estimate:",
        termRepoCollateralManager.getCollateralMarketValue(alice) // 1050000000000,
    )
    print(
        "getBorrowerRepurchaseObligation alice:",
        termRepoServicer.getBorrowerRepurchaseObligation(alice),
    )
    # print(
    #     termRepoCollateralManager._validateBatchLiquidationForFullLiquidation(
    #         alice, carol, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0]
    #     )
    # )
    # This is calculated from the values returned above
    liquidation_token_amount = 10000
    print("amount_to_submit", liquidation_token_amount)

    # txMsgData_nosig = termRepoCollateralManager.batchLiquidationWithRepoToken.encode_input(
    #     alice, [liquidation_token_amount, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    carol_repo_balance_before = termRepoToken.balanceOf(carol)
    carol_wbtc_balance_before = wbtc.balanceOf(carol)
    alice_repurchase_obligation_before = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    # Perform the small liquidation - within exposure cap
    tx = termRepoCollateralManager.batchLiquidationWithRepoToken(
        alice,
        [liquidation_token_amount, 0],
        # term_auth_carol,
        {"from": carol},
    )

    assert (
        termRepoServicer.getBorrowerRepurchaseObligation(alice) < alice_repurchase_obligation_before
    )
    assert termRepoToken.balanceOf(carol) < carol_repo_balance_before
    assert wbtc.balanceOf(carol) > carol_wbtc_balance_before


def test_batchLiquidationWithRepoToken_full(
    setup_protocol,
    constants,
    owner,
    alice,
    bob,
    carol,
    digby,
    protocolReserveAddress,
    treasuryAddress,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
):
    termRepoCollateralManager = setup_protocol["termRepoCollateralManager"]
    oracle = setup_protocol["oracle"]
    auction = setup_protocol["auction"]
    termAuctionBidLocker = setup_protocol["termAuctionBidLocker"]
    termAuctionOfferLocker = setup_protocol["termAuctionOfferLocker"]
    termRepoLocker = setup_protocol["termRepoLocker"]
    termRepoServicer = setup_protocol["termRepoServicer"]
    mockCollateralFeed_wbtc = setup_protocol["mockCollateralFeed_wbtc"]
    usdc = setup_protocol["usdc"]  # Purchase Token (6 decimals)
    wbtc = setup_protocol["wbtc"]  # Collateral Token (8 decimals)
    termRepoToken = setup_protocol["termRepoToken"]

    print(custom_error("ExceedsNetExposureCapOnLiquidation()"))  # 0x2d406e3a
    print(
        custom_error("InsufficientCollateralForLiquidationRepayment(address)", [wbtc.address])
    )  # 0x98de3335000000000000000000000000602c71e4dac47a042ee7f46e0aee17f94a3ba0b6
    print(custom_error("EncumberedCollateralRemaining()"))  # 0xfabbdb54
    print(custom_error("RepurchaseAmountTooHigh()"))  # 0xbcb83fa0

    bid_price1 = 100 * 10**9  # 100% (9 decimal places)
    bid_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    collateral_amount1 = 1.5 * 10 ** wbtc.decimals()

    bid_price2 = bid_price1
    bid_amount2 = bid_amount1 * 100
    collateral_amount2 = collateral_amount1 * 100

    offer_price1 = 100 * 10**9  # 100% (9 decimal places)
    offer_amount1 = 22000 * 10 ** usdc.decimals()  # min. tender amount
    offer_amount1 *= 200

    # Give Alice some collateral and allow transfer by the locker
    wbtc.transfer(alice, 2.5 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": alice})

    # Give Bob some purchase token and allow transfer by the locker
    usdc.transfer(bob, offer_amount1, {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": bob})

    # Give Carol some purchase token and allow transfer by the locker
    usdc.transfer(carol, 30_000 * 10 ** usdc.decimals(), {"from": owner})
    usdc.approve(termRepoLocker, constants.MAX_UINT256, {"from": carol})

    # Give Digby some collateral and allow transfer by the locker
    wbtc.transfer(digby, 250 * 10 ** wbtc.decimals(), {"from": owner})
    wbtc.approve(termRepoLocker, constants.MAX_UINT256, {"from": digby})

    ## BEFORE AUCTION
    ##
    assert usdc.balanceOf(alice) == 0
    assert usdc.balanceOf(bob) == offer_amount1  # 4,400,000
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 2.5 * 10 ** wbtc.decimals()
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0
    assert wbtc.balanceOf(digby) == 250 * 10 ** wbtc.decimals()

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 0
    assert termRepoToken.balanceOf(carol) == 0

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 0

    assert wbtc.balanceOf(termRepoLocker) == 0
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

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

    alice_nonce = 0
    digby_nonce = 1
    bob_nonce = 2

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termAuctionBidLocker.address
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(alice, alice_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission1], termAuth_nosig)
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(alice, alice_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit alice's bids
    tx = termAuctionBidLocker.lockBids([bid_submission1], {"from": alice})
    bid_id1 = tx.events[1]["id"]

    # The bid submission struct (lib/TermAuctionBidSubmission.sol)
    bid_id2 = web3.keccak(text="digby-bid-one")
    bid_nonce2 = 666
    bid_price_hash2 = web3.keccak(encode_abi(["uint256", "uint256"], [bid_price2, bid_nonce2]))
    bid_submission2 = [
        bid_id2,
        digby.address,
        bid_price_hash2,
        bid_amount2,
        [collateral_amount2],
        usdc,
        [wbtc],
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(digby, digby_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionBidLocker.lockBids.encode_input([bid_submission2], termAuth_nosig)
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(digby, digby_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit digby's bids
    tx = termAuctionBidLocker.lockBids([bid_submission2], {"from": digby})
    bid_id2 = tx.events[1]["id"]

    # The offer submission struct (lib/TermAuctionOfferSubmission.sol)
    offer_id1 = web3.keccak(text="bob-offer-one")
    offer_nonce1 = 333
    offer_price_hash1 = web3.keccak(
        encode_abi(["uint256", "uint256"], [offer_price1, offer_nonce1])
    )
    offer_submission1 = [
        offer_id1,
        bob.address,
        offer_price_hash1,
        offer_amount1,
        usdc,
    ]

    # Create the authentication token (address user, uint256 nonce, bytes signature)
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termAuctionOfferLocker.address
    # # 1. create term auth with dummy signature
    # termAuth_nosig = make_term_auth_no_sig(bob, bob_nonce, expirationTimestamp)
    # # 2. get txMsgData with termAuth with dummy signature (above), which will be stripped anyway
    # txMsgData_nosig = termAuctionOfferLocker.lockOffers.encode_input(
    #     [offer_submission1], termAuth_nosig
    # )
    # # 3. create termAuth with proper signature in it (txMsgData is stripped of dummy sig)
    # term_auth = make_term_auth(bob, bob_nonce, expirationTimestamp, txContract, txMsgData_nosig)

    # Submit bob's offers
    tx = termAuctionOfferLocker.lockOffers([offer_submission1], {"from": bob})
    offer_id1 = tx.events[2]["id"]

    # Create the CompleteAuctionInput struct tests/contracts/lib/CompleteAuctionInput.sol
    complete_auction_input = [
        [bid_id1, bid_id2],
        [],
        [],
        [offer_id1],
        [],
    ]

    # Advance past the reveal time
    chain.mine(timedelta=86500)

    # Reveal (some) bids and offers
    tx = termAuctionBidLocker.revealBids(
        [bid_id1, bid_id2], [bid_price1, bid_price2], [bid_nonce1, bid_nonce2], {"from": alice}
    )
    tx = termAuctionOfferLocker.revealOffers(
        [offer_id1], [offer_price1], [offer_nonce1], {"from": bob}
    )

    # Complete the auction
    tx = auction.completeAuction(complete_auction_input, {"from": owner})

    ## AFTER AUCTION
    ##
    assert usdc.balanceOf(alice) == 21902832697  # Minus fee that went to treasury
    assert usdc.balanceOf(bob) < offer_amount1
    assert usdc.balanceOf(carol) == 30_000 * 10 ** usdc.decimals()

    assert wbtc.balanceOf(alice) == 1 * 10 ** wbtc.decimals()  # Alice sent her WBTC as collateral
    assert wbtc.balanceOf(bob) == 0
    assert wbtc.balanceOf(carol) == 0

    assert termRepoToken.balanceOf(alice) == 0
    assert termRepoToken.balanceOf(bob) == 2222000327129
    assert termRepoToken.balanceOf(carol) == 0

    # Bob gives his termRepoTokens to Carol so she can liquidate Alice
    termRepoToken.transfer(carol, 2222000327129, {"from": bob})

    assert usdc.balanceOf(termRepoLocker) == 0
    assert usdc.balanceOf(protocolReserveAddress) == 0
    assert usdc.balanceOf(treasuryAddress) == 9813897627  # Small fee

    assert (
        wbtc.balanceOf(termRepoLocker) == collateral_amount1 + collateral_amount2
    )  # Protocol holds Alice and Digby's collateral
    assert wbtc.balanceOf(protocolReserveAddress) == 0
    assert wbtc.balanceOf(treasuryAddress) == 0

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Add collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 2

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalLockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalLockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price increase!
    tx = mockCollateralFeed_wbtc.setAnswer(22_000 * 10 ** usdc.decimals())

    # Remove collateral
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 3

    # termAuth_nosig = make_term_auth_no_sig(alice, nonce, expirationTimestamp)
    # txMsgData_nosig = termRepoCollateralManager.externalUnlockCollateral.encode_input(
    #     wbtc, 1 * 10 ** wbtc.decimals(), termAuth_nosig
    # )
    # term_auth_alice = make_term_auth(alice, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    tx = termRepoCollateralManager.externalUnlockCollateral(
        wbtc, 1 * 10 ** wbtc.decimals(), {"from": alice}
    )

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == False

    # Price drop!
    tx = mockCollateralFeed_wbtc.setAnswer(18_000 * 10 ** usdc.decimals())

    assert termRepoCollateralManager.isBorrowerInShortfall(alice) == True

    # Fake some liquidity in TermRepoLocker
    wbtc.transfer(termRepoLocker, 1 * 10 ** wbtc.decimals(), {"from": owner})

    # Liquidate
    # expirationTimestamp = chain.time() + 300  # + 5m
    # txContract = termRepoCollateralManager.address
    # nonce = 4

    # termAuth_nosig = make_term_auth_no_sig(carol, nonce, expirationTimestamp)

    assert termRepoServicer.getBorrowerRepurchaseObligation(alice) != 0

    # Before liquidation, Carol should have no WBTC
    assert wbtc.balanceOf(carol) == 0

    # Huge price drop so we can fully liquidate
    tx = mockCollateralFeed_wbtc.setAnswer(4_000 * 10 ** usdc.decimals())

    alice_wbtc_collateral_before = termRepoCollateralManager.getCollateralBalance(alice, wbtc)

    print("Collateral Balance WBTC alice:", alice_wbtc_collateral_before)

    # print(
    #     "Collateral Seizure Amounts alice:",
    #     termRepoCollateralManager._collateralSeizureAmounts(
    #         termRepoServicer.getBorrowerRepurchaseObligation(alice), wbtc.address
    #     ),
    # )

    print(
        "getCollateralMarketValue alice:", termRepoCollateralManager.getCollateralMarketValue(alice)
    )
    print(
        "submit estimate:",
        termRepoCollateralManager.getCollateralMarketValue(alice) // 1050000000000,
    )
    print(
        "getBorrowerRepurchaseObligation alice:",
        termRepoServicer.getBorrowerRepurchaseObligation(alice),
    )
    # print(
    #     termRepoCollateralManager._validateBatchLiquidationForFullLiquidation(
    #         alice, carol, [termRepoServicer.getBorrowerRepurchaseObligation(alice), 0]
    #     )
    # )
    # This is calculated from the values returned above
    liquidation_token_amount = 150000000 * 22000003238 // 577500084
    print("amount_to_submit", liquidation_token_amount)

    # txMsgData_nosig = termRepoCollateralManager.batchLiquidationWithRepoToken.encode_input(
    #     alice, [liquidation_token_amount, 0], termAuth_nosig
    # )
    # term_auth_carol = make_term_auth(carol, nonce, expirationTimestamp, txContract, txMsgData_nosig)

    carol_repo_balance_before = termRepoToken.balanceOf(carol)
    alice_repurchase_obligation_before = termRepoServicer.getBorrowerRepurchaseObligation(alice)

    assert wbtc.balanceOf(carol) == 0

    tx = termRepoCollateralManager.batchLiquidationWithRepoToken(
        alice,
        [liquidation_token_amount, 0],
        # term_auth_carol,
        {"from": carol},
    )
    print(tx.info())
    print("WBTC Locker:", wbtc.balanceOf(termRepoLocker))

    assert (
        termRepoServicer.getBorrowerRepurchaseObligation(alice) < alice_repurchase_obligation_before
    )
    assert termRepoToken.balanceOf(carol) < carol_repo_balance_before
    assert wbtc.balanceOf(carol) > alice_wbtc_collateral_before * 0.9
