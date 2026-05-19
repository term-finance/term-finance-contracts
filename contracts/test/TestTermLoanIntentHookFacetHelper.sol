//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermLoanIntentHookFacet} from "../facets/TermLoanIntentHookFacet.sol";
import {LibTermStorage, TermStorage, TermFlashLoanContext} from "../libraries/LibTermStorage.sol";

/// @title TestTermLoanIntentHookFacetHelper
/// @notice Extends TermLoanIntentHookFacet with storage manipulation functions for testing
contract TestTermLoanIntentHookFacetHelper is TermLoanIntentHookFacet {

    function addApprovedTermController(address controller) external {
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.approvedTermControllers[controller] = true;
    }

    function setActiveFlashLoanBorrower(address borrower) external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = borrower;
    }

    function clearActiveFlashLoanBorrower() external {
        TermFlashLoanContext storage tflc = LibTermStorage.termFlashLoanContext();
        tflc.activeFlashLoanBorrower = address(0);
    }

    // ---- settleLimitLend call recording ----

    uint256[][] private _recordedCollateralAmounts;

    /// @notice Records collateralAmounts for each settleLimitLend call so tests can verify proportional allocation
    function settleLimitLend(
        LimitLendOrder calldata,
        address,
        uint256,
        uint256[] calldata collateralAmounts,
        Signature calldata
    ) external {
        uint256[] memory copy = new uint256[](collateralAmounts.length);
        for (uint256 i = 0; i < collateralAmounts.length; i++) {
            copy[i] = collateralAmounts[i];
        }
        _recordedCollateralAmounts.push(copy);
    }

    function getRecordedCollateralAmounts(uint256 callIndex) external view returns (uint256[] memory) {
        return _recordedCollateralAmounts[callIndex];
    }

    /// @notice Mock implementation of getLendOrderHash for testing
    function getLendOrderHash(LimitLendOrder calldata order) external pure returns (bytes32) {
        return keccak256(abi.encode(order));
    }

    /// @notice Mock implementation of getBorrowOrderHash for testing
    function getBorrowOrderHash(LimitBorrowOrder calldata order) external pure returns (bytes32) {
        return keccak256(abi.encode(order));
    }
}
