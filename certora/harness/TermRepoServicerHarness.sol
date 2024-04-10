//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.18;

import "../../contracts/TermRepoServicer.sol";
contract TermRepoServicerHarness is
    TermRepoServicer
{
    function isTermContractPaired() external view returns (bool) {
        return termContractPaired;
    }

    function isTokenCollateral(address token) external view returns (bool) {
        for (uint8 i = 0; i < 2; ++i){
            if (termRepoCollateralManager.collateralTokens(i) == token) {
                return true;
            }
        }
        return false;
    }

    function totalCollateral(address borrower) external view returns (uint256) {
        uint256 totalCollateralAmount = 0;
        for (uint256 i = 0; i < 2; ++i){
            totalCollateralAmount += termRepoCollateralManager.getCollateralBalance(borrower, termRepoCollateralManager.collateralTokens(i));
        }
        return totalCollateralAmount;
    }

    function collateralBalance(address borrower, uint256 tokenNumber) external view returns (uint256) {
        return termRepoCollateralManager.getCollateralBalance(borrower, termRepoCollateralManager.collateralTokens(tokenNumber));
    }

    function termControllerAddress() external view returns (ITermController) {
        return termController;
    }

    function emitterAddress() external view returns (address) {
        return address(emitter);
    }
}
