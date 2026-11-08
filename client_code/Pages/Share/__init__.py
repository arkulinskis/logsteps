import anvil.server
from anvil import *

from ._anvil_designer import ShareTemplate
from ... import ls, router, state


class Share(ShareTemplate):
    """#s/<token>: a shared room for anyone with the link (no account needed). The 3D view (Components/Viewer) turns
    slowly until touched. Hearts and "Copy to my rooms" for members, a sign-up nudge for visitors.
    Server: get_shared (its own "not shared" state, so anvil.server.call), toggle_heart, remix."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.title, 1)
        self.token = args[0] if args else ""
        self.scan: dict = {}
        self.room_part.visible = False
        self.not_shared.visible = False
        if not self.token:
            self.not_shared.visible = True
            self.not_shared_text.text = "The link is missing its code."
            return
        r: dict = anvil.server.call("get_shared", self.token)
        if not r.get("ok"):
            self.not_shared.visible = True
            self.not_shared_text.text = str(r.get("error") or "")
            return
        self.scan = s = r["scan"]
        window_title = (s.get("title") or "Shared room") + " · Logsteps"
        from anvil.js import window
        window.document.title = window_title
        self.room_part.visible = True
        self.title.text = s["title"]
        self.avatar.text = state.initials(s.get("author"))
        self.byline.text = "Scanned by %s · %s · %s" % (s.get("author") or "", ls.fmt_date(s.get("created")),
                                                       state.plural(s.get("views") or 0, "view"))
        self._draw_heart()
        owner = bool(s.get("owner_view"))
        self.manage_link.visible = owner
        state.set_attr(self.manage_link, "href", router.href("scan", s["id"]))
        self.remix_button.visible = not owner
        self.notes.text = s.get("notes") or "No notes."
        self.notes.role = ["sh-notes"] if s.get("notes") else ["sh-notes", "faint-text"]
        pins = s.get("annotations") or []
        self.pins_part.visible = bool(pins)
        self.pins.items = [dict(a, i=i, can_edit=False) for i, a in enumerate(pins)]
        st = (s.get("model") or {}).get("stats") or {}
        size = s.get("size") or st.get("size")
        self.dims.visible = bool(size)
        if size:
            self.dim_w.text, self.dim_d.text, self.dim_h.text = ls.fmt_m(size[0]), ls.fmt_m(size[1]), ls.fmt_m(size[2])
        self.row_floor.visible = bool(s.get("area"))
        self.kv_floor.text = "≈ %s m²" % s.get("area")
        self.kv_points.text = ls.fmt_num(st.get("points") or s.get("points"))
        self.cta.visible = not state.me()

    @handle("", "show")
    def form_show(self, **event_args):
        if self.scan and not self.viewer.is_ready():
            self.viewer.show_scan(self.scan)

    def leave(self):
        self.viewer.dispose()

    def _draw_heart(self):
        s = self.scan
        self.heart_button.text = str(s.get("hearts") or 0)
        self.heart_button.role = ["btn", "sh-heart", "ic-heart", "on"] if s.get("hearted") else ["btn", "sh-heart", "ic-heart"]
        state.set_control_attr(self.heart_button, "aria-pressed", "true" if s.get("hearted") else "false")
        state.set_control_attr(self.heart_button, "aria-label", "Love this room (%d)" % (s.get("hearts") or 0))

    def _need_account(self, message):
        router.remember_after("#s/" + self.token)
        state.toast(message)
        router.go("auth", "signup")

    @handle("heart_button", "click")
    def heart_button_click(self, **event_args):
        if not state.me():
            self._need_account("Sign in to keep the rooms you love.")
            return
        r = state.call("toggle_heart", self.token)
        if r:
            self.scan["hearted"], self.scan["hearts"] = r["hearted"], r["hearts"]
            self._draw_heart()

    @handle("remix_button", "click")
    def remix_button_click(self, **event_args):
        if not state.me():
            self._need_account("Make a free account to keep a copy.")
            return
        r = state.call("remix", self.token)
        if r:
            state.toast("Copied to your rooms. Open it in Studio to make it yours.", "ok")
            router.go("scan", r["scan_id"])

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        from anvil.js import window
        url = window.location.href
        if ls.LS.canShare():
            ls.LS.share(self.scan["title"], "", url)
            return
        if ls.LS.copy(url):
            state.toast("Link copied", "ok")
        else:
            state.toast(url)
