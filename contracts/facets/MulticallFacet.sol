// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { LibDiamond } from "../libraries/LibDiamond.sol";
import {LibTermStorage, TermStorage} from "../libraries/LibTermStorage.sol";

import { IDiamondLoupe } from "./DiamondLoupeFacet.sol";
import { TermMulticallProtection } from "./base/TermMulticallProtection.sol";

contract MulticallFacet is TermMulticallProtection {
    
    // Custom ReentrancyGuard storage slot to avoid conflicts with other facets
    bytes32 private constant MULTICALL_REENTRANCY_SLOT = keccak256("multicall.reentrancy.guard");
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    
    // Events for transparency and debugging
    event MulticallExecuted(uint256 callCount, bool[] successes);
    event MulticallFailed(uint256 failedAtIndex, string reason);
    
    // Custom errors for better gas efficiency
    error EmptyCallsArray();
    error InvalidFunctionSelector(bytes4 selector);
    error FacetNotEnabled(address facet);
    error SubcallFailed(uint256 index, string reason);
    error ReentrancyGuardReentrantCall();
    
    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }
    
    function _nonReentrantBefore() private {
        bytes32 slot = MULTICALL_REENTRANCY_SLOT;
        uint256 status;
        assembly {
            status := sload(slot)
        }
        if (status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        assembly {
            sstore(slot, 2) // ENTERED = 2
        }
    }
    
    function _nonReentrantAfter() private {
        bytes32 slot = MULTICALL_REENTRANCY_SLOT;
        assembly {
            sstore(slot, 1) // NOT_ENTERED = 1
        }
    }
    
    /**
     * @notice Execute multiple calls atomically - reverts on first failure
     * @param calls Array of encoded function calls
     * @return results Array of return data from each call
     */
    function multicall(bytes[] calldata calls)
        external
        nonReentrant
        initiateMulticallProtection
        returns (bytes[] memory results)
    {
        // Input validation
        if (calls.length == 0) revert EmptyCallsArray();
        
        // Get diamond storage for direct facet lookup
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        
        results = new bytes[](calls.length);
        bool[] memory successes = new bool[](calls.length);
        
        for (uint256 i = 0; i < calls.length; i++) {
            // Validate the function selector and target facet
            _validateCall(calls[i]);
            
            // Get target facet directly from diamond storage
            bytes4 selector = bytes4(calls[i][:4]);
            address facet = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(facet != address(0), "MulticallFacet: Function does not exist");
            
            // Direct delegatecall to facet (bypasses diamond fallback)
            (bool ok, bytes memory ret) = facet.delegatecall(calls[i]);
            successes[i] = ok;
            
            if (!ok) {
                _revert(ret);
            }
            
            results[i] = ret;
        }
        
        emit MulticallExecuted(calls.length, successes);
    }
    
    /**
     * @notice Validate that a call targets an enabled facet and allowed function
     * @param call The encoded function call
     */
    function _validateCall(bytes calldata call) private view {
        if (call.length < 4) revert InvalidFunctionSelector(bytes4(0));
        
        bytes4 selector = bytes4(call[:4]);
        
        // Get the facet address for this selector using DiamondLoupe
        IDiamondLoupe loupe = IDiamondLoupe(address(this));
        address facetAddress = loupe.facetAddress(selector);
        
        // Ensure the selector maps to a valid enabled facet
        if (facetAddress == address(0)) {
            revert InvalidFunctionSelector(selector);
        }
        
        // Verify the facet is actually enabled by checking if it's in the facets list
        address[] memory enabledFacets = loupe.facetAddresses();
        bool facetEnabled = false;
        
        for (uint256 i = 0; i < enabledFacets.length; i++) {
            if (enabledFacets[i] == facetAddress) {
                facetEnabled = true;
                break;
            }
        }
        
        if (!facetEnabled) {
            revert FacetNotEnabled(facetAddress);
        }
    }
    
    /**
     * @notice External function to safely decode error strings
     * @dev This is called via try/catch to handle malformed data gracefully
     */
    function decodeErrorString(bytes memory data) external pure returns (string memory) {
        return abi.decode(data, (string));
    }
    
    /**
     * @notice Convert uint256 to string for panic code display
     */
    function _uint2str(uint256 _i) private pure returns (string memory str) {
        if (_i == 0) return "0";
        
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }
        
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + j % 10));
            j /= 10;
        }
        
        str = string(bstr);
    }
    
    /**
     * @notice Test helper function to expose _uint2str for testing
     * @dev This function should only be used for testing purposes
     */
    function uint2strTestHelper(uint256 _i) external pure returns (string memory) {
        return _uint2str(_i);
    }
}