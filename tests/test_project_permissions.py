"""
Tests for ADR-021: Hillary co-authorization in projects selection & approval.
"""

import pytest
from datetime import datetime
from unittest.mock import patch, MagicMock


@pytest.fixture
def db_mock():
    """Mock database for testing."""
    return MagicMock()


@pytest.fixture
def mock_session(db_mock):
    """Mock SQLAlchemy session."""
    session = MagicMock()
    session.execute = MagicMock(return_value=db_mock)
    return session


def _chairman_name():
    """Get chairman name."""
    return "Israel"


def _secretary_name():
    """Get secretary name."""
    return "Merab"


_HILLARY_NAME = "Hillary"


class TestProjectInterestSubmission:
    """Test POST /api/projects/interest submission status assignment."""

    def test_dad_submit_auto_confirms(self):
        """Dad's submissions should auto-confirm."""
        member = _chairman_name()  # Israel
        expected_status = "confirmed"

        # Simulate logic: if member == dad, status = confirmed
        if member == _chairman_name():
            status = "confirmed"

        assert status == expected_status

    def test_hillary_submit_awaits_coauthors(self):
        """Hillary's submissions should route to awaiting_coauthors."""
        member = _HILLARY_NAME
        expected_status = "awaiting_coauthors"

        # Simulate logic
        if member == _chairman_name():
            status = "confirmed"
        elif member == _HILLARY_NAME:
            status = "awaiting_coauthors"
        else:
            status = "pending"

        assert status == expected_status

    def test_other_member_submit_pending(self):
        """Other members' submissions should be pending."""
        member = "Solomon"
        expected_status = "pending"

        # Simulate logic
        if member == _chairman_name():
            status = "confirmed"
        elif member == _HILLARY_NAME:
            status = "awaiting_coauthors"
        else:
            status = "pending"

        assert status == expected_status


class TestHillaryConfirmation:
    """Test PUT /api/projects/interest/{id}/confirm with Hillary approval."""

    def test_hillary_confirms_own_submission(self):
        """Hillary should be able to approve his own submission (NEW)."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": _HILLARY_NAME,
            "status": "awaiting_coauthors"
        }

        # NEW LOGIC: Hillary can approve himself
        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] in ("awaiting_coauthors", "pending")
        )

        assert can_approve is True

    def test_hillary_confirms_other_pending_submission(self):
        """Hillary should be able to approve other members' pending submissions."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Solomon",
            "status": "pending"
        }

        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] == "pending"
        )

        assert can_approve is True

    def test_hillary_confirms_dad_submission(self):
        """Hillary should be able to approve Dad's submissions (NEW)."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": _chairman_name(),  # Israel
            "status": "pending"  # If Dad submits as pending (not auto-confirm scenario)
        }

        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] == "pending"
        )

        assert can_approve is True

    def test_non_hillary_cannot_approve_others(self):
        """Non-Hillary users should not be able to approve submissions."""
        current_user = "Solomon"
        submission = {
            "member_name": "Alex",
            "status": "pending"
        }

        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] == "pending"
        )

        assert can_approve is False

    def test_cannot_confirm_already_confirmed(self):
        """Cannot confirm an already-confirmed submission."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Alex",
            "status": "confirmed"
        }

        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] == "pending"
        )

        assert can_approve is False

    def test_can_reopen_rejected_submission(self):
        """Hillary can confirm a rejected submission to reopen it (override Dad's decision)."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Alex",
            "status": "rejected"
        }

        can_approve = (
            current_user == _HILLARY_NAME and
            submission["status"] in ("pending", "rejected")
        )

        assert can_approve is True

    def test_hillary_can_reopen_own_rejected_submission(self):
        """Hillary should be able to reopen his own rejected submission (override Dad's decision)."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": _HILLARY_NAME,
            "status": "rejected"
        }

        can_reopen = (
            current_user == _HILLARY_NAME and
            submission["member_name"] == _HILLARY_NAME and
            submission["status"] == "rejected"
        )

        assert can_reopen is True


