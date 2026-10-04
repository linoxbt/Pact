"""Owner-authenticated HTTP control plane. Supply a short-lived Privy access token."""

from __future__ import annotations

import json
import re
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .client import PactApiError


class PactControlClient:
    def __init__(self, base_url: str, access_token: str, *, timeout: float = 10,
                 transport: Callable[..., Any] = urlopen):
        origin = urlparse(base_url)
        if (origin.scheme != "https" and not (origin.scheme == "http" and
                origin.hostname in {"localhost", "127.0.0.1", "::1"})) or origin.path not in {"", "/"}:
            raise ValueError("control API must be an HTTPS origin outside localhost")
        if not origin.netloc or origin.username or origin.password or origin.query or origin.fragment:
            raise ValueError("invalid control API origin")
        if not access_token or "\n" in access_token or "\r" in access_token:
            raise ValueError("invalid owner token")
        self.base_url = base_url.rstrip("/")
        self.access_token = access_token
        self.timeout = timeout
        self.transport = transport

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"} or not re.fullmatch(
                r"/v2/[A-Za-z0-9/_?=&.%+-]+", path) or ".." in path or "//" in path:
            raise ValueError("invalid control API route")
        payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        headers = {"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base_url + path, data=payload, headers=headers, method=method)
        try:
            with self.transport(request, timeout=self.timeout) as response:
                data = response.read(1_000_001)
                if len(data) > 1_000_000:
                    raise ValueError("Pact control response too large")
                return json.loads(data)
        except HTTPError as error:
            try:
                code = json.loads(error.read(4096)).get("error", "HTTP_ERROR")
            except (ValueError, AttributeError):
                code = "HTTP_ERROR"
            raise PactApiError(error.code, code) from error

    def account(self): return self.request("GET", "/v2/account")
    def agents(self): return self.request("GET", "/v2/agents")
    def create_agent(self, name: str, environment: str, description: str = ""):
        return self.request("POST", "/v2/agents", {"name": name, "environment": environment,
                                                  "description": description})
    def update_agent(self, agent_id: str, patch: dict[str, Any]):
        return self.request("PATCH", f"/v2/agents/{agent_id}", patch)
    def grants(self): return self.request("GET", "/v2/grants")
    def create_grant(self, grant: dict[str, Any]): return self.request("POST", "/v2/grants", grant)
    def narrow_grant(self, grant_id: str, patch: dict[str, Any]):
        return self.request("PATCH", f"/v2/grants/{grant_id}", patch)
    def migrate_grant(self, grant_id: str):
        return self.request("POST", f"/v2/grants/{grant_id}/migrate", {})
    def policies(self): return self.request("GET", "/v2/policies")
    def create_policy(self, policy: dict[str, Any]): return self.request("POST", "/v2/policies", policy)
    def update_policy(self, policy_id: str, patch: dict[str, Any]):
        return self.request("PATCH", f"/v2/policies/{policy_id}", patch)
    def services(self): return self.request("GET", "/v2/services")
    def create_service(self, service: dict[str, Any]): return self.request("POST", "/v2/services", service)
    def update_service(self, service_id: str, patch: dict[str, Any]):
        return self.request("PATCH", f"/v2/services/{service_id}", patch)
    def save_service_secret(self, service_id: str, secret: str):
        return self.request("PUT", f"/v2/services/{service_id}/secret", {"secret": secret})
    def revoke_service_secret(self, service_id: str):
        return self.request("DELETE", f"/v2/services/{service_id}/secret")
    def endpoints(self): return self.request("GET", "/v2/endpoints")
    def create_endpoint(self, endpoint: dict[str, Any]):
        return self.request("POST", "/v2/endpoints", endpoint)
    def update_endpoint(self, endpoint_id: str, patch: dict[str, Any]):
        return self.request("PATCH", f"/v2/endpoints/{endpoint_id}", patch)
    def preview_openapi(self, spec: dict[str, Any]):
        return self.request("POST", "/v2/openapi/preview", {"spec": spec})
    def import_openapi(self, service_id: str, options: dict[str, Any]):
        return self.request("POST", f"/v2/services/{service_id}/import", options)
    def keys(self, agent_id: str): return self.request("GET", f"/v2/agents/{agent_id}/keys")
    def issue_key(self, agent_id: str, name: str, scopes: list[str], expires_at: str):
        return self.request("POST", f"/v2/agents/{agent_id}/keys",
                            {"name": name, "scopes": scopes, "expiresAt": expires_at})
    def rotate_key(self, agent_id: str, key_id: str):
        return self.request("POST", f"/v2/agents/{agent_id}/keys/{key_id}/rotate", {})
    def revoke_key(self, agent_id: str, key_id: str):
        return self.request("DELETE", f"/v2/agents/{agent_id}/keys/{key_id}")
    def approvals(self): return self.request("GET", "/v2/approvals")
    def decide_approval(self, approval_id: str, decision: str):
        return self.request("POST", f"/v2/approvals/{approval_id}/decision", {"decision": decision})
    def activity(self, filters: dict[str, str] | None = None):
        query = "?" + urlencode(filters) if filters else ""
        return self.request("GET", "/v2/activity" + query)
    def activity_detail(self, request_id: str):
        return self.request("GET", f"/v2/activity/{request_id}")
    def audit(self, cursor: str | None = None):
        return self.request("GET", "/v2/audit" + (f"?cursor={cursor}" if cursor else ""))
