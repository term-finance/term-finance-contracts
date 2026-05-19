//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";
import { ITermIntent } from "../interfaces/ITermIntent.sol";

struct TermStorage {
    // initialization flag for TermIntent
    bool termIntentInitialized;

    // address that initiated multicall
    address multicallInitiator;

    // address of the maker in active settlement context (for retrieveFunds authorization)
    address activeSettlementMaker;

    // address of the atomic transaction sender
    address atomicTxInitiatior;

    // address of the taker in active atomic transaction settlement context
    address activeAtomicTxSettlementTaker;

    // EIP712 domain separator for signing limit orders
    bytes32 eip712DomainSeparator;

    // Global term controller whitelist mapping
    mapping(address => bool) approvedTermControllers;

    // List of approved term controllers for enumeration
    address[] approvedTermControllerList;

    // Approved Fee Recipient Mapping
    mapping(address => bool) approvedFeeRecipients;

    // Global term event emitter
    ITermEventEmitter emitter;

    /// Maps order hash to order execution status and filled amount
    mapping(bytes32 => ITermIntent.OrderContext) limitOrderContextMapping;
    /// Maps order hash to maker address for contract wallets that pre-authorize orders
    mapping(bytes32 => address) preSignedLimitOrders;

    /// Maps order hash to order execution status and filled amount
    mapping(bytes32 => ITermIntent.OrderContext) swapOrderContextMapping;
    /// Maps order hash to maker address for contract wallets that pre-authorize orders
    mapping(bytes32 => address) preSignedSwapOrders;

    /// Maps maker => makerToken => takerToken to minimum valid salt for bulk order cancellation
    mapping(address => mapping(address => mapping(address => uint256))) limitOrderMakerTokenPairMinSalt;
    /// Maps maker => makerToken => takerToken to minimum valid salt for bulk swap order cancellation
    mapping(address => mapping(address => mapping(address => uint256))) swapOrderMakerTokenPairMinSalt;
}

struct TermERC4626VaultManagement {
    mapping(address => mapping(address => bool)) userApprovedERC4626Vaults;
}

struct TermFlashLoanContext {
    // address of the borrower in active flashloan context
    address activeFlashLoanBorrower;
}

library LibTermStorage {

    bytes32 internal constant TERM_STORAGE_POSITION = keccak256("term.storage");
    bytes32 internal constant TERM_ERC4626_VAULT_MANAGEMENT_POSITION = keccak256("term.erc4626.vault.management");
    bytes32 internal constant TERM_FLASH_LOAN_CONTEXT_POSITION = keccak256("term.flash.loan.context");
    address internal constant UNSET_INITIATOR = address(0); 

    function termStorage() internal pure returns (TermStorage storage ts) {
        bytes32 position = TERM_STORAGE_POSITION;
        assembly {
            ts.slot := position
        }
    }

    function termERC4626VaultManagement() internal pure returns (TermERC4626VaultManagement storage tev) {
        bytes32 position = TERM_ERC4626_VAULT_MANAGEMENT_POSITION;
        assembly {
            tev.slot := position
        }
    }

    function termFlashLoanContext() internal pure returns (TermFlashLoanContext storage tfc) {
        bytes32 position = TERM_FLASH_LOAN_CONTEXT_POSITION;
        assembly {
            tfc.slot := position
        }
    }

    // Validation function that can be called from modifiers
    function requireMulticallInitiator() internal view {
        TermStorage storage ts = termStorage();
        address initiator = ts.multicallInitiator;
        require(initiator != UNSET_INITIATOR, "uninitialized");
        require(msg.sender == initiator, "unauthorized");
    }
}
