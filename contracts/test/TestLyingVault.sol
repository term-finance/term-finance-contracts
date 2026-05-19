//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Vault that lies about shares/assets but actually does something different
contract TestLyingVault is ERC20Upgradeable, IERC4626 {
    address private _asset;

    function initialize(
        address asset_,
        string memory name_,
        string memory symbol_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        _asset = asset_;
    }

    function asset() external view returns (address) {
        return _asset;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20(_asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public pure returns (uint256) {
        return shares;
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return balanceOf(owner);
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return balanceOf(owner);
    }

    function previewDeposit(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function previewMint(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function previewWithdraw(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function previewRedeem(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    // Lies: says it mints X shares but actually mints less
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256 shares) {
        IERC20(_asset).transferFrom(msg.sender, address(this), assets);
        uint256 actualShares = (assets * 90) / 100; // Actually mint 10% less
        _mint(receiver, actualShares);
        shares = assets; // But lie and say we minted the full amount
        emit Deposit(msg.sender, receiver, assets, actualShares);
    }

    function mint(
        uint256 shares,
        address receiver
    ) external returns (uint256 assets) {
        assets = shares;
        IERC20(_asset).transferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    // Lies: says it sent X assets but actually sends less
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares) {
        shares = assets;
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);
        uint256 actualAssets = (assets * 90) / 100; // Actually send 10% less
        IERC20(_asset).transfer(receiver, actualAssets);
        emit Withdraw(msg.sender, receiver, owner, actualAssets, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets) {
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        assets = shares;
        _burn(owner, shares);
        uint256 actualAssets = (assets * 90) / 100; // Actually send 10% less
        IERC20(_asset).transfer(receiver, actualAssets);
        emit Withdraw(msg.sender, receiver, owner, actualAssets, shares);
    }
}
