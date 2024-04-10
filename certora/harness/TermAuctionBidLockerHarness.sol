//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermAuctionBidLocker.sol";
import {TermAuctionBid} from "../../contracts/lib/TermAuctionBid.sol";
import {Collateral} from "../../contracts/lib/Collateral.sol";

contract TermAuctionBidLockerHarness is
    TermAuctionBidLocker
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function harnessBidExists(bytes32 bidId) external view returns (bool) {
        return bids[bidId].amount != 0;
    }

    function getReentrancyGuardEntered() external view returns (bool) {
       return _reentrancyGuardEntered();
    }

    function harnessGetInternalBids(bytes32 bidId) external view returns (TermAuctionBid memory) {
        return bids[bidId];
    }

    function harnessGetInternalBidId(bytes32 bidId) external view returns (bytes32) {
        return bids[bidId].id;
    }
    
    function harnessGetInternalBidBidder(bytes32 bidId) external view returns (address) {
        return bids[bidId].bidder;
    }

    function harnessGetInternalBidBidPriceHash(bytes32 bidId) external view returns (bytes32) {
        return bids[bidId].bidPriceHash;
    }

    function harnessGetInternalBidBidRevealedPrice(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].bidPriceRevealed;
    }

    function harnessGetInternalBidAmount(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].amount;
    }

    function harnessGetInternalBidCollateralAmount(bytes32 bidId, uint256 collateralIndex) external view returns (uint256) {
        return bids[bidId].collateralAmounts[collateralIndex];
    }

    function harnessGetInternalBidIsRollover(bytes32 bidId) external view returns (bool) {
        return bids[bidId].isRollover;
    }

    function harnessGetInternalBidRolloverPairOffTermRepoServicer(bytes32 bidId) external view returns (address) {
        return bids[bidId].rolloverPairOffTermRepoServicer;
    }

    function harnessGetInternalBidIsRevealed(bytes32 bidId) external view returns (bool) {
        return bids[bidId].isRevealed;
    }

    function harnessGenerateBidPriceHash(uint256 price, uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(price, nonce));
    }

    function harnessGetInternalBidPurchaseToken(bytes32 bidId) external view returns (address) {
        return bids[bidId].purchaseToken;
    }

    function harnessGetInternalBidCollateralToken(bytes32 bidId, uint256 collateralIndex) external view returns (address) {
        return bids[bidId].collateralTokens[collateralIndex];
    }

    function harnessGetInternalBidCollateralTokenCount(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].collateralTokens.length;
    }

    function harnessGetInternalBidCollateralAmountCount(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].collateralAmounts.length;
    }

    function harnessCompareIncomingBidWithInternalBid(TermAuctionBid calldata incomingBid, bytes32 bidId) external view returns (bool) {
        return (
            incomingBid.id == bids[bidId].id &&
            incomingBid.bidder == bids[bidId].bidder &&
            incomingBid.bidPriceHash == bids[bidId].bidPriceHash &&
            incomingBid.bidPriceRevealed == bids[bidId].bidPriceRevealed &&
            incomingBid.amount == bids[bidId].amount &&
            incomingBid.collateralAmounts[0] == bids[bidId].collateralAmounts[0] &&
            incomingBid.collateralAmounts[1] == bids[bidId].collateralAmounts[1] &&
            incomingBid.purchaseToken == bids[bidId].purchaseToken &&
            incomingBid.collateralTokens[0] == bids[bidId].collateralTokens[0] &&
            incomingBid.collateralTokens[1] == bids[bidId].collateralTokens[1] &&
            incomingBid.isRollover == bids[bidId].isRollover &&
            incomingBid.rolloverPairOffTermRepoServicer == bids[bidId].rolloverPairOffTermRepoServicer &&
            incomingBid.isRevealed == bids[bidId].isRevealed
        );
    }
    function lockedBidAmount(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].amount;
    }

    function harnessIsInInitialCollateralShortFall(uint256 bidAmount, address[] memory collateralTokens_, uint256[] memory collateralAmounts) external returns (bool) {
        return _isInInitialCollateralShortFall(bidAmount, collateralTokens_, collateralAmounts);
    }

    function harnessBidCollateralAmountsLength(bytes32 bidId) external view returns (uint256) {
        return bids[bidId].collateralAmounts.length;
    }

    function harnessContainsBidId(TermAuctionBidSubmission[] calldata bids, bytes32 bidId) external view returns (bool) {
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].id == bidId) {
                return true;
            }
        }
        return false;
    }

    function harnessGenerateBidId(bytes32 id, address user) external view returns (bytes32) {
        return _generateBidId(id, user);
    }

    function generateBidIdPreview(bytes32 id, address user) external view returns (bytes32) {
        return keccak256(
            abi.encodePacked(id, user, address(this))
        );
    }

    function harnessReentrancyGuardEntered() external view returns (bool) {
        return _reentrancyGuardEntered();
    }
}
