// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

/// @notice The same vectors are asserted in packages/crypto/test/crypto.test.ts. Solidity's native
///         abi.encode and keccak256 must agree byte for byte with the TypeScript implementation.
contract CommitmentVectorsTest is Test {
    address constant REGISTRY = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
    bytes32 constant K1 = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 constant K2 = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 constant SALT = 0x3333333333333333333333333333333333333333333333333333333333333333;
    bytes32 constant PAYLOAD = 0x4444444444444444444444444444444444444444444444444444444444444444;
    bytes32 constant CRITERION = 0x5555555555555555555555555555555555555555555555555555555555555555;

    function test_observationCommitmentVector() public pure {
        bytes32 c = keccak256(
            abi.encode(keccak256("BLINDCOUNT_OBSERVATION_V1"), uint256(84532), REGISTRY, K1, K2, uint32(1), PAYLOAD, SALT)
        );
        assertEq(c, 0x50e7e327ab29d29ab3095754f2f30578fc9889d30533193792be72dabb7113b1);
    }

    function test_targetCommitmentVector() public pure {
        bytes32 c = keccak256(abi.encode(keccak256("BLINDCOUNT_TARGET_V1"), uint256(84532), REGISTRY, K1, CRITERION, SALT));
        assertEq(c, 0xc01b8e69bda55b4882c03ae2929df0cdae665ffca83ccc747018a16594ee2c13);
    }
}
