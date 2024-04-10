import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";
import "./locking.spec";



methods {
  function _.emitBidLocked(bytes32,TermAuctionBidLockerHarness.TermAuctionBid,address) external => NONDET DELETE;

  function _.auctionLockCollateral(address,address,uint256) external => DISPATCHER(true);
  function _.auctionUnlockCollateral(address,address,uint256) external => DISPATCHER(true);

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

use rule lockBidsRevertConditions;

use rule lockBidsWithReferralRevertConditions;

