from anvil import *

from ._anvil_designer import ReprocessTemplate

QUALITIES = ["fast", "balanced", "detailed"]


class Reprocess(ReprocessTemplate):
    """"Process this room again?" (scan page, Footage). Closes with {quality, mesh} or None."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.quality = "detailed"
        self._draw()

    def _draw(self):
        for key, b in zip(QUALITIES, [self.q_fast, self.q_balanced, self.q_detailed]):
            b.role = ["seg", "on"] if key == self.quality else ["seg"]

    def _pick(self, key):
        self.quality = key
        self._draw()

    @handle("q_fast", "click")
    def q_fast_click(self, **event_args):
        self._pick("fast")

    @handle("q_balanced", "click")
    def q_balanced_click(self, **event_args):
        self._pick("balanced")

    @handle("q_detailed", "click")
    def q_detailed_click(self, **event_args):
        self._pick("detailed")

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("go_button", "click")
    def go_button_click(self, **event_args):
        self.raise_event("x-close-alert", value={"quality": self.quality, "mesh": bool(self.mesh_box.checked)})
