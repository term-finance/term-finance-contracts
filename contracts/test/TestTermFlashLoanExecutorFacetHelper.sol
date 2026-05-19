// SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {TermFlashLoanExecutorFacet} from "../facets/flashloan/TermFlashLoanExecutorFacet.sol";
import {PreviewAction} from "../lib/PreviewAction.sol";
import {LibTermStorage} from "../libraries/LibTermStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestMockRepoTokenFull} from "./TestMockRepoTokenFull.sol";

contract TestTermFlashLoanExecutorFacetHelper is TermFlashLoanExecutorFacet {
    mapping(bytes4 => address) private _facetAddresses;
    mapping(bytes4 => PreviewAction) private _mockPreviews;
    mapping(bytes4 => bytes) private _mockCalldatas;

    constructor(address agg) TermFlashLoanExecutorFacet(agg) {}

    // IDiamondLoupe.facetAddress
    function facetAddress(bytes4 sel) external view returns (address) {
        return _facetAddresses[sel];
    }

    function setFacetAddress(bytes4 sel, address f) external {
        _facetAddresses[sel] = f;
    }

    // TermFlashHookFacet.generateActionCalldata — same ABI selector
    function generateActionCalldata(
        address,
        address,
        uint256,
        address,
        uint256,
        bytes4 sel,
        address,
        bytes memory
    ) external view returns (PreviewAction memory, bytes memory) {
        return (_mockPreviews[sel], _mockCalldatas[sel]);
    }

    function setMockAction(
        bytes4 sel,
        PreviewAction calldata preview,
        bytes calldata data_
    ) external {
        _mockPreviews[sel] = preview;
        _mockCalldatas[sel] = data_;
    }

    // Action target called via functionCall(address(this), calldata)
    function mockSwap(
        address tokenIn,
        uint256 burnAmt,
        address tokenOut,
        uint256 mintAmt
    ) external {
        if (burnAmt > 0) IERC20(tokenIn).transfer(address(1), burnAmt);
        if (mintAmt > 0) TestMockRepoTokenFull(tokenOut).mint(address(this), mintAmt);
    }

    // Direct storage writers (bypass _setFlashLoanBorrower guard)
    function setFlashLoanBorrower(address b) external {
        LibTermStorage.termFlashLoanContext().activeFlashLoanBorrower = b;
    }

    function clearFlashLoanBorrower() external {
        LibTermStorage.termFlashLoanContext().activeFlashLoanBorrower = address(0);
    }
}
