"""Master Flow collector — runs in the logged-in user's session.

Responsibilities:
  * Show the policy notice and record acknowledgement on first run.
  * Show an always-on tray indicator (required — no stealth mode).
  * Every `interval_seconds`, during working hours and while not paused,
    capture all monitors + foreground window + idle state, store locally.
  * Write a heartbeat each loop so the watchdog knows it is alive.
  * Purge data older than retention_days, once per day.

The tray is mandatory: if it cannot be created and `tray_required` is set,
the collector exits without capturing anything.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# allow running from source: add src/ to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from caflow_common import config as cfg_mod  # noqa: E402
from caflow_common.paths import Storage  # noqa: E402
from caflow_common.storage import Store  # noqa: E402
from collector import capture  # noqa: E402
from collector.uploader import CaptureItem, Uploader  # noqa: E402


def _setup_logging(storage: Storage) -> None:
    storage.ensure()
    logging.basicConfig(
        filename=str(storage.logs / "collector.log"),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


# ----------------------------- consent --------------------------------------

def ensure_consent(cfg: cfg_mod.Config, storage: Storage) -> bool:
    """Return True if the user has acknowledged the notice (showing it if needed)."""
    if not cfg.require_consent:
        return True
    if storage.consent_flag.exists():
        return True

    try:
        notice = cfg.policy_notice_path.read_text(encoding="utf-8")
    except OSError:
        notice = "Work activity (including periodic screenshots) is monitored on this company device."

    acknowledged = {"ok": False}
    try:
        import tkinter as tk
        from tkinter import scrolledtext

        root = tk.Tk()
        root.title("Master Flow — Monitoring notice")
        root.geometry("640x520")
        root.attributes("-topmost", True)

        txt = scrolledtext.ScrolledText(root, wrap=tk.WORD, font=("Segoe UI", 10))
        txt.insert(tk.END, notice)
        txt.configure(state=tk.DISABLED)
        txt.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

        btns = tk.Frame(root)
        btns.pack(fill=tk.X, padx=12, pady=(0, 12))

        def on_ack():
            acknowledged["ok"] = True
            root.destroy()

        def on_decline():
            acknowledged["ok"] = False
            root.destroy()

        tk.Button(btns, text="Decline", width=14, command=on_decline).pack(side=tk.RIGHT, padx=6)
        tk.Button(btns, text="I acknowledge", width=16, command=on_ack).pack(side=tk.RIGHT)
        root.mainloop()
    except Exception as exc:  # no GUI available
        logging.error("Consent dialog could not be shown: %s", exc)
        return False

    if acknowledged["ok"]:
        storage.state.mkdir(parents=True, exist_ok=True)
        storage.consent_flag.write_text(
            f"acknowledged {datetime.now().isoformat()} by {cfg.employee_id}\n",
            encoding="utf-8",
        )
        return True
    return False


# ----------------------------- pause state ----------------------------------

def is_paused(storage: Storage) -> bool:
    try:
        until = storage.pause_flag.read_text(encoding="utf-8").strip()
        return datetime.now() < datetime.fromisoformat(until)
    except (OSError, ValueError):
        return False


def set_pause(storage: Storage, minutes: int) -> None:
    storage.state.mkdir(parents=True, exist_ok=True)
    until = datetime.now() + timedelta(minutes=minutes)
    storage.pause_flag.write_text(until.isoformat(), encoding="utf-8")


def clear_pause(storage: Storage) -> None:
    try:
        storage.pause_flag.unlink()
    except OSError:
        pass


# ----------------------------- capture loop ----------------------------------

class CaptureLoop(threading.Thread):
    def __init__(self, cfg: cfg_mod.Config, storage: Storage, store: Store, uploader=None):
        super().__init__(daemon=True)
        self.cfg = cfg
        self.storage = storage
        self.store = store
        self.uploader = uploader
        self._stop = threading.Event()
        self._last_purge_day = None

    def stop(self):
        self._stop.set()

    def _maybe_purge(self):
        today = datetime.now().date()
        if self._last_purge_day == today:
            return
        self._last_purge_day = today
        try:
            n = self.store.purge_older_than(self.cfg.retention_days)
            if n:
                logging.info("Retention purge removed %d screenshots", n)
        except Exception as exc:
            logging.error("Purge failed: %s", exc)

    def _heartbeat(self):
        try:
            self.storage.heartbeat.write_text(str(int(time.time())), encoding="utf-8")
        except OSError:
            pass

    def run(self):
        logging.info("Capture loop started (interval=%ss)", self.cfg.interval_seconds)
        while not self._stop.is_set():
            cycle_start = time.time()
            self._heartbeat()  # always, so the watchdog sees us even when idle/paused
            try:
                now = datetime.now()
                if self.cfg.working_hours.is_within(now) and not is_paused(self.storage):
                    self._maybe_purge()
                    idle = capture.idle_seconds() >= self.cfg.idle_threshold_seconds
                    if idle and not self.cfg.capture_when_idle:
                        pass
                    else:
                        app, title = capture.foreground_info()
                        ts = int(cycle_start)
                        captured_at = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        batch = []
                        for display_no, webp in capture.grab_screens(self.cfg.webp_quality):
                            self.store.save_screenshot(display_no, webp, app, title, idle, ts=ts)
                            if self.uploader:
                                batch.append(CaptureItem(
                                    captured_at=captured_at,
                                    display_no=display_no,
                                    app=app,
                                    title=title,
                                    idle=idle,
                                    sha256=hashlib.sha256(webp).hexdigest(),
                                    bytes=len(webp),
                                    image_bytes=webp,
                                ))
                        if self.uploader and batch:
                            self.uploader.upload(batch)  # best-effort; local copy already saved
            except Exception as exc:
                logging.error("Capture cycle error: %s", exc)

            # keep a steady cadence regardless of how long the cycle took
            elapsed = time.time() - cycle_start
            self._stop.wait(max(0.5, self.cfg.interval_seconds - elapsed))


# ----------------------------- tray ------------------------------------------

def _tray_image():
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (64, 64), (24, 28, 36))
    d = ImageDraw.Draw(img)
    d.ellipse((14, 14, 50, 50), fill=(40, 170, 110))  # green "recording" dot
    return img


def run_tray(cfg: cfg_mod.Config, storage: Storage, store: Store, loop: CaptureLoop):
    import pystray
    from pystray import MenuItem as Item

    def status_text(_item=None):
        state = "Master Flow — Paused" if is_paused(storage) else "Master Flow"
        return f"{state}  ·  {store.count_today()} captures today"

    def do_pause(icon, _item):
        set_pause(storage, cfg.pause_max_minutes)
        icon.notify(f"Paused for {cfg.pause_max_minutes} min", "Master Flow")
        icon.update_menu()

    def do_resume(icon, _item):
        clear_pause(storage)
        icon.notify("Resumed", "Master Flow")
        icon.update_menu()

    def open_storage(_icon, _item):
        try:
            os.startfile(str(storage.root))  # noqa: SLF001 (Windows only)
        except Exception:
            pass

    menu = pystray.Menu(
        Item(status_text, None, enabled=False),
        pystray.Menu.SEPARATOR,
        Item(f"Pause for break ({cfg.pause_max_minutes} min)", do_pause),
        Item("Resume now", do_resume),
        Item("Open my data folder", open_storage),
    )
    icon = pystray.Icon("MasterFlow", _tray_image(), "Master Flow", menu)

    # refresh the status label periodically
    def refresher():
        while True:
            time.sleep(15)
            try:
                icon.update_menu()
            except Exception:
                break

    threading.Thread(target=refresher, daemon=True).start()
    loop.start()
    icon.run()  # blocks


def main():
    cfg = cfg_mod.load()
    storage = Storage(cfg.storage_root)
    _setup_logging(storage)

    if not ensure_consent(cfg, storage):
        logging.warning("Monitoring not acknowledged; collector exiting without capture.")
        return 0

    store = Store(storage, cfg.employee_id, cfg.device_id)

    uploader = None
    if cfg.server_mode == "http" and cfg.ingest_url and cfg.ingest_token:
        uploader = Uploader(cfg.ingest_url, cfg.ingest_token, cfg.device_id, cfg.employee_id)
        logging.info("Upload mode: posting to %s", cfg.ingest_url)
    elif cfg.server_mode == "http":
        logging.warning("server.mode=http but ingest_url/ingest_token missing; storing locally only.")

    loop = CaptureLoop(cfg, storage, store, uploader)

    if cfg.tray_required:
        try:
            run_tray(cfg, storage, store, loop)  # starts loop + blocks on tray
        except Exception as exc:
            logging.error("Tray required but failed to start (%s); refusing to capture.", exc)
            loop.stop()
            return 1
    else:
        loop.start()
        try:
            while loop.is_alive():
                loop.join(timeout=1)
        except KeyboardInterrupt:
            loop.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
