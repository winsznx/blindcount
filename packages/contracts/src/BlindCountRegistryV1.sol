// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title BlindCountRegistryV1
/// @notice Non-upgradeable registry of salted cohort/assignment commitments. Stores no criterion,
///         count, salt or personal data: only opaque bytes32 keys and commitments.
contract BlindCountRegistryV1 is AccessControlDefaultAdminRules, Pausable, EIP712 {
    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");
    bytes32 public constant CLOSER_ROLE = keccak256("CLOSER_ROLE");
    bytes32 public constant VOID_ROLE = keccak256("VOID_ROLE");
    bytes32 public constant VOID_APPROVER_ROLE = keccak256("VOID_APPROVER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant VOID_APPROVAL_TYPEHASH =
        keccak256("VoidApproval(bytes32 cohortKey,bytes32 assignmentKey,bytes32 reasonDigest,uint256 nonce)");

    enum CohortState { NONE, CREATED, FROZEN, CLOSED }
    enum AssignmentState { NONE, REGISTERED, ANCHORED, VOIDED }

    struct Cohort {
        CohortState state;
        uint32 expected;
        uint32 registered;
        uint32 terminal;
        uint64 closingAfter;
        bool disclosed;
        bytes32 targetCommitment;
    }

    struct Assignment {
        AssignmentState state;
        uint32 latestVersion;
    }

    mapping(bytes32 => Cohort) private _cohorts;
    mapping(bytes32 => mapping(bytes32 => Assignment)) private _assignments;
    mapping(bytes32 => mapping(bytes32 => mapping(uint32 => bytes32))) private _commitments;
    mapping(address => uint256) public voidApprovalNonces;

    event CohortCreated(bytes32 indexed cohortKey, bytes32 targetCommitment, uint32 assignmentCount);
    event AssignmentRegistered(bytes32 indexed cohortKey, bytes32 indexed assignmentKey);
    event RosterFrozen(bytes32 indexed cohortKey, uint32 assignmentCount);
    event ObservationAnchored(bytes32 indexed cohortKey, bytes32 indexed assignmentKey, uint32 version, bytes32 commitment);
    event AssignmentVoided(bytes32 indexed cohortKey, bytes32 indexed assignmentKey, bytes32 reasonDigest);
    event CohortClosed(bytes32 indexed cohortKey, uint64 closedAt);
    event CriterionDisclosureRecorded(bytes32 indexed cohortKey, bytes32 disclosureReceiptHash);

    error ZeroValue();
    error CohortExists();
    error UnknownCohort();
    error InvalidCohortState(CohortState actual);
    error AssignmentExists();
    error UnknownAssignment();
    error InvalidAssignmentState(AssignmentState actual);
    error RosterIncomplete(uint32 registered, uint32 expected);
    error RosterFull();
    error NonContiguousVersion(uint32 expected, uint32 provided);
    error NotAllTerminal(uint32 terminal, uint32 expected);
    error ClosingTooEarly(uint64 closingAfter);
    error AlreadyDisclosed();
    error InvalidApprover();

    constructor(address admin) AccessControlDefaultAdminRules(1 days, admin) EIP712("BlindCountRegistryV1", "1") {}

    function createCohort(bytes32 cohortKey, bytes32 targetCommitment, uint32 expectedAssignments, uint64 closingAfter)
        external
        onlyRole(PUBLISHER_ROLE)
        whenNotPaused
    {
        if (cohortKey == bytes32(0) || targetCommitment == bytes32(0) || expectedAssignments == 0) revert ZeroValue();
        Cohort storage c = _cohorts[cohortKey];
        if (c.state != CohortState.NONE) revert CohortExists();
        c.state = CohortState.CREATED;
        c.expected = expectedAssignments;
        c.closingAfter = closingAfter;
        c.targetCommitment = targetCommitment;
        emit CohortCreated(cohortKey, targetCommitment, expectedAssignments);
    }

    function registerAssignment(bytes32 cohortKey, bytes32 assignmentKey) external onlyRole(PUBLISHER_ROLE) whenNotPaused {
        _registerAssignment(cohortKey, assignmentKey);
    }

    function registerAssignments(bytes32 cohortKey, bytes32[] calldata assignmentKeys)
        external
        onlyRole(PUBLISHER_ROLE)
        whenNotPaused
    {
        for (uint256 i = 0; i < assignmentKeys.length; ++i) {
            _registerAssignment(cohortKey, assignmentKeys[i]);
        }
    }

    function freezeRoster(bytes32 cohortKey) external onlyRole(PUBLISHER_ROLE) whenNotPaused {
        Cohort storage c = _requireCohort(cohortKey, CohortState.CREATED);
        if (c.registered != c.expected) revert RosterIncomplete(c.registered, c.expected);
        c.state = CohortState.FROZEN;
        emit RosterFrozen(cohortKey, c.registered);
    }

    /// @notice Anchors the first observation (version 1) while the cohort collects, or a correction
    ///         (version 2+) at any time after the first. A correction never changes the original
    ///         commitment, the terminal count or a closed cohort's status: it is appended history.
    function anchorObservation(bytes32 cohortKey, bytes32 assignmentKey, uint32 version, bytes32 commitment)
        external
        onlyRole(ANCHOR_ROLE)
        whenNotPaused
    {
        if (commitment == bytes32(0)) revert ZeroValue();
        Cohort storage c = _cohorts[cohortKey];
        if (c.state == CohortState.NONE) revert UnknownCohort();
        Assignment storage a = _assignments[cohortKey][assignmentKey];
        if (a.state == AssignmentState.NONE) revert UnknownAssignment();
        if (a.state == AssignmentState.VOIDED) revert InvalidAssignmentState(a.state);
        uint32 next = a.latestVersion + 1;
        if (version != next) revert NonContiguousVersion(next, version);
        if (version == 1) {
            // First observations only while collecting: nothing new may enter a closed cohort.
            if (c.state != CohortState.FROZEN) revert InvalidCohortState(c.state);
            a.state = AssignmentState.ANCHORED;
            c.terminal += 1;
        } else if (c.state != CohortState.FROZEN && c.state != CohortState.CLOSED) {
            revert InvalidCohortState(c.state);
        }
        a.latestVersion = version;
        _commitments[cohortKey][assignmentKey][version] = commitment;
        emit ObservationAnchored(cohortKey, assignmentKey, version, commitment);
    }

    /// @notice Voids an assignment with no first observation. A second, distinct address holding
    ///         VOID_APPROVER_ROLE must sign an EIP-712 approval bound to its current nonce.
    function voidAssignment(
        bytes32 cohortKey,
        bytes32 assignmentKey,
        bytes32 reasonDigest,
        address approver,
        bytes calldata secondApproverSignature
    ) external onlyRole(VOID_ROLE) whenNotPaused {
        if (reasonDigest == bytes32(0)) revert ZeroValue();
        Cohort storage c = _requireCohort(cohortKey, CohortState.FROZEN);
        Assignment storage a = _assignments[cohortKey][assignmentKey];
        if (a.state == AssignmentState.NONE) revert UnknownAssignment();
        if (a.state != AssignmentState.REGISTERED) revert InvalidAssignmentState(a.state);
        if (approver == msg.sender || !hasRole(VOID_APPROVER_ROLE, approver)) revert InvalidApprover();

        bytes32 digest = voidApprovalDigest(cohortKey, assignmentKey, reasonDigest, voidApprovalNonces[approver]);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, secondApproverSignature);
        if (err != ECDSA.RecoverError.NoError || signer != approver) revert InvalidApprover();
        voidApprovalNonces[approver] += 1;

        a.state = AssignmentState.VOIDED;
        c.terminal += 1;
        emit AssignmentVoided(cohortKey, assignmentKey, reasonDigest);
    }

    function closeCohort(bytes32 cohortKey) external onlyRole(CLOSER_ROLE) whenNotPaused {
        Cohort storage c = _requireCohort(cohortKey, CohortState.FROZEN);
        if (c.terminal != c.expected) revert NotAllTerminal(c.terminal, c.expected);
        if (c.closingAfter != 0 && block.timestamp < c.closingAfter) revert ClosingTooEarly(c.closingAfter);
        c.state = CohortState.CLOSED;
        emit CohortClosed(cohortKey, uint64(block.timestamp));
    }

    function recordDisclosure(bytes32 cohortKey, bytes32 disclosureReceiptHash) external onlyRole(CLOSER_ROLE) whenNotPaused {
        if (disclosureReceiptHash == bytes32(0)) revert ZeroValue();
        Cohort storage c = _requireCohort(cohortKey, CohortState.CLOSED);
        if (c.disclosed) revert AlreadyDisclosed();
        c.disclosed = true;
        emit CriterionDisclosureRecorded(cohortKey, disclosureReceiptHash);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function voidApprovalDigest(bytes32 cohortKey, bytes32 assignmentKey, bytes32 reasonDigest, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VOID_APPROVAL_TYPEHASH, cohortKey, assignmentKey, reasonDigest, nonce)));
    }

    function getCohortStatus(bytes32 cohortKey)
        external
        view
        returns (uint8 state, uint32 expected, uint32 registered, uint32 terminal, bytes32 targetCommitment)
    {
        Cohort storage c = _cohorts[cohortKey];
        return (uint8(c.state), c.expected, c.registered, c.terminal, c.targetCommitment);
    }

    function isDisclosed(bytes32 cohortKey) external view returns (bool) {
        return _cohorts[cohortKey].disclosed;
    }

    function getAssignmentStatus(bytes32 cohortKey, bytes32 assignmentKey) external view returns (uint8 state, uint32 latestVersion) {
        Assignment storage a = _assignments[cohortKey][assignmentKey];
        return (uint8(a.state), a.latestVersion);
    }

    function getObservationCommitment(bytes32 cohortKey, bytes32 assignmentKey, uint32 version) external view returns (bytes32) {
        return _commitments[cohortKey][assignmentKey][version];
    }

    function _registerAssignment(bytes32 cohortKey, bytes32 assignmentKey) private {
        if (assignmentKey == bytes32(0)) revert ZeroValue();
        Cohort storage c = _requireCohort(cohortKey, CohortState.CREATED);
        if (c.registered == c.expected) revert RosterFull();
        Assignment storage a = _assignments[cohortKey][assignmentKey];
        if (a.state != AssignmentState.NONE) revert AssignmentExists();
        a.state = AssignmentState.REGISTERED;
        c.registered += 1;
        emit AssignmentRegistered(cohortKey, assignmentKey);
    }

    function _requireCohort(bytes32 cohortKey, CohortState required) private view returns (Cohort storage c) {
        c = _cohorts[cohortKey];
        if (c.state == CohortState.NONE) revert UnknownCohort();
        if (c.state != required) revert InvalidCohortState(c.state);
    }
}
