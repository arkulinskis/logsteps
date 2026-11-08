"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python -I tools/testing/test_server.py          -> prints ALL OK, or the first failure

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- demo data + samples
import base64  # noqa: E402
import io  # noqa: E402
import zipfile  # noqa: E402

as_user(None)
ex = call("list_explore")
assert M["DemoData"].state() == "loaded", "demo loads on first visit"
assert ex["total"] == 4 and all(c["status"] == "ready" for c in ex["scans"]), "4 public demo scans (the bedroom is link-only)"
assert ex["scans"][0]["thumb"].startswith("_/theme/demo-"), "demo scans use asset thumbnails"
assert len(call("list_explore", {"room": "kitchen"})["scans"]) == 1
assert len(call("list_explore", {"q": "maya"})["scans"]) == 2, "search finds the author"
assert call("list_explore", {"sort": "viewed"})["scans"][0]["title"] == "Studio gallery hallway"
assert call("list_explore", {"sort": "loved"})["scans"][0]["hearts"] == 4
assert denied("get_library")

as_user(ana)
lib = call("get_library")
assert lib["sample_added"] and len(lib["scans"]) == 1 and lib["scans"][0]["source"] == "sample", "a new member gets one sample scan"
assert call("get_library")["sample_added"] is False and len(call("get_library")["scans"]) == 1, "only once"
sample = lib["scans"][0]
assert sample["mine"] and sample["visibility"] == "private" and sample["points"] > 1000
d = ok(call("get_scan", sample["id"]))["scan"]
assert d["model"]["cloud"] == "_/theme/demo-loft.ply" and d["can_edit"] and len(d["versions"]) == 1 and d["path"]
assert d["annotations"] and d["share_url_part"].startswith("#s/")
assert not lib["station"]["online"], "no station has called in yet"

# ---------------------------------------------------------------------------------- capture -> queue
JPEG = b"\xff\xd8\xff\xe0" + b"x" * 300
B64 = base64.b64encode(JPEG).decode()
sc = ok(call("create_scan", "  Living   room ", "living", "capture", {"quality": "fast"}))["scan"]
assert sc["status"] == "capturing" and sc["title"] == "Living room"
assert ok(call("create_scan", "x", "nonsense"))["scan"]["room"] == "other", "unknown rooms become other"
bad(call("add_frames", sc["id"], 0, []))
bad(call("add_frames", sc["id"], 0, ["not base64!"]))
bad(call("add_frames", sc["id"], 0, [base64.b64encode(b"GIF89a").decode()]), "only JPEGs")
bad(call("add_frames", sc["id"], 595, [B64] * 10), "frame cap")
for i in range(0, 12, 6):
    assert ok(call("add_frames", sc["id"], i, [B64] * 6))["count"] == i + 6
assert ok(call("add_frames", sc["id"], 6, [B64] * 6))["count"] == 12, "a retried batch replaces, it doesn't double"
as_user(bob)
bad(call("add_frames", sc["id"], 12, [B64]), "only the owner adds frames")
bad(call("finish_capture", sc["id"]))
as_user(ana)
small = ok(call("create_scan", "Tiny", "office"))["scan"]
ok(call("add_frames", small["id"], 0, [B64] * 5))
bad(call("finish_capture", small["id"]), "needs 12 frames")
done_ = ok(call("finish_capture", sc["id"], {"seconds": 40, "portrait": True, "width": 720, "height": 1280}))["scan"]
assert done_["status"] == "queued" and done_["cover"], "queued, with a cover picture"
bad(call("add_frames", sc["id"], 12, [B64]), "no frames after finishing")
bad(call("update_scan", sc["id"], {"visibility": "public"}), "can't share before it's ready")
pol = call("poll_scans", [sc["id"], small["id"], "nope"])
assert pol["scans"][sc["id"]]["status"] == "queued" and "nope" not in pol["scans"]
assert ok(call("get_scan", sc["id"]))["scan"]["queue_position"] == 1

