//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Authorization, Id, Market, MarketParams, Position, Signature} from "@morpho-org/morpho-blue/src/interfaces/IMorpho.sol";

/// @title TestMockMorphoPool
/// @notice Mock Morpho pool for unit testing TermMorphoInterfaceFacet
contract TestMockMorphoPool {

    // ============================================================
    // = Morpho-compatible storage layout ========================
    // ============================================================
    // The first two slots are placeholders matching Morpho's owner (slot 0)
    // and feeRecipient (slot 1), so that _positions lands at POSITION_SLOT=2.
    // This is required for extSloads to return correct borrowShares data when
    // MorphoBalancesLib.expectedBorrowAssets is called.
    uint256 private _morphoSlot0; // slot 0 — Morpho owner placeholder
    uint256 private _morphoSlot1; // slot 1 — Morpho feeRecipient placeholder

    // Positions at slot 2 (matches Morpho's POSITION_SLOT = 2)
    mapping(bytes32 => mapping(address => Position)) private _positions;

    // Markets at slot 3 (matches Morpho's MARKET_SLOT = 3)
    mapping(bytes32 => Market) private _markets;

    // ============================================================
    // = Storage ==================================================
    // ============================================================

    // Whether setAuthorizationWithSig should revert
    bool public shouldRevertAuth;

    // Stored market params
    mapping(bytes32 => MarketParams) private _marketParams;

    // --- borrow overrides ---
    bool public overrideBorrowReturn;
    uint256 public borrowReturnAmount;

    // --- supply overrides ---
    bool public overrideSupplyReturn;
    uint256 public supplyReturnAmount;
    bool public overrideSupplyPull;
    uint256 public supplyPullAmount;

    // --- repay overrides ---
    bool public overrideRepayReturn;
    uint256 public repayReturnAmount;

    // ============================================================
    // = Configuration ============================================
    // ============================================================

    function setShouldRevertAuth(bool value) external {
        shouldRevertAuth = value;
    }

    function setPosition(bytes32 marketId, address user, Position memory pos) external {
        _positions[marketId][user] = pos;
    }

    function setMarket(bytes32 marketId, Market memory mkt) external {
        _markets[marketId] = mkt;
    }

    function setMarketParams(bytes32 marketId, MarketParams memory mp) external {
        _marketParams[marketId] = mp;
    }

    // Borrow config
    function setBorrowReturnAmount(uint256 amount) external {
        overrideBorrowReturn = true;
        borrowReturnAmount = amount;
    }

    function resetBorrowReturnAmount() external {
        overrideBorrowReturn = false;
    }

    // Supply config
    function setSupplyReturnAmount(uint256 amount) external {
        overrideSupplyReturn = true;
        supplyReturnAmount = amount;
    }

    function resetSupplyReturnAmount() external {
        overrideSupplyReturn = false;
    }

    function setSupplyPullOverride(uint256 amount) external {
        overrideSupplyPull = true;
        supplyPullAmount = amount;
    }

    function resetSupplyPullOverride() external {
        overrideSupplyPull = false;
    }

    // Repay config
    function setRepayReturnAmount(uint256 amount) external {
        overrideRepayReturn = true;
        repayReturnAmount = amount;
    }

    function resetRepayReturnAmount() external {
        overrideRepayReturn = false;
    }

    // ============================================================
    // = IMorpho Interface ========================================
    // ============================================================

    function setAuthorizationWithSig(
        Authorization calldata /* authorization */,
        Signature calldata /* signature */
    ) external {
        if (shouldRevertAuth) {
            revert("auth reverted");
        }
        // no-op on success
    }

    /// @dev supplyCollateral: pulls collateral from msg.sender, records position
    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalfOf,
        bytes memory /* data */
    ) external {
        uint256 pullAmt = overrideSupplyPull ? supplyPullAmount : assets;
        if (pullAmt > 0) {
            IERC20(marketParams.collateralToken).transferFrom(msg.sender, address(this), pullAmt);
        }
        bytes32 id = _computeId(marketParams);
        _positions[id][onBehalfOf].collateral += uint128(assets);
    }

    /// @dev supply: pulls loan tokens from msg.sender, returns (assets, 0) or override
    function supply(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address /* onBehalf */,
        bytes memory /* data */
    ) external returns (uint256 assetsSupplied, uint256 sharesSupplied) {
        uint256 pullAmt = overrideSupplyPull ? supplyPullAmount : assets;
        if (pullAmt > 0) {
            IERC20(marketParams.loanToken).transferFrom(msg.sender, address(this), pullAmt);
        }
        assetsSupplied = overrideSupplyReturn ? supplyReturnAmount : assets;
        sharesSupplied = 0;
    }

    /// @dev withdrawCollateral: sends collateralToken to receiver
    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address /* onBehalf */,
        address receiver
    ) external {
        IERC20(marketParams.collateralToken).transfer(receiver, assets);
    }

    /// @dev borrow: sends loanToken to receiver; returns (assets, 0) or override
    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address /* onBehalf */,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed) {
        assetsBorrowed = overrideBorrowReturn ? borrowReturnAmount : assets;
        if (assetsBorrowed > 0) {
            IERC20(marketParams.loanToken).transfer(receiver, assetsBorrowed);
        }
        sharesBorrowed = 0;
    }

    /// @dev repay: pulls loanToken from msg.sender; returns (assets, 0) or override
    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address /* onBehalf */,
        bytes memory /* data */
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid) {
        IERC20(marketParams.loanToken).transferFrom(msg.sender, address(this), assets);
        assetsRepaid = overrideRepayReturn ? repayReturnAmount : assets;
        sharesRepaid = 0;
    }

    function position(Id id, address user) external view returns (Position memory) {
        return _positions[Id.unwrap(id)][user];
    }

    function market(Id id) external view returns (Market memory) {
        return _markets[Id.unwrap(id)];
    }

    function idToMarketParams(Id id) external view returns (MarketParams memory) {
        return _marketParams[Id.unwrap(id)];
    }

    /// @dev Implements extSloads for MorphoBalancesLib compatibility.
    /// Reads raw storage slots using assembly. Because _positions is at storage
    /// slot 2 (matching Morpho's POSITION_SLOT=2), MorphoStorageLib slot
    /// computations produce the same slot addresses as this contract's storage.
    function extSloads(bytes32[] memory slots) external view returns (bytes32[] memory) {
        bytes32[] memory results = new bytes32[](slots.length);
        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                value := sload(slot)
            }
            results[i] = value;
        }
        return results;
    }

    // ============================================================
    // = Internal helpers =========================================
    // ============================================================

    function _computeId(MarketParams memory mp) internal pure returns (bytes32) {
        return keccak256(abi.encode(mp));
    }
}
