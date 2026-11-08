from anvil import *

from ._anvil_designer import RoomChipTemplate
from ... import state


class RoomChip(RoomChipTemplate):
    """A room-type filter chip on Explore. item = {key, label, n, on}; a click raises x-room on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.chip.text = "%s  %d" % (self.item["label"], self.item["n"])
        self.chip.role = ["room-chip", "on"] if self.item.get("on") else ["room-chip"]
        state.set_control_attr(self.chip, "aria-pressed", "true" if self.item.get("on") else "false")

    @handle("chip", "click")
    def chip_click(self, **event_args):
        self.parent.raise_event("x-room", key=self.item["key"])
