//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermRepoTokenIntentFacet} from "../facets/TermRepoTokenIntentFacet.sol";
import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";

/// @title TestTermRepoTokenIntentHookFacetHelper
/// @notice Extends TermRepoTokenIntentFacet with storage manipulation functions for testing
contract TestTermRepoTokenIntentHookFacetHelper is TermRepoTokenIntentFacet {

    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllers[controller] = true;
    }

    function addApprovedFeeRecipient(address recipient) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedFeeRecipients[recipient] = true;
    }

    function setActiveFlashLoanBorrower(address borrower) external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = borrower;
    }

    function clearActiveFlashLoanBorrower() external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = address(0);
    }

    function setPreSignedSwapOrder(bytes32 orderHash, address signer) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.preSignedSwapOrders[orderHash] = signer;
    }

    function setEmitter(address emitter) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.emitter = ITermEventEmitter(emitter);
    }
}