# ---------------------------------------------------------------------------------- the scan station (http endpoints)
run = anvil.server.run_endpoint
assert run("POST", "/station/claim", {}, b"{}")[0] == 401, "no key, no entry"
as_user(admin)
key = ok(call("station_new_key"))["key"]
assert key.startswith("lsk_") and call("station_info")["has_key"]
AUTH = {"Authorization": "Bearer " + key}
assert run("POST", "/station/claim", {"Authorization": "Bearer wrong"}, b"{}")[0] == 401
assert run("GET", "/station/claim", AUTH, None)[0] == 405, "claim is POST only"
st, body, _ = run("POST", "/station/claim", AUTH, json.dumps({"name": "test-rig", "gpu": "RTX"}).encode())
job = json.loads(body)["job"]
assert st == 200 and job["token"] == done_["token"] and job["frames"] == 12 and job["quality"] == "fast" and job["portrait"] is True
assert json.loads(run("POST", "/station/claim", AUTH, b"{}")[1])["job"] is None, "nothing else waiting"
as_user(ana)
assert call("get_library")["station"]["online"], "the claim counts as a heartbeat"
assert call("poll_scans", [sc["id"]])["scans"][sc["id"]]["status"] == "processing"
tok = job["token"]
st, z, hd = run("GET", "/station/frames/" + tok, AUTH, None)
names = zipfile.ZipFile(io.BytesIO(z.get_bytes())).namelist()
assert st == 200 and names[0] == "000000.jpg" and len(names) == 12
run("POST", "/station/progress/" + tok, AUTH, json.dumps({"stage": "Reconstructing 6 / 12", "progress": 0.5}).encode())
assert call("poll_scans", [sc["id"]])["scans"][sc["id"]]["stage"] == "Reconstructing 6 / 12"
PLY = b"ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n" + b"\0" * 4
assert run("POST", "/station/part/" + tok, AUTH, PLY[:30], {"kind": "nope", "idx": "0"})[0] == 400
run("POST", "/station/part/" + tok, AUTH, PLY[:30], {"kind": "cloud", "idx": "0"})
assert run("POST", "/station/done/" + tok, AUTH, json.dumps({"files": {"cloud": 2}}).encode())[0] == 400, "a missing part is caught"
run("POST", "/station/part/" + tok, AUTH, PLY[30:], {"kind": "cloud", "idx": "1"})
run("POST", "/station/part/" + tok, AUTH, PLY, {"kind": "mesh", "idx": "0"})
st, body, _ = run("POST", "/station/done/" + tok, AUTH, json.dumps({"files": {"cloud": 2, "mesh": 1}, "ms": 61000, "model": "lingbot-map.pt",
                  "stats": {"points": 1, "faces": 0, "size": [4, 3, 2.5], "area": 12}, "path": [[0, 1.4, 0, 1, 0, 0, 0], ["bad"]]}).encode())
assert st == 200, body
as_user(ana)
d = ok(call("get_scan", sc["id"]))["scan"]
assert d["status"] == "ready" and d["model"]["cloud"].startswith("_/api/file/") and d["model"]["mesh"] and d["has_mesh"]
assert d["path"] == [[0, 1.4, 0, 1, 0, 0, 0]] and d["size"] == [4, 3, 2.5] and d["process_ms"] == 61000
assert not T.uploads.search(), "parts are cleaned up"
assert "cancelled" in run("POST", "/station/progress/" + tok, AUTH, b"{}")[1], "a finished scan can't be changed by the station"

# ---------------------------------------------------------------------------------- signed file links
url = d["model"]["cloud"]
path_, qs = url[len("_/api"):].split("?")
q = dict(x.split("=") for x in qs.split("&"))
st, body, hd = run("GET", path_, {}, None, q)
assert st == 200 and body.get_bytes() == PLY and "max-age" in hd["Cache-Control"]
assert run("GET", path_, {}, None, dict(q, t="123.forged"))[0] == 403, "forged ticket"
assert run("GET", path_, {}, None, dict(q, t="1." + q["t"].split(".")[1]))[0] == 403, "expired ticket"
assert run("GET", path_.replace("/cloud", "/frame"), {}, None, dict(q, i="3"))[0] == 200
assert run("GET", path_.replace("/cloud", "/frame"), {}, None, dict(q, i="99"))[0] == 404
assert run("GET", path_.replace("/cloud", "/cover"), {}, None, q)[0] == 200
assert run("GET", path_.replace("/cloud", "/secret"), {}, None, q)[0] == 404

