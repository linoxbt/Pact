"""Strict, dependency-free HTTP client for the Pact service API."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _open(request: Request, *, timeout: float):
    return build_opener(_NoRedirect).open(request, timeout=timeout)


def _decimal(value: int, name: str) -> str:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return str(value)


def _hex(value: str, length: int, name: str) -> str:
    if not isinstance(value, str) or len(value) != length + 2 or not value.startswith("0x"):
        raise ValueError(f"{name} must be {length // 2} hex bytes")
    try:
        bytes.fromhex(value[2:])
    except ValueError as exc:
        raise ValueError(f"{name} must be hex") from exc
    return value


@dataclass(frozen=True)
class TransferIntent:
    grant_id: int
    agent: str
    token: str
    to: str
    amount: int
    nonce: int
    deadline: int
    policy_hash: str

    def wire(self) -> dict[str, str]:
        return {
            "grantId": _decimal(self.grant_id, "grant_id"),
            "agent": _hex(self.agent, 40, "agent"),
            "token": _hex(self.token, 40, "token"),
            "to": _hex(self.to, 40, "to"),
            "amount": _decimal(self.amount, "amount"),
            "nonce": _decimal(self.nonce, "nonce"),
            "deadline": _decimal(self.deadline, "deadline"),
            "policyHash": _hex(self.policy_hash, 64, "policy_hash"),
        }


@dataclass(frozen=True)
class ObligationTerms:
    grant_id: int
    reservation_id: int
    provider: str
    verifier: str
    arbitrator: str
    token: str
    amount: int
    deliver_by: int
    verify_by: int
    challenge_period: int
    specification_hash: str

    def wire(self) -> dict[str, str]:
        raw = asdict(self)
        addresses = {"provider", "verifier", "arbitrator", "token"}
        return {
            "grantId": _decimal(raw["grant_id"], "grant_id"),
            "reservationId": _decimal(raw["reservation_id"], "reservation_id"),
            **{name: _hex(raw[name], 40, name) for name in addresses},
            "amount": _decimal(raw["amount"], "amount"),
            "deliverBy": _decimal(raw["deliver_by"], "deliver_by"),
            "verifyBy": _decimal(raw["verify_by"], "verify_by"),
            "challengePeriod": _decimal(raw["challenge_period"], "challenge_period"),
            "specificationHash": _hex(raw["specification_hash"], 64, "specification_hash"),
        }


class PactApiError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(f"Pact API {status}: {code}")


class PactClient:
    def __init__(self, base_url: str, token: str | None = None, *, timeout: float = 10,
                 transport: Callable[..., Any] = _open):
        parsed = urlparse(base_url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and
                parsed.hostname in {"localhost", "127.0.0.1", "::1"}):
            raise ValueError("Pact API URL must use HTTPS outside localhost")
        if not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid Pact API URL")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.transport = transport

    def with_token(self, token: str) -> PactClient:
        if not token or "\n" in token or "\r" in token:
            raise ValueError("invalid session token")
        return PactClient(self.base_url, token, timeout=self.timeout, transport=self.transport)

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        payload = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body, separators=(",", ":")).encode()
        req = Request(self.base_url + path, data=payload, headers=headers, method=method)
        try:
            with self.transport(req, timeout=self.timeout) as response:
                data = response.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
                    raise ValueError("Pact API response too large")
                return json.loads(data)
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read(4096))
                error = detail.get("error") or detail.get("reason") or "HTTP_ERROR"
            except (ValueError, AttributeError):
                error = "HTTP_ERROR"
            raise PactApiError(exc.code, error) from exc
        except URLError as exc:
            raise ConnectionError("Pact API unavailable") from exc

    def challenge(self, address: str, grant_id: int | None = None) -> dict[str, Any]:
        body = {"address": _hex(address, 40, "address")}
        if grant_id is not None:
            body["grantId"] = _decimal(grant_id, "grant_id")
        return self._request("POST", "/v1/auth/challenge", body)

    def http_authority(self) -> dict[str, Any]:
        return self._request("GET", "/v2/agent/me")

    def session(self, nonce: str, signature: str) -> dict[str, Any]:
        return self._request("POST", "/v1/auth/session", {"nonce": nonce, "signature": signature})

    def logout(self) -> dict[str, Any]:
        return self._request("POST", "/v1/auth/logout")

    def grant(self, grant_id: int) -> dict[str, Any]:
        return self._request("GET", f"/v1/grants/{_decimal(grant_id, 'grant_id')}")

    def grants(self) -> dict[str, Any]:
        return self._request("GET", "/v1/grants")

    def my_authority(self) -> dict[str, Any]:
        return self._request("GET", "/v1/agent/me")

    def register_agent(self, grant_id: int, name: str, description: str = "") -> dict[str, Any]:
        return self._request("POST", "/v1/agents", {"grantId": _decimal(grant_id, "grant_id"),
                                                     "name": name, "description": description})

    def agents(self) -> dict[str, Any]:
        return self._request("GET", "/v1/agents")

    def agent(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}")

    def update_agent(self, agent_id: str, **changes: Any) -> dict[str, Any]:
        if not changes or set(changes) - {"name", "description", "status"}:
            raise ValueError("invalid agent update")
        return self._request("PATCH", f"/v1/agents/{uuid.UUID(agent_id)}", changes)

    def key_challenge(self, agent_id: str, name: str, scopes: list[str],
                      expires_at: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/agents/{uuid.UUID(agent_id)}/keys/challenge",
                             {"name": name, "scopes": scopes, "expiresAt": expires_at})

    def issue_key(self, agent_id: str, challenge_id: str, signature: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/agents/{uuid.UUID(agent_id)}/keys",
                             {"challengeId": str(uuid.UUID(challenge_id)), "signature": signature})

    def agent_keys(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}/keys")

    def revoke_agent_key(self, agent_id: str, key_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/v1/agents/{uuid.UUID(agent_id)}/keys/{uuid.UUID(key_id)}")

    def credentials(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}/credentials")

    def save_credential(self, agent_id: str, provider: str, label: str,
                        secret: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/agents/{uuid.UUID(agent_id)}/credentials",
                             {"provider": provider, "label": label, "secret": secret})

    def revoke_credential(self, agent_id: str, credential_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/v1/agents/{uuid.UUID(agent_id)}/credentials/{uuid.UUID(credential_id)}")

    def agent_config(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}/config")

    def configure_agent(self, agent_id: str, provider: str, model: str, instructions: str,
                        max_output_tokens: int = 1024,
                        custom_endpoint: str | None = None) -> dict[str, Any]:
        body = {"provider": provider, "model": model, "instructions": instructions,
                "maxOutputTokens": max_output_tokens}
        if custom_endpoint is not None:
            body["customEndpoint"] = custom_endpoint
        return self._request("PUT", f"/v1/agents/{uuid.UUID(agent_id)}/config", body)

    def run_agent(self, agent_id: str, input_text: str, idempotency_key: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/agents/{uuid.UUID(agent_id)}/runs",
                             {"input": input_text, "idempotencyKey": idempotency_key})

    def runs(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}/runs")

    def run(self, agent_id: str, run_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/agents/{uuid.UUID(agent_id)}/runs/{uuid.UUID(run_id)}")

    def proxy(self, agent_id: str, service_id: str, method: str, path: str,
              body: dict[str, Any] | None = None, approval_id: str | None = None, *,
              query: dict[str, str] | None = None, idempotency_key: str | None = None) -> dict[str, Any] | str:
        """Call a registered HTTP operation with a scoped integration key."""
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            raise ValueError("invalid proxy method")
        if not path.startswith("/") or path.startswith("//") or ".." in path or "?" in path or "#" in path:
            raise ValueError("invalid proxy path")
        route = f"/v2/proxy/{uuid.UUID(agent_id)}/{uuid.UUID(service_id)}{path}"
        if query:
            route += "?" + urlencode(query)
        if method != "GET" and not idempotency_key:
            raise ValueError("writes require an idempotency_key; reuse it when retrying")
        headers = {"Accept": "application/json"}
        if idempotency_key:
            if not all(c.isascii() and (c.isalnum() or c in "_-") for c in idempotency_key) or not 8 <= len(idempotency_key) <= 100:
                raise ValueError("invalid idempotency_key")
            headers["X-Pact-Idempotency-Key"] = idempotency_key
        if not self.token:
            raise ValueError("scoped integration key required")
        headers["Authorization"] = f"Bearer {self.token}"
        if approval_id:
            headers["X-Pact-Approval-Id"] = str(uuid.UUID(approval_id))
        payload = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body, separators=(",", ":")).encode()
        req = Request(self.base_url + route, data=payload, headers=headers, method=method)
        try:
            with self.transport(req, timeout=self.timeout) as response:
                data = response.read(1_000_001)
                if len(data) > 1_000_000:
                    raise ValueError("Pact proxy response too large")
                content_type = response.headers.get("Content-Type", "")
                if content_type.lower().startswith("text/plain"):
                    return data.decode("utf-8")
                return json.loads(data)
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read(4096))
                error = detail.get("error") or detail.get("reason") or "HTTP_ERROR"
            except (ValueError, AttributeError):
                error = "HTTP_ERROR"
            raise PactApiError(exc.code, error) from exc

    def quote_transfer(self, intent: TransferIntent) -> dict[str, Any]:
        return self._request("POST", "/v1/transfers/quote", intent.wire())

    def prepare_transfer_reservation(self, intent: TransferIntent, key: str) -> dict[str, Any]:
        return self._request("POST", "/v1/transfers/prepare-reservation",
                             {"intent": intent.wire(), "idempotencyKey": key})

    def prepare_transfer_execution(self, intent: TransferIntent, reservation_id: int,
                                   key: str, approval: str | None = None) -> dict[str, Any]:
        body = {"intent": intent.wire(), "reservationId": _decimal(reservation_id, "reservation_id"),
                "idempotencyKey": key}
        if approval is not None:
            body["approval"] = approval
        return self._request("POST", "/v1/transfers/prepare-execution", body)

    def next_obligation_reservation_id(self) -> dict[str, Any]:
        return self._request("GET", "/v1/obligations/next-reservation-id")

    def prepare_obligation_reservation(self, terms: ObligationTerms, key: str) -> dict[str, Any]:
        return self._request("POST", "/v1/obligations/prepare-reservation",
                             {"terms": terms.wire(), "idempotencyKey": key})

    def prepare_obligation_create(self, terms: ObligationTerms, principal_signature: str,
                                  provider_signature: str, key: str) -> dict[str, Any]:
        return self._request("POST", "/v1/obligations/prepare-create",
                             {"terms": terms.wire(), "principalSignature": principal_signature,
                              "providerSignature": provider_signature, "idempotencyKey": key})

    def obligation(self, obligation_id: int) -> dict[str, Any]:
        return self._request("GET", f"/v1/obligations/{_decimal(obligation_id, 'obligation_id')}")

    def receipt(self, obligation_id: int) -> dict[str, Any]:
        return self._request("GET", f"/v1/receipts/{_decimal(obligation_id, 'obligation_id')}")

    def request_approval(self, intent: TransferIntent, reservation_id: int) -> dict[str, Any]:
        return self._request("POST", "/v1/approvals/requests",
                             {"intent": intent.wire(), "reservationId": _decimal(reservation_id, "reservation_id")})

    def approvals(self) -> dict[str, Any]:
        return self._request("GET", "/v1/approvals")

    def approval(self, request_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/approvals/{uuid.UUID(request_id)}")

    def approve_request(self, request_id: str, signature: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/approvals/{uuid.UUID(request_id)}/approve",
                             {"signature": signature})

    def reject_request(self, request_id: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/approvals/{uuid.UUID(request_id)}/reject", {})

    def upload_evidence(self, obligation_id: int, content_type: str, data: bytes) -> dict[str, Any]:
        if not self.token:
            raise ValueError("session token required")
        if not data or len(data) > 5 * 1024 * 1024:
            raise ValueError("evidence size out of bounds")
        req = Request(self.base_url + f"/v1/evidence/{_decimal(obligation_id, 'obligation_id')}",
                      data=data, method="POST", headers={"Authorization": f"Bearer {self.token}",
                        "Content-Type": "application/octet-stream", "X-Pact-Evidence-Type": content_type})
        try:
            with self.transport(req, timeout=self.timeout) as response:
                return json.loads(response.read(4096))
        except HTTPError as exc:
            raise PactApiError(exc.code, "EVIDENCE_UPLOAD_FAILED") from exc

    def evidence(self, evidence_id: str) -> bytes:
        if not self.token:
            raise ValueError("session token required")
        req = Request(self.base_url + f"/v1/evidence/{uuid.UUID(evidence_id)}",
                      headers={"Authorization": f"Bearer {self.token}"})
        try:
            with self.transport(req, timeout=self.timeout) as response:
                data = response.read(5 * 1024 * 1024 + 1)
                if len(data) > 5 * 1024 * 1024:
                    raise ValueError("evidence response too large")
                return data
        except HTTPError as exc:
            raise PactApiError(exc.code, "EVIDENCE_READ_FAILED") from exc

    def submitted(self, operation_id: str, tx_hash: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/operations/{uuid.UUID(operation_id)}/submitted",
                             {"txHash": _hex(tx_hash, 64, "tx_hash")})

    def operation(self, operation_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/operations/{uuid.UUID(operation_id)}")
