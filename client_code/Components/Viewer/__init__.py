import json

from anvil import *
import anvil.js

from ._anvil_designer import ViewerTemplate
from ... import ls


class Viewer(ViewerTemplate):
    """The 3D room view of the scan and share pages: LS.mountView (ls-kit.js) loads the PLY files into the three.js
    viewer and draws the standard control bar. The engine object lives in JS; this component only passes data in and
    raises `ready` / `picked`."""

    def __init__(self, **properties):
        self.auto_rotate = False
        self.view_role = ""
        self.h = ls.NULL
        super().__init__(**properties)

    def show_scan(self, scan):
        self.dispose()
        view = self.dom_nodes["view"]
        view.innerHTML = ""
        self.dom_nodes["bar"].innerHTML = ""
        if self.view_role:
            view.classList.add(self.view_role)
        hooks = ls.js_value({})
        hooks["ready"] = self._ready
        hooks["pick"] = self._pick
        self.h = ls.LS.mountView(view, self.dom_nodes["bar"], json.dumps(scan),
                                 json.dumps({"autoRotate": bool(self.auto_rotate)}), hooks)

    def _ready(self):
        self.raise_event("ready")

    def _pick(self, point_json):
        self.raise_event("picked", point=json.loads(point_json) if point_json else None)

    def is_ready(self):
        return bool(self.h is not None and self.h.ready())

    def pick(self, hint="Tap the spot for your pin."):
        """The next tap on the room raises `picked`. False if the room hasn't loaded yet."""
        if self.h is None:
            return False
        return bool(self.h.pick(hint))

    def set_pins(self, pins):
        if self.h is not None:
            self.h.setPins(json.dumps(pins or []))

    def thumbnail(self):
        """A JPEG data URL of the current view (for the room's card picture), or ''."""
        if self.h is None:
            return ""
        return str(self.h.thumb() or "")

    def download(self, kind):
        if self.h is not None:
            self.h.download(kind)

    def dispose(self):
        if self.h is not None:
            self.h.dispose()
            self.h = ls.NULL

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.dispose()
