import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "../complexity.spec";
import "./accessRoles.spec";
import "./auction.spec";
import "./externalLocking.spec";
import "./liquidations.spec";

ghost mapping(address => mapping(uint256 => uint256)) tokenPricesPerAmount;

function usdValueCVL(address token, uint256 amount) returns ExponentialNoError.Exp {
    ExponentialNoError.Exp result;
    require result.mantissa == tokenPricesPerAmount[token][amount];
    return result;
}

methods {
    // TermAuctionBidLocker
    function _.termAuctionId() external => DISPATCHER(true);
    function _.termRepoServicer() external => DISPATCHER(true);
    function _.dayCountFractionMantissa() external => DISPATCHER(true);
    function _.lockRolloverBid(uint256) external => DISPATCHER(true);
    function _.auctionEndTime() external => DISPATCHER(true);
    function _.purchaseToken() external => DISPATCHER(true);
    function _.collateralTokens(address) external => DISPATCHER(true);
    function _.termAuction() external => DISPATCHER(true);
    function _.termRepoId() external => DISPATCHER(true);

    // TermController
    function _.isTermDeployed(address) external => PER_CALLEE_CONSTANT;
    function _.getProtocolReserveAddress() external => CONSTANT;

    // TermPriceOracle
    function _.usdValueOfTokens(address token, uint256 amount) external => usdValueCVL(token, amount) expect (ExponentialNoError.Exp);
}

use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;

use rule auctionLockCollateralIntegrity;
use rule auctionLockCollateralThirdParty;
use rule auctionLockCollateralRevertConditions;
use rule auctionUnlockCollateralIntegrity;
use rule auctionUnlockCollateralThirdParty;
use rule auctionUnlockCollateralRevertConditions;
use rule journalBidCollateralToCollateralManagerIntegrity;
use rule journalBidCollateralToCollateralManagerThirdParty;
use rule journalBidCollateralToCollateralManagerRevertConditions;

use rule externalLockCollateralIntegrity;
use rule externalLockCollateralThirdParty;
use rule externalLockCollateralRevertConditions;
use rule externalUnlockCollateralIntegrity;
use rule externalUnlockCollateralThirdParty;
use rule externalUnlockCollateralRevertConditions;

use rule pauseLiquidationsIntegrity;
use rule unpauseLiquidationsIntegrity;
