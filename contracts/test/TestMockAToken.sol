//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestMockAToken
/// @notice Mock aToken (ERC20) with open mint/burn for testing
contract TestMockAToken is ERC20 {
    constructor() ERC20("Mock aToken", "mAT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
