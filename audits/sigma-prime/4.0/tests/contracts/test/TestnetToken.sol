//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract TestnetToken is
    ERC20Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    uint8 internal decimals_;
    uint256 internal amount_;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _amount
    ) public initializer {
        AccessControlUpgradeable.__AccessControl_init();
        ERC20Upgradeable.__ERC20_init(_name, _symbol);
        decimals_ = _decimals;
        amount_ = _amount;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    function decimals() public view override returns (uint8) {
        return decimals_;
    }

    function amount() public view returns (uint256) {
        return amount_;
    }

    function claimsMade(address _user) public view returns (uint8) {
        return claims[_user];
    }

    mapping(address => uint8) public claims;

    function changeMintAmount(uint256 _amount) public onlyRole(ADMIN_ROLE) {
        amount_ = _amount;
    }

    function mint(address to) public {
        if (claims[to] >= 3) {
            revert("No claims remaining!");
        }
        ++claims[to];
        _mint(to, amount_);
    }

    function adminMint(
        address to,
        uint256 amount_
    ) public onlyRole(ADMIN_ROLE) {
        _mint(to, amount_);
    }

    function burn(address from, uint256 _amount) public {
        _burn(from, _amount);
    }

    // solhint-disable no-empty-blocks
    ///@dev Required override by the OpenZeppelin UUPS module
    function _authorizeUpgrade(
        address
    ) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {}
    // solhint-enable no-empty-blocks
}
