//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ITermIntent} from "../interfaces/ITermIntent.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {TermLoanIntentFacet} from "./TermLoanIntentFacet.sol";
import {TermRepoToken} from "../TermRepoToken.sol";
import {TermRepoTokenIntentFacet} from "./TermRepoTokenIntentFacet.sol";

import {TermAtomicTxProtection} from "./base/TermAtomicTxProtection.sol";

import {LibTermStorage, TermStorage}  from "../libraries/LibTermStorage.sol";
import {IDiamondLoupe} from "./DiamondLoupeFacet.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TermSettlementWithHooksFacet is TermAtomicTxProtection, ITermIntent {
    using Address for address;

    // ========================================================================
    // = Errors  ==============================================================
    // ========================================================================

    /// @notice Thrown when Swap taker asset is repo token
    error InvalidSwapOrderToFill();

    // ========================================================================
    // = APIs =================================================================
    // ========================================================================

    /// @notice Settles a limit lend order by first executing a specified function to retrieve purchase tokens, then settling the order with the retrieved funds, all within the same transaction
    /// @param order The limit lend order to settle
    /// @param fillAmount The amount to fill on the order
    /// @param collateralAmounts The collateral amounts to post (must be length 1)
    /// @param signature The maker's signature authorizing the order
    /// @param retrieveFundsList A list of functions to call to retrieve funds, including the target facet and any additional calldata. The list length must match the length of collateralAmounts, and each function must retrieve the exact amount of purchase tokens needed for that collateral amount.
    function settleLimitLendWithHook(
        LimitLendOrder memory order,
        uint256 fillAmount,
        uint256[] memory collateralAmounts,
        Signature memory signature,
        RetrieveFundsStruct[] memory retrieveFundsList
    ) external initiateAtomicTxProtection {
        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }

        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        if (collateralAmounts.length != servicer.termRepoCollateralManager().numOfAcceptedCollateralTokens()) {
            revert InvalidCollateralAmountsInput();
        }
        if (retrieveFundsList.length != collateralAmounts.length) {
            revert InvalidRetrieveFundsListLength();
        }
        for (uint8 i=0; i < retrieveFundsList.length; ++i) {
            if (collateralAmounts[i] > 0 && !_validateRetrieveFunds(retrieveFundsList[i])){
                revert RetrieveFundsNotSpecified();
            }
        }
        // enforced full fill to avoid unutilized retrieve funds left in diamond
        uint256 maxFill = _calculateLimitLendFillAmount(order);
        if (maxFill < fillAmount) {
            revert InsufficientRemainingCapacity(maxFill);
        }

        TermStorage storage ts = LibTermStorage.termStorage();
        for (uint8 i = 0; i < collateralAmounts.length; ++i) {
            if (collateralAmounts[i] == 0){
                continue;
            }
            
            address collateralToken = servicer.termRepoCollateralManager().collateralTokens(i);

            // generate retrieveFundsCalldata
            bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
                retrieveFundsList[i],
                collateralAmounts[i],
                collateralToken,
                msg.sender
            );

            // Set settlement context before executing retrieveFunds
            ts.activeAtomicTxSettlementTaker = msg.sender;
            uint256 collateralTokenBalanceBefore = IERC20(collateralToken).balanceOf(address(this));

            // execute retrieveFundsCalldata
            Address.functionCall(
                address(this),
                retrieveFundsCalldata
            );

            uint256 collateralTokenBalanceAfter = IERC20(collateralToken).balanceOf(address(this));

            if (collateralTokenBalanceAfter < collateralTokenBalanceBefore + collateralAmounts[i]) {
                revert InsufficientFundsRetrieved();
            }

            // Clear settlement context after execution
            ts.activeAtomicTxSettlementTaker = address(0);
        }
        
        ts.activeAtomicTxSettlementTaker = msg.sender;
        TermLoanIntentFacet(address(this)).settleLimitLend(order, msg.sender, fillAmount, collateralAmounts, signature);
        ts.activeAtomicTxSettlementTaker = address(0);
    }

    /// @notice Settles a limit borrow order by first executing a specified function to retrieve purchase tokens, then settling the order with the retrieved funds, all within the same transaction
    /// @param order The limit borrow order to settle
    /// @param fillAmount The amount to fill on the order
    /// @param signature The maker's signature authorizing the order
    /// @param retrieveFunds The details of the function to call to retrieve funds, including the target facet and any additional calldata
    function settleLimitBorrowWithHook(
        ITermIntent.LimitBorrowOrder memory order,
        uint256 fillAmount,
        ITermIntent.Signature memory signature,
        ITermIntent.RetrieveFundsStruct memory retrieveFunds
    ) external initiateAtomicTxProtection {
        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }
        if (!_validateRetrieveFunds(retrieveFunds)) {
            revert RetrieveFundsNotSpecified();
        }
        // enforced full fill to avoid unutilized retrieve funds left in diamond
        uint256 maxFill = _calculateLimitBorrowFillAmount(order);
        if (maxFill < fillAmount) {
            revert InsufficientRemainingCapacity(maxFill);
        }

        ITermRepoServicer servicer = ITermRepoServicer(order.repoServicer);
        address purchaseToken = servicer.purchaseToken();
        // generate retrieveFundsCalldata
        bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
            retrieveFunds,
            fillAmount,
            purchaseToken,
            msg.sender
        );

        // Set settlement context before executing retrieveFunds
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeAtomicTxSettlementTaker = msg.sender;

        uint256 purchaseTokenBalanceBefore = IERC20(purchaseToken).balanceOf(address(this));

        // execute retrieveFundsCalldata
        Address.functionCall(
            address(this),
            retrieveFundsCalldata
        );  

        uint256 purchaseTokenBalanceAfter = IERC20(purchaseToken).balanceOf(address(this));
        if (purchaseTokenBalanceAfter < purchaseTokenBalanceBefore + fillAmount) {
            revert InsufficientFundsRetrieved();
        }
        TermLoanIntentFacet(address(this)).settleLimitBorrow(order, msg.sender, fillAmount, signature);
        
        // Clear settlement context after execution
        ts.activeAtomicTxSettlementTaker = address(0);    
    }

    /// @notice Swaps a specified amount of purchaseTokens for repo tokens from a repo token swap order, by first executing a specified function to retrieve purchase tokens, then performing the swap with the retrieved funds, all within the same transaction
    /// @dev Only supports swap orders where the maker asset is NOT the purchase token (i.e., taker pays purchase tokens for repo tokens)
    /// @param order The repo token swap order to fill
    /// @param fillAmount The amount to fill on the order
    /// @param signature The maker's signature authorizing the order
    /// @param retrieveFunds The details of the function to call to retrieve funds, including the target facet and any additional calldata
    function swapRepoTokenWithHook(
        ITermIntent.RepoTokenSwapOrder memory order,
        uint256 fillAmount,
        ITermIntent.Signature memory signature,
        ITermIntent.RetrieveFundsStruct memory retrieveFunds
    ) external initiateAtomicTxProtection {
        if (fillAmount == 0) {
            revert InvalidFillAmount();
        }
        if (!_validateRetrieveFunds(retrieveFunds)) {
            revert RetrieveFundsNotSpecified();
        }
        if (order.makerAssetIsPurchaseToken){
            revert InvalidSwapOrderToFill();
        }

        (, address purchaseToken, ,) = TermRepoToken(order.repoToken).config();
        // enforced full fill to avoid unutilized retrieve funds left in diamond
        uint256 maxFill = _calculateRepoTokenSwapFillAmount(order);
        if (maxFill < fillAmount) {
            revert InsufficientRemainingCapacity(maxFill);
        }
        // generate retrieveFundsCalldata
        bytes memory retrieveFundsCalldata = _generateRetrieveFundsCalldata(
            retrieveFunds,
            fillAmount,
            purchaseToken,
            msg.sender
        );

        // Set settlement context before executing retrieveFunds
        TermStorage storage ts = LibTermStorage.termStorage();
        ts.activeAtomicTxSettlementTaker = msg.sender;

        uint256 purchaseTokenBalanceBefore = IERC20(purchaseToken).balanceOf(address(this));

        // execute retrieveFundsCalldata
        Address.functionCall(
            address(this),
            retrieveFundsCalldata
        );

        uint256 purchaseTokenBalanceAfter = IERC20(purchaseToken).balanceOf(address(this));
        if (purchaseTokenBalanceAfter < purchaseTokenBalanceBefore + fillAmount) {
            revert InsufficientFundsRetrieved();
        }

        TermRepoTokenIntentFacet(address(this)).swapRepoToken(order, msg.sender, fillAmount, signature);
        
        // Clear settlement context after execution
        ts.activeAtomicTxSettlementTaker = address(0);
    }

    /// @notice Calculates the actual fill amount for a limit lend order, capped by remaining unfilled capacity
    /// @param order The limit lend order to fill against
    /// @return The actual fill amount (min of requested and remaining capacity)
    /// @custom:reverts NothingToFill if the computed fill amount is zero
    function _calculateLimitLendFillAmount(
        ITermIntent.LimitLendOrder memory order
    ) internal view  returns (uint256 ) {
        TermStorage storage s = LibTermStorage.termStorage();
        bytes32 orderHash = TermLoanIntentFacet(address(this)).getLendOrderHash(order);
        ITermIntent.OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        uint256 maxFill = order.purchaseTokenAmount - orderContext.filledAmount;
        return maxFill;
    }

    /// @notice Calculates the actual fill amount for a limit borrow order, capped by remaining unfilled capacity
    /// @param order The limit borrow order to fill against
    /// @return The actual fill amount (min of requested and remaining capacity)
    /// @custom:reverts NothingToFill if the computed fill amount is zero
    function _calculateLimitBorrowFillAmount(
        ITermIntent.LimitBorrowOrder memory order
    ) internal view  returns (uint256 ) {
        TermStorage storage s = LibTermStorage.termStorage();
        bytes32 orderHash = TermLoanIntentFacet(address(this)).getBorrowOrderHash(order);
        ITermIntent.OrderContext memory orderContext = s.limitOrderContextMapping[orderHash];
        uint256 maxFill = order.purchaseTokenAmount - orderContext.filledAmount;
        return maxFill;
    }

    /// @notice Calculates the actual fill amount for a repo token swap order, capped by remaining unfilled capacity
    /// @param order The repo token swap order to fill against
    /// @return The actual fill amount (min of requested and remaining capacity)
    /// @custom:reverts NothingToFill if the computed fill amount is zero
    function _calculateRepoTokenSwapFillAmount(
        ITermIntent.RepoTokenSwapOrder memory order
    ) internal view returns (uint256) {
        TermStorage storage s = LibTermStorage.termStorage();
        bytes32 orderHash = TermRepoTokenIntentFacet(address(this)).getSwapOrderHash(order);
        ITermIntent.OrderContext memory orderContext = s.swapOrderContextMapping[orderHash];
        uint256 maxFill = order.purchaseTokenAmount - orderContext.filledAmount;
        return maxFill;
    }

    function _validateRetrieveFunds(RetrieveFundsStruct memory retrieveFunds) private view returns(bool) {
        if (retrieveFunds.method != bytes4(0)) {
            address facetAddress = IDiamondLoupe(address(this)).facetAddress(retrieveFunds.method);

            // Confirm that method belongs to specified facet
            if (facetAddress == address(0)) {
                revert InvalidRetrieveFundsFunction();
            }
            return true;
        }
        return false;
    }

    function _generateRetrieveFundsCalldata(RetrieveFundsStruct memory retrieveFunds, uint256 amountToRetrieve, address token, address user) private returns (bytes memory) {
        address facetAddress = IDiamondLoupe(address(this)).facetAddress(retrieveFunds.method);
        bytes4 sig = bytes4(keccak256("generateCalldata(bytes4,address,address,address,uint256,bool,bytes)"));

        bytes memory encodeCalldataInput = abi.encodeWithSelector(sig, retrieveFunds.method, retrieveFunds.target, token, user, amountToRetrieve, false, retrieveFunds.additionalCalldata);
        bytes memory returnData = Address.functionCall(
            facetAddress,
            encodeCalldataInput
        );
        return abi.decode(returnData, (bytes));
    }

}