//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import {TestMockAToken} from "./TestMockAToken.sol";

/// @title TestMockAavePool
/// @notice Mock Aave V3 pool for unit testing TermAaveInterfaceFacet
contract TestMockAavePool {

    // ============================================================
    // = Storage ==================================================
    // ============================================================

    address public addressesProvider;

    mapping(address => address) public aTokens;            // asset → aToken
    mapping(address => address) public variableDebtTokens; // asset → variableDebtToken
    mapping(address => address) public stableDebtTokens;   // asset → stableDebtToken

    // Configurable borrow capacity returned by getUserAccountData
    uint256 public availableBorrowsBase;

    // --- supply overrides ---
    bool public overrideSupplyMint;
    uint256 public supplyMintAmount;
    bool public overrideSupplyPull;
    uint256 public supplyPullAmount;

    // --- withdraw overrides ---
    bool public overrideWithdrawReturn;
    uint256 public withdrawReturnAmount;
    bool public overrideWithdrawBurn;
    uint256 public withdrawBurnAmount;
    bool public overrideWithdrawSend;
    uint256 public withdrawSendAmount;

    // --- repay overrides ---
    bool public overrideRepayReturn;
    uint256 public repayReturnOverrideAmount;

    // --- borrow overrides ---
    bool public overrideBorrowSend;
    uint256 public borrowSendAmount;

    // ============================================================
    // = Configuration ============================================
    // ============================================================

    function setAddressesProvider(address provider) external {
        addressesProvider = provider;
    }

    function setReserveTokens(
        address asset,
        address aToken,
        address stableDebt,
        address varDebt
    ) external {
        aTokens[asset] = aToken;
        stableDebtTokens[asset] = stableDebt;
        variableDebtTokens[asset] = varDebt;
    }

    function setAvailableBorrowsBase(uint256 amount) external {
        availableBorrowsBase = amount;
    }

    // Supply config
    function setSupplyMintAmount(uint256 amount) external {
        overrideSupplyMint = true;
        supplyMintAmount = amount;
    }

    function resetSupplyMintAmount() external {
        overrideSupplyMint = false;
    }

    function setSupplyPullAmount(uint256 amount) external {
        overrideSupplyPull = true;
        supplyPullAmount = amount;
    }

    function resetSupplyPullAmount() external {
        overrideSupplyPull = false;
    }

    // Withdraw config
    function setWithdrawReturnAmount(uint256 amount) external {
        overrideWithdrawReturn = true;
        withdrawReturnAmount = amount;
    }

    function resetWithdrawReturnAmount() external {
        overrideWithdrawReturn = false;
    }

    function setWithdrawBurnAmount(uint256 amount) external {
        overrideWithdrawBurn = true;
        withdrawBurnAmount = amount;
    }

    function resetWithdrawBurnAmount() external {
        overrideWithdrawBurn = false;
    }

    function setWithdrawSendAmount(uint256 amount) external {
        overrideWithdrawSend = true;
        withdrawSendAmount = amount;
    }

    function resetWithdrawSendAmount() external {
        overrideWithdrawSend = false;
    }

    // Repay config
    function setRepayReturnAmount(uint256 amount) external {
        overrideRepayReturn = true;
        repayReturnOverrideAmount = amount;
    }

    function resetRepayReturnAmount() external {
        overrideRepayReturn = false;
    }

    // Borrow config
    function setBorrowSendAmount(uint256 amount) external {
        overrideBorrowSend = true;
        borrowSendAmount = amount;
    }

    function resetBorrowSendAmount() external {
        overrideBorrowSend = false;
    }

    // ============================================================
    // = Pool Interface ===========================================
    // ============================================================

    function ADDRESSES_PROVIDER() external view returns (address) {
        return addressesProvider;
    }

    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory data) {
        data.stableDebtTokenAddress = stableDebtTokens[asset];
        data.variableDebtTokenAddress = variableDebtTokens[asset];
        data.aTokenAddress = aTokens[asset];
    }

    /// @dev Supply: pull assets from caller (facet), mint aTokens to onBehalfOf
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 /* referralCode */) external {
        uint256 pullAmt = overrideSupplyPull ? supplyPullAmount : amount;
        if (pullAmt > 0) {
            IERC20(asset).transferFrom(msg.sender, address(this), pullAmt);
        }
        uint256 mintAmt = overrideSupplyMint ? supplyMintAmount : amount;
        if (mintAmt > 0) {
            TestMockAToken(aTokens[asset]).mint(onBehalfOf, mintAmt);
        }
    }

    /// @dev Withdraw: burn aTokens from caller (facet), send assets to `to`, return withdrawal amount
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        uint256 burnAmt = overrideWithdrawBurn ? withdrawBurnAmount : amount;
        if (burnAmt > 0) {
            TestMockAToken(aTokens[asset]).burn(msg.sender, burnAmt);
        }
        uint256 sendAmt = overrideWithdrawSend ? withdrawSendAmount : amount;
        if (sendAmt > 0) {
            IERC20(asset).transfer(to, sendAmt);
        }
        return overrideWithdrawReturn ? withdrawReturnAmount : amount;
    }

    /// @dev Borrow: send assets to caller (facet), debt recorded for onBehalfOf
    function borrow(address asset, uint256 amount, uint256 /* rateMode */, uint16 /* referralCode */, address /* onBehalfOf */) external {
        uint256 sendAmt = overrideBorrowSend ? borrowSendAmount : amount;
        if (sendAmt > 0) {
            IERC20(asset).transfer(msg.sender, sendAmt);
        }
    }

    /// @dev Repay: pull assets from caller (facet), return repaid amount
    function repay(address asset, uint256 amount, uint256 /* rateMode */, address /* onBehalfOf */) external returns (uint256) {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        return overrideRepayReturn ? repayReturnOverrideAmount : amount;
    }

    /// @dev Returns configurable available borrow capacity
    function getUserAccountData(address /* user */)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 avlBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        return (0, 0, availableBorrowsBase, 0, 0, 0);
    }
}
