// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {CommitmentLedger} from "../src/CommitmentLedger.sol";
import {PactAccount} from "../src/PactAccount.sol";
import {ObligationManager} from "../src/ObligationManager.sol";
import {SettlementVault} from "../src/SettlementVault.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

interface VmFlow {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function expectRevert() external;
}

contract EscrowToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ObligationFlowTest {
    VmFlow private constant vm = VmFlow(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PRINCIPAL_KEY = 0xA11CE;
    uint256 private constant AGENT_KEY = 0xB0B;
    uint256 private constant PROVIDER_KEY = 0xFACE;
    uint256 private constant VERIFIER_KEY = 0xDEAD;
    uint256 private constant ARBITRATOR_KEY = 0xCAFE;

    address private principal;
    address private agent;
    address private provider;
    address private verifier;
    address private arbitrator;
    AuthorityRegistry private registry;
    CommitmentLedger private ledger;
    PactAccount private account;
    ObligationManager private manager;
    SettlementVault private vault;
    ReceiptRegistry private receipts;
    EscrowToken private token;
    uint256 private grantId;

    function setUp() public {
        principal = vm.addr(PRINCIPAL_KEY);
        agent = vm.addr(AGENT_KEY);
        provider = vm.addr(PROVIDER_KEY);
        verifier = vm.addr(VERIFIER_KEY);
        arbitrator = vm.addr(ARBITRATOR_KEY);
        ledger = new CommitmentLedger();
        registry = new AuthorityRegistry(address(ledger));
        account = new PactAccount(principal, registry, ledger);
        manager = new ObligationManager(registry, ledger);
        vault = new SettlementVault(address(manager));
        receipts = new ReceiptRegistry(address(manager));
        manager.configure(vault, receipts);
        ledger.configure(address(registry));
        ledger.configureObligationManager(address(manager));
        token = new EscrowToken();
        token.mint(principal, 15_000);
        vm.prank(principal);
        grantId = registry.createRoot(
            agent,
            address(account),
            address(token),
            provider,
            15_000,
            2_000,
            5_000,
            uint64(block.timestamp + 30 days),
            2,
            keccak256("policy")
        );
    }

    function _terms(uint256 reservationId) private view returns (ObligationManager.Terms memory) {
        return ObligationManager.Terms(
            grantId,
            reservationId,
            provider,
            verifier,
            arbitrator,
            address(token),
            6_000,
            uint64(block.timestamp + 10 days),
            uint64(block.timestamp + 12 days),
            uint64(1 days),
            keccak256("milestone")
        );
    }

    function _signature(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _create() private returns (uint256 id) {
        // Reservation ID is known before the agent reserves capacity; it is part of the signed terms.
        ObligationManager.Terms memory terms = _terms(ledger.nextReservationId());
        bytes32 digest = manager.hashTerms(terms);
        vm.prank(agent);
        uint256 reservationId = ledger.reserveLiabilityAt(
            grantId, terms.reservationId, digest, terms.amount, uint64(block.timestamp + 1 days)
        );
        require(reservationId == terms.reservationId, "reservation ID");
        id = manager.create(terms, _signature(PRINCIPAL_KEY, digest), _signature(PROVIDER_KEY, digest));
    }

    function _fund(uint256 id) private {
        vm.prank(principal);
        token.approve(address(vault), 6_000);
        vm.prank(principal);
        manager.fund(id);
    }

    function testFundedMilestoneSettlesAndAnchorsReceipt() public {
        uint256 id = _create();
        require(ledger.available(grantId) == 9_000, "gross liability reserved");
        _fund(id);
        vm.prank(provider);
        manager.submitEvidence(id, keccak256("delivery"));
        vm.prank(verifier);
        manager.verify(id, true, keccak256("accepted"));
        vm.warp(block.timestamp + 1 days);
        manager.finalize(id);
        require(token.balanceOf(provider) == 6_000, "provider paid");
        require(receipts.getReceipt(id).root != bytes32(0), "receipt anchored");
        require(ledger.available(grantId) == 9_000, "settled amount remains spent");
        vm.expectRevert();
        manager.finalize(id);
    }

    function testChallengeHoldsSettlementThenRefundsOnArbitratorRejection() public {
        uint256 id = _create();
        _fund(id);
        vm.prank(provider);
        manager.submitEvidence(id, keccak256("delivery"));
        vm.prank(verifier);
        manager.verify(id, true, keccak256("initial verdict"));
        vm.prank(principal);
        manager.challenge(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert();
        manager.finalize(id);
        vm.prank(arbitrator);
        manager.resolve(id, false, keccak256("arbitrated rejection"));
        manager.finalize(id);
        require(token.balanceOf(principal) == 15_000, "principal refunded");
        require(ledger.available(grantId) == 15_000, "liability released");
    }

    function testMissingArbitratorEventuallyRefundsChallengedEscrow() public {
        uint256 id = _create();
        _fund(id);
        vm.prank(provider);
        manager.submitEvidence(id, keccak256("delivery"));
        vm.prank(verifier);
        manager.verify(id, true, keccak256("initial verdict"));
        vm.prank(principal);
        manager.challenge(id);
        vm.expectRevert();
        manager.resolveArbitratorTimeout(id);
        vm.warp(block.timestamp + 32 days);
        manager.resolveArbitratorTimeout(id);
        manager.finalize(id);
        require(token.balanceOf(principal) == 15_000, "principal refunded after arbitration timeout");
        require(receipts.getReceipt(id).verdictHash == manager.ARBITRATOR_TIMEOUT_VERDICT(), "timeout verdict anchored");
    }

    function testChangedTermsCannotConsumeReservation() public {
        ObligationManager.Terms memory terms = _terms(ledger.nextReservationId());
        bytes32 digest = manager.hashTerms(terms);
        vm.prank(agent);
        ledger.reserveLiabilityAt(grantId, terms.reservationId, digest, terms.amount, uint64(block.timestamp + 1 days));
        terms.amount = 5_000;
        bytes32 changedDigest = manager.hashTerms(terms);
        bytes memory principalSig = _signature(PRINCIPAL_KEY, changedDigest);
        bytes memory providerSig = _signature(PROVIDER_KEY, changedDigest);
        vm.expectRevert();
        manager.create(terms, principalSig, providerSig);
    }

    function testExpectedReservationIdPreventsTermsRace() public {
        ObligationManager.Terms memory terms = _terms(ledger.nextReservationId());
        bytes32 digest = manager.hashTerms(terms);
        vm.prank(agent);
        ledger.reserve(grantId, keccak256("another action"), 100, uint64(block.timestamp + 1 days));
        vm.prank(agent);
        vm.expectRevert();
        ledger.reserveLiabilityAt(grantId, terms.reservationId, digest, terms.amount, uint64(block.timestamp + 1 days));
        require(ledger.available(grantId) == 14_900, "failed liability reservation held no capacity");
    }

    function testUnfundedTimeoutReleasesLiability() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 11 days);
        manager.cancelUnfunded(id);
        require(ledger.available(grantId) == 15_000, "unused liability released");
        require(receipts.getReceipt(id).root != bytes32(0), "cancel receipt anchored");
    }

    function testVerifierTimeoutEscalatesToArbitrator() public {
        uint256 id = _create();
        _fund(id);
        vm.prank(provider);
        manager.submitEvidence(id, keccak256("delivery"));
        vm.warp(block.timestamp + 13 days);
        manager.escalateVerifierTimeout(id);
        vm.expectRevert();
        manager.finalize(id);
        vm.prank(arbitrator);
        manager.resolve(id, true, keccak256("arbitrator accepts delivery"));
        manager.finalize(id);
        require(token.balanceOf(provider) == 6_000, "provider paid after timeout resolution");
    }
}