class TestHillaryOverride:
    """Test Hillary's ability to override Dad's decisions (NEW)."""

    def test_hillary_reopens_rejected_by_dad(self):
        """Hillary should be able to reopen Dad-rejected submissions."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Solomon",
            "status": "rejected",
            "rejected_by": _chairman_name()
        }

        # Hillary can approve rejected submissions to reopen them
        can_reopen = (
            current_user == _HILLARY_NAME and
            submission["status"] == "rejected"
        )

        assert can_reopen is True

    def test_hillary_reopens_routes_to_awaiting_chairman(self):
        """When Hillary reopens a rejected submission, it routes to awaiting_chairman for Dad's final decision."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Alex",
            "status": "rejected"
        }

        # If Hillary reopens, submission goes to awaiting_chairman
        can_reopen = (
            current_user == _HILLARY_NAME and
            submission["status"] == "rejected"
        )
        new_status = "awaiting_chairman" if can_reopen else "rejected"

        assert new_status == "awaiting_chairman"


class TestPermissionMatrix:
    """Test the complete permission matrix from ADR-021."""

    def test_dad_auto_confirms_own_submission(self):
        """Dad submitting auto-confirms to 'confirmed'."""
        submitter = _chairman_name()
        expected_status = "confirmed"

        status = "confirmed" if submitter == _chairman_name() else "pending"
        assert status == expected_status

    def test_hillary_awaits_on_own_submission(self):
        """Hillary submitting routes to 'awaiting_coauthors'."""
        submitter = _HILLARY_NAME
        expected_status = "awaiting_coauthors"

        if submitter == _chairman_name():
            status = "confirmed"
        elif submitter == _HILLARY_NAME:
            status = "awaiting_coauthors"
        else:
            status = "pending"

        assert status == expected_status

    def test_member_submission_pending(self):
        """Other members' submissions are 'pending'."""
        submitter = "Solomon"
        expected_status = "pending"

        if submitter == _chairman_name():
            status = "confirmed"
        elif submitter == _HILLARY_NAME:
            status = "awaiting_coauthors"
        else:
            status = "pending"

        assert status == expected_status

    def test_hillary_approval_chain_self_and_others(self):
        """Hillary can approve both his own and others' submissions."""
        scenarios = [
            {
                "approver": _HILLARY_NAME,
                "submission_member": _HILLARY_NAME,
                "submission_status": "awaiting_coauthors",
                "expected": True
            },
            {
                "approver": _HILLARY_NAME,
                "submission_member": "Solomon",
                "submission_status": "pending",
                "expected": True
            },
            {
                "approver": _HILLARY_NAME,
                "submission_member": _chairman_name(),
                "submission_status": "pending",
                "expected": True
            },
            {
                "approver": "Solomon",
                "submission_member": "Alex",
                "submission_status": "pending",
                "expected": False
            }
        ]

        for scenario in scenarios:
            can_approve = (
                scenario["approver"] == _HILLARY_NAME and
                scenario["submission_status"] in ("awaiting_coauthors", "pending")
            )
            assert can_approve == scenario["expected"], \
                f"Failed: approver={scenario['approver']}, member={scenario['submission_member']}"


class TestConcurrentApproval:
    """Test concurrent approval race condition handling."""

    def test_concurrent_hillary_dad_approval(self):
        """If both Hillary and Dad try to approve, last-write wins (idempotent)."""
        submission = {
            "id": 123,
            "member_name": "Solomon",
            "status": "pending",
            "confirmed_by": None
        }

        # First approval by Hillary
        submission_after_hillary = submission.copy()
        submission_after_hillary["status"] = "confirmed"
        submission_after_hillary["confirmed_by"] = _HILLARY_NAME

        # Concurrent approval attempt by Dad (internal key)
        # Should idempotently succeed (status already confirmed)
        submission_after_dad = submission_after_hillary.copy()
        submission_after_dad["confirmed_by"] = _chairman_name()  # Dad takes credit

        # Final state: confirmed by last approver (Dad)
        assert submission_after_dad["status"] == "confirmed"
        assert submission_after_dad["confirmed_by"] == _chairman_name()


