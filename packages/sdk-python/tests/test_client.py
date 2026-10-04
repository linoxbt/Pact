import io
import json
import unittest
from urllib.error import HTTPError

from pact import PactApiError, PactClient, TransferIntent


ADDRESS = "0x" + "a" * 40
HASH = "0x" + "b" * 64


class Response:
    def __init__(self, body, content_type="application/json"):
        self.body = io.BytesIO(body.encode() if isinstance(body, str) else json.dumps(body).encode())
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, size):
        return self.body.read(size)


class ClientTests(unittest.TestCase):
    def test_transfer_serializes_big_integers_and_auth(self):
        seen = []

        def transport(request, *, timeout):
            seen.append((request, timeout))
            return Response({"decision": {"result": "ALLOW"}})

        client = PactClient("https://pact.example", "opaque-token", transport=transport)
        intent = TransferIntent(1, ADDRESS, ADDRESS, ADDRESS, 2**70, 0, 2**65, HASH)
        self.assertEqual(client.quote_transfer(intent)["decision"]["result"], "ALLOW")
        request, timeout = seen[0]
        self.assertEqual(timeout, 10)
        self.assertEqual(json.loads(request.data)["amount"], str(2**70))
        self.assertEqual(request.get_header("Authorization"), "Bearer opaque-token")

    def test_rejects_insecure_remote_url(self):
        with self.assertRaises(ValueError):
            PactClient("http://pact.example")

    def test_proxy_accepts_text_response(self):
        def transport(*_args, **_kwargs):
            return Response("healthy", "text/plain; charset=utf-8")

        client = PactClient("https://pact.example", "pat_test", transport=transport)
        self.assertEqual(client.proxy("00000000-0000-4000-8000-000000000001",
                                      "00000000-0000-4000-8000-000000000002",
                                      "GET", "/health"), "healthy")

    def test_reports_api_error_without_exposing_token(self):
        def transport(*_args, **_kwargs):
            raise HTTPError("https://pact.example", 403, "Forbidden", {},
                            io.BytesIO(b'{"error":"AGENT_SCOPE_DENIED"}'))

        with self.assertRaises(PactApiError) as raised:
            PactClient("https://pact.example", "secret", transport=transport).grants()
        self.assertEqual(raised.exception.code, "AGENT_SCOPE_DENIED")
        self.assertNotIn("secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
