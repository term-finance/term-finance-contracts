//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermAuction} from "../TermAuction.sol";
import {TermAuctionRevealedBid} from "../lib/TermAuctionRevealedBid.sol";
import {TermAuctionRevealedOffer} from "../lib/TermAuctionRevealedOffer.sol";

contract TestingTermAuction is TermAuction {
    function calculateClearingPrice(
        TermAuctionRevealedBid[] memory sortedBids,
        TermAuctionRevealedOffer[] memory sortedOffers,
        uint256 clearingOffset
    ) public pure returns (uint256, uint256) {
        return
            _calculateClearingPrice(sortedBids, sortedOffers, clearingOffset);
    }

    function calculateRepurchasePrice(
        uint256 purchasePrice
    ) public view returns (uint256) {
        return _calculateRepurchasePrice(purchasePrice);
    }

    function setEndTime(uint256 auctionEndTime_) public {
        auctionEndTime = auctionEndTime_;
    }

    function upgrade(address upgradeAddress) external {
        _authorizeUpgrade(upgradeAddress);
    }
}
