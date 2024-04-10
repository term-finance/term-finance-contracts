//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermAuction.sol";

contract TermAuctionHarness is
    TermAuction
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }
}
