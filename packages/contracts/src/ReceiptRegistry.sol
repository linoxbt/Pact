// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Immutable anchor for the final state of a funded Pact obligation.
contract ReceiptRegistry {
    error Unauthorized();
    error AlreadyFinalized();

    struct Receipt {
        bytes32 termsDigest;
        bytes32 evidenceHash;
        bytes32 verdictHash;
        bytes32 root;
        bool paid;
    }
    mapping(uint256 => Receipt) public receipts;
    address public immutable manager;

    event ReceiptFinalized(uint256 indexed obligationId, bytes32 indexed root, bool paid);

    constructor(address manager_) {
        if (manager_ == address(0)) revert Unauthorized();
        manager = manager_;
    }

    function getReceipt(uint256 id) external view returns (Receipt memory) {
        return receipts[id];
    }

    function finalize(uint256 id, bytes32 termsDigest, bytes32 evidenceHash, bytes32 verdictHash, bool paid)
        external
        returns (bytes32 root)
    {
        if (msg.sender != manager) revert Unauthorized();
        if (receipts[id].root != bytes32(0)) revert AlreadyFinalized();
        root = keccak256(abi.encode(block.chainid, address(this), id, termsDigest, evidenceHash, verdictHash, paid));
        receipts[id] = Receipt(termsDigest, evidenceHash, verdictHash, root, paid);
        emit ReceiptFinalized(id, root, paid);
    }
}
