//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {ITermPriceOracle} from "./interfaces/ITermPriceOracle.sol";
import {ITermPriceOracleErrors} from "./interfaces/ITermPriceOracleErrors.sol";
import {ITermPriceOracleEvents} from "./interfaces/ITermPriceOracleEvents.sol";
import {ITermEventEmitter} from "./interfaces/ITermEventEmitter.sol";
import {Collateral} from "./lib/Collateral.sol";
import {ExponentialNoError} from "./lib/ExponentialNoError.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import {Versionable} from "./lib/Versionable.sol";

/// @author TermLabs
/// @title Term Price Consumer V3
/// @notice This contract is a centralized price oracle contract that feeds pricing data to all Term Repos
/// @dev This contract operates at the protocol level and governs all instances of a Term Repo
contract TermPriceConsumerV3 is
    ITermPriceOracle,
    ITermPriceOracleErrors,
    ITermPriceOracleEvents,
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ExponentialNoError,
    Versionable
{
    // ========================================================================
    // = Access Role  ======================================================
    // ========================================================================

    bytes32 public constant DEVOPS_ROLE = keccak256("DEVOPS_ROLE");
    bytes32 public constant EVERGREEN_MANAGEMENT_ROLE =
        keccak256("EVERGREEN_MANAGEMENT_ROLE");

    mapping(address => AggregatorV3Interface) internal priceFeeds;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Intializes with an array of token addresses, followed with an array of Chainlink aggregator addresses
    /// @notice https://docs.chain.link/docs/ethereum-addresses/
    function initialize(
        address devopsWallet_,
        address evergreenManagementWallet_
    ) external initializer {
        UUPSUpgradeable.__UUPSUpgradeable_init();
        AccessControlUpgradeable.__AccessControl_init();

        _grantRole(DEVOPS_ROLE, devopsWallet_);
        _grantRole(EVERGREEN_MANAGEMENT_ROLE, evergreenManagementWallet_);
    }

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The proxy price aggregator address for token to be added
    function addNewTokenPriceFeed(
        address token,
        address tokenPriceAggregator
    ) external onlyRole(EVERGREEN_MANAGEMENT_ROLE) {
        priceFeeds[token] = AggregatorV3Interface(tokenPriceAggregator);
        emit SubscribePriceFeed(token, tokenPriceAggregator);
    }

    /// @param token The address of the token whose price feed needs to be removed
    function removeTokenPriceFeed(
        address token
    ) external onlyRole(EVERGREEN_MANAGEMENT_ROLE) {
        delete priceFeeds[token];
        emit UnsubscribePriceFeed(token);
    }

    /// @notice A function to return current market value given a token address and an amount
    /// @param token The address of the token to query
    /// @param amount The amount tokens to value
    /// @return The current market value of tokens at the specified amount, in USD
    function usdValueOfTokens(
        address token,
        uint256 amount
    ) external view returns (Exp memory) {
        if (address(priceFeeds[token]) == address(0)) {
            revert NoPriceFeed(token);
        }
        uint256 latestPrice = uint256(_getLatestPrice(token));
        uint8 priceDecimals = _getDecimals(token);

        IERC20MetadataUpgradeable tokenInstance = IERC20MetadataUpgradeable(
            token
        );
        uint8 tokenDecimals = tokenInstance.decimals();

        return
            mul_(
                Exp({mantissa: (amount * expScale) / 10 ** tokenDecimals}),
                Exp({mantissa: (latestPrice * expScale) / 10 ** priceDecimals})
            );
    }

    /// @return The latest price from price aggregator
    function _getLatestPrice(address token) internal view returns (int256) {
        (
            ,
            // uint80 roundID
            int256 price, // uint startedAt // //uint timeStamp// //uint80 answeredInRound//
            ,
            ,

        ) = priceFeeds[token].latestRoundData();
        return price;
    }

    /// @return The decimal places in price feed
    function _getDecimals(address token) internal view returns (uint8) {
        return priceFeeds[token].decimals();
    }

    // ========================================================================
    // = Upgrades =============================================================
    // ========================================================================

    // solhint-disable no-empty-blocks
    /// @dev required override by the OpenZeppelin UUPS module
    function _authorizeUpgrade(
        address
    ) internal view override onlyRole(DEVOPS_ROLE) {}
    // solhint-enable no-empty-blocks
}
