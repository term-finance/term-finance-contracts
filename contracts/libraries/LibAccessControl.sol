//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

library LibAccessControl {
    bytes32 internal constant DEVOPS_ROLE = keccak256("DEVOPS_ROLE");
    bytes32 internal constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
}
