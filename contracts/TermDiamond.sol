//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Implementation of a diamond.
/******************************************************************************/

import { LibDiamond, IDiamondCut, IDiamondInit, IDiamondPause } from "./libraries/LibDiamond.sol";
import { LibAccessControl } from "./libraries/LibAccessControl.sol";
import { IDiamondLoupe } from "./facets/DiamondLoupeFacet.sol";

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @author TermLabs
/// @title TermDiamond
/// @notice Main diamond contract implementing EIP-2535 Diamond Standard
/// @dev Provides a fallback function that delegates calls to registered facets
/// @dev Includes pause functionality to halt operations in emergency situations
contract TermDiamond {

    // ========================================================================
    // = Errors ===============================================================
    // ========================================================================

    /// @notice Thrown when attempting to call a function while the diamond is paused
    error DiamondIsPaused();

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    /// @notice Initializes the diamond contract with core facet and role setup
    /// @dev Registers the DiamondCutFacet and initializes access control roles
    /// @param devopsWallet_ Address to be granted the DEVOPS_ROLE for managing upgrades
    /// @param adminWallet_ Address to be granted the ADMIN_ROLE for administrative functions
    /// @param _diamondCutFacet Address of the DiamondCutFacet contract
    constructor(address devopsWallet_, address adminWallet_, address _diamondCutFacet) {     

        // Add the diamondCut external function from the diamondCutFacet
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
        bytes4[] memory functionSelectors = new bytes4[](3);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        functionSelectors[1] = IDiamondPause.pauseDiamond.selector;
        functionSelectors[2] = IDiamondPause.unpauseDiamond.selector;
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: functionSelectors
        });
        // Encode the initDiamond function call
        bytes memory initCalldata = abi.encodeWithSelector(IDiamondInit.initDiamond.selector, devopsWallet_, adminWallet_);
        
        // Execute the diamond cut with initialization
        LibDiamond.diamondCut(cut, _diamondCutFacet, initCalldata);           
    }

    /// @notice Fallback function to delegate calls to registered facets
    /// @dev Looks up the facet address for the function selector and delegates the call
    /// @dev Reverts if the diamond is paused (except for unpauseDiamond function)
    /// @dev Reverts if no facet is registered for the function selector
    // Find facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        // get diamond storage
        assembly {
            ds.slot := position
        }
        if (ds.diamondPaused && !_isAllowedDuringPause(msg.sig)) {
            revert DiamondIsPaused();
        }
        // get facet from function selector
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        // Execute external function from facet using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
                case 0 {
                    revert(0, returndatasize())
                }
                default {
                    return(0, returndatasize())
                }
        }
    }

    receive() external payable {}

    /// @dev Checks if a function selector is allowed to be called when the diamond is paused
    /// @param selector The function selector to check
    /// @return bool True if the selector is allowed during pause, false otherwise
    function _isAllowedDuringPause(bytes4 selector) private pure returns (bool) {
        return selector == IDiamondPause.unpauseDiamond.selector ||
               _isDiamondLoupeSelector(selector);
    }

    /// @dev Checks if a selector belongs to the IDiamondLoupe interface
    /// @param selector The function selector to check
    /// @return bool True if the selector is part of IDiamondLoupe interface
    function _isDiamondLoupeSelector(bytes4 selector) private pure returns (bool) {
        return selector == IDiamondLoupe.facets.selector ||
               selector == IDiamondLoupe.facetFunctionSelectors.selector ||
               selector == IDiamondLoupe.facetAddresses.selector ||
               selector == IDiamondLoupe.facetAddress.selector ||
               selector == IDiamondLoupe.diamondPaused.selector ||
               selector == IERC165.supportsInterface.selector;
    }
}