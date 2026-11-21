from anvil import *

from ._anvil_designer import FitBoxTemplate
from ... import ls, state

# (key, name, width, depth, height) in metres: common North American / European sizes, frames included
PRESETS = [("sofa3", "3-seat sofa", 2.20, 0.95, 0.85), ("corner", "Corner sofa", 2.60, 1.60, 0.85),
           ("queen", "Queen bed", 1.60, 2.10, 0.60), ("king", "King bed", 1.98, 2.10, 0.60),
           ("wardrobe", "Wardrobe", 1.00, 0.60, 2.00), ("fridge", "Fridge", 0.76, 0.75, 1.78),
           ("washer", "Washer", 0.69, 0.76, 0.98), ("desk", "Desk", 1.40, 0.70, 0.75),
           ("dining", "Dining table", 1.80, 0.90, 0.75), ("piano", "Piano", 1.50, 0.60, 1.25),
           ("box", "Moving box", 0.46, 0.46, 0.46)]


class FitBox(FitBoxTemplate):
    """"Will it fit?" (scan and share pages, the Fit button under the view): a preset or a custom size, in cm or inches
    (the chosen units). Closes with {label, w, d, h} in metres, or None."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.heading(self.heading, 2)
        self.ft = ls.units() == "ft"
        unit = "in" if self.ft else "cm"
        self.w_lbl.text, self.d_lbl.text, self.h_lbl.text = "Width (%s)" % unit, "Depth (%s)" % unit, "Height (%s)" % unit
        self.chip_buttons = []
        for key, name, w, d, h in PRESETS:
            b = Button(text=name, role=["btn", "btn-sm", "fb-chip"])
            b.tag = key
            b.add_event_handler("click", self._preset)
            self.chips.add_component(b)
            self.chip_buttons.append(b)
        self._pick("sofa3")

    def _shown(self, m):
        return round(m / 0.0254, 1) if self.ft else round(m * 100)

    def _pick(self, key):
        for k2, name, w, d, h in PRESETS:
            if k2 == key:
                self.label_box.text = name
                self.w_box.text, self.d_box.text, self.h_box.text = self._shown(w), self._shown(d), self._shown(h)
        for b in self.chip_buttons:
            b.role = ["btn", "btn-sm", "fb-chip", "on"] if b.tag == key else ["btn", "btn-sm", "fb-chip"]
        self.message.visible = False

    def _preset(self, sender=None, **event_args):
        if sender is not None:
            self._pick(sender.tag)

    def _metres(self, box):
        try:
            v = float(box.text or 0)
        except (TypeError, ValueError):
            return 0.0
        return v * 0.0254 if self.ft else v / 100

    @handle("label_box", "pressed_enter")
    def label_box_pressed_enter(self, **event_args):
        self.place_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("place_button", "click")
    def place_button_click(self, **event_args):
        w, d, h = self._metres(self.w_box), self._metres(self.d_box), self._metres(self.h_box)
        if not all(0.1 <= v <= 6 for v in (w, d, h)):
            self.message.text = ("Each size must be between 4 and 236 inches." if self.ft
                                 else "Each size must be between 10 and 600 cm.")
            self.message.visible = True
            return
        label = (self.label_box.text or "").strip()[:40] or "Box"
        self.raise_event("x-close-alert", value={"label": label, "w": round(w, 3), "d": round(d, 3), "h": round(h, 3)})
