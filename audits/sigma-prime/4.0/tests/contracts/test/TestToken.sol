//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract TestToken is ERC20Upgradeable {
    uint8 internal decimals_;

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address[] memory _holder,
        uint256[] memory amount_
    ) public initializer {
        ERC20Upgradeable.__ERC20_init(_name, _symbol);
        decimals_ = _decimals;
        for (uint8 i = 0; i < _holder.length; i++) {
            _mint(_holder[i], amount_[i]);
        }
    }

    function decimals() public view override returns (uint8) {
        return decimals_;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}
