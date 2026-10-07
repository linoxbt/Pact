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
