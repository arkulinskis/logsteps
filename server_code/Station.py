"""The scan station: a computer with an NVIDIA GPU running station/logsteps_station.py, which turns frames into 3D
with lingbot-map (github.com/Robbyant/lingbot-map) and sends the result back. It talks to these endpoints with
"Authorization: Bearer <station key>" (the key is made in Admin -> Scan station; only its hash is stored).

    POST _/api/station/claim            {name, gpu, version} -> {job: {...} | null}; also the heartbeat
    GET  _/api/station/frames/<token>   the scan's frames as a zip (000000.jpg, 000001.jpg ...)
    POST _/api/station/progress/<token> {stage, progress 0..1}
    POST _/api/station/part/<token>?kind=cloud|mesh&idx=N   raw bytes of one part of a result file
    POST _/api/station/done/<token>     {files: {cloud: parts, mesh: parts}, stats, path, scale_source, ms}
    POST _/api/station/fail/<token>     {error}
"""
import hashlib
import io
import json
import zipfile

import anvil.server
import anvil.tables as tables
from anvil.tables import app_tables

from . import common as C
from . import Scans

STALE_MINUTES = 30
PART_LIMIT = 8 * 1024 * 1024


# ----------------------------------------------------------------------------------------------- key + helpers
def _hash(key):
    return hashlib.sha256(("logsteps-station|" + key).encode("utf-8")).hexdigest()


def _authorised():
    h = anvil.server.request.headers or {}
    auth = h.get("authorization") or h.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False
    want = (C.get_setting("station_key") or {}).get("hash")
    return bool(want) and _hash(auth[7:].strip()) == want


def _json(data, status=200):
    r = anvil.server.HttpResponse(status, json.dumps(data))
    r.headers["Content-Type"] = "application/json"
    return r


def _denied():
    return _json({"error": "Unknown or missing station key. Make one in Logsteps: Admin -> Scan station."}, 401)


def _body_json():
    try:
        return anvil.server.request.body_json or {}
    except Exception:
        return {}


def _heartbeat(info=None):
    st = dict(C.get_setting("station") or {})
    st["seen"] = C.iso(C.now())
    if info:
        for k in ("name", "gpu", "version"):
            if info.get(k):
                st[k] = C.text(info.get(k), 80)
    C.set_setting("station", st)


def _scan(token):
    if not isinstance(token, str) or len(token) > 40:
        return None
    return app_tables.scans.get(token=token)


def requeue_stale():
    for s in app_tables.scans.search(status="processing"):
        last = s["updated"] or s["claimed_at"]
        if last is None or (C.now() - last).total_seconds() > STALE_MINUTES * 60:
            s.update(status="queued", stage="Back in the queue: the station stopped answering", progress=0)


def job_for(s):
    settings = s["settings"] or {}
    cap = s["capture"] or {}
    return {"token": s["token"], "title": s["title"], "frames": s["frame_count"] or 0, "quality": settings.get("quality") or "balanced",
            "mesh": settings.get("mesh", True) is not False, "portrait": bool(cap.get("portrait"))}


# ----------------------------------------------------------------------------------------------- endpoints
@anvil.server.http_endpoint("/station/claim", methods=["POST"])
def claim(**ignored):
    if not _authorised():
        return _denied()
    _heartbeat(_body_json())
    requeue_stale()
    queued = app_tables.scans.search(tables.order_by("created", ascending=True), status="queued")
    if not len(queued):
        return _json({"job": None})
    s = queued[0]
    st = C.get_setting("station") or {}
    s.update(status="processing", stage="Picked up by %s" % (st.get("name") or "the scan station"), progress=0.01,
             claimed_at=C.now(), updated=C.now(), error="")
    return _json({"job": job_for(s)})


@anvil.server.http_endpoint("/station/frames/:token", methods=["GET"])
def frames(token, **ignored):
    if not _authorised():
        return _denied()
    s = _scan(token)
    if s is None:
        return _json({"error": "No such scan"}, 404)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for f in sorted(app_tables.scan_frames.search(scan=s), key=lambda r: r["idx"]):
            z.writestr("%06d.jpg" % int(f["idx"]), f["image"].get_bytes())
    r = anvil.server.HttpResponse(200, C.blob("application/zip", buf.getvalue(), "frames.zip"))
    r.headers["Content-Type"] = "application/zip"
    return r


@anvil.server.http_endpoint("/station/progress/:token", methods=["POST"])
def progress(token, **ignored):
    if not _authorised():
        return _denied()
    _heartbeat()
    s = _scan(token)
    if s is None or s["status"] != "processing":
        return _json({"ok": False, "cancelled": True})
    b = _body_json()
    try:
        p = max(0.0, min(0.99, float(b.get("progress") or 0)))
    except (TypeError, ValueError):
        p = s["progress"] or 0
    s.update(stage=C.text(b.get("stage"), 120) or s["stage"], progress=p, updated=C.now())
    return _json({"ok": True})


