// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Full-funded, single-milestone ERC-20 escrow controlled only by ObligationManager.
contract SettlementVault {
    error Unauthorized();
    error TransferFailed();
    error AlreadyFunded();
    error EmptyEscrow();

    struct Deposit {
        address token;
        uint256 amount;
    }
    mapping(uint256 => Deposit) public deposits;
    address public immutable manager;

    event Funded(uint256 indexed obligationId, address indexed token, uint256 amount);
    event Released(uint256 indexed obligationId, address indexed recipient, uint256 amount);

    constructor(address manager_) {
        if (manager_ == address(0)) revert Unauthorized();
        manager = manager_;
    }

    function fund(uint256 id, address token, address from, uint256 amount) external {
        if (msg.sender != manager) revert Unauthorized();
        if (deposits[id].amount != 0) revert AlreadyFunded();
        uint256 beforeBalance = _balance(token, address(this));
        (bool success, bytes memory response) =
            token.call(abi.encodeWithSelector(bytes4(0x23b872dd), from, address(this), amount));
        if (
            !success || (response.length != 0 && (response.length != 32 || !abi.decode(response, (bool))))
                || _balance(token, address(this)) - beforeBalance != amount
        ) revert TransferFailed();
        deposits[id] = Deposit(token, amount);
        emit Funded(id, token, amount);
    }

    function release(uint256 id, address recipient) external {
        if (msg.sender != manager) revert Unauthorized();
        Deposit memory d = deposits[id];
        if (d.amount == 0 || recipient == address(0)) revert EmptyEscrow();
        uint256 vaultBefore = _balance(d.token, address(this));
        uint256 recipientBefore = _balance(d.token, recipient);
        delete deposits[id];
        (bool success, bytes memory response) =
            d.token.call(abi.encodeWithSelector(bytes4(0xa9059cbb), recipient, d.amount));
        if (!success || (response.length != 0 && (response.length != 32 || !abi.decode(response, (bool))))) {
            revert TransferFailed();
        }
        uint256 vaultAfter = _balance(d.token, address(this));
        uint256 recipientAfter = _balance(d.token, recipient);
        if (
            vaultAfter > vaultBefore || vaultBefore - vaultAfter != d.amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != d.amount
        ) {
            revert TransferFailed();
        }
        emit Released(id, recipient, d.amount);
    }

    function _balance(address token, address holder) private view returns (uint256 balance) {
        (bool success, bytes memory response) = token.staticcall(abi.encodeWithSelector(bytes4(0x70a08231), holder));
        if (!success || response.length != 32) revert TransferFailed();
        balance = abi.decode(response, (uint256));
    }
}
