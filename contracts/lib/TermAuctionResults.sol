//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {AuctionMetadata} from "./AuctionMetadata.sol";

struct TermAuctionResults {
    AuctionMetadata[] auctionMetadata;
    uint8 numOfAuctions;
}