@anvil.server.http_endpoint("/station/part/:token", methods=["POST"])
def part(token, kind=None, idx=None, **ignored):
    if not _authorised():
        return _denied()
    s = _scan(token)
    if s is None or s["status"] != "processing":
        return _json({"ok": False, "cancelled": True}, 409)
    if kind not in ("cloud", "mesh"):
        return _json({"error": "kind must be cloud or mesh"}, 400)
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        return _json({"error": "bad idx"}, 400)
    body = anvil.server.request.body
    data = body.get_bytes() if body is not None else b""
    if not data or len(data) > PART_LIMIT or idx < 0 or idx > 40:
        return _json({"error": "parts must be 1 byte to 8 MB, at most 40 of them"}, 400)
    key = "st:%s:%s" % (token, kind)
    old = app_tables.uploads.get(key=key, idx=idx)
    if old is not None:
        old.delete()
    app_tables.uploads.add_row(owner=None, key=key, idx=idx, data=C.blob("application/octet-stream", data, "part"), created=C.now())
    s["updated"] = C.now()
    return _json({"ok": True})


@anvil.server.http_endpoint("/station/done/:token", methods=["POST"])
def done(token, **ignored):
    if not _authorised():
        return _denied()
    _heartbeat()
    s = _scan(token)
    if s is None or s["status"] != "processing":
        return _json({"ok": False, "cancelled": True}, 409)
    b = _body_json()
    files = b.get("files") or {}
    got = {}
    for kind in ("cloud", "mesh"):
        if files.get(kind):
            try:
                parts = int(files[kind])
            except (TypeError, ValueError):
                return _json({"error": "bad part count"}, 400)
            m = Scans.assemble("st:%s:%s" % (token, kind), parts, "%s.ply" % kind)
            if m is None:
                return _json({"error": "the %s file is incomplete or not a PLY" % kind}, 400)
            got[kind] = m
    if "cloud" not in got:
        return _json({"error": "a point cloud is required"}, 400)
    stats = Scans.clean_stats(b.get("stats"))
    note = "Reconstructed with lingbot-map" + (" (%s)" % C.text(b.get("model"), 40) if b.get("model") else "")
    Scans.add_version(s, s["owner"], "station", note, cloud=got.get("cloud"), mesh=got.get("mesh"), stats=stats)
    try:
        ms = int(b.get("ms") or 0)
    except (TypeError, ValueError):
        ms = 0
    s.update(status="ready", stage="", progress=1, error="", path=Scans.clean_path(b.get("path")), thumb=None,
             scale_source="estimated" if b.get("scale_source") != "calibrated" else "calibrated", process_ms=ms, updated=C.now())
    return _json({"ok": True})


@anvil.server.http_endpoint("/station/fail/:token", methods=["POST"])
def fail(token, **ignored):
    if not _authorised():
        return _denied()
    _heartbeat()
    s = _scan(token)
    if s is None:
        return _json({"ok": False}, 404)
    b = _body_json()
    s.update(status="failed", stage="", progress=0, error=C.text(b.get("error"), 300) or "The scan station couldn't process this scan.",
             updated=C.now())
    for kind in ("cloud", "mesh"):  # parts of a result that will never be finished
        for r in app_tables.uploads.search(key="st:%s:%s" % (token, kind)):
            r.delete()
    return _json({"ok": True})


# ----------------------------------------------------------------------------------------------- admin
def _job_row(s):
    return {"id": s.get_id(), "title": s["title"], "owner": C.name_of(s["owner"]), "status": s["status"], "stage": s["stage"] or "",
            "progress": s["progress"] or 0, "frames": s["frame_count"] or 0, "created": C.iso(s["created"]),
            "updated": C.iso(s["updated"]), "error": s["error"] or "", "ms": s["process_ms"]}


@anvil.server.callable(require_user=True)
def station_info():
    C.require_admin()
    key = C.get_setting("station_key") or {}
    jobs = [s for s in app_tables.scans.search(tables.order_by("updated", ascending=False)) if s["status"] in ("queued", "processing", "failed")]
    done_rows = [s for s in app_tables.scans.search(tables.order_by("updated", ascending=False), status="ready") if s["process_ms"]][:8]
    times = [s["process_ms"] for s in done_rows]
    return {"station": Scans.station_state(), "has_key": bool(key.get("hash")), "key_hint": key.get("hint") or "",
            "key_made": key.get("made"), "jobs": [_job_row(s) for s in jobs[:50]], "recent": [_job_row(s) for s in done_rows],
            "avg_ms": int(sum(times) / len(times)) if times else None, "endpoint": "_/api/station"}


@anvil.server.callable(require_user=True)
def station_new_key():
    """A new station key. Shown once; the old key stops working."""
    me = C.require_admin()
    key = "lsk_" + C.new_token(24)
    C.set_setting("station_key", {"hash": _hash(key), "hint": key[:8] + "…" + key[-4:], "made": C.iso(C.now()), "by": C.name_of(me)})
    return C.ok(key=key)


@anvil.server.callable(require_user=True)
def station_requeue(scan_id):
    C.require_admin()
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return C.fail("That scan doesn't exist any more.")
    if not app_tables.scan_frames.search(scan=s):
        return C.fail("This scan has no frames to process.")
    s.update(status="queued", stage="Waiting for the scan station", progress=0, error="", updated=C.now())
    return C.ok()


@anvil.server.callable(require_user=True)
def station_cancel(scan_id):
    C.require_admin()
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return C.fail("That scan doesn't exist any more.")
    if s["status"] not in ("queued", "processing"):
        return C.fail("That scan isn't waiting or processing.")
    s.update(status="failed", stage="", progress=0, error="Stopped by an admin.", updated=C.now())
    return C.ok()