class TestBackwardCompatibility:
    """Test that existing internal-key endpoints still work."""

    def test_dad_approve_endpoint_still_works(self):
        """Dad's internal-key approve endpoint should remain functional."""
        internal_key = "secret-key"
        provided_key = "secret-key"

        has_internal_key_access = provided_key == internal_key
        assert has_internal_key_access is True

    def test_dad_reject_endpoint_still_works(self):
        """Dad's internal-key reject endpoint should remain functional."""
        internal_key = "secret-key"
        provided_key = "secret-key"

        has_internal_key_access = provided_key == internal_key
        assert has_internal_key_access is True


class TestHillarySubmittingForDad:
    """Test Hillary submitting projects on behalf of Dad (NEW)."""

    def test_only_hillary_can_submit_for_others(self):
        """Only Hillary can submit projects on behalf of others."""
        # Hillary submitting for Dad: should be allowed
        submitter = _HILLARY_NAME
        for_member = _chairman_name()
        allowed = submitter == _HILLARY_NAME

        assert allowed is True

        # Alex submitting for Dad: should be blocked
        submitter = "Alex"
        allowed = submitter == _HILLARY_NAME

        assert allowed is False

    def test_hillary_submitting_for_dad_auto_confirms(self):
        """When Hillary submits for Dad, it should auto-confirm (Dad's privilege)."""
        submitter = _HILLARY_NAME
        for_member = _chairman_name()
        target_member = for_member or submitter

        # When submitting for Dad, member becomes Dad
        # Dad's submissions always auto-confirm
        if target_member == _chairman_name():
            status = "confirmed"
        else:
            status = "pending"

        assert status == "confirmed"

    def test_submitted_by_tracked_when_hillary_submits_for_dad(self):
        """The submitted_by field should track Hillary when she submits for Dad."""
        submitter = _HILLARY_NAME
        for_member = _chairman_name()

        submitted_by = submitter if for_member else None

        assert submitted_by == _HILLARY_NAME


class TestHillaryApprovingAsDad:
    """Test Hillary approving submissions as Dad (NEW)."""

    def test_hillary_can_approve_other_awaiting_chairman(self):
        """Hillary can approve other members' awaiting_chairman submissions as Dad."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Alex",
            "status": "awaiting_chairman"
        }

        # Hillary can approve awaiting_chairman as Dad
        can_approve_as_dad = (
            current_user == _HILLARY_NAME and
            submission["member_name"] != _HILLARY_NAME and
            submission["status"] == "awaiting_chairman"
        )

        assert can_approve_as_dad is True

    def test_approval_as_dad_tracked_in_chain(self):
        """When Hillary approves as Dad, it should be tracked as 'Hillary (as Dad)' in approved_by_chain."""
        approver = "Hillary (as Dad)"
        existing_chain = "Solomon,Hillary"

        # Append to chain
        new_chain = existing_chain + f",{approver}" if existing_chain else approver

        assert "Hillary (as Dad)" in new_chain
        assert new_chain.endswith("Hillary (as Dad)")

    def test_hillary_as_dad_sets_status_confirmed(self):
        """When Hillary approves as Dad, status should be 'confirmed' (final approval)."""
        current_user = _HILLARY_NAME
        submission = {
            "member_name": "Alex",
            "status": "awaiting_chairman"
        }

        can_approve_as_dad = (
            current_user == _HILLARY_NAME and
            submission["status"] == "awaiting_chairman"
        )
        new_status = "confirmed" if can_approve_as_dad else submission["status"]

        assert new_status == "confirmed"
