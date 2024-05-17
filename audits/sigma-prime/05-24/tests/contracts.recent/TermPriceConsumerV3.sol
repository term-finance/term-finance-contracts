//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import {ITermPriceOracle} from "./interfaces/ITermPriceOracle.sol";
import {ITermPriceOracleErrors} from "./interfaces/ITermPriceOracleErrors.sol";
import {ITermPriceOracleEvents} from "./interfaces/ITermPriceOracleEvents.sol";
import {ITermEventEmitter} from "./interfaces/ITermEventEmitter.sol";
import {Collateral} from "./lib/Collateral.sol";
import {ExponentialNoError} from "./lib/ExponentialNoError.sol";
import {TermPriceFeedConfig} from "./lib/TermPriceFeedConfig.sol";
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

    mapping(address => TermPriceFeedConfig) internal priceFeeds;
    mapping(address => TermPriceFeedConfig) internal fallbackPriceFeeds;


    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Intializes with an array of token addresses, followed with an array of Chainlink aggregator addresses
    /// @notice https://docs.chain.link/docs/ethereum-addresses/
    function initialize(
        address devopsWallet_
    ) external initializer {
        UUPSUpgradeable.__UUPSUpgradeable_init();
        AccessControlUpgradeable.__AccessControl_init();

        _grantRole(DEVOPS_ROLE, devopsWallet_);
    }

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The price aggregator address for token to be added
    /// @param tokenPriceAggregatorRefreshRateThreshold Refresh threshold in seconds for primary price feed updates beyond which price is stale
    /// @param fallbackPriceAggregator The fallback  price aggregator address for token to be added
    /// @param fallbackPriceAggregatorRefreshRateThreshold Refresh threshold for fallback price feed updates beyond which price is stale

    function addNewTokenPriceFeedAndFallbackPriceFeed(
        address token,
        address tokenPriceAggregator,
        uint256 tokenPriceAggregatorRefreshRateThreshold,
        address fallbackPriceAggregator,
        uint256 fallbackPriceAggregatorRefreshRateThreshold
    ) external onlyRole(DEVOPS_ROLE) {
        _addNewTokenPriceFeed(token, tokenPriceAggregator, tokenPriceAggregatorRefreshRateThreshold);
        _addNewTokenFallbackPriceFeed(token, fallbackPriceAggregator, fallbackPriceAggregatorRefreshRateThreshold);
    }

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The proxy price aggregator address for token to be added
    /// @param refreshRateThreshold Refresh threshold in seconds for primary price feed updates beyond which price is stale

    function addNewTokenPriceFeed(
        address token,
        address tokenPriceAggregator,
        uint256 refreshRateThreshold
    ) external onlyRole(DEVOPS_ROLE) {
        _addNewTokenPriceFeed(token, tokenPriceAggregator, refreshRateThreshold);
    }

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The proxy price aggregator address for token to be added
    /// @param refreshRateThreshold Refresh threshold in seconds for fallback price feed updates beyond which price is stale
    function addNewTokenFallbackPriceFeed(
        address token,
        address tokenPriceAggregator,
        uint256 refreshRateThreshold
    ) external onlyRole(DEVOPS_ROLE) {
        _addNewTokenFallbackPriceFeed(token, tokenPriceAggregator, refreshRateThreshold);
    }

    /// @param token The address of the token whose price feed needs to be removed
    function removeTokenPriceFeed(
        address token
    ) external onlyRole(DEVOPS_ROLE) {
        delete priceFeeds[token];
        emit UnsubscribePriceFeed(token);
    }

    /// @param token The address of the token whose price feed needs to be removed
    function removeFallbackTokenPriceFeed(
        address token
    ) external onlyRole(DEVOPS_ROLE) {
        delete fallbackPriceFeeds[token];
        emit UnsubscribeFallbackPriceFeed(token);
    }

    /// @notice A function to return current market value given a token address and an amount
    /// @param token The address of the token to query
    /// @param amount The amount tokens to value
    /// @return The current market value of tokens at the specified amount, in USD
    function usdValueOfTokens(
        address token,
        uint256 amount
    ) external view returns (Exp memory) {
        if (address(priceFeeds[token].priceFeed) == address(0)) {
            revert NoPriceFeed(token);
        }
        int256 latestPriceInt;
        uint8 priceDecimals;
        (latestPriceInt, priceDecimals) = _getLatestPrice(token);
        uint256 latestPrice = uint256(latestPriceInt);

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

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The proxy price aggregator address for token to be added
    /// @param refreshRateThreshold Refresh threshold in seconds for primary price feed updates beyond which price is stale

    function _addNewTokenPriceFeed(
        address token,
        address tokenPriceAggregator,
        uint256 refreshRateThreshold
    ) internal {
        require(tokenPriceAggregator != address(0), "Primary Price feed cannot be zero address");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(tokenPriceAggregator);

         (
            ,
            // uint80 roundID
            int256 price, // uint startedAt // //uint timeStamp// //uint80 answeredInRound//
            ,
            uint256 lastUpdatedTimestamp,

        ) = priceFeed.latestRoundData();

        if (price <= 0) {
            revert InvalidPrice();
        }
        TermPriceFeedConfig memory priceFeedConfig = TermPriceFeedConfig({
            priceFeed: AggregatorV3Interface(tokenPriceAggregator),
            refreshRateThreshold: refreshRateThreshold
        });
        priceFeeds[token] = priceFeedConfig;
        emit SubscribePriceFeed(token, tokenPriceAggregator);
    }

    /// @param token The address of the token to add a price feed for
    /// @param tokenPriceAggregator The proxy price aggregator address for token to be added
    /// @param refreshRateThreshold Refresh threshold in seconds for fallback price feed updates beyond which price is stale
    function _addNewTokenFallbackPriceFeed(
        address token,
        address tokenPriceAggregator,
        uint256 refreshRateThreshold
    ) internal {
        require(tokenPriceAggregator != address(0), "Fallback Price feed cannot be zero address");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(tokenPriceAggregator);

         (
            ,
            // uint80 roundID
            int256 price, // uint startedAt // //uint timeStamp// //uint80 answeredInRound//
            ,
            uint256 lastUpdatedTimestamp,

        ) = priceFeed.latestRoundData();

        if (price <= 0) {
            revert InvalidPrice();
        }
        
        TermPriceFeedConfig memory priceFeedConfig = TermPriceFeedConfig({
            priceFeed: AggregatorV3Interface(tokenPriceAggregator),
            refreshRateThreshold: refreshRateThreshold
        });
        fallbackPriceFeeds[token] = priceFeedConfig;
        emit SubscribeFallbackPriceFeed(token, tokenPriceAggregator);
    }
    

    /// @return The latest price from price aggregator and the decimals in the price
    function _getLatestPrice(address token) internal view returns (int256, uint8) {

        (
            ,
            // uint80 roundID
            int256 price, // uint startedAt // //uint timeStamp// //uint80 answeredInRound//
            ,
            uint256 lastUpdatedTimestamp,

        ) = priceFeeds[token].priceFeed.latestRoundData();

        AggregatorV3Interface fallbackPriceFeed = fallbackPriceFeeds[token].priceFeed;

        
        if (address(fallbackPriceFeed) == address(0) || priceFeeds[token].refreshRateThreshold == 0) {
            if (price <= 0) {
                revert InvalidPrice();
            } else {
                return (price, priceFeeds[token].priceFeed.decimals()); // Use primary price feed if there is no fallback price feed.
            }
        }
        if (address(fallbackPriceFeed) != address(0)) {
            if (price > 0 && ( block.timestamp - lastUpdatedTimestamp) <=   priceFeeds[token].refreshRateThreshold) {
                return (price, priceFeeds[token].priceFeed.decimals()); // Return primary price feed if it is not stale
            }

            (
            ,
            int256 fallbackPrice,
            ,
            uint256 fallbackLastUpdatedTimestamp,

            ) = fallbackPriceFeed.latestRoundData();
            if (price <= 0) {
                if (fallbackPrice <= 0) {
                    revert InvalidPrice();
                }
                else {
                    return (fallbackPrice, fallbackPriceFeed.decimals()); // Use fallback price feed if primary price feed unavailable
                }
            } else {
                if (fallbackPrice <= 0 ) {
                    return (price, priceFeeds[token].priceFeed.decimals());
                } else {
                    if (fallbackPrice > 0 && ( block.timestamp - fallbackLastUpdatedTimestamp) <=   fallbackPriceFeeds[token].refreshRateThreshold) {
                        return (fallbackPrice, fallbackPriceFeed.decimals()); //if primary price is stale, use fallback price feed
                    } 
                    // if both price feeds are stale take the latest one 
                    if (lastUpdatedTimestamp >= fallbackLastUpdatedTimestamp ) {
                        return (price, priceFeeds[token].priceFeed.decimals()); 
                    } else {
                        return (fallbackPrice, fallbackPriceFeed.decimals() );
                    }
                }
            }
        }
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
