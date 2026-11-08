"""Logsteps' JavaScript engines (theme/assets/ls-*.js, window.LS) seen from Python.

The engines draw and run the 3D rooms (three.js viewer, measuring, replay, pins), the camera walk (Capture) and the
desktop editor (Studio). Python reaches them only through this module and two components:

    ls.setup()               once at start-up: the server bridge (UI.api in the engines) and LS.host (toasts, yes/no)
    Components/Viewer        the 3D view + its control bar on the scan and share pages (LS.mountView)
    Components/Screen        a whole editor engine (capture, studio) mounted into a page (UI.mountScreen)
    ls.room_art(seed)        the isometric room drawing shown on cards without a picture (SVG text)
    ls.py_value / js_value   JS <-> plain Python
Room types, badges and number formats used by the Forms live here too (same words as the old pages).
"""
import json

import anvil
import anvil.js
import anvil.server
from anvil import confirm
from anvil.js import window

from . import router, state

LS = window.LS
UI = window.UI
NULL = anvil.js.call(window.Function("return null"))  # "no JS object yet", typed for the validator

ROOMS = [("living", "Living room"), ("kitchen", "Kitchen"), ("bedroom", "Bedroom"), ("office", "Office"),
         ("bathroom", "Bathroom"), ("hallway", "Hallway"), ("studio", "Studio"), ("shop", "Shop or café"),
         ("outdoor", "Outdoors"), ("other", "Other")]
ROOM_LABEL = dict(ROOMS)
QUALITY = [("Fast", "fast"), ("Balanced", "balanced"), ("Detailed", "detailed")]
# status badge: (text, icon, role)
STATUS = {"capturing": ("Upload unfinished", "upload", "badge-warn"), "queued": ("In the queue", "clock", "badge"),
          "processing": ("Processing", "cpu", "badge-brand"), "failed": ("Didn't work", "info", "badge-bad")}
VIS = {"public": ("Public", "globe", "badge-accent"), "link": ("Link", "link", "badge"), "private": ("Private", "lock", "badge")}


def py_value(x):
    """JS -> plain Python (dicts, lists, str, numbers). None stays None."""
    if x is None:
        return None
    return json.loads(window.JSON.stringify(x))


def js_value(x):
    """Python -> a real JS object (not a proxy of a Python dict)."""
    return window.JSON.parse(json.dumps(x))


def room_art(seed):
    return str(LS.roomArt(str(seed or "x")))


def fmt_num(n):
    return "{:,}".format(int(n or 0))


def fmt_big(n):
    n = int(n or 0)
    if n > 999999:
        return "%.1fM" % (n / 1e6)
    if n > 999:
        return "%dk" % round(n / 1000)
    return str(n)


def status_badge(scan):
    """(text, icon, role) for a scan on its way or failed, else None."""
    return STATUS.get(scan.get("status") or "")


def vis_badge(visibility):
    return VIS.get(visibility or "private", VIS["private"])


def badge_html(info):
    """A small badge as HTML (inside cards: the picture's corners). info = (text, icon, role)."""
    text, icon, role = info
    return '<span class="ui-badge %s"><i class="ic ic-%s"></i>%s</span>' % (role.replace("badge-", "").replace("badge", ""), icon,
                                                                         str(UI.esc(text)))


def fmt_date(iso):
    """'2026-11-02T...' -> '2 Nov 2026'."""
    if not iso:
        return ""
    return "%s %s" % (state.short_date(iso), iso[:4])


def fmt_m(x):
    return "%.2f" % float(x or 0)


# ---------------------------------------------------------------- server calls for the engines (UI.api)
def _bridge(kind, payload_json):
    """Called from JS. Always returns a JSON string: {"result": ...} or {"error": ...}."""
    p = json.loads(payload_json) if payload_json else {}
    try:
        if kind == "call":
            call = anvil.server.call_s if p.get("quiet") else anvil.server.call
            return json.dumps({"result": call(p["fn"], *(p.get("args") or []))})
        return json.dumps({"error": "Unknown request: %s" % kind})
    except Exception as e:
        kind_of = type(e).__name__  # (some of Anvil's exception classes aren't in the validator's stubs)
        if kind_of == "SessionExpiredError":
            return json.dumps({"error": "Your session expired. Reload the page and sign in again.", "reload": True})
        if kind_of == "AppOfflineError":
            return json.dumps({"error": "You seem to be offline. Check your connection and try again."})
        if kind_of == "PermissionDenied":
            return json.dumps({"error": str(e) or "You don't have access to that.", "denied": True})
        print("bridge %s %s failed: %r" % (kind, p.get("fn", ""), e))
        return json.dumps({"error": "Something went wrong. Please try again.", "detail": repr(e)[:300]})


# ---------------------------------------------------------------- LS.host: what the engines ask Python to show
def _toast(message, kind=""):
    state.toast(message, kind or None)


def _confirm(options_json):
    o = json.loads(options_json or "{}")
    return bool(confirm(o.get("text") or "", title=o.get("title") or "Are you sure?",
                        buttons=[(o.get("cancel") or "Cancel", False), (o.get("ok") or "OK", True)], role="app-dialog"))


def _go(target_hash):
    router.show()


def setup():
    window.LS_BRIDGE = _bridge
    LS.host = js_value({})
    for name, fn in (("toast", _toast), ("confirm", _confirm), ("go", _go)):
        LS.host[name] = fn


def set_me(me):
    """The engines read UI.me (Studio checks who owns a room)."""
    UI.me = js_value(me) if me else None


def ask(text, title, ok, danger=False):
    """Yes/no in the app's dialog look."""
    return bool(confirm(text, title=title, buttons=[("Cancel", False), (ok, True)], role="app-dialog"))
