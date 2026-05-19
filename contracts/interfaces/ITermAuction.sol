//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermController} from "./ITermController.sol";

/// @title ITermAuction Term Auction interface
interface ITermAuction {
    function auctionCancelledForWithdrawal() external view returns (bool);
    function controller() external view returns (ITermController);
}
