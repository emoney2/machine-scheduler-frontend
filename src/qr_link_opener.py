# qr_link_opener.py
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse
import webbrowser

PORT = 3000

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        company = params.get('company', [''])[0]
        order = params.get('order', [''])[0]
        if company and order:
            url = f"https://machineschedule.netlify.app/ship?company={company}&order={order}"
            print("Opening:", url)
            webbrowser.open_new_tab(url)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Opened.")

if __name__ == '__main__':
    print(f"QR Redirect Server running on http://localhost:{PORT}")
    HTTPServer(('localhost', PORT), Handler).serve_forever()