// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAuthorityReader {
    function isActive(uint256 id) external view returns (bool);
    function getGrant(uint256 id)
        external
        view
        returns (
            address principal,
            address agent,
            address account,
            address token,
            address recipient,
            uint256 parentId,
            uint256 ceiling,
            uint256 singleLimit,
            uint256 approvalThreshold,
            uint64 expiresAt,
            uint8 depthRemaining,
            bytes32 policyHash,
            bool revoked
        );
}

/// @notice Single-asset capacity accounting. A child's ceiling is locked in its parent at delegation.
contract CommitmentLedger {
    error Unauthorized();
    error InsufficientCapacity();
    error InvalidReservation();
    error AlreadyUsed();
    error NotExpired();

    struct Balance {
        uint256 allocated;
        uint256 reserved;
        uint256 committed;
        uint256 spent;
    }

    struct Reservation {
        uint256 grantId;
        bytes32 intentHash;
        uint256 amount;
        uint64 expiresAt;
        bool consumed;
        bool liability;
    }
    mapping(uint256 => Balance) public balances;
    mapping(uint256 => Reservation) public reservations;
    mapping(uint256 => uint256) public reclaimedChildCapacity;
    mapping(bytes32 => bool) public usedIntent;
    uint256 public nextReservationId = 1;
    address public registry;
    address public obligationManager;
    address public immutable owner;

    event ChildAllocated(uint256 indexed grantId, uint256 amount);
    event Reserved(uint256 indexed reservationId, uint256 indexed grantId, bytes32 indexed intentHash, uint256 amount);
    event ReservationExpired(uint256 indexed reservationId);
    event ReservationCancelled(uint256 indexed reservationId);
    event Spent(uint256 indexed reservationId, uint256 amount);
    event ChildCapacityReclaimed(uint256 indexed childId, uint256 indexed parentId, uint256 amount);
    event LiabilityCommitted(uint256 indexed reservationId, uint256 indexed grantId, uint256 amount);
    event LiabilityClosed(uint256 indexed grantId, uint256 amount, bool paid);

    constructor() {
        owner = msg.sender;
    }

    function configure(address registry_) external {
        if (msg.sender != owner || registry != address(0) || registry_ == address(0)) revert Unauthorized();
        registry = registry_;
    }

    function configureObligationManager(address manager_) external {
        if (msg.sender != owner || obligationManager != address(0) || manager_ == address(0)) revert Unauthorized();
        obligationManager = manager_;
    }

    function available(uint256 grantId) public view returns (uint256) {
        (,,,,,, uint256 ceiling,,,,,,) = IAuthorityReader(registry).getGrant(grantId);
        Balance storage b = balances[grantId];
        return ceiling - b.allocated - b.reserved - b.committed - b.spent;
    }

    function allocateChild(uint256 parentId, uint256 amount) external {
        if (msg.sender != registry) revert Unauthorized();
        if (amount == 0 || available(parentId) < amount) revert InsufficientCapacity();
        balances[parentId].allocated += amount;
        emit ChildAllocated(parentId, amount);
    }

    function reserve(uint256 grantId, bytes32 intentHash, uint256 amount, uint64 expiresAt)
        external
        returns (uint256 id)
    {
        return _reserve(grantId, intentHash, amount, expiresAt, false);
    }

    function reserveLiability(uint256 grantId, bytes32 termsDigest, uint256 amount, uint64 expiresAt)
        external
        returns (uint256 id)
    {
        return _reserve(grantId, termsDigest, amount, expiresAt, true);
    }

    function reserveLiabilityAt(
        uint256 grantId,
        uint256 expectedReservationId,
        bytes32 termsDigest,
        uint256 amount,
        uint64 expiresAt
    ) external returns (uint256 id) {
        if (expectedReservationId != nextReservationId) revert InvalidReservation();
        return _reserve(grantId, termsDigest, amount, expiresAt, true);
    }

    function _reserve(uint256 grantId, bytes32 intentHash, uint256 amount, uint64 expiresAt, bool liability)
        private
        returns (uint256 id)
    {
        if (!IAuthorityReader(registry).isActive(grantId)) revert InvalidReservation();
        (, address agent,,,,,, uint256 singleLimit,, uint64 grantExpiry,,,) =
            IAuthorityReader(registry).getGrant(grantId);
        if (msg.sender != agent) revert Unauthorized();
        if (intentHash == bytes32(0) || usedIntent[intentHash]) revert AlreadyUsed();
        if (amount == 0 || (!liability && amount > singleLimit) || available(grantId) < amount) {
            revert InsufficientCapacity();
        }
        if (expiresAt <= block.timestamp || expiresAt > grantExpiry) revert InvalidReservation();
        usedIntent[intentHash] = true;
        balances[grantId].reserved += amount;
        id = nextReservationId++;
        reservations[id] = Reservation(grantId, intentHash, amount, expiresAt, false, liability);
        emit Reserved(id, grantId, intentHash, amount);
    }

    function consumeSpend(uint256 id, bytes32 intentHash) external returns (uint256 amount) {
        Reservation storage r = reservations[id];
        (,, address grantAccount,,,,,,,,,,) = IAuthorityReader(registry).getGrant(r.grantId);
        if (msg.sender != grantAccount) revert Unauthorized();
        if (
            r.grantId == 0 || r.consumed || r.liability || r.expiresAt <= block.timestamp || r.intentHash != intentHash
                || !IAuthorityReader(registry).isActive(r.grantId)
        ) revert InvalidReservation();
        r.consumed = true;
        amount = r.amount;
        balances[r.grantId].reserved -= amount;
        balances[r.grantId].spent += amount;
        emit Spent(id, amount);
    }

    function commitLiability(uint256 id, bytes32 termsDigest) external returns (uint256 grantId, uint256 amount) {
        if (msg.sender != obligationManager) revert Unauthorized();
        Reservation storage r = reservations[id];
        if (
            r.grantId == 0 || r.consumed || !r.liability || r.expiresAt <= block.timestamp
                || r.intentHash != termsDigest || !IAuthorityReader(registry).isActive(r.grantId)
        ) revert InvalidReservation();
        r.consumed = true;
        grantId = r.grantId;
        amount = r.amount;
        balances[grantId].reserved -= amount;
        balances[grantId].committed += amount;
        emit LiabilityCommitted(id, grantId, amount);
    }

    function closeLiability(uint256 grantId, uint256 amount, bool paid) external {
        if (msg.sender != obligationManager) revert Unauthorized();
        Balance storage b = balances[grantId];
        if (amount == 0 || amount > b.committed) revert InvalidReservation();
        b.committed -= amount;
        if (paid) b.spent += amount;
        emit LiabilityClosed(grantId, amount, paid);
    }

    function expireReservation(uint256 id) external {
        Reservation storage r = reservations[id];
        if (r.grantId == 0 || r.consumed) revert InvalidReservation();
        if (r.expiresAt > block.timestamp) revert NotExpired();
        r.consumed = true;
        balances[r.grantId].reserved -= r.amount;
        emit ReservationExpired(id);
    }

    function cancelReservation(uint256 id) external {
        Reservation storage r = reservations[id];
        if (r.grantId == 0 || r.consumed) revert InvalidReservation();
        (address principal,,,,,,,,,,,,) = IAuthorityReader(registry).getGrant(r.grantId);
        if (msg.sender != principal) revert Unauthorized();
        r.consumed = true;
        balances[r.grantId].reserved -= r.amount;
        emit ReservationCancelled(id);
    }

    function reclaimUnusedChild(uint256 childId) external returns (uint256 amount) {
        (address principal,,,,, uint256 parentId,,,, uint64 expiresAt,,, bool revoked) =
            IAuthorityReader(registry).getGrant(childId);
        if (msg.sender != principal) revert Unauthorized();
        if (parentId == 0 || (!revoked && expiresAt > block.timestamp)) revert InvalidReservation();
        uint256 free = available(childId);
        uint256 alreadyReclaimed = reclaimedChildCapacity[childId];
        if (free <= alreadyReclaimed) revert InsufficientCapacity();
        amount = free - alreadyReclaimed;
        reclaimedChildCapacity[childId] = free;
        balances[parentId].allocated -= amount;
        emit ChildCapacityReclaimed(childId, parentId, amount);
    }
}
