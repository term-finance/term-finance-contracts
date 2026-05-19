//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TestMockWETH
/// @notice Minimal WETH9-like mock for testing WETHWrappingFacet
contract TestMockWETH is IERC20 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    bool public shouldRevertOnWithdraw;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(!shouldRevertOnWithdraw, "MockWETH: withdraw reverted");
        require(balanceOf[msg.sender] >= wad, "MockWETH: insufficient balance");
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        (bool success, ) = payable(msg.sender).call{value: wad}("");
        require(success, "MockWETH: ETH transfer failed");
        emit Withdrawal(msg.sender, wad);
    }

    function setShouldRevertOnWithdraw(bool _shouldRevert) external {
        shouldRevertOnWithdraw = _shouldRevert;
    }

    function approve(
        address spender,
        uint256 amount
    ) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(
        address to,
        uint256 amount
    ) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockWETH: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        require(balanceOf[from] >= amount, "MockWETH: insufficient balance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(
                allowance[from][msg.sender] >= amount,
                "MockWETH: insufficient allowance"
            );
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
