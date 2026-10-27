"""Shared server helpers: time, permissions, input cleaning, rate limits, app settings.

Every other server module imports this as `from . import common as C`.
Rules every callable follows:
  - check who is calling (C.me() / C.require_user() / C.require_admin()) before touching data
  - return JSON-friendly values only (dicts, lists, str, numbers, bools, None); dates via C.iso()
  - expected problems return C.fail("Message the user can read"); the page shows it
"""
import datetime as dt
import re

import anvil.server
import anvil.users
from anvil.tables import app_tables


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(v):
    """date/datetime -> ISO string (datetimes in UTC), anything else unchanged."""
    if isinstance(v, dt.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=dt.timezone.utc)
        return v.astimezone(dt.timezone.utc).isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return v


def fail(message):
    return {"ok": False, "error": message}


def ok(**data):
    data["ok"] = True
    return data


def text(value, limit=200, multiline=False):
    """Clean user text: str, trimmed, length-capped; single-line unless multiline."""
    s = "" if value is None else str(value)
    s = s.replace("\r\n", "\n").strip()
    if not multiline:
        s = re.sub(r"\s+", " ", s)
    else:
        s = re.sub(r"\n{3,}", "\n\n", s)
    return s[:limit]


def me():
    return anvil.users.get_user()


def require_user():
    u = anvil.users.get_user()
    if u is None:
        raise anvil.server.PermissionDenied("Please sign in first.")
    return u


def is_admin(user):
    return bool(user is not None and user["is_admin"])


def require_admin():
    u = require_user()
    if not is_admin(u):
        raise anvil.server.PermissionDenied("Only admins can do that.")
    return u


def name_of(user):
    if user is None:
        return "Someone"
    return user["display_name"] or (user["email"] or "Someone").split("@")[0].capitalize()


def row_by_id(table, row_id):
    """get_by_id that returns None for a missing or malformed id (ids come from the browser)."""
    if not isinstance(row_id, str) or not row_id:
        return None
    try:
        return table.get_by_id(row_id)
    except Exception:
        return None


def rate_limited(key, limit, seconds):
    """True if this browser session already did `key` `limit` times in the last `seconds`."""
    stamp = now()
    store = "rate_" + key
    recent = [t for t in (anvil.server.session.get(store) or [])
              if (stamp - dt.datetime.fromisoformat(t)).total_seconds() < seconds]
    if len(recent) >= limit:
        return True
    anvil.server.session[store] = recent + [stamp.isoformat()]
    return False


def get_setting(key, default=None):
    row = app_tables.app_settings.get(key=key)
    return default if row is None else row["value"]


def set_setting(key, value):
    row = app_tables.app_settings.get(key=key)
    if row is None:
        app_tables.app_settings.add_row(key=key, value=value)
    else:
        row["value"] = value


# ----------------------------------------------------------------------------------------------- Logsteps helpers
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import secrets as _secrets
import time as _time

import anvil

ROOMS = {"living": "Living room", "kitchen": "Kitchen", "bedroom": "Bedroom", "office": "Office", "bathroom": "Bathroom",
         "hallway": "Hallway", "studio": "Studio", "shop": "Shop or café", "outdoor": "Outdoors", "other": "Other"}
VISIBILITY = ("private", "link", "public")


def new_token(n=12):
    """A random, URL-safe id (share links, file URLs, upload keys)."""
    return _secrets.token_urlsafe(n).replace("-", "x").replace("_", "y")


def secret():
    """The app's private key for signing file links (made on first use, kept in app_settings)."""
    s = get_setting("file_secret")
    if not s:
        s = _secrets.token_hex(32)
        set_setting("file_secret", s)
    return s


def _sig(text):
    mac = _hmac.new(secret().encode("utf-8"), text.encode("utf-8"), _hashlib.sha256).digest()
    return _b64.urlsafe_b64encode(mac[:18]).decode("ascii").rstrip("=")


def ticket(token, hours=8):
    """A signed, expiring pass for one scan's files: "<expiry>.<signature>". Rounded to the hour so URLs stay cacheable."""
    exp = (int(_time.time()) // 3600 + hours + 1) * 3600
    return "%d.%s" % (exp, _sig("%s|%d" % (token, exp)))


def ticket_ok(token, t):
    try:
        exp, sig = str(t).split(".", 1)
        exp = int(exp)
    except (ValueError, AttributeError):
        return False
    if exp < _time.time():
        return False
    return _hmac.compare_digest(sig, _sig("%s|%d" % (token, exp)))


def b64bytes(s, limit):
    """Bytes from a base64 string (a data: URL prefix is fine); None if it isn't valid or is bigger than `limit` bytes."""
    if not isinstance(s, str) or not s:
        return None
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    if len(s) > limit * 4 // 3 + 8:
        return None
    try:
        data = _b64.b64decode(s, validate=True)
    except Exception:
        return None
    return data if len(data) <= limit else None


def blob(content_type, data, name):
    return anvil.BlobMedia(content_type, data, name=name)


def stamp(dt_value):
    """A short cache-buster from a datetime."""
    return str(int(dt_value.timestamp())) if dt_value else "0"
