from anvil import *

from ._anvil_designer import ScanCardTemplate
from ... import ls, router, state


class ScanCard(ScanCardTemplate):
    """One room card (the library, Explore, the landing page). item = a scan card dict from the server (Scans.card)
    plus "_explore" (show author and hearts instead of the visibility) and "_href" (where the card goes; default
    #scan/<id>). An item {"_new": True} is the dashed "Scan a room" tile at the end of the library."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        if s.get("_new"):
            self.link.visible = False
            return
        self.new_tile.visible = False
        explore = bool(s.get("_explore"))
        state.set_attr(self.link, "href", s.get("_href") or router.href("scan", s["id"]))
        self.dom_nodes["art"].innerHTML = ls.room_art(s["id"])
        pic = s.get("thumb") or s.get("cover")
        img = self.dom_nodes["pic"]
        if pic:
            img.src = pic
            img.addEventListener("error", self._no_pic)
        else:
            img.style.display = "none"
        self.thumb.classes["cover"] = bool(not s.get("thumb") and s.get("cover"))
        st = ls.status_badge(s)
        self.st_badge.visible = st is not None
        if st is not None:
            self.st_text.text = st[0]
            self.st_icon.classes.add("ic-" + st[1])
            self.st_badge.classes[st[2].replace("badge-", "") or "plain"] = True
        self.sample_badge.visible = s.get("source") == "sample"
        self.vis_badge.visible = not explore
        if not explore:
            text, icon, role = ls.vis_badge(s.get("visibility"))
            self.vis_text.text = text
            self.vis_icon.classes.add("ic-" + icon)
            self.vis_badge.classes[role.replace("badge-", "") or "plain"] = True
        status = s.get("status")
        pending = status in ("queued", "processing", "capturing")
        self.prog.visible = pending
        self.dim.visible = bool(not pending and s.get("size") and status == "ready")
        if pending:
            self.stage.text = s.get("stage") or ("Waiting for the scan station" if status == "queued" else "Working…")
            self.track.classes["wait"] = status == "queued" or not s.get("progress")
            self.bar.style["width"] = "%d%%" % round((s.get("progress") or 0) * 100)
        elif self.dim.visible:
            self.dim_text.text = "%.1f m" % s["size"][0]
        self.title.text = s.get("title") or ""
        if explore:
            self.meta.text = "%s · %s" % (s.get("author") or "", s.get("room_label") or "")
        else:
            self.meta.text = "%s · %s" % (s.get("room_label") or "", state.ago(s.get("updated")))
        self.stats.text = self._stats(s, explore)

    @staticmethod
    def _stats(s, explore):
        status = s.get("status")
        if status == "ready":
            bits = []
            if s.get("points"):
                bits.append(ls.fmt_num(s["points"]) + " pts")
            if s.get("area"):
                bits.append("≈ %s m²" % s["area"])
            if s.get("has_mesh"):
                bits.append("surface")
            if explore:
                bits.append("♥ %d" % (s.get("hearts") or 0))
                bits.append(state.plural(s.get("views") or 0, "view"))
            return " · ".join(bits)
        if status == "failed":
            return "Open it to try again"
        return state.plural(s["frames"], "frame") if s.get("frames") else ""

    def _no_pic(self, event):
        self.dom_nodes["pic"].style.display = "none"
