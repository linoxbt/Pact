// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICapacityAllocator {
    function allocateChild(uint256 parentId, uint256 amount) external;
}

/// @notice Principal-created, bounded grants. Parent allocations reserve capacity for children.
contract AuthorityRegistry {
    error Unauthorized();
    error InvalidGrant();
    error InactiveGrant();
    error InvalidDelegation();

    struct Grant {
        address principal;
        address agent;
        address account;
        address token;
        address recipient;
        uint256 parentId;
        uint256 ceiling;
        uint256 singleLimit;
        uint256 approvalThreshold;
        uint64 expiresAt;
        uint8 depthRemaining;
        bytes32 policyHash;
        bool revoked;
    }

    mapping(uint256 => Grant) private grants;
    uint256 public nextGrantId = 1;
    ICapacityAllocator public immutable ledger;

    event GrantCreated(
        uint256 indexed grantId, uint256 indexed parentId, address indexed principal, address agent, uint256 ceiling
    );
    event GrantRevoked(uint256 indexed grantId);
    event AgentRotated(uint256 indexed grantId, address indexed previousAgent, address indexed newAgent);

    constructor(address ledger_) {
        if (ledger_ == address(0)) revert InvalidGrant();
        ledger = ICapacityAllocator(ledger_);
    }

    function createRoot(
        address agent,
        address account,
        address token,
        address recipient,
        uint256 ceiling,
        uint256 singleLimit,
        uint256 approvalThreshold,
        uint64 expiresAt,
        uint8 depthRemaining,
        bytes32 policyHash
    ) external returns (uint256 id) {
        if (
            agent == address(0) || account == address(0) || token == address(0) || recipient == address(0)
                || ceiling == 0 || singleLimit == 0 || singleLimit > ceiling || expiresAt <= block.timestamp
                || depthRemaining > 8
        ) {
            revert InvalidGrant();
        }
        id = nextGrantId++;
        grants[id] = Grant(
            msg.sender,
            agent,
            account,
            token,
            recipient,
            0,
            ceiling,
            singleLimit,
            approvalThreshold,
            expiresAt,
            depthRemaining,
            policyHash,
            false
        );
        emit GrantCreated(id, 0, msg.sender, agent, ceiling);
    }

    function delegate(
        uint256 parentId,
        address agent,
        uint256 ceiling,
        uint256 singleLimit,
        uint256 approvalThreshold,
        uint64 expiresAt,
        bytes32 policyHash
    ) external returns (uint256 id) {
        Grant storage parent = grants[parentId];
        if (msg.sender != parent.principal) revert Unauthorized();
        if (!isActive(parentId)) revert InactiveGrant();
        if (
            agent == address(0) || parent.depthRemaining == 0 || ceiling == 0 || singleLimit == 0
                || singleLimit > ceiling || singleLimit > parent.singleLimit || expiresAt > parent.expiresAt
                || expiresAt <= block.timestamp || approvalThreshold > parent.approvalThreshold
        ) revert InvalidDelegation();
        ledger.allocateChild(parentId, ceiling);
        id = nextGrantId++;
        grants[id] = Grant(
            parent.principal,
            agent,
            parent.account,
            parent.token,
            parent.recipient,
            parentId,
            ceiling,
            singleLimit,
            approvalThreshold,
            expiresAt,
            parent.depthRemaining - 1,
            policyHash,
            false
        );
        emit GrantCreated(id, parentId, parent.principal, agent, ceiling);
    }

    function revoke(uint256 id) external {
        Grant storage grant = grants[id];
        if (grant.principal == address(0)) revert InvalidGrant();
        if (msg.sender != grant.principal) revert Unauthorized();
        grant.revoked = true;
        emit GrantRevoked(id);
    }

    function rotateAgent(uint256 id, address newAgent) external {
        Grant storage grant = grants[id];
        if (grant.principal == address(0)) revert InvalidGrant();
        if (msg.sender != grant.principal) revert Unauthorized();
        if (newAgent == address(0)) revert InvalidGrant();
        address old = grant.agent;
        grant.agent = newAgent;
        emit AgentRotated(id, old, newAgent);
    }

    function getGrant(uint256 id) external view returns (Grant memory) {
        if (grants[id].principal == address(0)) revert InvalidGrant();
        return grants[id];
    }

    function isActive(uint256 id) public view returns (bool) {
        if (id == 0 || id >= nextGrantId) return false;
        for (uint256 i; i < 9; ++i) {
            Grant storage grant = grants[id];
            if (grant.revoked || grant.expiresAt <= block.timestamp) return false;
            if (grant.parentId == 0) return true;
            id = grant.parentId;
        }
        return false;
    }
}
