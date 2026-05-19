//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermAuctionOfferLocker} from "../TermAuctionOfferLocker.sol";
import {TermAuctionRevealedOffer} from "../lib/TermAuctionRevealedOffer.sol";
import {TermAuctionOffer} from "../lib/TermAuctionOffer.sol";

contract TestingTermAuctionOfferLocker is TermAuctionOfferLocker {
    function obfuscateOffer(
        TermAuctionRevealedOffer memory revealed,
        uint256 nonce
    ) public pure returns (TermAuctionOffer memory hidden) {
        return
            TermAuctionOffer({
                id: revealed.id,
                offeror: revealed.offeror,
                offerPriceHash: keccak256(
                    abi.encode(revealed.offerPriceRevealed, nonce)
                ),
                offerPriceRevealed: revealed.offerPriceRevealed,
                amount: revealed.amount,
                purchaseToken: revealed.purchaseToken,
                isRevealed: false
            });
    }

    function addOffer(
        TermAuctionRevealedOffer calldata offer,
        uint256 nonce
    ) public {
        // Add offer to auction.

        offers[offer.id] = obfuscateOffer(offer, nonce);
        offerCount += 1;
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

    function getOfferCount() public view returns (uint256) {
        return offerCount;
    }

    function setOfferCount(uint256 offerCount_) public {
        offerCount = offerCount_;
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
