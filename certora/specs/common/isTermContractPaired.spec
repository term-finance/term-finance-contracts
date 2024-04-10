// Rules related to the state variable `isTermContractPaired`. This field
// exists in multiple Term contracts:
// - TermAuction
// - TermAuctionBidLocker
// - TermAuctionOfferLocker
// - TermRepoCollateralManager
// - TermRepoLocker
// - TermRepoRolloverManager
// - TermRepoServicer
// - TermRepoToken
//
// Import the rules in this file into the `rules.spec` file for each Term
// contract that has the `isTermContractPaired` state variable to validate
// the correctness of the `isTermContractPaired` field on that contract.

import "../methods/emitMethods.spec";
import "../methods/erc20Methods.spec";


methods {
    function isTermContractPaired() external returns(bool) envfree;
}


// Ensures that calls to pairTermContracts succeed when contract is not yet paired.
rule pairTermContractsSucceedsWhenNotPaired(
    env e,
    calldataarg args
) {
    // Constrain input space to only include contracts that have not been paired yet.
    require !isTermContractPaired();

    pairTermContracts(e, args);

    // Assert that the pairing succeeded.
    assert isTermContractPaired(),
        "termContractPaired should be true after calling pairTermContracts(...) on an unpaired contract";
}

// Ensures that calls to pairTermContracts revert when contract is already paired.
rule pairTermContractsRevertsWhenAlreadyPaired(
    env e,
    calldataarg args
) {
    // Constrain input space to only include contracts that have already been paired.
    require isTermContractPaired();

    pairTermContracts@withrevert(e, args);
    assert lastReverted,
        "pairTermContracts(...) should revert when calling it on an already paired contract";

    assert isTermContractPaired(),
        "termContractPaired should not change when calling pairTermContracts(...) on an already paired contract";
}

function onlyPairTermContractsChangesIsTermContractPairedRule(
    env e,
    method f,
    calldataarg args
) {
    bool isTermContractPairedBefore = isTermContractPaired();

    f(e, args);

    bool isTermContractPairedAfter = isTermContractPaired();

    assert isTermContractPairedBefore == isTermContractPairedAfter,
        "termContractPaired should not change when calling methods other than pairTermContracts(...)";
}

// Ensures that calls to methods other than pairTermContracts do not change the
// value of isTermContractPaired.
//
// This rule must be copied into each Term contract that has the
// `termContractPaired` state variable. Modify the rule method filter to match
// the relevant signatures of the contract this is being applied to.
//
// rule onlyPairTermContractsChangesIsTermContractPaired(
//     env e,
//     method f,
//     calldataarg args
// ) filtered { f ->
//     !f.isView &&
//     f.contract == currentContract &&
//     f.selector != sig:pairTermContracts(address,address,address,address,address,address,address,address,string).selector &&
//     f.selector != sig:initialize(string,uint256,uint256,uint256,uint256,address,address,address,address).selector
// } {
//     onlyPairTermContractsChangesIsTermContractPairedRule(e, f, args);
// }
