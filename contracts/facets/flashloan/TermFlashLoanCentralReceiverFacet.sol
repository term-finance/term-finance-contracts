//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDiamondLoupe} from "../DiamondLoupeFacet.sol";
import {TermFlashBase} from "../base/TermFlashBase.sol";


interface InstaFlashReceiverInterface {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata data
    ) external returns (bool);
}

/// @author TermLabs
/// @title TermFlashLoanCentralReceiverFacet
/// @notice Central flash loan receiver for Term Finance protocol operations
/// @dev Implements flash loan callback interface for various Term Finance operations
contract TermFlashLoanCentralReceiverFacet is InstaFlashReceiverInterface, TermFlashBase {
    struct TermFlashLoanCallback {
        address callbackFacet;
        bytes4 selector;
    }
    
    using SafeERC20 for IERC20;
    using Address for address;

    // ========================================================================
    // = Constants  ===========================================================
    // ========================================================================
    uint256 constant public MAX_OPERATION_DATA = 32768; // 32 KB

    uint256 constant public MAX_PREMIUM_PERCENTAGE = 1000; // 10% (basis points)

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================
    /// @notice Thrown when array lengths of assets, amounts, and premiums do not match
    error ArrayLengthMismatch();

    /// @notice Thrown when callback facet does not match selector mapping
    error CallbackFacetSelectorMismatch();

    /// @notice Thrown when calldata size exceeds maximum allowed limit
    error CalldataTooLarge();

    /// @notice Thrown when flash loan premium exceeds maximum allowed percentage
    error ExcessivePremium();

    /// @notice Thrown when an asset address is invalid (zero address)
    error InvalidAssetAddress();
    
    /// @notice Thrown when selector is not found in diamond
    error SelectorNotFound();

    /// @notice Thrown when amount is zero
    error ZeroAmount();

    // ========================================================================
    // = State Variables  =====================================================
    // ========================================================================

    address immutable flashLoanAggregatorContract;

    // ========================================================================
    // = Deploy  ==============================================================
    // ========================================================================

    constructor(address flashLoanAggregator_) {
        flashLoanAggregatorContract = flashLoanAggregator_;
    }

    // ========================================================================
    // = Interface/API ========================================================
    // ========================================================================

    /// @notice Flash loan callback function that executes various Term Finance operations
    /// @dev Called by the flash loan aggregator with the borrowed funds, routes to appropriate facet
    /// @param assets Array of borrowed asset addresses
    /// @param amounts Array of borrowed amounts
    /// @param premiums Array of flash loan fees
    /// @param initiator Address that initiated the flash loan
    /// @param data Encoded operation parameters containing function selector and operation data
    /// @return success Boolean indicating successful execution
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata data
    ) external override validateCallback(flashLoanAggregatorContract, initiator) returns (bool success) {
        if (assets.length != amounts.length || amounts.length != premiums.length) { 
            revert ArrayLengthMismatch();
        }
        for (uint i = 0; i < assets.length; i++) {
            if (assets[i] == address(0)) {
                revert InvalidAssetAddress();
            }
            if (amounts[i] == 0) {
                revert ZeroAmount();
            }

            if (premiums[i] > amounts[i] * MAX_PREMIUM_PERCENTAGE / 10000) { 
                revert ExcessivePremium();
            }
        }

        if (data.length > MAX_OPERATION_DATA) { 
            revert CalldataTooLarge();
        }

        // Decode TermFlashLoanCallback from the beginning of calldata
        (TermFlashLoanCallback memory callback, ) = abi.decode(data, (TermFlashLoanCallback, bytes));

        // Verify that the callback's facet and selector are properly mapped in the diamond
        address actualFacet = IDiamondLoupe(address(this)).facetAddress(callback.selector);
        if (actualFacet == address(0)) revert SelectorNotFound();
        if (actualFacet != callback.callbackFacet) revert CallbackFacetSelectorMismatch();

        // Encode the flash loan parameters with the callback selector and operation data
        bytes memory encodedData = abi.encodePacked(callback.selector, abi.encode(assets, amounts, premiums, initiator, data));

        // Execute the flash loan operation using the callback's selector
        Address.functionDelegateCall(actualFacet, encodedData);
        return true;
    }
}