# ---------------------------------------------------------------------------------- station failure + requeue
bad_scan = ok(call("create_scan", "Dark cellar", "other"))["scan"]
ok(call("add_frames", bad_scan["id"], 0, [B64] * 12))
ok(call("finish_capture", bad_scan["id"]))
t2 = json.loads(run("POST", "/station/claim", AUTH, b"{}")[1])["job"]["token"]
run("POST", "/station/fail/" + t2, AUTH, json.dumps({"error": "Not enough light"}).encode())
assert call("get_scan", bad_scan["id"])["scan"]["error"] == "Not enough light"
assert ok(call("reprocess", bad_scan["id"], {"quality": "detailed"}))["scan"]["status"] == "queued"
bad(call("reprocess", bad_scan["id"]), "already queued")
t3 = json.loads(run("POST", "/station/claim", AUTH, b"{}")[1])["job"]
assert t3["quality"] == "detailed"
T.scans.get(token=t3["token"])["updated"] = now - dt.timedelta(hours=2)
json.loads(run("POST", "/station/claim", AUTH, b"{}")[1])
assert T.scans.get(token=t3["token"])["status"] == "processing", "a stale job goes back to the queue and is picked up again"
as_user(ana)
assert denied("station_info") and denied("station_new_key") and denied("station_requeue", bad_scan["id"])
as_user(admin)
info = call("station_info")
assert info["station"]["name"] == "test-rig" and any(j["title"] == "Dark cellar" for j in info["jobs"])
ok(call("station_cancel", bad_scan["id"]))
assert T.scans.get_by_id(bad_scan["id"])["status"] == "failed"
ok(call("station_requeue", bad_scan["id"]))
bad(call("station_requeue", sample["id"]), "samples have no frames")

# ---------------------------------------------------------------------------------- editing, sharing, hearts, remix
as_user(bob)
bad(call("get_scan", sc["id"]), "private scans stay private")
bad(call("update_scan", sc["id"], {"title": "Mine now"}))
as_user(ana)
bad(call("update_scan", sc["id"], {"title": "x"}))
bad(call("update_scan", sc["id"], {"visibility": "everyone"}))
d = ok(call("update_scan", sc["id"], {"title": "Front room", "room": "living", "notes": "Line one\n\n\n\nLine two", "visibility": "link"}))["scan"]
assert d["title"] == "Front room" and d["notes"] == "Line one\n\nLine two" and d["visibility"] == "link"
ann = ok(call("save_annotations", sc["id"], [{"p": [1, 2, 3], "label": "Sofa", "color": "gold"}, {"p": [1, 2], "label": "bad"},
                                             {"p": [0, 0, 0], "label": ""}, "junk"]))
assert ann["annotations"] == [{"p": [1.0, 2.0, 3.0], "label": "Sofa", "note": "", "color": "gold"}]
th = base64.b64encode(b"\x89PNG\r\n" + b"0" * 100).decode()
assert ok(call("set_thumb", sc["id"], "data:image/png;base64," + th))["thumb"].startswith("_/api/file/")
bad(call("set_thumb", sc["id"], base64.b64encode(b"<svg>").decode()))
as_user(bob)
bad(call("set_thumb", sc["id"], th), "only the owner sets the picture")
shared = ok(call("get_shared", d["token"]))["scan"]
assert shared["title"] == "Front room" and not shared["can_edit"] and "versions" not in shared and shared["views"] == 1
call("get_shared", d["token"])
assert T.scans.get_by_id(sc["id"])["views"] == 1, "one view per visitor"
redirect = ok(call("get_scan", sc["id"]))
assert redirect["redirect"] == "#s/" + d["token"], "a shared scan opened by id sends others to the share view"
assert ok(call("toggle_heart", d["token"]))["hearts"] == 1
assert ok(call("toggle_heart", d["token"]))["hearted"] is False
ok(call("toggle_heart", d["token"]))
copy = ok(call("remix", d["token"]))["scan_id"]
cd = ok(call("get_scan", copy))["scan"]
assert cd["mine"] and cd["visibility"] == "private" and cd["source"] == "remix" and cd["model"]["cloud"].startswith("_/api/file/")
as_user(None)
assert ok(call("get_shared", d["token"]))["scan"]["hearts"] == 1, "signed-out visitors can open a link"
assert denied("toggle_heart", d["token"]) and denied("remix", d["token"])
bad(call("get_shared", "nope"))
bad(call("get_shared", sample["token"]), "private scans have no share view")
as_user(ana)
old_token = d["token"]
new_token = ok(call("reset_link", sc["id"]))["scan"]["token"]
assert new_token != old_token
as_user(None)
bad(call("get_shared", old_token), "the old link stops working")
assert ok(call("get_shared", new_token))
as_user(ana)
ok(call("update_scan", sc["id"], {"visibility": "public"}))
as_user(None)
assert any(c["title"] == "Front room" for c in call("list_explore")["scans"])

