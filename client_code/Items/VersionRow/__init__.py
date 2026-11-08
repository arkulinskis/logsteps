from anvil import *

from ._anvil_designer import VersionRowTemplate
from ... import ls, state

SOURCE = {"station": "Scan station", "studio": "Studio", "import": "Imported", "remix": "Copied", "sample": "Sample", "demo": "Demo"}


class VersionRow(VersionRowTemplate):
    """One version of a room (scan page). item = a version dict from Scans.detail + can_edit.
    Use / Delete raise x-use / x-delete (with n) on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        v = self.item
        src = SOURCE.get(v.get("source") or "", v.get("source") or "")
        self.n.text = "v%d" % v["n"]
        self.note.text = v.get("note") or src
        bits = [src, state.ago(v.get("created"))]
        pts = (v.get("stats") or {}).get("points")
        if pts:
            bits.append(ls.fmt_num(pts) + " pts")
        self.meta.text = " · ".join(b for b in bits if b)
        cur = bool(v.get("current"))
        self.row.classes["cur"] = cur
        self.in_use.visible = cur
        self.use_button.visible = self.delete_button.visible = not cur and bool(v.get("can_edit"))
        self.delete_button.tooltip = "Delete version %d" % v["n"]
        state.set_control_attr(self.delete_button, "aria-label", "Delete version %d" % v["n"])

    @handle("use_button", "click")
    def use_button_click(self, **event_args):
        self.parent.raise_event("x-use", n=self.item["n"])

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self.parent.raise_event("x-delete", n=self.item["n"])
