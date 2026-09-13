"""Verify operation-bound Coordinator grants; an internal key alone is not a user grant.

The Coordinator authenticates and resolves exact source correspondence before issuing
these short-lived envelopes. No HTTP identity/role headers or rule metadata grant access.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from .remediation import ConfirmationDecision, ConfirmationUnauthorized
from .remediation_history import HistoryReadGrant


def _identifier(value):
    return (type(value) is str and 0 < len(value) <= 512 and value == value.strip()
            and not any(ord(c) < 32 or ord(c) == 127 for c in value))


def _source(value):
    return (type(value) is dict and set(value) == {"model_version_id", "run_id", "source_sha256"}
            and _identifier(value["model_version_id"]) and _identifier(value["run_id"])
            and type(value["source_sha256"]) is str
            and re.fullmatch(r"[0-9a-f]{64}", value["source_sha256"]) is not None)


def _case(value, issue_id):
    return (type(value) is dict and set(value) == {"issue_id", "tenant_id", "project_id", "ifc_guid",
            "rule_code", "original", "revised", "correspondence_ref"}
            and value["issue_id"] == issue_id
            and all(_identifier(value[k]) for k in ("issue_id", "tenant_id", "project_id", "ifc_guid",
                                                   "rule_code", "correspondence_ref"))
            and _source(value["original"]) and _source(value["revised"])
            and value["original"]["run_id"] != value["revised"]["run_id"]
            and value["original"]["model_version_id"] != value["revised"]["model_version_id"])


class RequestAuthority:
    def __init__(self, claims):
        self.claims = claims

    def _fresh(self):
        if self.claims["expires_at_ms"] <= time.time() * 1000:
            raise ConfirmationUnauthorized("expired remediation grant")

    @property
    def expires_at(self):
        return datetime.fromtimestamp(self.claims["expires_at_ms"] / 1000, timezone.utc).isoformat()

    def __call__(self, context):
        self._fresh()
        matches = [case for case in self.claims["cases"] if (
            case["issue_id"] == context.issue_id and case["project_id"] == context.project_id
            and case["tenant_id"] == context.tenant_id
            and case["original"]["source_sha256"] == context.original_source_sha256
            and case["revised"]["source_sha256"] == context.revised_source_sha256
            and case["original"]["model_version_id"] == context.original_model_version_id
            and case["original"]["run_id"] == context.original_run_id
            and case["revised"]["model_version_id"] == context.revised_model_version_id
            and case["revised"]["run_id"] == context.revised_run_id
            and case["ifc_guid"] == context.ifc_guid and case["rule_code"] == context.rule_code)]
        if self.claims["operation"] != "confirm" or len(matches) != 1:
            raise ConfirmationUnauthorized("source correspondence not authorized")
        case = matches[0]
        return ConfirmationDecision(context, self.claims["principal_ref"], self.claims["authorization_ref"],
                                    case["correspondence_ref"], self.expires_at,
                                    self.claims["actor_kind"], case)

    def history(self, issue_id):
        self._fresh()
        if self.claims["operation"] != "history" or self.claims["issue_id"] != issue_id:
            raise ConfirmationUnauthorized("history not authorized")
        versions = frozenset(case[side]["model_version_id"] for case in self.claims["cases"]
                             for side in ("original", "revised"))
        return HistoryReadGrant(issue_id, versions, self.expires_at, tuple(self.claims["cases"]))

    def reopen(self, issue, original_run_id, rule_code, binding):
        self._fresh()
        if self.claims["operation"] != "reopen" or not any(
            case["issue_id"] == issue["id"] and case["ifc_guid"] == issue["ifc_guid"]
            and case["tenant_id"] == binding["tenant_id"] and case["project_id"] == binding["project_id"]
            and case["original"] == binding["source"]
            and case["original"]["model_version_id"] == issue["model_version_id"]
            and case["original"]["run_id"] == original_run_id and case["rule_code"] == rule_code
            for case in self.claims["cases"]
        ):
            raise ConfirmationUnauthorized("reopen not authorized")
        return {"principal_ref": self.claims["principal_ref"], "actor_kind": self.claims["actor_kind"],
                "authorization_ref": self.claims["authorization_ref"]}


async def request_authority(request: Request, operation: str):
    key = os.environ.get("A1_REMEDIATION_INTERNAL_KEY", "")
    if len(key.encode()) < 32:
        return None
    try:
        headers = request.headers.getlist("x-a1-remediation-grant")
        if len(headers) != 1 or len(headers[0]) > 16384:
            raise ValueError()
        encoded, signature = headers[0].split(".")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", encoded) or not re.fullmatch(r"[0-9a-f]{64}", signature):
            raise ValueError()
        expected = hmac.new(key.encode(), encoded.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        keys = {"version", "operation", "issue_id", "body_sha256", "expires_at_ms", "principal_ref",
                "actor_kind", "authorization_ref", "cases"}
        if type(claims) is not dict or set(claims) != keys or type(claims["version"]) is not int or claims["version"] != 1:
            raise ValueError()
        now = time.time() * 1000
        if (claims["operation"] != operation or claims["issue_id"] != request.path_params["issue_id"]
                or type(claims["expires_at_ms"]) is not int or not now < claims["expires_at_ms"] <= now + 30_000
                or not _identifier(claims["principal_ref"]) or not _identifier(claims["authorization_ref"])
                or claims["actor_kind"] not in ("external_authority", "local_validation")
                or type(claims["cases"]) is not list or not 1 <= len(claims["cases"]) <= 32
                or not all(_case(case, claims["issue_id"]) for case in claims["cases"])
                or claims["body_sha256"] != hashlib.sha256(await request.body()).hexdigest()):
            raise ValueError()
        if claims["actor_kind"] == "local_validation" and (os.environ.get("A1_REMEDIATION_LOCAL_VALIDATION") != "true"
                or os.environ.get("NODE_ENV") == "production" or os.environ.get("ENVIRONMENT") == "production"):
            raise ValueError()
        return RequestAuthority(claims)
    except (ValueError, TypeError, KeyError, UnicodeError):
        code = "remediation_history_denied" if operation == "history" else "remediation_authorization_denied"
        raise HTTPException(403, detail={"code": code}) from None
