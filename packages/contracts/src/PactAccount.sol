// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthorityRegistry} from "./AuthorityRegistry.sol";
import {CommitmentLedger} from "./CommitmentLedger.sol";

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @notice Principal-funded account. Agents can only execute exact reserved ERC-20 transfers.
contract PactAccount {
    error Unauthorized();
    error InvalidAction();
    error InvalidApproval();
    error TransferFailed();
    error Reentrant();

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "TransferIntent(uint256 grantId,address agent,address token,address to,uint256 amount,uint256 nonce,uint64 deadline,bytes32 policyHash)"
    );
    bytes32 public constant APPROVAL_TYPEHASH =
        keccak256("TransferApproval(bytes32 intentHash,uint256 reservationId,uint64 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    bytes32 private immutable NAME_HASH = keccak256("PactAccount");
    bytes32 private immutable VERSION_HASH = keccak256("1");

    address public immutable principal;
    AuthorityRegistry public immutable registry;
    CommitmentLedger public immutable ledger;
    mapping(uint256 => bool) public usedNonces;
    uint256 private entered;

    struct TransferIntent {
        uint256 grantId;
        address agent;
        address token;
        address to;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
        bytes32 policyHash;
    }

    event TransferExecuted(
        uint256 indexed grantId,
        uint256 indexed reservationId,
        bytes32 indexed intentHash,
        address token,
        address to,
        uint256 amount
    );

    constructor(address principal_, AuthorityRegistry registry_, CommitmentLedger ledger_) {
        if (principal_ == address(0) || address(registry_) == address(0) || address(ledger_) == address(0)) {
            revert InvalidAction();
        }
        principal = principal_;
        registry = registry_;
        ledger = ledger_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashIntent(TransferIntent calldata intent) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.grantId,
                intent.agent,
                intent.token,
                intent.to,
                intent.amount,
                intent.nonce,
                intent.deadline,
                intent.policyHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function hashApproval(bytes32 intentHash, uint256 reservationId, uint64 deadline) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(APPROVAL_TYPEHASH, intentHash, reservationId, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function executeTransfer(TransferIntent calldata intent, uint256 reservationId, bytes calldata approval) external {
        if (entered != 0) revert Reentrant();
        entered = 1;
        if (
            !registry.isActive(intent.grantId) || intent.deadline <= block.timestamp || usedNonces[intent.nonce]
                || intent.agent != msg.sender || intent.to == address(0) || intent.amount == 0
        ) revert InvalidAction();
        AuthorityRegistry.Grant memory grant = registry.getGrant(intent.grantId);
        if (
            grant.principal != principal || grant.account != address(this) || grant.agent != intent.agent
                || grant.token != intent.token || grant.recipient != intent.to || grant.policyHash != intent.policyHash
                || intent.amount > grant.singleLimit
        ) revert InvalidAction();

        bytes32 intentHash = hashIntent(intent);
        if (intent.amount > grant.approvalThreshold) {
            bytes32 approvalHash = hashApproval(intentHash, reservationId, intent.deadline);
            if (!_validPrincipalSignature(approvalHash, approval)) revert InvalidApproval();
        }
        usedNonces[intent.nonce] = true;
        uint256 reservedAmount = ledger.consumeSpend(reservationId, intentHash);
        if (reservedAmount != intent.amount) revert InvalidAction();
        (bool success, bytes memory response) =
            intent.token.call(abi.encodeWithSelector(bytes4(0xa9059cbb), intent.to, intent.amount));
        if (!success || (response.length != 0 && (response.length != 32 || !abi.decode(response, (bool))))) {
            revert TransferFailed();
        }
        emit TransferExecuted(intent.grantId, reservationId, intentHash, intent.token, intent.to, intent.amount);
        entered = 0;
    }

    function _validPrincipalSignature(bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (principal.code.length != 0) {
            try IERC1271(principal).isValidSignature(digest, signature) returns (bytes4 magic) {
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
        address signer = ecrecover(digest, v, r, s);
        return signer != address(0) && signer == principal;
    }
}
