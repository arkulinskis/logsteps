from anvil import *

from ._anvil_designer import HomeTemplate
from ... import ls, state

FILTERS = ["all", "ready", "pending", "shared"]


class Home(HomeTemplate):
    """#home (Operate): the member's library of rooms. Totals, filters (all / ready / on its way / shared, remembered
    in the browser), the scan station's status, the cards (Items/ScanCard) and tips. While a scan is on its way it
    polls poll_scans every 5 s quietly (Timer) and reloads when one becomes ready."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.hello, 1)
        state.heading(self.empty_title, 2)
        self.filter = state.store_get("lib.filter", "all")
        if self.filter not in FILTERS:
            self.filter = "all"
        self.data: dict = {}
        self.load()

    def load(self):
        d = state.call("get_library")
        if not d:
            return
        self.data = d
        self.draw()
        if d.get("sample_added"):
            state.toast("We added a sample room so you can try everything. Delete it whenever you like.")
        self.schedule()

    def _visible(self):
        f = self.filter
        out = []
        for s in self.data["scans"]:
            if f == "ready" and s["status"] != "ready":
                continue
            if f == "pending" and s["status"] == "ready":
                continue
            if f == "shared" and s["visibility"] == "private":
                continue
            out.append(s)
        return out

    def draw(self):
        d, me = self.data, state.me() or {}
        t = d["totals"]
        first = (me.get("name") or "there").split(" ")[0]
        self.hello.text = ("Hello, " if t["scans"] else "Welcome, ") + first
        self.lead.text = (state.plural(t["scans"], "room") + " scanned so far. Walk another one?") if t["scans"] else \
            "Scan your first room: walk around it slowly with your phone."
        self.n_scans.text, self.n_ready.text = str(t["scans"]), str(t["ready"])
        self.n_points.text, self.n_shared.text = ls.fmt_big(t["points"]), str(t["shared"])
        for key, b in zip(FILTERS, [self.f_all, self.f_ready, self.f_pending, self.f_shared]):
            b.role = ["seg", "on"] if key == self.filter else ["seg"]
        self.draw_station(d["station"])
        items = self._visible()
        if items and self.filter == "all":
            items = items + [{"_new": True}]
        self.cards.items = items
        self.cards.visible = bool(items)
        self.empty.visible = not items
        f = self.filter
        self.empty_title.text = "No rooms yet" if f == "all" else "Nothing here"
        self.empty_text.text = ("Open a ready room and choose who can see it." if f == "shared" else
                                "Every scan is ready." if f == "pending" else "Scan a room with your phone, or import a model.")
        if t["scans"] <= 2:
            self.dom_nodes["tips"].setAttribute("open", "")
        else:
            self.dom_nodes["tips"].removeAttribute("open")

    def draw_station(self, st):
        self.station.classes["on"] = bool(st.get("online"))
        q = st.get("queue") or 0
        if st.get("online"):
            self.station_text.text = "Scan station online" + (" · " + state.plural(q, "scan") + " waiting" if q else "")
        else:
            self.station_text.text = "Scan station offline" + (" · %d waiting" % q if q else "")

    def _set_filter(self, key):
        self.filter = key
        state.store_set("lib.filter", key)
        self.draw()

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    @handle("f_ready", "click")
    def f_ready_click(self, **event_args):
        self._set_filter("ready")

    @handle("f_pending", "click")
    def f_pending_click(self, **event_args):
        self._set_filter("pending")

    @handle("f_shared", "click")
    def f_shared_click(self, **event_args):
        self._set_filter("shared")

    # ---- polling while scans are on their way
    def _pending_ids(self):
        return [s["id"] for s in (self.data or {}).get("scans", []) if s["status"] in ("queued", "processing")]

    def schedule(self):
        self.timer.interval = 5 if self._pending_ids() else 0

    @handle("timer", "tick")
    def timer_tick(self, **event_args):
        ids = self._pending_ids()
        if not ids:
            self.timer.interval = 0
            return
        r = state.call_quiet("poll_scans", ids)
        if not r:
            return
        changed, reload = False, False
        for s in self.data["scans"]:
            u = r["scans"].get(s["id"])
            if not u:
                continue
            if u["status"] == "ready" and s["status"] != "ready":
                state.toast('"%s" is ready in 3D!' % s["title"], "ok")
                reload = True
            elif u["status"] != s["status"] or u.get("stage") != s["stage"] or u.get("progress") != s["progress"]:
                s.update(u)
                changed = True
        self.data["station"] = r["station"]
        if reload:
            self.load()
        elif changed:
            self.draw()
        else:
            self.draw_station(r["station"])
        self.schedule()

    def leave(self):
        self.timer.interval = 0
