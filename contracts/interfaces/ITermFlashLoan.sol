//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

interface ITermFlashLoan {
    
    struct TermFlashLoanCallback {
        address callbackFacet;
        bytes4 selector;
    }
}
