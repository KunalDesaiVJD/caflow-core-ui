"""Load and validate config.yaml into a simple typed structure."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from pathlib import Path
from typing import List

import yaml

from .paths import config_path

_DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


@dataclass
class WorkingHours:
    start: time
    end: time
    days: List[int]

    def is_within(self, now) -> bool:
        if now.weekday() not in self.days:
            return False
        return self.start <= now.time() <= self.end


@dataclass
class Config:
    interval_seconds: int
    webp_quality: int
    idle_threshold_seconds: int
    capture_when_idle: bool
    working_hours: WorkingHours
    storage_root: str
    retention_days: int
    employee_id: str
    device_id: str
    tray_required: bool
    require_consent: bool
    policy_notice_file: str
    pause_max_minutes: int
    _app_dir: Path = field(default=None)

    @property
    def policy_notice_path(self) -> Path:
        return (self._app_dir or Path(".")) / self.policy_notice_file


def _parse_time(s: str) -> time:
    h, m = str(s).split(":")
    return time(int(h), int(m))


def load() -> Config:
    path = config_path()
    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    cap = raw["capture"]
    wh = cap["working_hours"]
    sto = raw["storage"]
    ident = raw["identity"]
    disc = raw["disclosure"]
    pause = raw.get("pause", {})

    return Config(
        interval_seconds=int(cap["interval_seconds"]),
        webp_quality=int(cap.get("webp_quality", 60)),
        idle_threshold_seconds=int(cap.get("idle_threshold_seconds", 180)),
        capture_when_idle=bool(cap.get("capture_when_idle", True)),
        working_hours=WorkingHours(
            start=_parse_time(wh["start"]),
            end=_parse_time(wh["end"]),
            days=[_DAYS[d.lower()] for d in wh["days"]],
        ),
        storage_root=str(sto["root"]),
        retention_days=int(sto.get("retention_days", 90)),
        employee_id=str(ident["employee_id"]),
        device_id=str(ident["device_id"]),
        tray_required=bool(disc.get("tray_required", True)),
        require_consent=bool(disc.get("require_consent", True)),
        policy_notice_file=str(disc.get("policy_notice_file", "policy-notice.txt")),
        pause_max_minutes=int(pause.get("max_minutes", 30)),
        _app_dir=path.parent,
    )
