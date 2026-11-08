from anvil import *

from anvil.js import window

from ._anvil_designer import AdminTemplate
from ... import ls, state

TABS = ["overview", "scans", "station", "feedback", "users", "demo"]
WHICH = ["all", "public", "shared", "failed"]


class Admin(AdminTemplate):
    """#admin/<tab>: overview numbers, every scan (visibility, delete: Items/AdminScanRow), the scan station (status,
    queue with retry/stop: Items/JobRow, the station key, setup steps), the old feedback inbox, users (admin / active
    switches) and the demo data. Each tab is its own address, so the browser's back button works."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.tab = args[0] if args and args[0] in TABS else "overview"
        self._filter = "new"
        self._which = "all"
        parts = {"overview": self.overview_part, "scans": self.scans_part, "station": self.station_part,
                 "feedback": self.feedback_part, "users": self.users_part, "demo": self.demo_part}
        tabs = {"overview": self.tab_overview, "scans": self.tab_scans, "station": self.tab_station,
                "feedback": self.tab_feedback, "users": self.tab_users, "demo": self.tab_demo}
        self.scans_panel.add_event_handler("x-changed", self._scans_changed)
        self.jobs_panel.add_event_handler("x-changed", self._station_changed)
        self.new_key_part.visible = False
        self._key = ""
        for name in TABS:
            parts[name].visible = name == self.tab
            tabs[name].classes["on"] = name == self.tab
        self.feedback_panel.add_event_handler("x-changed", self._feedback_changed)
        getattr(self, "_" + self.tab)()

    # ---- overview
    def _overview(self):
        d = state.call("admin_overview")
        self.s_users.text, self.s_scans.text, self.s_public.text = str(d["users"]), str(d["scans"]), str(d["public"])
        self.s_queue.text, self.s_failed.text, self.s_feedback.text = str(d["queue"]), str(d["failed"]), str(d["feedback_new"])
        st = d["station"]
        self.ov_dot.classes["on"] = bool(st.get("online"))
        who = (" · " + st["name"] + (", " + st["gpu"] if st.get("gpu") else "")) if st.get("name") else ""
        self.ov_station.text = "Scan station " + ("online" if st.get("online") else "offline") + who
        self.ov_setup.visible = not st.get("online")
        self.demo_line.text = "Demo data is %s (%d demo people). Manage it in the Demo data tab." % (
            d["demo"]["state"], d["demo"]["counts"].get("users", 0))

    # ---- scans
    def _scans(self):
        d = state.call("admin_scans", (self.scan_search.text or "").strip() or None, self._which)
        if not d:
            return
        self.scans_panel.items = d["scans"]
        self.no_scans.visible = not d["scans"]
        self.scans_count.text = state.plural(d["total"], "scan")
        for key, b in zip(WHICH, [self.w_all, self.w_public, self.w_shared, self.w_failed]):
            b.role = ["seg", "on"] if key == self._which else ["seg"]

    def _scans_changed(self, **event_args):
        self._scans()

    def _set_which(self, key):
        self._which = key
        self._scans()

    @handle("w_all", "click")
    def w_all_click(self, **event_args):
        self._set_which("all")

    @handle("w_public", "click")
    def w_public_click(self, **event_args):
        self._set_which("public")

    @handle("w_shared", "click")
    def w_shared_click(self, **event_args):
        self._set_which("shared")

    @handle("w_failed", "click")
    def w_failed_click(self, **event_args):
        self._set_which("failed")

    @handle("scan_search", "pressed_enter")
    def scan_search_pressed_enter(self, **event_args):
        self._scans()

    @handle("scan_search_button", "click")
    def scan_search_button_click(self, **event_args):
        self._scans()

    # ---- the scan station
    def _station(self):
        d = state.call("station_info")
        if not d:
            return
        st = d["station"]
        self.st_dot.classes["on"] = bool(st.get("online"))
        self.st_state.text = "Online" if st.get("online") else "Offline"
        if st.get("seen"):
            heard = "Last heard from %s%s%s." % (state.ago(st["seen"]), (": " + st["name"]) if st.get("name") else "",
                                               (" (%s)" % st["gpu"]) if st.get("gpu") else "")
        else:
            heard = "No station has connected yet."
        avg = (" Recent scans took %d s on average." % round(d["avg_ms"] / 1000)) if d.get("avg_ms") else ""
        self.st_text.text = "%s %s waiting, %d processing.%s" % (heard, state.plural(st.get("queue") or 0, "scan"), st.get("busy") or 0, avg)
        self.jobs_panel.items = d["jobs"]
        self.no_jobs.visible = not d["jobs"]
        if d.get("has_key"):
            self.key_text.text = "The scan station signs in with this key. Current key: %s, made %s. Making a new one stops the old one." % (
                d.get("key_hint") or "", state.ago(d.get("key_made")))
        else:
            self.key_text.text = "The scan station signs in with this key. There is no key yet."
        self.make_key.text = "Make a new key" if d.get("has_key") else "Make a station key"
        app = window.location.origin + window.location.pathname.rstrip("/")
        self.run_cmd.text = "python logsteps_station.py --app %s --key lsk_…" % app

    def _station_changed(self, **event_args):
        self._station()

    @handle("make_key", "click")
    def make_key_click(self, **event_args):
        if not ls.ask("Any station using the old key stops until you give it the new one.", "Make a new station key?", "Make key"):
            return
        r = state.call("station_new_key")
        if r:
            self._key = r["key"]
            self._station()
            self.new_key.text = r["key"]
            self.new_key_part.visible = True

    @handle("copy_key", "click")
    def copy_key_click(self, **event_args):
        if self._key and ls.LS.copy(self._key):
            state.toast("Key copied", "ok")

    # ---- feedback
    def _feedback(self):
        d = state.call("list_feedback", None)
        self._fb = d
        items = [i for i in d["items"] if self._filter == "all" or i["status"] == self._filter]
        self.feedback_panel.items = items
        self.no_feedback.visible = not items
        labels = {"new": "New", "read": "Read", "done": "Done", "all": "All"}
        for key, el in (("new", self.f_new), ("read", self.f_read), ("done", self.f_done), ("all", self.f_all)):
            n = len(d["items"]) if key == "all" else d["counts"].get(key, 0)
            el.text = "%s (%d)" % (labels[key], n)
            el.role = ["seg", "on"] if key == self._filter else ["seg"]

    def _set_filter(self, value):
        self._filter = value
        self._feedback()

    @handle("f_new", "click")
    def f_new_click(self, **event_args):
        self._set_filter("new")

    @handle("f_read", "click")
    def f_read_click(self, **event_args):
        self._set_filter("read")

    @handle("f_done", "click")
    def f_done_click(self, **event_args):
        self._set_filter("done")

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    def _feedback_changed(self, **event_args):
        self._feedback()

    # ---- users
    def _users(self, query=None):
        d = state.call("list_users", query or None)
        self.users_panel.items = d["users"]
        self.users_count.text = state.plural(d["total"], "person", "people")

    @handle("search_box", "pressed_enter")
    def search_box_pressed_enter(self, **event_args):
        self._users(self.search_box.text)

    @handle("search_button", "click")
    def search_button_click(self, **event_args):
        self._users(self.search_box.text)

    # ---- demo data
    def _demo(self):
        d = state.call("admin_overview")["demo"]
        counts = ", ".join("%s %s" % (v, k) for k, v in d["counts"].items())
        self.demo_status.text = "Status: %s · %s" % (d["state"], counts)
        self.demo_load_button.text = "Reload demo data" if d["state"] == "loaded" else "Load demo data"

    @handle("demo_load_button", "click")
    def demo_load_button_click(self, **event_args):
        if confirm("Demo people and content are added (any old demo rows are replaced).", title="Load the demo data?",
                   buttons=[("Cancel", False), ("Load", True)], role="app-dialog"):
            if state.call("demo_load"):
                state.toast("Done", "ok")
                self._demo()

    @handle("demo_remove_button", "click")
    def demo_remove_button_click(self, **event_args):
        if confirm("Every demo row is deleted. Real data stays.", title="Remove the demo data?",
                   buttons=[("Cancel", False), ("Remove", True)], role="app-dialog"):
            if state.call("demo_remove"):
                state.toast("Done", "ok")
                self._demo()
