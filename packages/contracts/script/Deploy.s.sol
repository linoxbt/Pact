// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {CommitmentLedger} from "../src/CommitmentLedger.sol";
import {PactAccount} from "../src/PactAccount.sol";
import {ObligationManager} from "../src/ObligationManager.sol";
import {SettlementVault} from "../src/SettlementVault.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

interface VmDeploy {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys a complete immutable local stack. Supply PACT_PRINCIPAL in the environment.
contract Deploy {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run()
        external
        returns (
            CommitmentLedger ledger,
            AuthorityRegistry registry,
            PactAccount account,
            ObligationManager manager,
            SettlementVault vault,
            ReceiptRegistry receipts
        )
    {
        address principal = vm.envAddress("PACT_PRINCIPAL");
        require(principal != address(0), "missing principal");
        vm.startBroadcast();
        ledger = new CommitmentLedger();
        registry = new AuthorityRegistry(address(ledger));
        account = new PactAccount(principal, registry, ledger);
        manager = new ObligationManager(registry, ledger);
        vault = new SettlementVault(address(manager));
        receipts = new ReceiptRegistry(address(manager));
        ledger.configure(address(registry));
        ledger.configureObligationManager(address(manager));
        manager.configure(vault, receipts);
        vm.stopBroadcast();
    }
}
