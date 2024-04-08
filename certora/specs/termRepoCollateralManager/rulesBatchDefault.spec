import "../methods/erc20Methods.spec";
import "../methods/emitMethods.spec";
import "./liquidations.spec";
import "../common/isTermContractPaired.spec";
import "../complexity.spec";
import "./accessRoles.spec";
import "./auction.spec";
import "./externalLocking.spec";
import "./stateVariables.spec";

ghost mapping(address => uint256) tokenPrices;

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

    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}

use rule batchDefaultSuccessfullyDefaults;
use rule batchDefaultRevertsIfInvalid;
use rule batchDefaultDoesNotAffectThirdParty;
