//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.16;

import "../lib/ExponentialNoError.sol";

contract PricingCalc is
    ExponentialNoError
{
    uint256 public dayCountFractionMantissa;
    uint256 public MAX_BID_PRICE = 10000000000000000000000; // 10,000%

    function setDayCountFractionMantissa (uint256 _dayCountFractionMantissa) public {
        dayCountFractionMantissa = _dayCountFractionMantissa;
    }

    function calculateRepurchasePrice(uint256 clearingPrice, uint256 amount)
        public
        view
        returns (uint256)
    {
        Exp memory repurchaseFactor = add_(
            Exp({mantissa: expScale}),
            mul_(
                Exp({mantissa: dayCountFractionMantissa}),
                Exp({mantissa: (clearingPrice * 1e9) / 100})
            )
        ); // @dev: Since clearing Price has 9 decimals, multiple by 1e9 to get to 18 for expscale

        return
            truncate(
                mul_(
                    Exp({mantissa: amount * expScale}),
                    repurchaseFactor
                )
            );
    }
}
