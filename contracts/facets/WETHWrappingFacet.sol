//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Permit2Lib} from "permit2/src/libraries/Permit2Lib.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/// @author TermLabs
/// @title WETHWrappingFacet
/// @notice Provides functionality to wrap and unwrap native ETH tokens using the WETH pattern.
/// @dev This facet can be used as part of a diamond proxy pattern to add ETH wrapping capabilities
contract WETHWrappingFacet {
    using SafeERC20 for IWETH;
    using SafeCast for uint256; 

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Wraps native ETH tokens into their wrapped ERC20 equivalent
    /// @dev Deposits native ETH tokens and transfers wrapped tokens (e.g., WETH) to the caller
    /// @param wrappedTokenAddr The address of the wrapped token contract (e.g., WETH)
    function wrapETH(
        address wrappedTokenAddr
    ) external payable {
        IWETH wrappedToken = IWETH(wrappedTokenAddr);
        wrappedToken.deposit{value: msg.value}();
        wrappedToken.safeTransfer(msg.sender, msg.value);
    }
    
    /// @notice Unwraps wrapped ETH tokens back to native ETH tokens
    /// @dev Burns wrapped tokens and transfers native ETH tokens to the caller
    /// @param amount The amount of wrapped tokens to unwrap
    /// @param wrappedTokenAddr The address of the wrapped token contract (e.g., WETH)
    /// @param usePermit2 If true, uses Permit2 for token transfer; otherwise uses standard ERC20 transfer
    function unwrapETH(
        uint256 amount,
        address wrappedTokenAddr,
        bool usePermit2
    ) external {
        IWETH wrappedToken = IWETH(wrappedTokenAddr);
        if (usePermit2) {
            Permit2Lib.PERMIT2.transferFrom(
                msg.sender,
                address(this),
                amount.toUint160(),
                wrappedTokenAddr
            );
        } else {
            wrappedToken.safeTransferFrom(msg.sender, address(this), amount);
        }
        wrappedToken.withdraw(amount);
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}