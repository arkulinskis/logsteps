"""Files: the 3D models, pictures and frames, over signed links (pages get them from Scans.detail / C.ticket).

    GET _/api/file/<token>/<what>?t=<ticket>[&v=<version n>][&i=<frame number>]
    what: cloud | mesh (PLY, the current version or version v) | thumb | cover (JPEG/PNG) | frame (frame i, JPEG)

The ticket is signed with the app's secret and expires after a few hours, so a file link only works for people
the server just showed the scan to. Changing the share link (Scans.reset_link) changes the token, so old links die.
"""
import anvil.server
from anvil.tables import app_tables

from . import common as C


def _send(media, cache="private, max-age=3600"):
    r = anvil.server.HttpResponse(200, media)
    r.headers["Cache-Control"] = cache
    r.headers["Content-Type"] = media.content_type or "application/octet-stream"
    return r


def _not_found(msg="Not found"):
    return anvil.server.HttpResponse(404, msg)


@anvil.server.http_endpoint("/file/:token/:what")
def get_file(token, what, t=None, v=None, i=None, **ignored):
    if not isinstance(token, str) or len(token) > 40:
        return _not_found()
    s = app_tables.scans.get(token=token)
    if s is None or not C.ticket_ok(token, t):
        return anvil.server.HttpResponse(403, "This link has expired. Reload the page.")
    if what in ("cloud", "mesh"):
        ver = s["current"]
        if v not in (None, ""):
            try:
                ver = app_tables.scan_versions.get(scan=s, n=int(v))
            except (TypeError, ValueError):
                ver = None
        m = ver[what] if ver is not None else None
        return _send(m, "private, max-age=86400") if m is not None else _not_found()
    if what in ("thumb", "cover"):
        m = s[what]
        return _send(m, "private, max-age=86400") if m is not None else _not_found()
    if what == "frame":
        try:
            f = app_tables.scan_frames.get(scan=s, idx=int(i))
        except (TypeError, ValueError):
            f = None
        return _send(f["image"], "private, max-age=86400") if f is not None else _not_found()
    return _not_found()
