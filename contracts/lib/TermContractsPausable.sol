//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermController} from "../interfaces/ITermController.sol";
abstract contract TermContractsPausable {

    error TermContractsPaused();
    
    modifier whileTermContractsNotPaused(ITermController controller) {
        if (controller.termContractsPaused()) {
            revert TermContractsPaused();
        }
        _;
    }

}