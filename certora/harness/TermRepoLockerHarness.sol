//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermRepoLocker.sol";
contract TermRepoLockerHarness is
    TermRepoLocker
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function emitterAddress() external view returns (address) {
        return address(emitter);
    }
}
