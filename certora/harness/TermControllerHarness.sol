// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../contracts/TermController.sol";

contract TermControllerHarness is TermController {
    function requireTreasuryWallet() external returns (uint256){
        require(treasuryWallet == 100, "treasuryWallet is not 100");
        return 100;
    }
}