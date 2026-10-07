// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SettlementVault} from "../src/SettlementVault.sol";

contract DishonestReleaseToken {
    mapping(address => uint256) public balanceOf;

    function transferFrom(address, address to, uint256 amount) external returns (bool) {
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

contract VaultSafetyTest {
    function testUnpaidReleaseRevertsAndPreservesDeposit() public {
        SettlementVault vault = new SettlementVault(address(this));
        DishonestReleaseToken token = new DishonestReleaseToken();
        vault.fund(1, address(token), address(this), 100);
        (bool success,) = address(vault).call(abi.encodeCall(vault.release, (1, address(0xBEEF))));
        require(!success, "unpaid release succeeded");
        (, uint256 amount) = vault.deposits(1);
        require(amount == 100, "failed payment destroyed escrow");
        require(token.balanceOf(address(vault)) == 100, "escrow balance changed");
    }
}
