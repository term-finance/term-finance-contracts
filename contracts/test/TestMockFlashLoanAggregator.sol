// SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error FlashLoanNotRepaid(address token, uint256 required, uint256 actual);

contract TestMockFlashLoanAggregator {
    function flashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256,
        bytes calldata data,
        bytes calldata
    ) external {
        uint256[] memory premiums = new uint256[](tokens.length);

        // Record starting balances and transfer flash loan amounts to borrower
        uint256[] memory startBalances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            startBalances[i] = IERC20(tokens[i]).balanceOf(address(this));
            IERC20(tokens[i]).transfer(msg.sender, amounts[i]);
        }

        (bool ok, bytes memory ret) = msg.sender.call(
            abi.encodeWithSignature(
                "flashExecuteCallback(address[],uint256[],uint256[],address,bytes)",
                tokens,
                amounts,
                premiums,
                msg.sender,
                data
            )
        );
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }

        // Verify repayment: balance must be restored to at least what it was before
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 endBalance = IERC20(tokens[i]).balanceOf(address(this));
            if (endBalance < startBalances[i]) {
                revert FlashLoanNotRepaid(tokens[i], startBalances[i], endBalance);
            }
        }
    }

    // Allows test to call back with custom initiator (for InvalidInitiator test)
    function directCall(
        address target,
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata data
    ) external {
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSignature(
                "flashExecuteCallback(address[],uint256[],uint256[],address,bytes)",
                tokens,
                amounts,
                premiums,
                initiator,
                data
            )
        );
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
