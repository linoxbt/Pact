// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "./AuthorityRegistry.sol";
import {CommitmentLedger} from "./CommitmentLedger.sol";
import {PactAccount} from "./PactAccount.sol";

/// @notice One principal-owned account per wallet, sharing Pact's authority registry and ledger.
contract PactAccountFactory {
    error AccountAlreadyCreated();

    AuthorityRegistry public immutable registry;
    CommitmentLedger public immutable ledger;
    mapping(address => address) public accountOf;

    event AccountCreated(address indexed principal, address indexed account);

    constructor(AuthorityRegistry registry_, CommitmentLedger ledger_) {
        registry = registry_;
        ledger = ledger_;
    }

    function createAccount() external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AccountAlreadyCreated();
        account = address(new PactAccount(msg.sender, registry, ledger));
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account);
    }
}
