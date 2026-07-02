import "../common/isTermContractPaired.spec";
import "../methods/emitMethods.spec";
import "./accessRoles.spec";

methods {
    // TermController is not in this conf's scene; completeAuction's whileTermContractsNotPaused(controller)
    // and controller.recordAuctionResult(...) would otherwise be unresolved external calls that havoc
    // currentContract storage (e.g. isTermContractPaired). Summarize them as side-effect-free.
    function _.termContractsPaused() external => NONDET;
    function _.recordAuctionResult(bytes32,bytes32,uint256) external => NONDET;

    // completeAuction's auction math (clearing price + bid/offer assignment, with their inner loops and nonlinear
    // mul_/div_) is irrelevant to access control and the isTermContractPaired flag these rules assert on. Abstract it so
    // the SMT doesn't solve it: summarize the arithmetic helpers and the heavy internal stages.
    function _.div_(uint256 x, uint256 y) internal => divCVL(x,y) expect uint256;
    function _.mul_(uint256 x, uint256 y) internal => mulCVL(x,y) expect uint256;
    function TermAuction._calculateAndStoreClearingPrice(TermAuction.TermAuctionRevealedBid[] memory, TermAuction.TermAuctionRevealedOffer[] memory) internal returns (uint256, uint256) => NONDET;
    function TermAuction._assignBids(TermAuction.TermAuctionRevealedBid[] memory, uint256, uint256) internal returns (uint256) => NONDET;
    function TermAuction._assignOffers(TermAuction.TermAuctionRevealedOffer[] memory, uint256, uint256) internal returns (uint256) => NONDET;
}

function mulCVL(uint256 x, uint256 y) returns uint256 {
    return require_uint256(x * y);
}

function divCVL(uint256 x, uint256 y) returns uint256 {
    require y != 0;
    return require_uint256(x / y);
}

// termContractPaired
use rule pairTermContractsSucceedsWhenNotPaired;
use rule pairTermContractsRevertsWhenAlreadyPaired;
use rule onlyRoleCanCallRevert;
use rule onlyRoleCanCallStorage;
use rule onlyRoleCanCallRevertCompleteAuction;
use rule onlyRoleCanCallStorageCompleteAuction;
rule onlyPairTermContractsChangesIsTermContractPaired(
    env e,
    method f,
    calldataarg args
) filtered { f ->
    !f.isView &&
    f.contract == currentContract &&
    f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,string).selector &&
    f.selector != sig:upgradeToAndCall(address,bytes).selector &&
    f.selector != sig:initialize(string,string,uint256,uint256,uint256,address,address,uint256).selector
} {
    onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
}
