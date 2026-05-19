//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermAuctionBidLocker} from "../TermAuctionBidLocker.sol";
import {TermAuctionRevealedBid} from "../lib/TermAuctionRevealedBid.sol";
import {TermAuctionBid} from "../lib/TermAuctionBid.sol";

contract TestingTermAuctionBidLocker is TermAuctionBidLocker {
    TermAuctionRevealedBid[] public auctionBids;
    TermAuctionBid[] public bidsToUnlock;

    function obfuscateBid(
        TermAuctionRevealedBid memory revealed,
        uint256 nonce
    ) public pure returns (TermAuctionBid memory hidden) {
        if (revealed.isRollover) {
            return
                TermAuctionBid({
                    id: revealed.id,
                    bidder: revealed.bidder,
                    bidPriceHash: keccak256(
                        abi.encode(revealed.bidPriceRevealed, nonce)
                    ),
                    bidPriceRevealed: revealed.bidPriceRevealed,
                    amount: revealed.amount,
                    collateralAmounts: revealed.collateralAmounts,
                    purchaseToken: revealed.purchaseToken,
                    collateralTokens: revealed.collateralTokens,
                    isRollover: revealed.isRollover,
                    rolloverPairOffTermRepoServicer: revealed
                        .rolloverPairOffTermRepoServicer,
                    isRevealed: true
                });
        }
        return
            TermAuctionBid({
                id: revealed.id,
                bidder: revealed.bidder,
                bidPriceHash: keccak256(
                    abi.encode(revealed.bidPriceRevealed, nonce)
                ),
                bidPriceRevealed: 0,
                amount: revealed.amount,
                collateralAmounts: revealed.collateralAmounts,
                purchaseToken: revealed.purchaseToken,
                collateralTokens: revealed.collateralTokens,
                isRollover: revealed.isRollover,
                rolloverPairOffTermRepoServicer: revealed
                    .rolloverPairOffTermRepoServicer,
                isRevealed: false
            });
    }

    function testGetAllBids(
        bytes32[] calldata revealedBids,
        bytes32[] calldata expiredRolloverBids,
        bytes32[] calldata unrevealedBids
    ) external {
        (
            TermAuctionRevealedBid[] memory memoryAuctionBids,
            TermAuctionBid[] memory memoryUnlockBids
        ) = _getAllBids(revealedBids, expiredRolloverBids, unrevealedBids);
        for (uint256 i = 0; i < memoryAuctionBids.length; ++i) {
            auctionBids.push(memoryAuctionBids[i]);
        }
        for (uint256 i = 0; i < memoryUnlockBids.length; ++i) {
            bidsToUnlock.push(memoryUnlockBids[i]);
        }
    }

    function addBid(TermAuctionRevealedBid calldata bid, uint256 nonce) public {
        // Add bid to auction.

        bids[bid.id] = obfuscateBid(bid, nonce);
        bidCount += 1;
    }

    function setStartTime(uint256 auctionStartTime_) public {
        auctionStartTime = auctionStartTime_;
    }

    function setEndTime(uint256 auctionEndTime_) public {
        auctionEndTime = auctionEndTime_;
    }

    function setRevealTime(uint256 revealTime_) public {
        revealTime = revealTime_;
    }

    function getBidCount() public view returns (uint256) {
        return bidCount;
    }

    function setBidCount(uint256 bidCount_) public {
        bidCount = bidCount_;
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
