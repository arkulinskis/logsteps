from anvil import *

from ._anvil_designer import AdminScanRowTemplate
from ... import ls, router, state


class AdminScanRow(AdminScanRowTemplate):
    """Admin → Scans: one scan (anyone's). Change who can see it, open the share view, delete it.
    Delete raises x-changed on the panel so the Admin page reloads the list."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        pic = s.get("thumb") or s.get("cover")
        img = self.dom_nodes["pic"]
        if pic:
            img.src = pic
        else:
            img.style.visibility = "hidden"
        self.title.text = s.get("title") or ""
        self.demo_badge.visible = bool(s.get("demo"))
        st = ls.status_badge(s)
        self.status.visible = st is not None
        if st is not None:
            self.status.text = st[0]
            self.status.role = ["badge", st[2]] if st[2] != "badge" else ["badge"]
        bits = [s.get("author") or ""]
        if s.get("owner_email"):
            bits.append(s["owner_email"])
        bits += [s.get("room_label") or "", state.ago(s.get("updated"))]
        if s.get("points"):
            bits.append(ls.fmt_num(s["points"]) + " pts")
        self.meta.text = " · ".join(b for b in bits if b)
        self.error.text = s.get("error") or ""
        self.error.visible = bool(s.get("error"))
        self.vis_box.items = [("Private", "private"), ("Link", "link"), ("Public", "public")]
        self.vis_box.selected_value = s.get("visibility") or "private"
        state.set_control_attr(self.vis_box, "aria-label", "Who can see " + (s.get("title") or "it"))
        self.open_link.visible = s.get("status") == "ready" and s.get("visibility") != "private"
        state.set_attr(self.open_link, "href", router.href("s", s.get("token") or ""))
        self.delete_button.tooltip = "Delete " + (s.get("title") or "this scan")

    @handle("vis_box", "change")
    def vis_box_change(self, **event_args):
        if state.call("admin_set_visibility", self.item["id"], self.vis_box.selected_value):
            state.toast("Saved", "ok")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("It is deleted for its owner too, with its versions and footage.", title="Delete this scan?",
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("admin_delete_scan", self.item["id"]):
                state.toast("Deleted")
                self.parent.raise_event("x-changed")
