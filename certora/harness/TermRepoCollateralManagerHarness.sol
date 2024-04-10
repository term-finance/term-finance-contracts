//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermRepoCollateralManager.sol";
contract TermRepoCollateralManagerHarness is
    TermRepoCollateralManager
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function repoServicer() external view returns (address){
        return address(termRepoServicer);
    }

    function encumberedCollateralBalance(address token) external view returns (uint256) {
        return encumberedCollateralBalances[token];
    }

    function isTokenCollateral(address token) external view returns (bool) {
        return _isAcceptedCollateralToken(token);
    }
    
    function collateralTokensLength() external view returns (uint256) {
        return collateralTokens.length;
    }

    function isInCollateralTokenArray(address token) external view returns (bool) {
        for (uint8 i = 0; i < 2; ++i){
            if (collateralTokens[i] == token) {
                return true;
            }
        }
        return false;
    }
    function allowFullLiquidation(address borrower, uint256[] calldata closureAmounts) external returns (bool) {
        return _validateBatchLiquidationForFullLiquidation(
            borrower,
            msg.sender,
            closureAmounts
        );
    }

    function willBorrowerBeInShortfall(address borrower, uint256 balanceAdjust, address collateralTokenAdjusted, uint256 collateralBalanceAdjust) external view returns(bool) {
        Exp memory repurchasePriceUSDValue = termPriceOracle.usdValueOfTokens(
            purchaseToken,
            termRepoServicer.getBorrowerRepurchaseObligation(borrower) - balanceAdjust
        );
        Exp memory haircutUSDTotalCollateralValue = Exp({mantissa: 0});
        address collateralToken;
        uint256 collatBalance;
        for (uint256 i = 0; i < collateralTokens.length; ++i) {
            collateralToken = collateralTokens[i];
            if ( collateralToken == collateralTokenAdjusted) {
                collatBalance = lockedCollateralLedger[borrower][collateralToken] - collateralBalanceAdjust;
                
            } else {
                collatBalance = lockedCollateralLedger[borrower][collateralToken];
            }
            Exp memory additionalHairCutUSDCollateralValue = div_(
                termPriceOracle.usdValueOfTokens(
                    collateralToken,
                    collatBalance
                ),
                Exp({mantissa: maintenanceCollateralRatios[collateralToken]})

                );
            haircutUSDTotalCollateralValue = add_(
                    additionalHairCutUSDCollateralValue,
                    haircutUSDTotalCollateralValue
                );
            
        }
        if (
            lessThanExp(haircutUSDTotalCollateralValue, repurchasePriceUSDValue)
        ) {
            return true;
        }
        return false;
    }

    function willBeWithinNetExposureCapOnLiquidation(address borrower, uint256 balanceAdjust, address collateralTokenAdjusted, uint256 collateralBalanceAdjust) external returns (bool) {
        uint256 borrowerRepurchaseObligation = termRepoServicer
            .getBorrowerRepurchaseObligation(borrower) - balanceAdjust;

        /// Borrower should not be liquidated to zero balance in this case.
        if (borrowerRepurchaseObligation == 0) {
            return false;
        }

        Exp memory haircutUSDTotalCollateralValue = Exp({mantissa: 0});
        Exp memory additionalHairCutUSDCollateralValue;
        address collateralToken;
        uint256 collatBalance;
        for (uint256 i = 0; i < collateralTokens.length; ++i) {
            collateralToken = collateralTokens[i];
            if (collateralToken == collateralTokenAdjusted) {
                collatBalance = lockedCollateralLedger[borrower][collateralToken] - collateralBalanceAdjust;

            }
            else {
                collatBalance = lockedCollateralLedger[borrower][collateralToken];

            }

            additionalHairCutUSDCollateralValue = div_(
                    termPriceOracle.usdValueOfTokens(
                        collateralToken,
                        collatBalance
                    ),
                Exp({mantissa: initialCollateralRatios[collateralToken]})
                );

            haircutUSDTotalCollateralValue = add_(
                additionalHairCutUSDCollateralValue,
                haircutUSDTotalCollateralValue
            );
        }
        Exp memory borrowerRepurchaseValue = termPriceOracle.usdValueOfTokens(
            purchaseToken,
            borrowerRepurchaseObligation
        );

        if (
            lessThanExp(haircutUSDTotalCollateralValue, borrowerRepurchaseValue)
        ) {
            return true;
        }
        Exp memory excessEquity = sub_(
            haircutUSDTotalCollateralValue,
            borrowerRepurchaseValue
        );

        return
            lessThanOrEqualExp(
                div_(excessEquity, borrowerRepurchaseValue),
                Exp({mantissa: netExposureCapOnLiquidation})
            );
    }

    function harnessCollateralSeizureAmounts(uint256 amountToCover_, address collateralToken) external returns (uint256, uint256) {
        return _collateralSeizureAmounts(amountToCover_, collateralToken);
    }

    function harnessWithinNetExposureCapOnLiquidation(address borrower) external returns (bool) {
        return _withinNetExposureCapOnLiquidation(borrower);
    }

    function termPriceOracleAddress() external view returns (address) {
        return address(termPriceOracle);
    }

    function termRepoServicerAddress() external view returns (address) {
        return address(termRepoServicer);
    }
    
    function termControllerAddress() external view returns (address) {
        return address(termController);
    }

    function emitterAddress() external view returns (address) {
        return address(emitter);
    }

    function harnessLockedCollateralLedger(address borrower, address collateralToken) external view returns (uint256) {
        return lockedCollateralLedger[borrower][collateralToken];
    }

    function harnessCollateralTokensLength() external view returns (uint256) {
        return collateralTokens.length;
    }
}
