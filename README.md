# TermFinance Smart Contracts

[<img alt="DeFiSafety Badge" width="96px" align="right" src="images/defisafetyscore.svg" />](https://defisafety.com/app/pqrs/576)

![TermFinance CI](https://github.com/term-finance/term-finance-contracts/actions/workflows/ci.yml/badge.svg?branch=main)

[![codecov](https://codecov.io/gh/term-finance/term-finance-contracts/graph/badge.svg?token=rSmJK0e9nG)](https://codecov.io/gh/term-finance/term-finance-contracts) [![CI](https://github.com/term-finance/term-finance-contracts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/term-finance/term-finance-contracts/blob/main/.github/workflows/ci.yml)

Term Finance is a noncustodial fixed-rate liquidity protocol modeled on tri-party repo arrangements common in traditional finance (TradFi). Liquidity suppliers and takers are matched through a unique weekly auction process where liquidity takers submit bids and suppliers submit offers to the protocol, which then determines an interest rate that clears the market. Bidders who bid more than the clearing rate receive liquidity and lenders asking less than the clearing rate, supply. All other participants’ bids and offers are said to be “left on the table.”

### What is Tri-Party Repo?

Tri-party repo is a financial arrangement where a seller sells an asset at a negotiated price (purchase price) and simultaneously agrees to repurchase that asset at a future date (repurchase date) at a pre-specified price (repurchase price). The difference between the repurchase price and the purchase price (price differential) can be thought of as the interest earned by the buyer over the term of the arrangement. The repurchase price is a function of the pricing rate or repo rate. Economically speaking, the arrangement is identical in substance to a collateralized loan. The third party in the “tri-party” repo arrangement is a collateral agent who is designated by both parties to handle settlement and manage collateral on behalf of both parties.

### How Does Term Finance Work?

The Term Finance Protocol is a protocol that governs the deployments of Term Repo arrangements. Term Repo is an on-chain implementation of fixed-rate fixed-term borrowing modeled on traditional tri-party repo with a few key differences: (i) Term Repos involve digital assets rather than fiat and real world assets, (ii) Term Repos utilize noncustodial smart contracts to automate the settlement and collateral management functions typically administered by a collateral agent in the TradFi context, and (iii) the Repo Rate attached to Term Repo Tokens minted to lenders (and paid by borrowers) is determined by auction.

## Term Finance Protocol

The contracts that make up the Term Finance Protocol are broadly divided into two classes: (i) "evergreen" Protocol Contracts that govern at the protocol level; and (ii) "serial"  Term Repos that are instances of Term Finance Protocol's implementation of tri-party repo on-chain. This second class of serial contracts are necessarily finite in nature given that each Term Repo is limited to a fixed-term and has a fixed maturity or repurchase date.

### Protocol Contract Class

Protocol contracts are evergreen contracts at the protocol level that govern and apply across all Term Repos. The following contracts belong to this class and handle protocol level authentication, security controls, event logging and manage centralized price feeds.

* `TermEventEmitter.sol`
* `TermController.sol`
* `TermPriceConsumerV3.sol`

### Term Repo Class

The Term Repo Class are a class of smart contracts that are serially deployed. Each repo maturity (and corresponding set of key terms) require the deployment of a separate instance of the entire class.  The class of smart contracts belonging to the Term Repo Object Class can be further split into three subclasses or groups.

#### Term Auction Group

The Term Auction group of contracts contain the logic to handle and process bid and offer submissions, determine an auction clearing price, and to settle and clear a Term Auction.

* `TermAuction.sol`
* `TermAuctionBidLocker.sol`
* `TermAuctionOfferLocker.sol`

#### Term Servicer Group

The Term Servicer group of contracts enforce the terms of a Term Repo arrangement and automate the settlement and collateral management functions handled by the collateral agent in the TradFi context.

* `TermRepoCollateralManager.sol`
* `TermRepoServicer.sol`
* `TermRepoRolloverManager.sol`
* `TermRepoLocker.sol`

#### Term Repo Token

The Term (Repo) Token is an ERC-20 contract that registers claims of lenders to a Term Repo arrangement against the total aggregate repurchase price due on the repurchase date (Total Outstanding Repurchase Exposure) from all borrowers to the same.

* `TermRepoToken.sol`

## Development

To setup your development environment first make sure you have the following `.env`` files setup:

- `goerli.env`

```shell
yarn install
```

### Linting

To check code style/quality:

```shell
yarn check:eslint
yarn check:solhint
yarn check:prettier
```

### Testing

To run tests:

```shell
yarn test
```

Or to run with code coverage results:
```shell
yarn check:coverage
```

## Vendored Code

This project uses two vendored libraries:

- ExponentialNoError (`BSD-3-Clause`) - https://github.com/compound-finance/compound-protocol/blob/master/contracts/ExponentialNoError.sol
- MultiSend (`LGPL-3.0-only`) - https://github.com/safe-global/safe-contracts/blob/main/contracts/libraries/MultiSend.sol

## Documentation comments

We use the NatSpec comment format for our contracts: https://docs.soliditylang.org/en/v0.8.3/natspec-format.html?highlight=Natspec

## Class diagram

To generate a class diagram for our solidity contracts:

```
yarn build:class-diagram
```

## Solidity code quality

We currently use the `slither` static analyzer alongside `solhint` to provide automated code quality suggestions.

Some additional resources:

- https://ethereum.org/en/security/#introduction
