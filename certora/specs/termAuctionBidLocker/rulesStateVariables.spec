import "./stateVariables.spec";
import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";

methods {
    function _.auctionLockCollateral(address,address,uint256) external => DISPATCHER(true);
    function _.auctionUnlockCollateral(address,address,uint256) external => DISPATCHER(true);

    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;
}

use rule pauseLockingCausesBidLockingToRevert;
use rule unpauseLockingAllowsBidLocking;
use rule pauseUnlockingCausesBidUnlockingToRevert;
use rule unpauseUnlockingAllowsBidUnlocking;

use rule notAllowedMethodsCannotChangeBidCount;
use rule onlyAllowedMethodsCanChangeBidCount;
use rule lockerCollateralTokenBalanceGreaterThanCollateralLedgerBalance;
