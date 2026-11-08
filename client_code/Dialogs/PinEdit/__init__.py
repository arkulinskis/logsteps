from anvil import *

from ._anvil_designer import PinEditTemplate
from ... import state

COLORS = ["brand", "accent", "gold", "ink"]


class PinEdit(PinEditTemplate):
    """New pin / Edit pin (scan page). Closes with {label, note, color}, "remove", or None (cancelled).
    The page saves the whole pin list (save_annotations)."""

    def __init__(self, pin, is_new, **properties):
        super().__init__(**properties)
        self.heading.text = "New pin" if is_new else "Edit pin"
        state.heading(self.heading, 2)
        self.label_box.text = pin.get("label") or ""
        self.note_box.text = pin.get("note") or ""
        self.color = pin.get("color") if pin.get("color") in COLORS else "brand"
        self.remove_button.visible = not is_new
        self._draw_colors()

    def _draw_colors(self):
        for key, b in zip(COLORS, [self.c_brand, self.c_accent, self.c_gold, self.c_ink]):
            role = ["seg", "pin-c", "pin-c-" + key]
            b.role = role + ["on"] if key == self.color else role

    def _pick(self, key):
        self.color = key
        self._draw_colors()

    @handle("c_brand", "click")
    def c_brand_click(self, **event_args):
        self._pick("brand")

    @handle("c_accent", "click")
    def c_accent_click(self, **event_args):
        self._pick("accent")

    @handle("c_gold", "click")
    def c_gold_click(self, **event_args):
        self._pick("gold")

    @handle("c_ink", "click")
    def c_ink_click(self, **event_args):
        self._pick("ink")

    @handle("", "show")
    def form_show(self, **event_args):
        self.label_box.focus()

    @handle("label_box", "pressed_enter")
    def label_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("remove_button", "click")
    def remove_button_click(self, **event_args):
        self.raise_event("x-close-alert", value="remove")

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        label = (self.label_box.text or "").strip()[:60]
        if not label:
            self.message.text, self.message.visible = "Give the pin a label.", True
            return
        self.raise_event("x-close-alert", value={"label": label, "note": (self.note_box.text or "").strip()[:300], "color": self.color})
