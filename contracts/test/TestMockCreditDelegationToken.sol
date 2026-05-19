//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

/// @title TestMockCreditDelegationToken
/// @notice Mock credit delegation token for testing Aave borrow delegation
contract TestMockCreditDelegationToken {
    mapping(address => mapping(address => uint256)) private _borrowAllowances;

    event DelegationWithSigCalled(address delegator, address delegatee, uint256 amount, uint256 deadline);

    function setBorrowAllowance(address delegator, address delegatee, uint256 amount) external {
        _borrowAllowances[delegator][delegatee] = amount;
    }

    function borrowAllowance(address delegator, address delegatee) external view returns (uint256) {
        return _borrowAllowances[delegator][delegatee];
    }

    function approveDelegation(address delegatee, uint256 amount) external {
        _borrowAllowances[msg.sender][delegatee] = amount;
    }

    function delegationWithSig(
        address delegator,
        address delegatee,
        uint256 value,
        uint256 deadline,
        uint8 /* v */,
        bytes32 /* r */,
        bytes32 /* s */
    ) external {
        emit DelegationWithSigCalled(delegator, delegatee, value, deadline);
    }
}
