#!/usr/bin/env python3
"""
Anthropic API key diagnostic.

What this proves / disproves:
  - Does THIS API key have access to claude-sonnet-4-6?
  - Which models does it have access to?
  - Is the failure in the key (account-level) or in our Electron app's plumbing
    (proxy / SDK / Key Vault) ?

It calls api.anthropic.com directly. No proxy, no MSAL, no Electron, no SDK.
If 4.6 works here but fails in the app, the bug is on our side.

Usage (PowerShell):
  $env:ANTHROPIC_API_KEY = "sk-ant-..."
  python scripts/check-anthropic-access.py

Or pass the key as an arg:
  python scripts/check-anthropic-access.py sk-ant-...

The script uses only the standard library so any Python 3.8+ install works
without needing pip / venv.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


API_BASE = "https://api.anthropic.com"
API_VERSION = "2023-06-01"

# Models we want to probe, in priority order. claude-sonnet-4-6 is what our
# Electron app currently requests; the others are sanity checks so we can
# see what the key DOES work with if 4.6 is rejected.
MODELS_TO_TRY = [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-7",
    "claude-haiku-4-5-20251001",
]


def _headers(api_key: str) -> dict[str, str]:
    return {
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
    }


def _do_request(
    method: str, path: str, api_key: str, body: dict | None = None
) -> tuple[int, dict | str]:
    """Return (status, parsed_body_or_text). Never raises."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url=f"{API_BASE}{path}",
        method=method,
        headers=_headers(api_key),
        data=data,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except urllib.error.URLError as e:
        return -1, f"Network error: {e.reason}"


def list_models(api_key: str) -> list[str]:
    print("\n=== /v1/models (what does this key see?) ===")
    status, body = _do_request("GET", "/v1/models", api_key)
    if status != 200:
        print(f"  HTTP {status}: {body}")
        return []
    if not isinstance(body, dict):
        print(f"  Unexpected body: {body!r}")
        return []
    models = body.get("data", [])
    ids = [m.get("id", "?") for m in models]
    print(f"  Account has {len(ids)} models visible.")
    for mid in ids:
        marker = "  <- target" if mid == "claude-sonnet-4-6" else ""
        print(f"    {mid}{marker}")
    return ids


def try_messages(api_key: str, model: str) -> bool:
    """Send a minimal one-token request to verify the model actually works."""
    print(f"\n=== /v1/messages with model={model} ===")
    body = {
        "model": model,
        "max_tokens": 4,
        "messages": [{"role": "user", "content": "ping"}],
    }
    status, resp = _do_request("POST", "/v1/messages", api_key, body)
    if status == 200:
        if isinstance(resp, dict):
            content = resp.get("content", [])
            text = ""
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    break
            usage = resp.get("usage", {})
            print(f"  OK  HTTP 200, response='{text.strip()[:40]}', usage={usage}")
        else:
            print(f"  OK  HTTP 200, body={resp!r}")
        return True
    # Surface the structured error so model-access vs key-invalid is clear.
    if isinstance(resp, dict):
        err = resp.get("error", {})
        print(
            f"  FAIL  HTTP {status}, type={err.get('type', '?')}, "
            f"message={err.get('message', '?')!r}"
        )
    else:
        print(f"  FAIL  HTTP {status}, body={resp!r}")
    return False


def main() -> int:
    api_key = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("ANTHROPIC_API_KEY", "")
    ).strip()
    if not api_key:
        print(
            "Set ANTHROPIC_API_KEY env var, or pass the key as the first arg.\n"
            "  PowerShell:  $env:ANTHROPIC_API_KEY = 'sk-ant-...'\n"
            "  Then:        python scripts/check-anthropic-access.py"
        )
        return 2
    if not api_key.startswith("sk-ant-"):
        print(
            f"Warning: key doesn't look like a real Anthropic key "
            f"(starts with {api_key[:8]!r}). Continuing anyway."
        )

    print(f"Testing key: {api_key[:12]}...{api_key[-4:]}")

    visible = list_models(api_key)

    results: dict[str, bool] = {}
    for model in MODELS_TO_TRY:
        results[model] = try_messages(api_key, model)

    print("\n=== Summary ===")
    for model, ok in results.items():
        sym = "PASS" if ok else "FAIL"
        in_listing = "(in /v1/models)" if model in visible else "(NOT in /v1/models)"
        print(f"  {sym}  {model:36s} {in_listing}")

    if results.get("claude-sonnet-4-6"):
        print("\nVerdict: this key DOES have access to claude-sonnet-4-6.")
        print("If the Electron app still fails, the bug is on our side")
        print("(proxy, Key Vault key, or SDK model passing) — not the key.")
    elif any(results.values()):
        print(
            "\nVerdict: this key does NOT have access to claude-sonnet-4-6,"
            "\nbut other models work. Either upgrade account access at "
            "console.anthropic.com or switch the app to a model this key can use."
        )
    else:
        print(
            "\nVerdict: this key can't reach ANY model. The key itself may be"
            "\ninvalid, revoked, or out of credit. Check console.anthropic.com."
        )

    return 0 if results.get("claude-sonnet-4-6") else 1


if __name__ == "__main__":
    sys.exit(main())
