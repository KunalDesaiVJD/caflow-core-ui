"""Master Flow watchdog — runs as SYSTEM (startup scheduled task).

The collector runs in the user session and can be ended by the user from Task
Manager. This process detects that (via a stale heartbeat) and relaunches the
collector by running its scheduled task. The user cannot stop or delete this
task without administrator rights, so tracking cannot be permanently disabled
from a standard account.

It does not capture anything itself.
"""
from __future__ import annotations

import logging
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from caflow_common import config as cfg_mod  # noqa: E402
from caflow_common.paths import Storage  # noqa: E402

COLLECTOR_TASK = "MasterFlowCollector"


def _heartbeat_age(storage: Storage) -> float:
    try:
        ts = int(storage.heartbeat.read_text(encoding="utf-8").strip())
        return max(0.0, time.time() - ts)
    except (OSError, ValueError):
        return 1e9  # never seen a heartbeat -> treat as very stale


def _relaunch_collector() -> None:
    try:
        subprocess.run(
            ["schtasks", "/Run", "/TN", COLLECTOR_TASK],
            check=False,
            capture_output=True,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        logging.info("Triggered %s", COLLECTOR_TASK)
    except Exception as exc:
        logging.error("Failed to trigger collector task: %s", exc)


def main():
    cfg = cfg_mod.load()
    storage = Storage(cfg.storage_root)
    storage.ensure()
    logging.basicConfig(
        filename=str(storage.logs / "watchdog.log"),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.info("Watchdog started.")

    # a heartbeat older than this means the collector is gone / stuck
    stale_after = max(30, cfg.interval_seconds * 3)
    check_every = max(10, cfg.interval_seconds)
    last_relaunch = 0.0

    while True:
        try:
            age = _heartbeat_age(storage)
            if age > stale_after:
                # avoid hammering: at most one relaunch per grace window
                if time.time() - last_relaunch > stale_after:
                    logging.warning("Heartbeat stale (%.0fs); relaunching collector.", age)
                    _relaunch_collector()
                    last_relaunch = time.time()
        except Exception as exc:
            logging.error("Watchdog loop error: %s", exc)
        time.sleep(check_every)


if __name__ == "__main__":
    main()
