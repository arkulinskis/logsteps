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

    def show_scan(self, scan, edit=False, keep_hint=""):
        """edit: the owner's own room page (Save / It's really... on the measure bar, Keep it for boxes)."""
        self.dispose()
        view = self.dom_nodes["view"]
        view.innerHTML = ""
        self.dom_nodes["bar"].innerHTML = ""
        if self.view_role:
            view.classList.add(self.view_role)
        hooks = ls.js_value({})
        hooks["ready"] = self._ready
        hooks["pick"] = self._pick
        hooks["measured"] = self._measured
        hooks["fit"] = self._fit
        hooks["fits"] = self._fits
        hooks["units"] = self._units
        self.h = ls.LS.mountView(view, self.dom_nodes["bar"], json.dumps(scan),
                                 json.dumps({"autoRotate": bool(self.auto_rotate), "canEdit": bool(edit), "keepHint": keep_hint}),
                                 hooks)

    def _ready(self):
        self.raise_event("ready")

    def _pick(self, point_json):
        self.raise_event("picked", point=json.loads(point_json) if point_json else None)

    def _measured(self, action, measure_json):
        self.raise_event("measured", action=str(action), measure=json.loads(measure_json or "{}"))

    def _fit(self):
        self.raise_event("fit_requested")

    def _fits(self, fits_json):
        self.raise_event("fits_changed", fits=json.loads(fits_json or "[]"))

    def _units(self, units):
        self.raise_event("units_changed", units=str(units))

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

    def set_measures(self, items):
        if self.h is not None:
            self.h.setMeasures(json.dumps(items or []))

    def set_scale(self, k):
        """The room's size fix (every length shown = length in the file x k)."""
        if self.h is not None:
            self.h.setScale(float(k or 1))

    def add_fit(self, spec):
        """A new furniture box {label, w, d, h} (metres) on the floor in the middle of the view. False if not loaded yet."""
        if self.h is None:
            return False
        return bool(self.h.addFit(json.dumps(spec)))

    def set_fits(self, items):
        if self.h is not None:
            self.h.setFits(json.dumps(items or []))

    def start_measure(self):
        """Measuring on (the next two taps make a line). False if the room hasn't loaded yet."""
        if self.h is None:
            return False
        return bool(self.h.measure())

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
