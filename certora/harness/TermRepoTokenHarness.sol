//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermRepoToken.sol";
contract TermRepoTokenHarness is
    TermRepoToken
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

}
