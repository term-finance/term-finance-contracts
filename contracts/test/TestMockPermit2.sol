//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestMockPermit2
/// @notice Mock Permit2 contract for testing Permit2Facet
contract TestMockPermit2 {
    bool public shouldRevertOnPermit;
    bool public shouldRevertOnTransferFrom;

    address public lastPermitOwner;
    address public lastPermitSpender;
    address public lastPermitToken;
    uint160 public lastPermitAmount;

    address public lastTransferFrom;
    address public lastTransferTo;
    uint160 public lastTransferAmount;
    address public lastTransferToken;

    function setShouldRevertOnPermit(bool _shouldRevert) external {
        shouldRevertOnPermit = _shouldRevert;
    }

    function setShouldRevertOnTransferFrom(bool _shouldRevert) external {
        shouldRevertOnTransferFrom = _shouldRevert;
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return keccak256("MockPermit2DomainSeparator");
    }

    function permit(
        address owner,
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata /* signature */
    ) external {
        if (shouldRevertOnPermit) {
            revert("Mock permit failed");
        }
        lastPermitOwner = owner;
        lastPermitSpender = permitSingle.spender;
        lastPermitToken = permitSingle.details.token;
        lastPermitAmount = permitSingle.details.amount;
    }

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external {
        if (shouldRevertOnTransferFrom) {
            revert("Mock transferFrom failed");
        }
        lastTransferFrom = from;
        lastTransferTo = to;
        lastTransferAmount = amount;
        lastTransferToken = token;
        IERC20(token).transferFrom(from, to, amount);
    }
}
