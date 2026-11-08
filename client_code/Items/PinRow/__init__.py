from anvil import *

from ._anvil_designer import PinRowTemplate

COLORS = ["brand", "accent", "gold", "ink"]


class PinRow(PinRowTemplate):
    """A pin in a room's side panel (scan page, share page). item = {i, label, note, color, can_edit};
    Edit raises x-edit-pin (with the pin's index) on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        a = self.item
        self.label.text = a.get("label") or ""
        self.note.text = a.get("note") or ""
        self.note.visible = bool(a.get("note"))
        color = a.get("color") if a.get("color") in COLORS else "brand"
        self.dot.classes[color] = True
        self.edit_button.visible = bool(a.get("can_edit"))
        self.edit_button.tooltip = "Edit the pin " + (a.get("label") or "")

    @handle("edit_button", "click")
    def edit_button_click(self, **event_args):
        self.parent.raise_event("x-edit-pin", i=self.item["i"])
