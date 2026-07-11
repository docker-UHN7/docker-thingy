import os
import random
import sqlite3
import string
from urllib.parse import urlparse

from flask import Flask, g, jsonify, redirect, request

DB_PATH = os.environ.get("DB_PATH", "/data/links.db")
CODE_ALPHABET = string.ascii_letters + string.digits

app = Flask(__name__)


def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS links (
            code TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            hits INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.commit()
    conn.close()


def generate_code(length=6):
    return "".join(random.choice(CODE_ALPHABET) for _ in range(length))


def is_valid_url(value):
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.get("/api/links")
def list_links():
    db = get_db()
    rows = db.execute("SELECT code, url, hits, created_at FROM links ORDER BY created_at DESC").fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/shorten")
def shorten():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "").strip()

    if not is_valid_url(url):
        return jsonify(error="url must be an absolute http(s) URL"), 400

    db = get_db()
    for _ in range(5):
        code = generate_code()
        try:
            db.execute("INSERT INTO links (code, url) VALUES (?, ?)", (code, url))
            db.commit()
            return jsonify(code=code, url=url, short_url=f"{request.host_url}{code}"), 201
        except sqlite3.IntegrityError:
            continue

    return jsonify(error="could not generate a unique code, try again"), 500


@app.get("/<code>")
def follow(code):
    db = get_db()
    row = db.execute("SELECT url FROM links WHERE code = ?", (code,)).fetchone()
    if row is None:
        return jsonify(error="short link not found"), 404

    db.execute("UPDATE links SET hits = hits + 1 WHERE code = ?", (code,))
    db.commit()
    return redirect(row["url"], code=302)


@app.get("/")
def index():
    db = get_db()
    rows = db.execute("SELECT code, url, hits FROM links ORDER BY created_at DESC LIMIT 20").fetchall()
    items = "".join(
        f'<li><a href="/{row["code"]}">/{row["code"]}</a> &rarr; {row["url"]} '
        f'<span class="hits">({row["hits"]} hits)</span></li>'
        for row in rows
    )
    return f"""
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Link Shortener MVP</title>
        <style>
          body {{ font-family: system-ui, sans-serif; max-width: 560px; margin: 3rem auto; color: #1c2530; }}
          input, button {{ font-size: 1rem; padding: 0.5rem; }}
          input[type="url"] {{ width: 70%; }}
          ul {{ padding-left: 1.2rem; }}
          .hits {{ color: #6b7784; font-size: 0.85rem; }}
        </style>
      </head>
      <body>
        <h1>Link Shortener MVP</h1>
        <form onsubmit="shorten(event)">
          <input id="url" type="url" placeholder="https://example.com/some/long/url" required />
          <button type="submit">Shorten</button>
        </form>
        <p id="result"></p>
        <h2>Recent links</h2>
        <ul>{items or "<li>No links yet.</li>"}</ul>
        <script>
          async function shorten(event) {{
            event.preventDefault();
            const url = document.getElementById("url").value;
            const response = await fetch("/api/shorten", {{
              method: "POST",
              headers: {{ "content-type": "application/json" }},
              body: JSON.stringify({{ url }})
            }});
            const data = await response.json();
            document.getElementById("result").textContent = response.ok
              ? `Short link: ${{data.short_url}}`
              : `Error: ${{data.error}}`;
            if (response.ok) {{
              setTimeout(() => window.location.reload(), 800);
            }}
          }}
        </script>
      </body>
    </html>
    """


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
