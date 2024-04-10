//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermAuctionOfferLocker.sol";
import {TermAuctionOffer} from "../../contracts/lib/TermAuctionOffer.sol";

contract TermAuctionOfferLockerHarness is
    TermAuctionOfferLocker
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function harnessGetInternalOffers(bytes32 offerId) external view returns (TermAuctionOffer memory) {
        return offers[offerId];
    }

    function harnessGenerateOfferPriceHash(uint256 price, uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(price, nonce));
    }

    function harnessOfferExists(bytes32 offerId) external view returns (bool) {
        return offers[offerId].amount != 0;
    }

    function harnessGetInternalOfferId(bytes32 offerId) external view returns (bytes32) {
        return offers[offerId].id;
    }

    function harnessGetInternalOfferOfferor(bytes32 offerId) external view returns (address) {
        return offers[offerId].offeror;
    }

    function harnessGetInternalOfferAmount(bytes32 offerId) external view returns (uint256) {
        return offers[offerId].amount;
    }

    function harnessGetInternalOfferIsRevealed(bytes32 offerId) external view returns (bool) {
        return offers[offerId].isRevealed;
    }

    function harnessGetInternalOfferOfferRevealedPrice(bytes32 offerId) external view returns (uint256) {
        return offers[offerId].offerPriceRevealed;
    }

    function harnessGetInternalOfferOfferPriceHash(bytes32 offerId) external view returns (bytes32) {
        return offers[offerId].offerPriceHash;
    }

    function harnessGetTermAuction() external view returns (address) {
        return address(termAuction);
    }

    function harnessCompareIncomingOfferWithInternalOffer(TermAuctionOffer calldata incomingOffer, bytes32 offerId) external view returns (bool) {
        return (
            incomingOffer.id == offers[offerId].id &&
            incomingOffer.offeror == offers[offerId].offeror &&
            incomingOffer.offerPriceHash == offers[offerId].offerPriceHash &&
            incomingOffer.offerPriceRevealed == offers[offerId].offerPriceRevealed &&
            incomingOffer.amount == offers[offerId].amount &&
            incomingOffer.purchaseToken == offers[offerId].purchaseToken &&
            incomingOffer.isRevealed == offers[offerId].isRevealed
        );
    }

    function harnessGenerateOfferId(bytes32 offerId, address offeror) external view returns (bytes32) {
        return _generateOfferId(offerId, offeror);
    }

    function generateOfferIdPreview(bytes32 id, address user) external view returns (bytes32) {
        return keccak256(
            abi.encodePacked(id, user, address(this))
        );
    }
    function harnessReentrancyGuardEntered() external view returns (bool) {
        return _reentrancyGuardEntered();
    }
}
