import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pact import PactApiError, PactControlClient


class RedirectTests(unittest.TestCase):
    def test_owner_token_never_follows_cross_origin_redirect(self):
        received = []

        class Target(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *_):
                pass

        target = ThreadingHTTPServer(("127.0.0.1", 0), Target)

        class Redirect(Target):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{target.server_port}/capture")
                self.end_headers()

        source = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (target, source)]
        for thread in threads:
            thread.start()
        try:
            client = PactControlClient(f"http://127.0.0.1:{source.server_port}", "dummy-owner-token")
            with self.assertRaises(PactApiError) as raised:
                client.account()
            self.assertEqual(raised.exception.status, 302)
            self.assertEqual(received, [])
        finally:
            for server in (source, target):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join()


class PaymentTests(unittest.TestCase):
    def test_paid_actions_use_explicit_payment_header(self):
        import io
        calls = []

        def transport(request, **_kwargs):
            calls.append(request)
            return io.BytesIO(b"{}")

        client = PactControlClient("https://pact.example", "owner", transport=transport)
        payment_id = "11111111-1111-4111-8111-111111111111"
        client.prepare_payment("/v2/agents", {"name": "Test", "environment": "development"})
        client.confirm_payment(payment_id, "0x" + "ab" * 32)
        client.create_agent("Test", "development", payment_id=payment_id)
        client.create_grant({}, payment_id=payment_id)
        client.create_policy({}, payment_id=payment_id)
        client.issue_key(payment_id, "Key", ["proxy.read"], "2030-01-01T00:00:00Z", payment_id=payment_id)
        self.assertTrue(all(r.get_header("X-pact-payment") is None for r in calls[:2]))
        self.assertTrue(all(r.get_header("X-pact-payment") == payment_id for r in calls[2:]))
        with self.assertRaises(ValueError):
            client.create_agent("Test", "development", payment_id="bad\r\nheader")
