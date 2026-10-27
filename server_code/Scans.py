"""Scans: a member's rooms. Capture (frames in), status, the scan page, versions, sharing settings, uploads.

Life of a scan (scans.status):
  capturing  the browser is sending frames (create_scan -> add_frames ... -> finish_capture)
  queued     waiting for the scan station (server_code/Station.py), which runs lingbot-map on a GPU
  processing the station has it; stage + progress say where it is
  ready      it has a current version (scan_versions: cloud = points, mesh = optional surface)
  failed     the station gave up (error says why); reprocess() queues it again if the frames are still there

Files never travel through server calls as Media: the pages get signed links to Files.py (C.ticket).
"""
import anvil.server
import anvil.tables as tables
from anvil.tables import app_tables

from . import common as C
from . import DemoData

MAX_FRAMES = 600
MAX_FRAME_BYTES = 700 * 1024
MAX_PART_BYTES = 900 * 1024        # one upload part (base64 from the browser is about 1.2 MB)
MAX_MODEL_BYTES = 80 * 1024 * 1024
QUALITY = {"fast": "Fast", "balanced": "Balanced", "detailed": "Detailed"}
STATION_ONLINE_SECONDS = 150


# ----------------------------------------------------------------------------------------------- shared views
def file_url(scan, what, extra=""):
    return "_/api/file/%s/%s?t=%s%s" % (scan["token"], what, C.ticket(scan["token"]), extra)


def version_urls(scan, v):
    if v is None:
        return None, None
    cloud = ("_/theme/" + v["asset"]) if v["asset"] else (file_url(scan, "cloud", "&v=%d" % v["n"]) if v["cloud"] else None)
    mesh = ("_/theme/" + v["mesh_asset"]) if v["mesh_asset"] else (file_url(scan, "mesh", "&v=%d" % v["n"]) if v["mesh"] else None)
    return cloud, mesh


def thumb_url(scan):
    if scan["thumb"] is not None:
        return file_url(scan, "thumb", "&h=" + C.stamp(scan["updated"]))
    if scan["thumb_asset"]:
        return "_/theme/" + scan["thumb_asset"]
    return None


def cover_url(scan):
    return file_url(scan, "cover") if scan["cover"] is not None else None


def station_state():
    st = C.get_setting("station") or {}
    seen = st.get("seen")
    online = False
    if seen:
        try:
            import datetime as dt
            online = (C.now() - dt.datetime.fromisoformat(seen)).total_seconds() < STATION_ONLINE_SECONDS
        except Exception:
            online = False
    return {"online": online, "seen": seen, "name": st.get("name") or "", "gpu": st.get("gpu") or "",
            "queue": len(app_tables.scans.search(status="queued")), "busy": len(app_tables.scans.search(status="processing"))}


def card(scan, me=None):
    v = scan["current"]
    stats = (v["stats"] if v is not None else None) or {}
    return {"id": scan.get_id(), "token": scan["token"], "title": scan["title"], "room": scan["room"] or "other",
            "room_label": C.ROOMS.get(scan["room"] or "other", "Other"), "status": scan["status"], "stage": scan["stage"] or "",
            "progress": scan["progress"] or 0, "visibility": scan["visibility"] or "private", "source": scan["source"] or "capture",
            "created": C.iso(scan["created"]), "updated": C.iso(scan["updated"]), "frames": scan["frame_count"] or 0,
            "points": stats.get("points") or 0, "faces": stats.get("faces") or 0, "size": stats.get("size"),
            "area": stats.get("area"), "has_mesh": bool(v is not None and (v["mesh"] or v["mesh_asset"])),
            "thumb": thumb_url(scan), "cover": cover_url(scan), "hearts": scan["hearts"] or 0, "views": scan["views"] or 0,
            "author": C.name_of(scan["owner"]), "demo": bool(scan["is_demo"]),
            "mine": me is not None and scan["owner"] == me}


def versions_of(scan):
    return list(app_tables.scan_versions.search(tables.order_by("n", ascending=False), scan=scan))


