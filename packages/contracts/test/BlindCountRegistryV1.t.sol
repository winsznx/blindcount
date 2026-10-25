// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BlindCountRegistryV1} from "../src/BlindCountRegistryV1.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract BlindCountRegistryV1Test is Test {
    BlindCountRegistryV1 registry;

    address admin = makeAddr("admin");
    address relayer = makeAddr("relayer");
    address outsider = makeAddr("outsider");
    uint256 approverPk = 0xA11CE;
    address approver;

    bytes32 constant COHORT = keccak256("cohort-1");
    bytes32 constant A1 = keccak256("assignment-1");
    bytes32 constant A2 = keccak256("assignment-2");
    bytes32 constant TARGET = keccak256("target-commitment");
    bytes32 constant REASON = keccak256("reason");

    function setUp() public {
        approver = vm.addr(approverPk);
        registry = new BlindCountRegistryV1(admin);
        vm.startPrank(admin);
        registry.grantRole(registry.PUBLISHER_ROLE(), relayer);
        registry.grantRole(registry.ANCHOR_ROLE(), relayer);
        registry.grantRole(registry.CLOSER_ROLE(), relayer);
        registry.grantRole(registry.VOID_ROLE(), relayer);
        registry.grantRole(registry.PAUSER_ROLE(), relayer);
        registry.grantRole(registry.VOID_APPROVER_ROLE(), approver);
        vm.stopPrank();
    }

    function _publish() internal {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 2, 0);
        registry.registerAssignment(COHORT, A1);
        registry.registerAssignment(COHORT, A2);
        registry.freezeRoster(COHORT);
        vm.stopPrank();
    }

    function _approval(bytes32 assignmentKey, uint256 nonce) internal view returns (bytes memory) {
        bytes32 digest = registry.voidApprovalDigest(COHORT, assignmentKey, REASON, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(approverPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // 1
    function test_createCohortWithZeroAssignmentsReverts() public {
        vm.prank(relayer);
        vm.expectRevert(BlindCountRegistryV1.ZeroValue.selector);
        registry.createCohort(COHORT, TARGET, 0, 0);
    }

    // 2
    function test_createSameCohortTwiceReverts() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 2, 0);
        vm.expectRevert(BlindCountRegistryV1.CohortExists.selector);
        registry.createCohort(COHORT, TARGET, 2, 0);
        vm.stopPrank();
    }

    function test_freezeRequiresFullRoster() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 2, 0);
        registry.registerAssignment(COHORT, A1);
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.RosterIncomplete.selector, 1, 2));
        registry.freezeRoster(COHORT);
        vm.stopPrank();
    }

    function test_duplicateAssignmentReverts() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 2, 0);
        registry.registerAssignment(COHORT, A1);
        vm.expectRevert(BlindCountRegistryV1.AssignmentExists.selector);
        registry.registerAssignment(COHORT, A1);
        vm.stopPrank();
    }

    // 3
    function test_addAssignmentAfterFreezeReverts() public {
        _publish();
        vm.prank(relayer);
        vm.expectRevert();
        registry.registerAssignment(COHORT, keccak256("late"));
    }

    // 4
    function test_anchorBeforeFreezeReverts() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 1, 0);
        registry.registerAssignment(COHORT, A1);
        vm.expectRevert();
        registry.anchorObservation(COHORT, A1, 1, keccak256("c"));
        vm.stopPrank();
    }

    function test_anchorUnknownAssignmentReverts() public {
        _publish();
        vm.prank(relayer);
        vm.expectRevert(BlindCountRegistryV1.UnknownAssignment.selector);
        registry.anchorObservation(COHORT, keccak256("unknown"), 1, keccak256("c"));
    }

    // 5 + 6
    function test_secondFirstVersionRevertsAndTerminalCountedOnce() public {
        _publish();
        vm.startPrank(relayer);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.NonContiguousVersion.selector, 2, 1));
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        registry.anchorObservation(COHORT, A1, 2, keccak256("amend"));
        vm.stopPrank();
        (, , , uint32 terminal,) = registry.getCohortStatus(COHORT);
        assertEq(terminal, 1);
        assertEq(registry.getObservationCommitment(COHORT, A1, 1), keccak256("c1"));
        assertEq(registry.getObservationCommitment(COHORT, A1, 2), keccak256("amend"));
    }

    function test_versionGapReverts() public {
        _publish();
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.NonContiguousVersion.selector, 1, 3));
        registry.anchorObservation(COHORT, A1, 3, keccak256("c"));
    }

    // 7
    function test_voidAnchoredAssignmentReverts() public {
        _publish();
        vm.startPrank(relayer);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        bytes memory sig = _approval(A1, 0);
        vm.expectRevert();
        registry.voidAssignment(COHORT, A1, REASON, approver, sig);
        vm.stopPrank();
    }

    function test_voidWithValidSecondApprover() public {
        _publish();
        bytes memory sig = _approval(A2, 0);
        vm.prank(relayer);
        registry.voidAssignment(COHORT, A2, REASON, approver, sig);
        (uint8 state,) = registry.getAssignmentStatus(COHORT, A2);
        assertEq(state, uint8(BlindCountRegistryV1.AssignmentState.VOIDED));
        assertEq(registry.voidApprovalNonces(approver), 1);
    }

    // 8
    function test_voidWithSelfApprovalReverts() public {
        _publish();
        bytes32 voidRole = registry.VOID_ROLE();
        vm.prank(admin);
        registry.grantRole(voidRole, approver);
        bytes memory sig = _approval(A2, 0);
        vm.prank(approver);
        vm.expectRevert(BlindCountRegistryV1.InvalidApprover.selector);
        registry.voidAssignment(COHORT, A2, REASON, approver, sig);
    }

    function test_voidWithStaleNonceReverts() public {
        _publish();
        bytes memory sig = _approval(A2, 0);
        vm.prank(relayer);
        registry.voidAssignment(COHORT, A2, REASON, approver, sig);

        // Replaying the nonce-0 signature for another assignment must fail.
        bytes memory stale = _approval(A1, 0);
        vm.prank(relayer);
        vm.expectRevert(BlindCountRegistryV1.InvalidApprover.selector);
        registry.voidAssignment(COHORT, A1, REASON, approver, stale);
    }

    function test_voidWithNonApproverSignerReverts() public {
        _publish();
        bytes32 digest = registry.voidApprovalDigest(COHORT, A2, REASON, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, digest);
        vm.prank(relayer);
        vm.expectRevert(BlindCountRegistryV1.InvalidApprover.selector);
        registry.voidAssignment(COHORT, A2, REASON, approver, abi.encodePacked(r, s, v));
    }

    // 9
    function test_closeWithNonTerminalReverts() public {
        _publish();
        vm.startPrank(relayer);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.NotAllTerminal.selector, 1, 2));
        registry.closeCohort(COHORT);
        vm.stopPrank();
    }

    // 10 + 11 + 12
    function test_closeOnceThenNoAnchorNoReopen() public {
        _publish();
        vm.startPrank(relayer);
        vm.expectRevert();
        registry.recordDisclosure(COHORT, keccak256("receipt"));

        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        registry.anchorObservation(COHORT, A2, 1, keccak256("c2"));
        registry.closeCohort(COHORT);

        vm.expectRevert();
        registry.closeCohort(COHORT);

        registry.recordDisclosure(COHORT, keccak256("receipt"));
        vm.expectRevert(BlindCountRegistryV1.AlreadyDisclosed.selector);
        registry.recordDisclosure(COHORT, keccak256("receipt"));
        vm.stopPrank();
        assertTrue(registry.isDisclosed(COHORT));
    }

    // P1 corrections: appended after closure without touching the original or the closed status.
    function test_correctionAfterCloseKeepsOriginalAndClosedStatus() public {
        _publish();
        vm.startPrank(relayer);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        registry.anchorObservation(COHORT, A2, 1, keccak256("c2"));
        registry.closeCohort(COHORT);
        registry.anchorObservation(COHORT, A1, 2, keccak256("correction"));
        vm.stopPrank();
        (uint8 state,,, uint32 terminal,) = registry.getCohortStatus(COHORT);
        assertEq(state, uint8(BlindCountRegistryV1.CohortState.CLOSED));
        assertEq(terminal, 2);
        assertEq(registry.getObservationCommitment(COHORT, A1, 1), keccak256("c1"));
        assertEq(registry.getObservationCommitment(COHORT, A1, 2), keccak256("correction"));
        (, uint32 latest) = registry.getAssignmentStatus(COHORT, A1);
        assertEq(latest, 2);
    }

    function test_noFirstObservationOrGapAfterClose() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 2, 0);
        registry.registerAssignment(COHORT, A1);
        registry.registerAssignment(COHORT, A2);
        registry.freezeRoster(COHORT);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        bytes32 approverDigest = registry.voidApprovalDigest(COHORT, A2, REASON, 0);
        vm.stopPrank();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(approverPk, approverDigest);
        vm.startPrank(relayer);
        registry.voidAssignment(COHORT, A2, REASON, approver, abi.encodePacked(r, s, v));
        registry.closeCohort(COHORT);
        // A voided assignment can never gain an observation, before or after close.
        vm.expectRevert();
        registry.anchorObservation(COHORT, A2, 1, keccak256("late"));
        // Corrections must stay contiguous after close too.
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.NonContiguousVersion.selector, 2, 3));
        registry.anchorObservation(COHORT, A1, 3, keccak256("gap"));
        vm.stopPrank();
    }

    function test_firstObservationRejectedAfterCloseOnUnanchoredCohortPath() public {
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, 1, 0);
        registry.registerAssignment(COHORT, A1);
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.InvalidCohortState.selector, BlindCountRegistryV1.CohortState.CREATED));
        registry.anchorObservation(COHORT, A1, 1, keccak256("early"));
        vm.stopPrank();
    }

    function test_closingAfterEnforced() public {
        vm.startPrank(relayer);
        uint64 closingAfter = uint64(block.timestamp + 1 days);
        registry.createCohort(COHORT, TARGET, 1, closingAfter);
        registry.registerAssignment(COHORT, A1);
        registry.freezeRoster(COHORT);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        vm.expectRevert(abi.encodeWithSelector(BlindCountRegistryV1.ClosingTooEarly.selector, closingAfter));
        registry.closeCohort(COHORT);
        vm.warp(closingAfter);
        registry.closeCohort(COHORT);
        vm.stopPrank();
    }

    // 13
    function test_unprivilegedCallsRevert() public {
        vm.startPrank(outsider);
        vm.expectRevert();
        registry.createCohort(COHORT, TARGET, 1, 0);
        vm.stopPrank();

        _publish();
        vm.startPrank(outsider);
        vm.expectRevert();
        registry.anchorObservation(COHORT, A1, 1, keccak256("c"));
        vm.expectRevert();
        registry.voidAssignment(COHORT, A1, REASON, approver, "");
        vm.expectRevert();
        registry.closeCohort(COHORT);
        vm.expectRevert();
        registry.recordDisclosure(COHORT, keccak256("r"));
        vm.expectRevert();
        registry.pause();
        vm.stopPrank();
    }

    // 14: EIP-712 approval is domain-bound to chain and contract address.
    function test_voidApprovalIsDomainBound() public {
        _publish();
        BlindCountRegistryV1 other = new BlindCountRegistryV1(admin);
        assertTrue(other.voidApprovalDigest(COHORT, A2, REASON, 0) != registry.voidApprovalDigest(COHORT, A2, REASON, 0));
        uint256 chainId = block.chainid;
        bytes32 before = registry.voidApprovalDigest(COHORT, A2, REASON, 0);
        vm.chainId(chainId + 1);
        assertTrue(registry.voidApprovalDigest(COHORT, A2, REASON, 0) != before);
    }

    // 16
    function test_pauseBlocksMutationsButNotReads() public {
        _publish();
        vm.startPrank(relayer);
        registry.anchorObservation(COHORT, A1, 1, keccak256("c1"));
        registry.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.anchorObservation(COHORT, A2, 1, keccak256("c2"));
        vm.stopPrank();
        assertEq(registry.getObservationCommitment(COHORT, A1, 1), keccak256("c1"));
        (uint8 state,,,,) = registry.getCohortStatus(COHORT);
        assertEq(state, uint8(BlindCountRegistryV1.CohortState.FROZEN));
    }

    function test_zeroCommitmentReverts() public {
        _publish();
        vm.prank(relayer);
        vm.expectRevert(BlindCountRegistryV1.ZeroValue.selector);
        registry.anchorObservation(COHORT, A1, 1, bytes32(0));
    }

    function testFuzz_terminalNeverExceedsExpected(uint8 anchors, uint8 amendments) public {
        uint32 n = uint32(bound(anchors, 1, 20));
        vm.startPrank(relayer);
        registry.createCohort(COHORT, TARGET, n, 0);
        for (uint32 i = 0; i < n; ++i) registry.registerAssignment(COHORT, bytes32(uint256(i + 1)));
        registry.freezeRoster(COHORT);
        for (uint32 i = 0; i < n; ++i) registry.anchorObservation(COHORT, bytes32(uint256(i + 1)), 1, keccak256(abi.encode(i)));
        uint32 m = uint32(bound(amendments, 0, 10));
        for (uint32 v = 2; v < m + 2; ++v) registry.anchorObservation(COHORT, bytes32(uint256(1)), v, keccak256(abi.encode(v)));
        vm.stopPrank();
        (, uint32 expected, uint32 registered, uint32 terminal,) = registry.getCohortStatus(COHORT);
        assertEq(expected, n);
        assertEq(registered, n);
        assertEq(terminal, n);
    }

    function test_noTargetDataInRoleOrEvents() public {
        vm.recordLogs();
        _publish();
        assertEq(vm.getRecordedLogs().length, 4);
        assertFalse(IAccessControl(address(registry)).hasRole(registry.PUBLISHER_ROLE(), outsider));
    }
}
