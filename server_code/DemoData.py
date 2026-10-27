"""Demo content, so the app never looks empty: four made-up people and five public room scans (procedural point clouds
in assets/demo-*.ply, made by tools/make_demo_scans.py; their facts are in DemoScenes.py). Loaded automatically the
first time anyone opens the app (ensure_loaded), removed or reloaded from Admin -> Demo data. Removing is remembered.

Every demo row has is_demo=True, so remove() deletes exactly what load() added. Demo users have @example.com emails
and no password (they can't sign in).

give_sample(user): every new member gets one private "Sample" scan (a copy of the loft) so the viewer and Studio
have something to show on day one. Samples belong to the member (not demo rows): they stay if the demo is removed.
"""
import datetime as dt

from anvil.tables import app_tables

from . import common as C
from . import DemoScenes

DEMO_USERS = {
    "maya": ("Maya Chen", "maya.demo@example.com"),
    "theo": ("Theo Martin", "theo.demo@example.com"),
    "ines": ("Ines Ozola", "ines.demo@example.com"),
    "kofi": ("Kofi Mensah", "kofi.demo@example.com"),
}
# slug -> (days ago, visibility, views, annotations)
DEMO_SCANS = {
    "loft": (3, "public", 214, [
        {"p": [-0.3, 0.45, 0.6], "label": "Coffee table", "note": "Walnut, 140 x 70 cm. Keep.", "color": "brand"},
        {"p": [-3.05, 1.6, 0.4], "label": "Brick wall", "note": "Original 1920s brick. Don't paint!", "color": "accent"},
        {"p": [2.9, 1.3, -0.9], "label": "Bookshelf", "note": "Could move to the hallway.", "color": "gold"},
        {"p": [-0.8, 1.9, -2.38], "label": "Window", "note": "Morning sun until 11.", "color": "ink"}]),
    "kitchen": (6, "public", 133, [
        {"p": [0.15, 0.95, 0.35], "label": "Island", "note": "Stools need 75 cm seat height.", "color": "brand"},
        {"p": [0.6, 1.5, -1.5], "label": "Fridge", "note": "Door opens left.", "color": "ink"}]),
    "office": (9, "public", 76, [
        {"p": [-0.65, 0.78, -1.1], "label": "Desk", "note": "180 x 68 cm.", "color": "brand"}]),
    "bedroom": (12, "link", 41, []),
    "gallery": (15, "public", 302, [
        {"p": [-2.8, 1.55, -1.15], "label": "Piece 1", "note": "\"Terracotta field\", 100 x 75 cm.", "color": "brand"},
        {"p": [3.1, 1.55, -1.15], "label": "Piece 5", "note": "Needs a brighter spot.", "color": "gold"}]),
}
HEARTS = {"loft": ["theo", "ines", "kofi"], "kitchen": ["maya", "ines"], "office": ["maya"], "gallery": ["theo", "ines", "kofi", "maya"]}
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["hearts", "scan_frames", "scan_versions", "scans"]


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def _stats(info):
    w, d, h = info["size"]
    return {"points": info["points"], "faces": 0, "size": [w, d, h], "area": round(w * d, 1)}


def _add_scan(owner, slug, title, notes, visibility, created, views, annotations, demo):
    from . import Scans
    info = DemoScenes.SCENES[slug]
    s = app_tables.scans.add_row(owner=owner, title=title, room=info["room"], notes=notes, status="ready", stage="", progress=1,
                                 visibility=visibility, token=C.new_token(), source="capture" if demo else "sample",
                                 settings={"quality": "balanced", "mesh": False}, created=created, updated=created,
                                 frame_count=0, capture={"seconds": 74, "portrait": False}, path=info["path"],
                                 annotations=annotations, scale_source="demo", thumb_asset="demo-%s.jpg" % slug,
                                 views=views, hearts=0, process_ms=48000 + len(slug) * 3100, is_demo=demo)
    Scans.add_version(s, owner, "station" if demo else "sample", "Reconstructed with lingbot-map" if demo else "Sample scan",
                      asset="demo-%s.ply" % slug, stats=_stats(info))
    return s


def load():
    remove(remember=False)
    users = {}
    for key, (name, email) in DEMO_USERS.items():
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=C.now() - dt.timedelta(days=40), samples_given=True)
        users[key] = u
    scans = {}
    for slug, (days, vis, views, pins) in DEMO_SCANS.items():
        info = DemoScenes.SCENES[slug]
        scans[slug] = _add_scan(users[info["owner"]], slug, info["title"], info["notes"], vis,
                                C.now() - dt.timedelta(days=days, hours=3), views, pins, True)
    for slug, fans in HEARTS.items():
        for who in fans:
            app_tables.hearts.add_row(scan=scans[slug], user=users[who], created=C.now() - dt.timedelta(days=1), is_demo=True)
        scans[slug]["hearts"] = len(fans)
    C.set_setting("demo", "loaded")
    return counts()


def give_sample(user):
    """One private sample scan for a new member (only once)."""
    user["samples_given"] = True
    info = DemoScenes.SCENES["loft"]
    return _add_scan(user, "loft", "Sample: " + info["title"], "A sample scan to explore. Try Replay, Measure and the Studio; "
                     "delete it whenever you like.", "private", C.now(), 0, DEMO_SCANS["loft"][3], False)


def remove(remember=True):
    for s in app_tables.scans.search(is_demo=True):  # real members' hearts on demo scans go too
        for h in app_tables.hearts.search(scan=s):
            h.delete()
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            if name == "scans":
                r["current"] = None
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
