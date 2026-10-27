"""Sharing: share links (#s/<token>), the public Explore gallery, hearts, and remixing someone's scan into your own.

visibility: private (owner + admins), link (anyone with the link), public (the link + Explore).
"""
import anvil.server
import anvil.tables as tables
from anvil.tables import app_tables

from . import common as C
from . import DemoData
from . import Scans


def _shared_scan(token):
    if not isinstance(token, str) or not token or len(token) > 40:
        return None
    s = app_tables.scans.get(token=token)
    if s is None or s["status"] != "ready":
        return None
    me = C.me()
    if s["visibility"] in ("link", "public") or (me is not None and (s["owner"] == me or C.is_admin(me))):
        return s
    return None


@anvil.server.callable
def get_shared(token):
    """A shared scan, for anyone with the link (signed in or not)."""
    DemoData.ensure_loaded()
    s = _shared_scan(token)
    if s is None:
        return C.fail("This scan isn't shared (any more), or the link is wrong.")
    me = C.me()
    seen = anvil.server.session.get("seen") or []
    if token not in seen and not (me is not None and s["owner"] == me):
        s["views"] = (s["views"] or 0) + 1
        anvil.server.session["seen"] = (seen + [token])[-200:]
    d = Scans.detail(s, me, shared=True)
    d["hearted"] = bool(me is not None and app_tables.hearts.get(scan=s, user=me))
    d["owner_view"] = bool(me is not None and s["owner"] == me)
    return C.ok(scan=d)


@anvil.server.callable
def list_explore(opts=None):
    """Public scans for the Explore gallery. opts: {room, sort: new|loved|viewed, q}."""
    DemoData.ensure_loaded()
    opts = opts if isinstance(opts, dict) else {}
    me = C.me()
    rows = [s for s in app_tables.scans.search(tables.order_by("updated", ascending=False), visibility="public", status="ready")]
    room = opts.get("room")
    if room in C.ROOMS:
        rows = [s for s in rows if s["room"] == room]
    q = C.text(opts.get("q"), 60).lower()
    if q:
        rows = [s for s in rows if q in (s["title"] or "").lower() or q in (s["notes"] or "").lower() or q in C.name_of(s["owner"]).lower()]
    sort = opts.get("sort")
    if sort == "loved":
        rows.sort(key=lambda s: -(s["hearts"] or 0))
    elif sort == "viewed":
        rows.sort(key=lambda s: -(s["views"] or 0))
    hearted = set()
    if me is not None:
        hearted = {h["scan"].get_id() for h in app_tables.hearts.search(user=me) if h["scan"] is not None}
    out = []
    for s in rows[:60]:
        c = Scans.card(s, me)
        c["hearted"] = c["id"] in hearted
        out.append(c)
    counts = {}
    for s in app_tables.scans.search(visibility="public", status="ready"):
        counts[s["room"] or "other"] = counts.get(s["room"] or "other", 0) + 1
    return {"scans": out, "rooms": C.ROOMS, "counts": counts, "total": len(rows)}


@anvil.server.callable(require_user=True)
def toggle_heart(token):
    me = C.require_user()
    s = _shared_scan(token)
    if s is None:
        return C.fail("This scan isn't shared any more.")
    h = app_tables.hearts.get(scan=s, user=me)
    if h is not None:
        h.delete()
        on = False
    else:
        if C.rate_limited("heart", 120, 3600):
            return C.fail("Easy there! Try again in a little while.")
        app_tables.hearts.add_row(scan=s, user=me, created=C.now(), is_demo=False)
        on = True
    s["hearts"] = len(app_tables.hearts.search(scan=s))
    return C.ok(hearted=on, hearts=s["hearts"])


@anvil.server.callable(require_user=True)
def remix(token):
    """Copy a shared scan's current version into your own library (private), to explore or edit in Studio."""
    me = C.require_user()
    s = _shared_scan(token)
    if s is None:
        return C.fail("This scan isn't shared any more.")
    if C.rate_limited("remix", 20, 3600):
        return C.fail("That's a lot of copies in one hour. Try again later.")
    v = s["current"]
    if v is None:
        return C.fail("This scan has no 3D model yet.")
    title = C.text("%s (copy)" % s["title"], 80) if s["owner"] == me else C.text("%s, from %s" % (s["title"], C.name_of(s["owner"])), 80)
    n = app_tables.scans.add_row(owner=me, title=title, room=s["room"], notes=s["notes"] or "", status="ready", stage="", progress=1,
                                 visibility="private", token=C.new_token(), source="remix", settings={}, created=C.now(),
                                 updated=C.now(), frame_count=0, views=0, hearts=0, annotations=s["annotations"] or [],
                                 path=s["path"] or [], scale_source=s["scale_source"], thumb=s["thumb"], thumb_asset=s["thumb_asset"],
                                 cover=s["cover"], is_demo=False)
    Scans.add_version(n, me, "remix", "Copied from %s" % C.name_of(s["owner"]), cloud=v["cloud"], mesh=v["mesh"],
                      asset=v["asset"], mesh_asset=v["mesh_asset"], stats=v["stats"])
    return C.ok(scan_id=n.get_id())
