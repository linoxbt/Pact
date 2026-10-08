// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EscrowToken} from "./ObligationFlow.t.sol";

/// @notice Unrestricted faucet fixture for live testnet tests. No monetary value.
contract LiveTestToken is EscrowToken {
    string public constant name = "Pact Live Test USD";
    string public constant symbol = "pTEST";
    uint8 public constant decimals = 6;
}
