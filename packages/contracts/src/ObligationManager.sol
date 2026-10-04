// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "./AuthorityRegistry.sol";
import {CommitmentLedger} from "./CommitmentLedger.sol";
import {SettlementVault} from "./SettlementVault.sol";
import {ReceiptRegistry} from "./ReceiptRegistry.sol";

interface IContractSigner {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @notice Exact-terms, full-funded, single-milestone obligation lifecycle.
contract ObligationManager {
    error Unauthorized();
    error InvalidTerms();
    error InvalidState();
    error InvalidSignature();
    error NotReady();
    error Reentrant();

    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "ObligationTerms(uint256 grantId,uint256 reservationId,address provider,address verifier,address arbitrator,address token,uint256 amount,uint64 deliverBy,uint64 verifyBy,uint64 challengePeriod,bytes32 specificationHash)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    uint256 private constant MAX_CHALLENGE = 30 days;
    uint256 public constant ARBITRATION_TIMEOUT = 30 days;
    bytes32 public constant ARBITRATOR_TIMEOUT_VERDICT = keccak256("PACT_ARBITRATOR_TIMEOUT_REFUND_V1");

    enum State {
        None,
        Created,
        Funded,
        Submitted,
        Verified,
        Rejected,
        Challenged,
        Settled,
        Refunded
    }

    struct Terms {
        uint256 grantId;
        uint256 reservationId;
        address provider;
        address verifier;
        address arbitrator;
        address token;
        uint256 amount;
        uint64 deliverBy;
        uint64 verifyBy;
        uint64 challengePeriod;
        bytes32 specificationHash;
    }

    struct Obligation {
        uint256 grantId;
        address principal;
        address provider;
        address verifier;
        address arbitrator;
        address token;
        uint256 amount;
        uint64 deliverBy;
        uint64 verifyBy;
        uint64 challengePeriod;
        uint64 challengeEndsAt;
        bytes32 termsDigest;
        bytes32 evidenceHash;
        bytes32 verdictHash;
        State state;
    }

    AuthorityRegistry public immutable registry;
    CommitmentLedger public immutable ledger;
    address public immutable owner;
    SettlementVault public vault;
    ReceiptRegistry public receipts;
    uint256 public nextObligationId = 1;
    uint256 private entered;
    mapping(uint256 => Obligation) public obligations;

    event ObligationCreated(
        uint256 indexed id, uint256 indexed grantId, bytes32 indexed termsDigest, address provider, uint256 amount
    );
    event EvidenceSubmitted(uint256 indexed id, bytes32 evidenceHash);
    event VerdictRecorded(uint256 indexed id, bytes32 verdictHash, bool accepted);
    event Challenged(uint256 indexed id);
    event Finalized(uint256 indexed id, bool paid, bytes32 receiptRoot);

    constructor(AuthorityRegistry registry_, CommitmentLedger ledger_) {
        registry = registry_;
        ledger = ledger_;
        owner = msg.sender;
    }

    function configure(SettlementVault vault_, ReceiptRegistry receipts_) external {
        if (
            msg.sender != owner || address(vault) != address(0) || address(vault_) == address(0)
                || address(receipts_) == address(0) || vault_.manager() != address(this)
                || receipts_.manager() != address(this)
        ) revert Unauthorized();
        vault = vault_;
        receipts = receipts_;
    }

    function hashTerms(Terms calldata terms) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("PactObligation"), keccak256("1"), block.chainid, address(this))
        );
        bytes32 body = keccak256(
            abi.encode(
                TERMS_TYPEHASH,
                terms.grantId,
                terms.reservationId,
                terms.provider,
                terms.verifier,
                terms.arbitrator,
                terms.token,
                terms.amount,
                terms.deliverBy,
                terms.verifyBy,
                terms.challengePeriod,
                terms.specificationHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function create(Terms calldata terms, bytes calldata principalSignature, bytes calldata providerSignature)
        external
        returns (uint256 id)
    {
        if (
            address(vault) == address(0) || !registry.isActive(terms.grantId) || terms.provider == address(0)
                || terms.verifier == address(0) || terms.arbitrator == address(0) || terms.amount == 0
                || terms.specificationHash == bytes32(0) || terms.deliverBy <= block.timestamp
                || terms.verifyBy <= terms.deliverBy || terms.verifyBy > terms.deliverBy + 30 days
                || terms.challengePeriod == 0 || terms.challengePeriod > MAX_CHALLENGE
        ) revert InvalidTerms();
        AuthorityRegistry.Grant memory grant = registry.getGrant(terms.grantId);
        if (
            terms.token != grant.token || terms.provider != grant.recipient || terms.deliverBy > grant.expiresAt
                || terms.provider == grant.principal || terms.verifier == terms.provider
                || terms.verifier == grant.principal || terms.arbitrator == terms.provider
                || terms.arbitrator == grant.principal || terms.arbitrator == terms.verifier
        ) revert InvalidTerms();
        bytes32 digest = hashTerms(terms);
        if (
            !_validSignature(grant.principal, digest, principalSignature)
                || !_validSignature(terms.provider, digest, providerSignature)
        ) revert InvalidSignature();
        (uint256 grantId, uint256 amount) = ledger.commitLiability(terms.reservationId, digest);
        if (grantId != terms.grantId || amount != terms.amount) revert InvalidTerms();
        id = nextObligationId++;
        obligations[id] = Obligation(
            grantId,
            grant.principal,
            terms.provider,
            terms.verifier,
            terms.arbitrator,
            terms.token,
            amount,
            terms.deliverBy,
            terms.verifyBy,
            terms.challengePeriod,
            0,
            digest,
            bytes32(0),
            bytes32(0),
            State.Created
        );
        emit ObligationCreated(id, grantId, digest, terms.provider, amount);
    }

    function fund(uint256 id) external {
        if (entered != 0) revert Reentrant();
        entered = 1;
        Obligation storage o = obligations[id];
        if (o.state != State.Created || msg.sender != o.principal || block.timestamp > o.deliverBy) {
            revert InvalidState();
        }
        vault.fund(id, o.token, o.principal, o.amount);
        o.state = State.Funded;
        entered = 0;
    }

    function submitEvidence(uint256 id, bytes32 evidenceHash) external {
        Obligation storage o = obligations[id];
        if (
            o.state != State.Funded || msg.sender != o.provider || block.timestamp > o.deliverBy
                || evidenceHash == bytes32(0)
        ) revert InvalidState();
        o.evidenceHash = evidenceHash;
        o.state = State.Submitted;
        emit EvidenceSubmitted(id, evidenceHash);
    }

    function verify(uint256 id, bool accepted, bytes32 verdictHash) external {
        Obligation storage o = obligations[id];
        if (
            o.state != State.Submitted || msg.sender != o.verifier || verdictHash == bytes32(0)
                || block.timestamp > o.verifyBy
        ) revert InvalidState();
        o.verdictHash = verdictHash;
        o.challengeEndsAt = uint64(block.timestamp + o.challengePeriod);
        o.state = accepted ? State.Verified : State.Rejected;
        emit VerdictRecorded(id, verdictHash, accepted);
    }

    function challenge(uint256 id) external {
        Obligation storage o = obligations[id];
        if (
            (o.state != State.Verified && o.state != State.Rejected)
                || (msg.sender != o.principal && msg.sender != o.provider) || block.timestamp >= o.challengeEndsAt
        ) revert InvalidState();
        o.state = State.Challenged;
        emit Challenged(id);
    }

    function escalateVerifierTimeout(uint256 id) external {
        Obligation storage o = obligations[id];
        if (o.state != State.Submitted || block.timestamp <= o.verifyBy) revert InvalidState();
        o.state = State.Challenged;
        emit Challenged(id);
    }

    function resolve(uint256 id, bool accepted, bytes32 verdictHash) external {
        Obligation storage o = obligations[id];
        if (o.state != State.Challenged || msg.sender != o.arbitrator || verdictHash == bytes32(0)) {
            revert InvalidState();
        }
        o.verdictHash = verdictHash;
        o.challengeEndsAt = uint64(block.timestamp);
        o.state = accepted ? State.Verified : State.Rejected;
        emit VerdictRecorded(id, verdictHash, accepted);
    }

    /// @notice Refunds a challenged obligation if its named arbitrator has not acted in time.
    /// The principal and provider accept this fallback when they sign the obligation terms.
    function resolveArbitratorTimeout(uint256 id) external {
        Obligation storage o = obligations[id];
        if (o.state != State.Challenged) revert InvalidState();
        uint256 deadline = (o.challengeEndsAt == 0 ? o.verifyBy : o.challengeEndsAt) + ARBITRATION_TIMEOUT;
        if (block.timestamp <= deadline) revert NotReady();
        o.verdictHash = ARBITRATOR_TIMEOUT_VERDICT;
        o.challengeEndsAt = uint64(block.timestamp);
        o.state = State.Rejected;
        emit VerdictRecorded(id, ARBITRATOR_TIMEOUT_VERDICT, false);
    }

    function finalize(uint256 id) external {
        if (entered != 0) revert Reentrant();
        entered = 1;
        Obligation storage o = obligations[id];
        if (o.state != State.Verified && o.state != State.Rejected) revert InvalidState();
        if (block.timestamp < o.challengeEndsAt) revert NotReady();
        bool paid = o.state == State.Verified;
        o.state = paid ? State.Settled : State.Refunded;
        ledger.closeLiability(o.grantId, o.amount, paid);
        vault.release(id, paid ? o.provider : o.principal);
        bytes32 root = receipts.finalize(id, o.termsDigest, o.evidenceHash, o.verdictHash, paid);
        emit Finalized(id, paid, root);
        entered = 0;
    }

    function cancelUnfunded(uint256 id) external {
        Obligation storage o = obligations[id];
        if (o.state != State.Created || block.timestamp <= o.deliverBy) revert InvalidState();
        o.state = State.Refunded;
        ledger.closeLiability(o.grantId, o.amount, false);
        bytes32 root = receipts.finalize(id, o.termsDigest, bytes32(0), bytes32(0), false);
        emit Finalized(id, false, root);
    }

    function cancelUndelivered(uint256 id) external {
        if (entered != 0) revert Reentrant();
        entered = 1;
        Obligation storage o = obligations[id];
        if (o.state != State.Funded || block.timestamp <= o.deliverBy) revert InvalidState();
        o.state = State.Refunded;
        ledger.closeLiability(o.grantId, o.amount, false);
        vault.release(id, o.principal);
        bytes32 root = receipts.finalize(id, o.termsDigest, bytes32(0), bytes32(0), false);
        emit Finalized(id, false, root);
        entered = 0;
    }

    function _validSignature(address signer, bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (signer.code.length != 0) {
            try IContractSigner(signer).isValidSignature(digest, signature) returns (bytes4 magic) {
                return magic == ERC1271_MAGIC;
            } catch {
                return false;
            }
        }
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v != 27 && v != 28) return false;
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return false;
        return ecrecover(digest, v, r, s) == signer;
    }
}
