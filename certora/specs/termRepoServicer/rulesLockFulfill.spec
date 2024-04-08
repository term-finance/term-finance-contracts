import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "./stateVariables.spec";
import "./fulfillment.spec";
import "./locking.spec";

methods {
    function upgradeToAndCall(address,bytes) external => NONDET DELETE;
    function _.usdValueOfTokens(address,uint256) external => NONDET DELETE;
    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;

    // // TermRepoToken
    // function _.totalRedemptionValue() external => DISPATCHER(true);
    // function _.redemptionValue() external => DISPATCHER(true);
    // function _.burnAndReturnValue(address,uint256) external => DISPATCHER(true);
    // function _.mintRedemptionValue(address,uint256) external => DISPATCHER(true);
    // function _.mintTokens(address,uint256) external => DISPATCHER(true);
    // function _.decrementMintExposureCap(uint256) external => DISPATCHER(true);
    // function _.burn(address,uint256) external => DISPATCHER(true);

    // TermRepoLocker
    // function _.transferTokenFromWallet(address,address,uint256) external => DISPATCHER(true);
    // function _.transferTokenToWallet(address,address,uint256) external => DISPATCHER(true);

    // TermController
    function _.getTreasuryAddress() external => ALWAYS(100);
    function _.getProtocolReserveAddress() external => ALWAYS(100);


    // // TermRepoRolloverManager
    // function _.getRolloverInstructions(address) external => DISPATCHER(true);
    // function _.fulfillRollover(address) external => DISPATCHER(true);

    // // TermRepoCollateralManager
    // function _.numOfAcceptedCollateralTokens() external => DISPATCHER(true);
    // function _.collateralTokens() external => DISPATCHER(true);
    // function _.collateralTokens(uint256) external => DISPATCHER(true);
    // function _.calculateMintableExposure(address,uint256) external => DISPATCHER(true);
    // function _.encumberedCollateralRemaining() external => DISPATCHER(true);
    // function _.unlockCollateralOnRepurchase(address) external => DISPATCHER(true);
    // function _.journalBidCollateralToCollateralManager(address,address[],uint256[]) external => DISPATCHER(true);
    // function _.mintOpenExposureLockCollateral(address,address,uint256) external => DISPATCHER(true);
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}

use rule fulfillBidIntegrity;
use rule fulfillOfferIntegrity;
use rule fulfillOfferDoesNotAffectThirdParty;
use rule fulfillBidDoesNotAffectThirdParty;

use rule lockOfferAmountIntegrity;
use rule unlockOfferAmountIntegrity;
use rule lockOfferAmountDoesNotAffectThirdParty;
use rule unlockOfferAmountDoesNotAffectThirdParty;
use rule lockOfferAmountRevertsWhenInvalid;
use rule unlockOfferAmountRevertsWhenInvalid;