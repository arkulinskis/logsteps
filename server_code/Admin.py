"""Admin page callables: overview, users (make admin, disable), demo data. Admins only.
Feedback admin calls live in Feedback.py."""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Feedback, Scans


@anvil.server.callable(require_user=True)
def admin_overview():
    C.require_admin()
    return {"users": len([u for u in app_tables.users.search() if not u["is_demo"]]),
            "admins": len(app_tables.users.search(is_admin=True)),
            "feedback_new": Feedback.new_count(),
            "scans": len([s for s in app_tables.scans.search() if not s["is_demo"]]),
            "public": len([s for s in app_tables.scans.search(visibility="public") if not s["is_demo"]]),
            "queue": len(app_tables.scans.search(status="queued")) + len(app_tables.scans.search(status="processing")),
            "failed": len(app_tables.scans.search(status="failed")),
            "station": Scans.station_state(),
            "demo": {"state": DemoData.state(), "counts": DemoData.counts()}}


def _user(u):
    return {"id": u.get_id(), "email": u["email"], "name": C.name_of(u), "is_admin": C.is_admin(u),
            "enabled": u["enabled"] is not False, "joined": C.iso(u["signed_up"]), "last_seen": C.iso(u["last_seen"])}


@anvil.server.callable(require_user=True)
def list_users(query=None):
    C.require_admin()
    query = C.text(query, 80).lower()
    rows = [u for u in app_tables.users.search(tables.order_by("signed_up", ascending=False)) if not u["is_demo"]]
    if query:
        rows = [u for u in rows if query in (u["email"] or "").lower() or query in (u["display_name"] or "").lower()]
    return {"users": [_user(u) for u in rows[:200]], "total": len(rows)}


@anvil.server.callable(require_user=True)
def set_admin(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me and not flag:
        return C.fail("You can't remove your own admin rights.")
    u["is_admin"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def set_enabled(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me:
        return C.fail("You can't disable your own account.")
    u["enabled"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def demo_load():
    C.require_admin()
    DemoData.load()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


@anvil.server.callable(require_user=True)
def demo_remove():
    C.require_admin()
    DemoData.remove()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


# ----------------------------------------------------------------------------------------------- scans (moderation)
@anvil.server.callable(require_user=True)
def admin_scans(query=None, which="all"):
    """Every scan, newest first. which: all | public | shared | failed."""
    C.require_admin()
    query = C.text(query, 80).lower()
    rows = list(app_tables.scans.search(tables.order_by("updated", ascending=False)))
    if which == "public":
        rows = [s for s in rows if s["visibility"] == "public"]
    elif which == "shared":
        rows = [s for s in rows if s["visibility"] in ("link", "public")]
    elif which == "failed":
        rows = [s for s in rows if s["status"] == "failed"]
    if query:
        rows = [s for s in rows if query in (s["title"] or "").lower() or query in C.name_of(s["owner"]).lower()
                or query in ((s["owner"]["email"] if s["owner"] else "") or "").lower()]
    out = []
    for s in rows[:150]:
        c = Scans.card(s, None)
        c["owner_email"] = s["owner"]["email"] if s["owner"] is not None and not s["is_demo"] else ""
        c["error"] = s["error"] or ""
        out.append(c)
    return {"scans": out, "total": len(rows)}


@anvil.server.callable(require_user=True)
def admin_set_visibility(scan_id, visibility):
    C.require_admin()
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return C.fail("That scan doesn't exist any more.")
    if visibility not in C.VISIBILITY:
        return C.fail("Choose private, link or public.")
    s["visibility"] = visibility
    return C.ok()


@anvil.server.callable(require_user=True)
def admin_delete_scan(scan_id):
    C.require_admin()
    s = C.row_by_id(app_tables.scans, scan_id)
    if s is None:
        return C.ok()
    Scans._delete(s)
    return C.ok()
