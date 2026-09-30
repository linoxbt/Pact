// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {CommitmentLedger} from "../src/CommitmentLedger.sol";
import {PactAccount} from "../src/PactAccount.sol";
import {PactAccountFactory} from "../src/PactAccountFactory.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function expectRevert() external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FalseTransferToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

contract PactCoreTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PRINCIPAL_KEY = 0xA11CE;
    uint256 private constant AGENT_KEY = 0xB0B;
    uint256 private constant CHILD_KEY = 0xCAFE;
    bytes32 private constant POLICY = keccak256("single-asset-transfer-policy-v1");

    address private principal;
    address private agent;
    address private child;
    AuthorityRegistry private registry;
    CommitmentLedger private ledger;
    PactAccount private account;
    MockToken private token;
    uint256 private root;

    function setUp() public {
        principal = vm.addr(PRINCIPAL_KEY);
        agent = vm.addr(AGENT_KEY);
        child = vm.addr(CHILD_KEY);
        ledger = new CommitmentLedger();
        registry = new AuthorityRegistry(address(ledger));
        account = new PactAccount(principal, registry, ledger);
        token = new MockToken();
        ledger.configure(address(registry));
        token.mint(address(account), 15_000);
        vm.prank(principal);
        root = registry.createRoot(
            agent,
            address(account),
            address(token),
            address(0xBEEF),
            15_000,
            10_000,
            5_000,
            uint64(block.timestamp + 30 days),
            2,
            POLICY
        );
    }

    function testFactoryCreatesSeparatePrincipalAccounts() public {
        PactAccountFactory factory = new PactAccountFactory(registry, ledger);
        vm.prank(principal);
        address first = factory.createAccount();
        vm.prank(child);
        address second = factory.createAccount();
        require(first != second, "shared account");
        require(factory.accountOf(principal) == first, "principal account");
        require(factory.accountOf(child) == second, "child account");
        require(PactAccount(first).principal() == principal, "principal owner");
        require(PactAccount(second).principal() == child, "child owner");
        vm.expectRevert();
        vm.prank(principal);
        factory.createAccount();
    }

    function _intent(uint256 grantId, address actor, uint256 amount, uint256 nonce)
        private
        view
        returns (PactAccount.TransferIntent memory)
    {
        return PactAccount.TransferIntent(
            grantId, actor, address(token), address(0xBEEF), amount, nonce, uint64(block.timestamp + 1 days), POLICY
        );
    }

    function _reserve(PactAccount.TransferIntent memory intent, address actor) private returns (uint256) {
        bytes32 hash = account.hashIntent(intent);
        vm.prank(actor);
        return ledger.reserve(intent.grantId, hash, intent.amount, intent.deadline);
    }

    function _approval(bytes32 intentHash, uint256 reservationId, uint64 deadline) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(PRINCIPAL_KEY, account.hashApproval(intentHash, reservationId, deadline));
        return abi.encodePacked(r, s, v);
    }

    function testChildAllocationBoundsLiability() public {
        vm.prank(principal);
        uint256 grant = registry.delegate(root, child, 500, 500, 500, uint64(block.timestamp + 20 days), POLICY);
        require(ledger.available(root) == 14_500, "parent capacity");
        PactAccount.TransferIntent memory tooLarge = _intent(grant, child, 6_000, 1);
        bytes32 tooLargeHash = account.hashIntent(tooLarge);
        vm.prank(child);
        vm.expectRevert();
        ledger.reserve(grant, tooLargeHash, 6_000, tooLarge.deadline);
        require(ledger.available(grant) == 500, "child capacity");
    }

    function testCompetingReservationsCannotOversubscribe() public {
        vm.prank(principal);
        uint256 grant = registry.delegate(root, child, 8_000, 8_000, 5_000, uint64(block.timestamp + 20 days), POLICY);
        PactAccount.TransferIntent memory first = _intent(grant, child, 7_000, 1);
        PactAccount.TransferIntent memory second = _intent(grant, child, 2_000, 2);
        _reserve(first, child);
        bytes32 secondHash = account.hashIntent(second);
        vm.prank(child);
        vm.expectRevert();
        ledger.reserve(grant, secondHash, second.amount, second.deadline);
        require(ledger.available(grant) == 1_000, "remaining capacity");
    }

    function testTokenReturningTrueWithoutPaymentCannotProduceExecutedReceipt() public {
        FalseTransferToken falseToken = new FalseTransferToken();
        falseToken.mint(address(account), 100);
        vm.prank(principal);
        uint256 grantId = registry.createRoot(
            agent,
            address(account),
            address(falseToken),
            address(0xBEEF),
            100,
            100,
            100,
            uint64(block.timestamp + 1 days),
            0,
            POLICY
        );
        PactAccount.TransferIntent memory intent = PactAccount.TransferIntent(
            grantId, agent, address(falseToken), address(0xBEEF), 50, 94, uint64(block.timestamp + 1 hours), POLICY
        );
        uint256 reservationId = _reserve(intent, agent);
        vm.prank(agent);
        vm.expectRevert();
        account.executeTransfer(intent, reservationId, "");
        require(!account.usedNonces(94), "nonce must roll back");
    }

    function testApprovedTransferConsumesReservationAndNonce() public {
        PactAccount.TransferIntent memory intent = _intent(root, agent, 6_000, 42);
        uint256 reservationId = _reserve(intent, agent);
        bytes memory approval = _approval(account.hashIntent(intent), reservationId, intent.deadline);
        vm.prank(agent);
        account.executeTransfer(intent, reservationId, approval);
        require(token.balanceOf(address(0xBEEF)) == 6_000, "recipient paid");
        require(ledger.available(root) == 9_000, "cumulative spend counted");
        vm.prank(agent);
        vm.expectRevert();
        account.executeTransfer(intent, reservationId, approval);
    }

    function testChangedTermsCannotUseOldReservation() public {
        PactAccount.TransferIntent memory intent = _intent(root, agent, 6_000, 42);
        uint256 reservationId = _reserve(intent, agent);
        bytes memory approval = _approval(account.hashIntent(intent), reservationId, intent.deadline);
        intent.to = address(0xDEAD);
        vm.prank(agent);
        vm.expectRevert();
        account.executeTransfer(intent, reservationId, approval);
        require(token.balanceOf(address(0xDEAD)) == 0, "changed recipient denied");
    }

    function testRevokedParentBlocksChildExecution() public {
        vm.prank(principal);
        uint256 grant = registry.delegate(root, child, 500, 500, 500, uint64(block.timestamp + 20 days), POLICY);
        PactAccount.TransferIntent memory intent = _intent(grant, child, 400, 1);
        uint256 reservationId = _reserve(intent, child);
        vm.prank(principal);
        registry.revoke(root);
        vm.prank(child);
        vm.expectRevert();
        account.executeTransfer(intent, reservationId, "");
    }

    function testExpiredReservationReleasesCapacity() public {
        PactAccount.TransferIntent memory intent = _intent(root, agent, 1_000, 1);
        uint256 reservationId = _reserve(intent, agent);
        require(ledger.available(root) == 14_000, "reserved");
        vm.warp(block.timestamp + 2 days);
        ledger.expireReservation(reservationId);
        require(ledger.available(root) == 15_000, "released");
    }

    function testApprovalRequiredAboveThreshold() public {
        PactAccount.TransferIntent memory intent = _intent(root, agent, 6_000, 1);
        uint256 reservationId = _reserve(intent, agent);
        vm.prank(agent);
        vm.expectRevert();
        account.executeTransfer(intent, reservationId, "");
    }

    function testPrincipalCancelsReservationAndReclaimsRevokedChildCapacity() public {
        vm.prank(principal);
        uint256 grant = registry.delegate(root, child, 6_000, 2_000, 2_000, uint64(block.timestamp + 20 days), POLICY);
        PactAccount.TransferIntent memory intent = _intent(grant, child, 1_000, 1);
        uint256 reservationId = _reserve(intent, child);
        require(ledger.available(root) == 9_000, "allocation locked");
        vm.prank(principal);
        registry.revoke(grant);
        vm.prank(principal);
        ledger.cancelReservation(reservationId);
        vm.prank(principal);
        require(ledger.reclaimUnusedChild(grant) == 6_000, "all capacity reclaimed");
        require(ledger.available(root) == 15_000, "parent capacity restored");
        vm.prank(principal);
        vm.expectRevert();
        ledger.reclaimUnusedChild(grant);
    }

    function testReclaimPreservesSpentChildLiability() public {
        vm.prank(principal);
        uint256 grant = registry.delegate(root, child, 6_000, 2_000, 2_000, uint64(block.timestamp + 20 days), POLICY);
        PactAccount.TransferIntent memory intent = _intent(grant, child, 1_000, 1);
        uint256 reservationId = _reserve(intent, child);
        vm.prank(child);
        account.executeTransfer(intent, reservationId, "");
        vm.prank(principal);
        registry.revoke(grant);
        vm.prank(principal);
        require(ledger.reclaimUnusedChild(grant) == 5_000, "only unused capacity reclaimed");
        require(ledger.available(root) == 14_000, "spent amount remains allocated");
    }

    function testFuzz_ChildReservationsStayInsideParentAllocation(uint256 rawAllocation, uint256 rawChildUse) public {
        uint256 allocation = rawAllocation % 14_000 + 1;
        uint256 childLimit = allocation < 10_000 ? allocation : 10_000;
        vm.prank(principal);
        uint256 grant = registry.delegate(
            root,
            child,
            allocation,
            childLimit,
            childLimit < 5_000 ? childLimit : 5_000,
            uint64(block.timestamp + 20 days),
            POLICY
        );
        uint256 childUse = rawChildUse % childLimit + 1;
        PactAccount.TransferIntent memory intent = _intent(grant, child, childUse, 1);
        uint256 reservationId = _reserve(intent, child);
        require(ledger.available(root) == 15_000 - allocation, "parent allocation unchanged by child reserve");
        require(ledger.available(grant) == allocation - childUse, "child reserve counted exactly once");
        vm.prank(principal);
        registry.revoke(grant);
        vm.prank(principal);
        ledger.cancelReservation(reservationId);
        vm.prank(principal);
        ledger.reclaimUnusedChild(grant);
        require(ledger.available(root) == 15_000, "safe reclaim");
    }
}
