from anvil import *

from ._anvil_designer import ExploreTemplate
from ... import router, state

SORTS = ["new", "loved", "viewed"]


class Explore(ExploreTemplate):
    """#explore (open to visitors too): public rooms from everyone. Room-type chips (Items/RoomChip), sort
    (newest / most loved / most viewed), search. Cards open the share view #s/<token>. Server: list_explore."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.title, 1)
        state.heading(self.empty_title, 2)
        state.set_control_attr(self.search_box, "aria-label", "Search rooms or people")
        self.opts = {"room": None, "sort": "new", "q": ""}
        self.rooms_panel.add_event_handler("x-room", self._room)
        self.load()

    def load(self):
        d = state.call("list_explore", self.opts)
        if not d:
            return
        total = sum(d["counts"].values())
        chips = [{"key": "", "label": "All", "n": total, "on": not self.opts["room"]}]
        for k, label in d["rooms"].items():
            if d["counts"].get(k):
                chips.append({"key": k, "label": label, "n": d["counts"][k], "on": self.opts["room"] == k})
        self.rooms_panel.items = chips
        self.count.text = state.plural(d["total"], "room") + (' for "%s"' % self.opts["q"] if self.opts["q"] else "")
        for key, b in zip(SORTS, [self.s_new, self.s_loved, self.s_viewed]):
            b.role = ["seg", "on"] if key == self.opts["sort"] else ["seg"]
        items = [dict(s, _explore=True, _href=router.href("s", s["token"])) for s in d["scans"]]
        self.cards.items = items
        self.cards.visible = bool(items)
        self.empty.visible = not items
        self.empty_title.text = "No public rooms " + ("match" if self.opts["q"] or self.opts["room"] else "yet")
        self.empty_text.text = "Make one of yours public to be the first." if state.me() else "Be the first: scan a room and share it."

    def _room(self, key=None, **event_args):
        self.opts["room"] = key or None
        self.load()

    def _sort(self, key):
        self.opts["sort"] = key
        self.load()

    @handle("s_new", "click")
    def s_new_click(self, **event_args):
        self._sort("new")

    @handle("s_loved", "click")
    def s_loved_click(self, **event_args):
        self._sort("loved")

    @handle("s_viewed", "click")
    def s_viewed_click(self, **event_args):
        self._sort("viewed")

    def _search(self):
        self.opts["q"] = (self.search_box.text or "").strip()
        self.load()

    @handle("search_box", "pressed_enter")
    def search_box_pressed_enter(self, **event_args):
        self._search()

    @handle("search_button", "click")
    def search_button_click(self, **event_args):
        self._search()
