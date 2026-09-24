"""Mutation Gate (docs/architecture/mutation-gate-adr.md).

Every DataChannel command that may change the stage is admitted here before its payload is acted on: the local denials
the authority client decides (vocabulary membership, harness-only, the envelope fields it needs), the DataChannel trace
verification, the Runtime Mutation Authority decision and the stage-load rollback on an unanswered authorization. Stage
confirmation after Kit reports a stage result goes through here too. The gate owns the authority transport and returns
an admitted command or the exact `commandRejected` payload to answer with (`runtime_state` "unchanged": nothing ran);
managers dispatch it as it is. It does not dispatch events, hold stage state, interpret measurement policy or bind the
trace context.
"""

from dataclasses import dataclass
from typing import Callable, Optional

import carb

try:
    from .runtime_authority import AuthorityDecision, RuntimeAuthorityClient, command_rejected_payload
except ImportError:  # pragma: no cover - test modules import this file directly.
    from runtime_authority import AuthorityDecision, RuntimeAuthorityClient, command_rejected_payload


@dataclass(frozen=True)
class Admitted:
    """A command the authority admitted: its verified trace id and the authorization decision (with the authority's data)."""

    trace_id: str
    decision: AuthorityDecision


@dataclass(frozen=True)
class Refused:
    """A command that must not run. `rejection` is the `commandRejected` payload to answer with, or None to drop the
    command silently: a trace the authority refused is not answered, because answering would confirm to an unverified
    sender that the session exists (only "the authority could not be asked" is answered, retryably)."""

    decision: AuthorityDecision
    rejection: Optional[dict]


# A local refusal the caller decides between trace verification and authorization (stage load's in-progress guard), so
# an authorization is never requested for a command the runtime would refuse anyway.
Precondition = Callable[[], Optional[AuthorityDecision]]


class MutationGate:
    def __init__(self, authority: RuntimeAuthorityClient):
        self._authority = authority

    def admit(self, event_type: str, payload, *, precondition: Optional[Precondition] = None) -> "Admitted | Refused":
        """Verify the DataChannel trace, run the caller's precondition, then ask the authority to authorize."""
        verified = self._verify(event_type, payload)
        if isinstance(verified, Refused):
            return verified
        if precondition is not None:
            local = precondition()
            if local is not None:
                return Refused(local, command_rejected_payload(event_type, payload, local))
        decision = self._authority.authorize(event_type, payload)
        if decision.authorized:
            return Admitted(trace_id=verified, decision=decision)
        return Refused(decision, command_rejected_payload(event_type, payload, decision))

    def reauthorize(self, event_type: str, payload) -> "Admitted | Refused":
        """Ask the authority again for a command `admit` already let in, without a second trace verification or the
        precondition: measurement re-grants its policy while it serves one request."""
        decision = self._authority.authorize(event_type, payload)
        if decision.authorized:
            return Admitted(trace_id=decision.trace_id, decision=decision)
        return Refused(decision, command_rejected_payload(event_type, payload, decision))

    def verify_readonly(self, event_type: str, payload) -> "str | Refused":
        """The verified trace id of a read-only command, or the refusal."""
        return self._verify(event_type, payload)

    def confirm_stage(self, payload, outcome: str) -> AuthorityDecision:
        """Confirm a stage result with the authority (`outcome`: "success" or "failed")."""
        return self._authority.confirm_stage(payload, outcome)

    def _verify(self, event_type: str, payload) -> "str | Refused":
        try:
            decision = self._authority.verify_datachannel_trace_decision(event_type, payload)
        except Exception:
            decision = None
        if decision is not None and decision.authorized and decision.trace_id:
            carb.log_info(f"[runtime-authority] datachannel trace accepted for {event_type}")
            return decision.trace_id
        # A rejected trace used to drop the command with no record at all, which makes "Kit never received it" and
        # "Kit received it and refused it" indistinguishable from the outside. Record the outcome - never the trace
        # value, it is a carrier.
        carb.log_warn(f"[runtime-authority] datachannel trace rejected for {event_type}")
        # When the authority could not be reached at all, answer instead of dropping. A viewer that gets nothing back
        # waits forever, which is exactly what a coordinator outage produced. The command is still never executed - it
        # is refused, retryably, so the caller knows this was "could not check", not "checked and denied".
        if decision is not None and decision.detail_code == "authority_unavailable":
            return Refused(decision, command_rejected_payload(event_type, payload, decision))
        return Refused(decision or AuthorityDecision(False, reason="lease_invalid", detail_code="datachannel_trace_unverified"), None)