def detail(scan, me, shared=False):
    d = card(scan, me)
    v = scan["current"]
    cloud, mesh = version_urls(scan, v)
    can_edit = me is not None and (scan["owner"] == me or (C.is_admin(me) and not shared))
    d.update({"notes": scan["notes"] or "", "error": scan["error"] or "", "path": scan["path"] or [],
              "annotations": scan["annotations"] or [], "scale_source": scan["scale_source"] or "estimated",
              "settings": scan["settings"] or {}, "process_ms": scan["process_ms"], "can_edit": bool(can_edit),
              "model": {"cloud": cloud, "mesh": mesh, "n": v["n"] if v is not None else None,
                        "stats": (v["stats"] if v is not None else None) or {}},
              "frames_url": file_url(scan, "frame") if (scan["frame_count"] or 0) and (can_edit or not shared or scan["visibility"] != "private") else None,
              "capture": scan["capture"] or {}})
    if can_edit and not shared:
        d["versions"] = [{"n": x["n"], "source": x["source"], "note": x["note"] or "", "created": C.iso(x["created"]),
                          "author": C.name_of(x["author"]), "stats": x["stats"] or {}, "current": v is not None and x == v,
                          "has_mesh": bool(x["mesh"] or x["mesh_asset"])} for x in versions_of(scan)]
        d["share_url_part"] = "#s/" + scan["token"]
    if scan["status"] in ("queued", "processing"):
        d["station"] = station_state()
        if scan["status"] == "queued":
            ahead = [s for s in app_tables.scans.search(status="queued") if s["created"] and scan["created"] and s["created"] < scan["created"]]
            d["queue_position"] = len(ahead) + 1
    return d


def own_scan(scan_id, me, allow_admin=True):
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return None
    if s["owner"] == me or (allow_admin and C.is_admin(me)):
        return s
    return None


def touch(scan):
    scan["updated"] = C.now()


# ----------------------------------------------------------------------------------------------- the library
@anvil.server.callable(require_user=True)
def get_library():
    me = C.require_user()
    DemoData.ensure_loaded()
    added = False
    if not me["samples_given"] and not me["is_demo"]:
        DemoData.give_sample(me)
        added = True
    rows = app_tables.scans.search(tables.order_by("updated", ascending=False), owner=me)
    scans = [card(s, me) for s in rows]
    totals = {"scans": len(scans), "ready": len([s for s in scans if s["status"] == "ready"]),
              "points": sum(s["points"] for s in scans), "shared": len([s for s in scans if s["visibility"] != "private"])}
    return {"scans": scans, "totals": totals, "station": station_state(), "sample_added": added, "rooms": C.ROOMS}


@anvil.server.callable(require_user=True)
def poll_scans(ids):
    """Status of scans that are still on their way (the library and scan page poll this quietly)."""
    me = C.require_user()
    out = {}
    for sid in (ids or [])[:40]:
        s = own_scan(sid, me)
        if s is not None:
            out[sid] = {"status": s["status"], "stage": s["stage"] or "", "progress": s["progress"] or 0, "error": s["error"] or ""}
    return {"scans": out, "station": station_state()}


# ----------------------------------------------------------------------------------------------- capture
@anvil.server.callable(require_user=True)
def create_scan(title, room, source="capture", settings=None):
    me = C.require_user()
    title = C.text(title, 80) or "Untitled room"
    room = room if room in C.ROOMS else "other"
    source = source if source in ("capture", "video") else "capture"
    settings = settings or {}
    quality = settings.get("quality") if settings.get("quality") in QUALITY else "balanced"
    if C.rate_limited("create_scan", 30, 3600):
        return C.fail("That's a lot of scans in one hour. Take a break and try again a bit later.")
    stale = [s for s in app_tables.scans.search(owner=me, status="capturing")
             if s["created"] and (C.now() - s["created"]).total_seconds() > 86400]
    for s in stale:  # captures that never finished uploading, a day later
        _delete(s)
    s = app_tables.scans.add_row(owner=me, title=title, room=room, notes="", status="capturing", stage="Uploading", progress=0,
                                 visibility="private", token=C.new_token(), source=source,
                                 settings={"quality": quality, "mesh": settings.get("mesh", True) is not False},
                                 created=C.now(), updated=C.now(), frame_count=0, views=0, hearts=0, annotations=[], is_demo=False)
    return C.ok(scan=card(s, me))


@anvil.server.callable(require_user=True)
def add_frames(scan_id, start, frames):
    """frames: base64 JPEGs, in order, starting at frame number `start`."""
    me = C.require_user()
    s = own_scan(scan_id, me, allow_admin=False)
    if s is None:
        return C.fail("That scan doesn't exist any more.")
    if s["status"] != "capturing":
        return C.fail("This scan has already been sent for processing.")
    if not isinstance(frames, list) or not frames or len(frames) > 12:
        return C.fail("Send between 1 and 12 frames at a time.")
    try:
        start = int(start)
    except (TypeError, ValueError):
        return C.fail("Bad frame number.")
    if start < 0 or start + len(frames) > MAX_FRAMES:
        return C.fail("A scan can have up to %d frames." % MAX_FRAMES)
    for i, f in enumerate(frames):
        data = C.b64bytes(f, MAX_FRAME_BYTES)
        if data is None or not data.startswith(b"\xff\xd8"):
            return C.fail("Frame %d isn't a JPEG picture (or it is too big)." % (start + i + 1))
        idx = start + i
        old = app_tables.scan_frames.get(scan=s, idx=idx)
        if old is not None:  # a retried batch
            old.delete()
        app_tables.scan_frames.add_row(scan=s, idx=idx, image=C.blob("image/jpeg", data, "frame-%04d.jpg" % idx), is_demo=False)
    s["frame_count"] = len(app_tables.scan_frames.search(scan=s))
    s["progress"] = 0
    touch(s)
    return C.ok(count=s["frame_count"])


