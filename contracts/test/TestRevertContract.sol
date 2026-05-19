// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title TestRevertContract
 * @dev A test contract to simulate different revert scenarios for MulticallFacet testing
 */
contract TestRevertContract {
    
    /**
     * @notice Function that reverts with a standard revert message
     */
    function revertWithMessage() external pure {
        revert("This is a test revert message");
    }
    
    /**
     * @notice Function that reverts with a custom error
     */
    error CustomTestError(uint256 code);
    
    function revertWithCustomError() external pure {
        revert CustomTestError(42);
    }
    
    /**
     * @notice Function that reverts with no data using assembly
     */
    function revertWithNoData() external pure {
        assembly {
            revert(0, 0)
        }
    }
    
    /**
     * @notice Function that succeeds
     */
    function succeed() external pure returns (bool) {
        return true;
    }
}
