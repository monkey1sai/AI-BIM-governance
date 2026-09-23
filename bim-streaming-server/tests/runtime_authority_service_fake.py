"""The coordinator's internal runtime-authority routes, answered in memory behind the RuntimeAuthorityClient transport seam.

Manager tests put a real MutationGate over a real RuntimeAuthorityClient whose transport is this fake, so the decision
parsing, the local denials and the stage-load rollback run exactly as in Kit (docs/architecture/mutation-gate-adr.md).
"""

import json

SESSION_ID = "review_session_x"
TRACE_ID = "rev_review_session_x"

VERIFY = "datachannel-trace-verifications"
AUTHORIZE = "runtime-command-authorizations"
CONFIRM = "stage-binding-confirmations"
ROLLBACK = "stage-binding-authorization-rollbacks"

# Denials the tests configure, as the coordinator words them.
LEASE_RELEASED = {"reason": "lease_invalid", "retryable": False, "detail_code": "lease_released"}
UNREACHABLE = "unreachable"


class FakeAuthorityService:
    """`authorize` and `confirm` are True (allow), a denial dict (`reason`, `retryable`, `detail_code`) or UNREACHABLE
    (the route answers 503). `verify` is True (verify the fixture session's trace only) or UNREACHABLE. `data` is merged
    into every authorization the service grants."""

    def __init__(self, *, authorize=True, confirm=True, verify=True, data=None):
        self.authorize = authorize
        self.confirm = confirm
        self.verify = verify
        self.data = dict(data or {})
        self.requests = []

    def __call__(self, url, headers, body, timeout):
        route = url.rsplit("/", 1)[-1]
        session_id = url.rsplit("/", 2)[-2]
        payload = json.loads(body.decode("utf-8"))
        self.requests.append((route, payload))
        if route == VERIFY:
            if self.verify == UNREACHABLE:
                return 503, {}, b"{}"
            reply = {
                "verified": session_id == SESSION_ID and payload.get("trace_id") == TRACE_ID,
                "session_id": session_id,
                "trace_id": payload.get("trace_id"),
            }
        elif route == AUTHORIZE:
            reply = self._answer(self.authorize, payload, {"authorized": True, "retryable": False, **self.data}, "authorized")
        elif route == CONFIRM:
            success = payload.get("outcome") == "success"
            granted = {
                "confirmed": True,
                "binding_revision_id": payload.get("binding_revision_id"),
                "transaction_status": "active" if success else "failed",
                "idempotent_replay": False,
            }
            if success:
                granted["active_binding_revision"] = payload.get("binding_revision_id")
            reply = self._answer(self.confirm, payload, granted, "confirmed")
        elif route == ROLLBACK:
            reply = {"rolled_back": True}
        else:  # pragma: no cover - a route the client does not call
            raise AssertionError(f"unexpected authority route {route}")
        if reply is None:
            return 503, {}, b"{}"
        trace_id = headers.get("X-Trace-Id")
        return 200, ({"X-Trace-Id": trace_id} if trace_id else {}), json.dumps(reply).encode("utf-8")

    @staticmethod
    def _answer(setting, payload, granted, flag):
        if setting == UNREACHABLE:
            return None
        echo = {"request_id": payload.get("request_id"), "trace_id": payload.get("trace_id")}
        if setting is True:
            return {**granted, **echo}
        return {flag: False, **setting, **echo}

    def bodies(self, route):
        """The request bodies the client sent to one route, in order."""
        return [body for sent_route, body in self.requests if sent_route == route]

    @property
    def authorized_events(self):
        """The event types the client asked the authority to authorize, in order."""
        return [body["requested_event_type"] for body in self.bodies(AUTHORIZE)]

    @property
    def confirmed_outcomes(self):
        """The stage outcomes the client asked the authority to confirm, in order."""
        return [body["outcome"] for body in self.bodies(CONFIRM)]