@anvil.server.callable(require_user=True)
def finish_capture(scan_id, info=None):
    me = C.require_user()
    s = own_scan(scan_id, me, allow_admin=False)
    if s is None:
        return C.fail("That scan doesn't exist any more.")
    if s["status"] != "capturing":
        return C.ok(scan=card(s, me))
    n = len(app_tables.scan_frames.search(scan=s))
    if n < 12:
        return C.fail("A room needs at least 12 sharp frames. Walk a little longer, slowly.")
    info = info if isinstance(info, dict) else {}
    s["capture"] = {"seconds": min(int(info.get("seconds") or 0), 3600), "skipped": min(int(info.get("skipped") or 0), 100000),
                    "portrait": bool(info.get("portrait")), "width": int(info.get("width") or 0), "height": int(info.get("height") or 0),
                    "motion": bool(info.get("motion"))}
    middle = app_tables.scan_frames.get(scan=s, idx=n // 3) or app_tables.scan_frames.search(scan=s)[0]
    s.update(frame_count=n, cover=middle["image"], status="queued", stage="Waiting for the scan station", progress=0, error="")
    touch(s)
    return C.ok(scan=card(s, me))


# ----------------------------------------------------------------------------------------------- the scan page
@anvil.server.callable(require_user=True)
def get_scan(scan_id):
    me = C.require_user()
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return C.fail("This scan doesn't exist any more.")
    if s["owner"] != me and not C.is_admin(me):
        if s["visibility"] in ("link", "public"):
            return C.ok(scan=detail(s, me, shared=True), redirect="#s/" + s["token"])
        return C.fail("This scan is private.")
    return C.ok(scan=detail(s, me))


@anvil.server.callable(require_user=True)
def update_scan(scan_id, changes):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    changes = changes if isinstance(changes, dict) else {}
    if "title" in changes:
        t = C.text(changes["title"], 80)
        if len(t) < 2:
            return C.fail("Give the room a name (at least 2 characters).")
        s["title"] = t
    if "room" in changes:
        s["room"] = changes["room"] if changes["room"] in C.ROOMS else "other"
    if "notes" in changes:
        s["notes"] = C.text(changes["notes"], 2000, multiline=True)
    if "visibility" in changes:
        if changes["visibility"] not in C.VISIBILITY:
            return C.fail("Choose private, link or public.")
        if changes["visibility"] != "private" and s["status"] != "ready":
            return C.fail("You can share a scan once its 3D model is ready.")
        s["visibility"] = changes["visibility"]
    touch(s)
    return C.ok(scan=detail(s, me))


@anvil.server.callable(require_user=True)
def reset_link(scan_id):
    """A new share link; the old one stops working."""
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    s["token"] = C.new_token()
    touch(s)
    return C.ok(scan=detail(s, me))


def _delete(s):
    for t in (app_tables.hearts, app_tables.scan_frames):
        for r in t.search(scan=s):
            r.delete()
    s["current"] = None
    for v in app_tables.scan_versions.search(scan=s):
        v.delete()
    s.delete()


@anvil.server.callable(require_user=True)
def delete_scan(scan_id):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.ok()
    _delete(s)
    return C.ok()


@anvil.server.callable(require_user=True)
def delete_footage(scan_id):
    """Remove the captured frames (the 3D model stays). Frees space; replay then has no picture-in-picture."""
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    if s["status"] in ("queued", "processing", "capturing"):
        return C.fail("Wait until the scan is processed.")
    for r in app_tables.scan_frames.search(scan=s):
        r.delete()
    s.update(frame_count=0)
    touch(s)
    return C.ok(scan=detail(s, me))


@anvil.server.callable(require_user=True)
def reprocess(scan_id, settings=None):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    if s["status"] in ("queued", "processing", "capturing"):
        return C.fail("This scan is already on its way.")
    if not app_tables.scan_frames.search(scan=s):
        return C.fail("The original footage was deleted, so this scan can't be processed again.")
    settings = settings if isinstance(settings, dict) else {}
    cur = dict(s["settings"] or {})
    if settings.get("quality") in QUALITY:
        cur["quality"] = settings["quality"]
    if "mesh" in settings:
        cur["mesh"] = bool(settings["mesh"])
    s.update(status="queued", stage="Waiting for the scan station", progress=0, error="", settings=cur)
    touch(s)
    return C.ok(scan=detail(s, me))


@anvil.server.callable(require_user=True)
def set_thumb(scan_id, image):
    """The 3D preview picture for cards (the browser renders it the first time the owner opens a ready scan)."""
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    data = C.b64bytes(image, 400 * 1024)
    if data is None or not (data.startswith(b"\xff\xd8") or data.startswith(b"\x89PNG")):
        return C.fail("That picture isn't a JPEG or PNG (or it is too big).")
    kind = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
    s["thumb"] = C.blob(kind, data, "thumb." + ("png" if kind == "image/png" else "jpg"))
    touch(s)
    return C.ok(thumb=thumb_url(s))


def clean_annotations(items):
    out = []
    for a in (items if isinstance(items, list) else [])[:60]:
        if not isinstance(a, dict):
            continue
        try:
            p = [round(float(x), 4) for x in (a.get("p") or [])[:3]]
        except (TypeError, ValueError):
            continue
        if len(p) != 3 or any(abs(x) > 10000 for x in p):
            continue
        label = C.text(a.get("label"), 60)
        if not label:
            continue
        color = a.get("color") if a.get("color") in ("brand", "accent", "ink", "gold") else "brand"
        out.append({"p": p, "label": label, "note": C.text(a.get("note"), 300, multiline=True), "color": color})
    return out


def clean_path(path):
    out = []
    for e in (path if isinstance(path, list) else [])[:2000]:
        try:
            vals = [round(float(x), 4) for x in e[:6]] + [int(e[6]) if len(e) > 6 else len(out)]
        except (TypeError, ValueError, IndexError):
            continue
        if len(vals) == 7 and all(abs(x) < 100000 for x in vals[:6]):
            out.append(vals)
    return out


@anvil.server.callable(require_user=True)
def save_annotations(scan_id, items):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    s["annotations"] = clean_annotations(items)
    touch(s)
    return C.ok(annotations=s["annotations"])


# ----------------------------------------------------------------------------------------------- versions
@anvil.server.callable(require_user=True)
def set_current_version(scan_id, n):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    v = app_tables.scan_versions.get(scan=s, n=n) if isinstance(n, (int, float)) else None
    if v is None:
        return C.fail("That version doesn't exist.")
    s["current"] = v
    s["thumb"] = None  # redrawn from this version next time the owner opens it
    touch(s)
    return C.ok(scan=detail(s, me))


@anvil.server.callable(require_user=True)
def delete_version(scan_id, n):
    me = C.require_user()
    s = own_scan(scan_id, me)
    if s is None:
        return C.fail("You can only change your own scans.")
    v = app_tables.scan_versions.get(scan=s, n=n) if isinstance(n, (int, float)) else None
    if v is None:
        return C.ok(scan=detail(s, me))
    if s["current"] == v:
        return C.fail("That's the version in use. Switch to another one first.")
    v.delete()
    touch(s)
    return C.ok(scan=detail(s, me))


def add_version(scan, author, source, note, cloud=None, mesh=None, asset=None, mesh_asset=None, stats=None):
    last = app_tables.scan_versions.search(tables.order_by("n", ascending=False), scan=scan)
    n = (last[0]["n"] + 1) if len(last) else 1
    v = app_tables.scan_versions.add_row(scan=scan, n=n, source=source, note=note or "", cloud=cloud, mesh=mesh, asset=asset,
                                         mesh_asset=mesh_asset, stats=stats or {}, author=author, created=C.now(),
                                         is_demo=bool(scan["is_demo"]))
    scan["current"] = v
    return v


def clean_stats(st):
    st = st if isinstance(st, dict) else {}
    out = {}
    for k in ("points", "faces"):
        try:
            out[k] = max(0, int(st.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    try:
        size = [round(float(x), 3) for x in (st.get("size") or [])[:3]]
        if len(size) == 3:
            out["size"] = size
    except (TypeError, ValueError):
        pass
    try:
        if st.get("area") is not None:
            out["area"] = round(float(st["area"]), 2)
    except (TypeError, ValueError):
        pass
    return out


# ----------------------------------------------------------------------------------------------- uploads (Studio saves, imports)
@anvil.server.callable(require_user=True)
def upload_begin(kind):
    me = C.require_user()
    if kind not in ("cloud", "mesh"):
        return C.fail("Unknown file kind.")
    if C.rate_limited("upload_begin", 40, 3600):
        return C.fail("That's a lot of uploads in one hour. Try again later.")
    old = [r for r in app_tables.uploads.search(owner=me) if r["created"] and (C.now() - r["created"]).total_seconds() > 6 * 3600]
    for r in old:
        r.delete()
    return C.ok(key="u:%s:%s:%s" % (me.get_id(), kind, C.new_token(9)))


def _key_owner_ok(key, me):
    return isinstance(key, str) and key.startswith("u:%s:" % me.get_id())


@anvil.server.callable(require_user=True)
def upload_part(key, idx, data):
    me = C.require_user()
    if not _key_owner_ok(key, me):
        return C.fail("That upload isn't yours.")
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        return C.fail("Bad part number.")
    if idx < 0 or idx > MAX_MODEL_BYTES // MAX_PART_BYTES + 1:
        return C.fail("That file is too big (the limit is %d MB)." % (MAX_MODEL_BYTES // (1024 * 1024)))
    raw = C.b64bytes(data, MAX_PART_BYTES)
    if raw is None:
        return C.fail("That part didn't arrive whole. Try again.")
    old = app_tables.uploads.get(key=key, idx=idx)
    if old is not None:
        old.delete()
    app_tables.uploads.add_row(owner=me, key=key, idx=idx, data=C.blob("application/octet-stream", raw, "part"), created=C.now())
    return C.ok(idx=idx)


def assemble(key, parts, name):
    """Join an upload's parts into one PLY file; None if parts are missing or it isn't a PLY."""
    rows = sorted(app_tables.uploads.search(key=key), key=lambda r: r["idx"])
    if not rows or len(rows) != parts or [r["idx"] for r in rows] != list(range(parts)):
        return None
    data = b"".join(r["data"].get_bytes() for r in rows)
    for r in rows:
        r.delete()
    if not data.startswith(b"ply") or len(data) > MAX_MODEL_BYTES:
        return None
    return C.blob("application/octet-stream", data, name)


@anvil.server.callable(require_user=True)
def upload_finish(target):
    """target: {scan_id (or none for an import), title, room, note, cloud: [key, parts], mesh: [key, parts] or None,
    stats, annotations, path, scale_source}. Makes a new version (and a new scan for an import)."""
    me = C.require_user()
    target = target if isinstance(target, dict) else {}
    files = {}
    for kind in ("cloud", "mesh"):
        spec = target.get(kind)
        if not spec:
            continue
        try:
            key, parts = spec[0], int(spec[1])
        except (TypeError, ValueError, IndexError):
            return C.fail("Bad upload.")
        if not _key_owner_ok(key, me) or (":%s:" % kind) not in key:
            return C.fail("That upload isn't yours.")
        m = assemble(key, parts, "%s.ply" % kind)
        if m is None:
            return C.fail("The %s file didn't arrive whole, or it isn't a PLY file. Please try again." % ("point" if kind == "cloud" else "mesh"))
        files[kind] = m
    if "cloud" not in files and "mesh" not in files:
        return C.fail("Nothing to save.")
    stats = clean_stats(target.get("stats"))
    if target.get("scan_id"):
        s = own_scan(target.get("scan_id"), me)
        if s is None:
            return C.fail("You can only save your own scans.")
        source, note = "studio", C.text(target.get("note"), 120) or "Edited in Studio"
    else:
        if C.rate_limited("import", 20, 3600):
            return C.fail("That's a lot of imports in one hour. Try again later.")
        room = target.get("room") if target.get("room") in C.ROOMS else "other"
        s = app_tables.scans.add_row(owner=me, title=C.text(target.get("title"), 80) or "Imported room", room=room, notes="",
                                     status="ready", stage="", progress=1, visibility="private", token=C.new_token(), source="import",
                                     settings={}, created=C.now(), updated=C.now(), frame_count=0, views=0, hearts=0,
                                     annotations=[], scale_source="import", is_demo=False)
        source, note = "import", C.text(target.get("note"), 120) or "Imported file"
    add_version(s, me, source, note, cloud=files.get("cloud"), mesh=files.get("mesh"), stats=stats)
    if "annotations" in target:
        s["annotations"] = clean_annotations(target.get("annotations"))
    if "path" in target and target.get("path") is not None:
        s["path"] = clean_path(target.get("path"))
    if target.get("scale_source") in ("estimated", "calibrated", "import", "demo"):
        s["scale_source"] = target["scale_source"]
    s.update(status="ready", stage="", progress=1, thumb=None)
    touch(s)
    return C.ok(scan=detail(s, me))
