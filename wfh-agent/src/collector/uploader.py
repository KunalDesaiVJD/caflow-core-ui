"""Uploads capture batches to the caflow `wfh-ingest` edge function.

Used only when config server.mode == 'http'. Local storage still happens
regardless, so a failed upload never loses data — the next run re-uploads from
the local store is NOT implemented in this demo (captures already uploaded are
simply skipped on the server via upsert); for the demo we upload best-effort
each cycle and keep the local copy as the source of truth.

Uses only the Python standard library (urllib) — no extra dependency.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class CaptureItem:
    captured_at: str   # ISO 8601, UTC, e.g. "2026-11-06T09:30:00Z"
    display_no: int
    app: Optional[str]
    title: Optional[str]
    idle: bool
    sha256: str
    bytes: int
    image_bytes: bytes

    def to_payload(self) -> dict:
        return {
            "captured_at": self.captured_at,
            "display_no": self.display_no,
            "app": self.app,
            "title": self.title,
            "idle": self.idle,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "image_b64": base64.b64encode(self.image_bytes).decode("ascii"),
        }


class Uploader:
    def __init__(self, ingest_url: str, token: str, device_id: str, employee_id: str, timeout: int = 30):
        self.ingest_url = ingest_url
        self.token = token
        self.device_id = device_id
        self.employee_id = employee_id
        self.timeout = timeout

    def upload(self, items: List[CaptureItem]) -> bool:
        """POST a batch. Returns True on HTTP 200. Best-effort: logs and
        returns False on any error (the local copy remains)."""
        if not items:
            return True
        body = json.dumps({
            "device_id": self.device_id,
            "employee_id": self.employee_id,
            "captures": [it.to_payload() for it in items],
        }).encode("utf-8")

        req = urllib.request.Request(
            self.ingest_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
                logging.info("Upload ok (%d items): %s", len(items), raw[:300])
                return resp.status == 200
        except urllib.error.HTTPError as e:
            logging.error("Upload HTTP %s: %s", e.code, e.read().decode("utf-8", "replace")[:300])
        except Exception as e:
            logging.error("Upload failed: %s", e)
        return False