# ---------------------------------------------------------------------------------- versions + uploads (Studio, import)
as_user(ana)
bad(call("upload_begin", "pdf"))
k1 = ok(call("upload_begin", "cloud"))["key"]
ok(call("upload_part", k1, 0, base64.b64encode(PLY[:20]).decode()))
ok(call("upload_part", k1, 1, base64.b64encode(PLY[20:]).decode()))
as_user(bob)
bad(call("upload_part", k1, 2, base64.b64encode(PLY).decode()), "someone else's upload key")
bad(call("upload_finish", {"scan_id": sc["id"], "cloud": [k1, 2]}))
as_user(ana)
bad(call("upload_finish", {"scan_id": sc["id"], "cloud": [k1, 3]}), "missing part")
k1b = ok(call("upload_begin", "cloud"))["key"]
ok(call("upload_part", k1b, 0, base64.b64encode(PLY[:20]).decode()))
ok(call("upload_part", k1b, 1, base64.b64encode(PLY[20:]).decode()))
d = ok(call("upload_finish", {"scan_id": sc["id"], "cloud": [k1b, 2], "note": "Cropped the balcony", "stats": {"points": 9, "size": [3, 3, 2]},
                               "annotations": [{"p": [0, 0, 0], "label": "Moved pin"}], "path": [], "scale_source": "calibrated"}))["scan"]
assert d["model"]["n"] == 2 and len(d["versions"]) == 2 and d["versions"][0]["note"] == "Cropped the balcony" and d["scale_source"] == "calibrated"
assert d["annotations"][0]["label"] == "Moved pin" and not d["has_mesh"]
bad(call("delete_version", sc["id"], 2), "can't delete the version in use")
d = ok(call("set_current_version", sc["id"], 1))["scan"]
assert d["model"]["n"] == 1 and d["has_mesh"]
d = ok(call("delete_version", sc["id"], 2))["scan"]
assert len(d["versions"]) == 1
bad(call("set_current_version", sc["id"], 99))
kb = ok(call("upload_begin", "cloud"))["key"]
ok(call("upload_part", kb, 0, base64.b64encode(b"not a ply").decode()))
bad(call("upload_finish", {"cloud": [kb, 1]}), "only PLY files")
ki = ok(call("upload_begin", "cloud"))["key"]
ok(call("upload_part", ki, 0, base64.b64encode(PLY).decode()))
imp = ok(call("upload_finish", {"title": "Attic (from Polycam)", "room": "other", "cloud": [ki, 1], "stats": {"points": 1}}))["scan"]
assert imp["source"] == "import" and imp["status"] == "ready" and imp["model"]["cloud"]

# ---------------------------------------------------------------------------------- footage, delete, admin moderation
ok(call("delete_footage", sc["id"]))
assert not T.scan_frames.search(scan=T.scans.get_by_id(sc["id"])) and call("get_scan", sc["id"])["scan"]["frames_url"] is None
bad(call("reprocess", sc["id"]), "no footage, no reprocessing")
as_user(bob)
ok(call("delete_scan", sc["id"]))
assert T.scans.get_by_id(sc["id"]) is not None, "deleting someone else's scan does nothing"
as_user(ana)
assert denied("admin_scans") and denied("admin_delete_scan", sc["id"]) and denied("admin_set_visibility", sc["id"], "private")
as_user(admin)
assert call("admin_overview")["scans"] >= 4
allscans = call("admin_scans")
assert allscans["total"] >= 9 and any(c["owner_email"] == "ana@example.com" for c in allscans["scans"])
assert all(c["visibility"] == "public" for c in call("admin_scans", None, "public")["scans"])
assert call("admin_scans", "front", "all")["total"] == 2, "the scan and Bob's remix of it"
ok(call("admin_set_visibility", sc["id"], "private"))
bad(call("admin_set_visibility", sc["id"], "nope"))
as_user(None)
assert not any(c["title"] == "Front room" for c in call("list_explore")["scans"]), "admins can unpublish"
as_user(ana)
ok(call("delete_scan", sc["id"]))
assert T.scans.get_by_id(sc["id"]) is None and not [h for h in T.hearts.rows if h["scan"] is None]
as_user(admin)
ok(call("admin_delete_scan", imp["id"]))

# ---------------------------------------------------------------------------------- demo data on and off
ok(call("demo_remove"))
as_user(None)
assert M["DemoData"].state() == "removed" and call("list_explore")["total"] == 0
assert not T.users.search(is_demo=True)
as_user(ana)
assert any(c["source"] == "sample" for c in call("get_library")["scans"]), "a member's sample stays when the demo goes"
as_user(admin)
ok(call("demo_load"))
ok(call("demo_load"))
assert call("list_explore")["total"] == 4, "reloading replaces the demo instead of doubling it"

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "get_shared", "list_explore", "legal_state", "legal_accept"}
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
