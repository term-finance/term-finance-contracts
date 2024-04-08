//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermRepoRolloverManager.sol";
contract TermRepoRolloverManagerHarness is
    TermRepoRolloverManager
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function collateralManager() external view returns (address) {
        return address(termRepoCollateralManager);
    }

    function repoServicer() external view returns (address) {
        return address(termRepoServicer);
    }

    function repoCollateralManager() external view returns (address) {
        return address(termRepoCollateralManager);
    }

    function getRolloverBidId(address borrower) external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), borrower));
    }

    function controller() external view returns (address) {
        return address(termController);
    }

    function eventEmitter() external view returns (address) {
        return address(emitter);
    }

    function isRolloverAuctionApproved(address bidLocker) external view returns (bool) {
        return approvedRolloverAuctionBidLockers[
            bidLocker
        ];
    }
}
