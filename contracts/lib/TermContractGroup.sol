//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {TermAuction} from "../TermAuction.sol";
import {TermAuctionBidLocker} from "../TermAuctionBidLocker.sol";
import {TermAuctionOfferLocker} from "../TermAuctionOfferLocker.sol";
import {TermRepoCollateralManager} from "../TermRepoCollateralManager.sol";
import {TermRepoLocker} from "../TermRepoLocker.sol";
import {TermRepoRolloverManager} from "../TermRepoRolloverManager.sol";
import {TermRepoServicer} from "../TermRepoServicer.sol";
import {TermRepoToken} from "../TermRepoToken.sol";

struct TermContractGroup {
    TermRepoLocker termRepoLocker;
    TermRepoServicer termRepoServicer;
    TermRepoCollateralManager termRepoCollateralManager;
    TermRepoRolloverManager rolloverManager;
    TermRepoToken termRepoToken;
    TermAuctionOfferLocker termAuctionOfferLocker;
    TermAuctionBidLocker termAuctionBidLocker;
    TermAuction auction;
}
