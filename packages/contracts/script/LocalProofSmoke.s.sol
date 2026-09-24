// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {CommitmentLedger} from "../src/CommitmentLedger.sol";
import {PactAccount} from "../src/PactAccount.sol";

interface VmSmoke {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Local Anvil-only fixture for checking the public proof reader against real ABIs.
contract LocalProofSmoke {
    VmSmoke private constant vm = VmSmoke(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (uint256 grantId, uint256 reservationId, bytes32 digest) {
        address principal = vm.envAddress("PACT_PRINCIPAL");
        AuthorityRegistry registry = AuthorityRegistry(vm.envAddress("PACT_REGISTRY"));
        CommitmentLedger ledger = CommitmentLedger(vm.envAddress("PACT_LEDGER"));
        PactAccount account = PactAccount(vm.envAddress("PACT_ACCOUNT"));
        address token = address(0x1234);
        address recipient = address(0x5678);
        bytes32 policyHash = keccak256("local-smoke-policy");
        vm.startBroadcast();
        grantId = registry.createRoot(
            principal, address(account), token, recipient, 1_000, 500, 500, 2_000_000_100, 1, policyHash
        );
        PactAccount.TransferIntent memory intent =
            PactAccount.TransferIntent(grantId, principal, token, recipient, 100, 1, 2_000_000_000, policyHash);
        digest = account.hashIntent(intent);
        reservationId = ledger.reserve(grantId, digest, 100, 2_000_000_000);
        vm.stopBroadcast();
    }
}
