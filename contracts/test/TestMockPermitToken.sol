//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @title TestMockPermitToken
/// @notice Mock ERC20 with a fake permit() that records args and can toggle revert
contract TestMockPermitToken is ERC20Upgradeable {
    uint8 internal decimals_;

    bool public shouldRevertOnPermit;

    address public lastPermitOwner;
    address public lastPermitSpender;
    uint256 public lastPermitAmount;
    uint256 public lastPermitDeadline;
    uint8 public lastPermitV;
    bytes32 public lastPermitR;
    bytes32 public lastPermitS;

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

    function setShouldRevertOnPermit(bool _shouldRevert) external {
        shouldRevertOnPermit = _shouldRevert;
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (shouldRevertOnPermit) {
            revert("Mock permit failed");
        }
        lastPermitOwner = owner;
        lastPermitSpender = spender;
        lastPermitAmount = value;
        lastPermitDeadline = deadline;
        lastPermitV = v;
        lastPermitR = r;
        lastPermitS = s;
    }
}
