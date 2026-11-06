"""Filesystem layout for the agent.

All runtime data lives under storage.root (default C:\\ProgramData\\MasterFlowAgent).
Config and the policy notice are read from next to the executable when frozen,
or from the project root when run from source.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def app_dir() -> Path:
    """Directory holding the exe (frozen) or the project root (source)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # src/caflow_common/paths.py -> project root is three parents up
    return Path(__file__).resolve().parents[2]


def config_path() -> Path:
    return app_dir() / "config.yaml"


class Storage:
    """Resolved runtime paths under the configured storage root."""

    def __init__(self, root: str):
        self.root = Path(root)

    @property
    def db(self) -> Path:
        return self.root / "db" / "agent.db"

    @property
    def screens(self) -> Path:
        return self.root / "screens"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def state(self) -> Path:
        return self.root / "state"

    # state files
    @property
    def heartbeat(self) -> Path:
        return self.state / "collector.heartbeat"

    @property
    def pause_flag(self) -> Path:
        return self.state / "paused.until"

    @property
    def consent_flag(self) -> Path:
        return self.state / "consent.ack"

    def screens_for_day(self, day: str) -> Path:
        return self.screens / day

    def ensure(self) -> None:
        for p in (self.db.parent, self.screens, self.logs, self.state):
            os.makedirs(p, exist_ok=True)
