// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {CommitmentLedger} from "../src/CommitmentLedger.sol";
import {PactAccountFactory} from "../src/PactAccountFactory.sol";
import {ObligationManager} from "../src/ObligationManager.sol";
import {SettlementVault} from "../src/SettlementVault.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

interface VmFactoryDeploy {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys protocol infrastructure without a shared principal or shared user account.
contract DeployFactory {
    VmFactoryDeploy private constant vm = VmFactoryDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run()
        external
        returns (
            CommitmentLedger ledger,
            AuthorityRegistry registry,
            ObligationManager manager,
            SettlementVault vault,
            ReceiptRegistry receipts
        )
    {
        vm.startBroadcast();
        ledger = new CommitmentLedger();
        registry = new AuthorityRegistry(address(ledger));
        new PactAccountFactory(registry, ledger);
        manager = new ObligationManager(registry, ledger);
        vault = new SettlementVault(address(manager));
        receipts = new ReceiptRegistry(address(manager));
        ledger.configure(address(registry));
        ledger.configureObligationManager(address(manager));
        manager.configure(vault, receipts);
        vm.stopBroadcast();
    }
}
