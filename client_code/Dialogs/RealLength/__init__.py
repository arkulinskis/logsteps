from anvil import *

from ._anvil_designer import RealLengthTemplate
from ... import ls, state

# known sizes: (label for the note under the sizes, metres)
PRESETS = {"door": ("Door", 2.032), "a4": ("A4 paper", 0.297), "letter": ("Letter paper", 0.2794)}
K_MIN, K_MAX = 0.5, 2.0  # Scans.K_MIN / K_MAX: bigger fixes belong in Studio


class RealLength(RealLengthTemplate):
    """"It's really…" (scan page): the real length of the line just measured. raw = its length in the file (metres before
    any fix), k = the room's current size fix. Closes with {real, label} (metres) or None (cancelled); the page calls
    set_scale, and every size follows."""

    def __init__(self, raw, k, **properties):
        super().__init__(**properties)
        state.heading(self.heading, 2)
        self.raw = float(raw or 0)
        self.k = float(k or 1)
        self.ft = ls.units() == "ft"
        self.ref = ""  # the preset's name while its value is unchanged
        self.ref_value = 0.0
        now = self.raw * self.k
        self.intro.text = ("The line is %s in the scan now. Type its real length (a tape measure is best), or tap something "
                           "with a known size if that's what you measured." % ls.fmt_len(now))
        self.metric_row.visible = not self.ft
        self.imperial_row.visible = self.ft
        self.unit_box.items = [("cm", "cm"), ("m", "m")]
        for box, label in ((self.len_box, "Real length"), (self.unit_box, "Unit"), (self.ft_box, "Feet"), (self.in_box, "Inches")):
            state.set_control_attr(box, "aria-label", label)
        self._fill(now)
        self._preview()

    def _fill(self, m):
        if self.ft:
            total = m / 0.0254
            feet = int(total // 12)
            self.ft_box.text = feet
            self.in_box.text = round(total - feet * 12, 1)
        elif m < 1:
            self.unit_box.selected_value = "cm"
            self.len_box.text = round(m * 100, 1)
        else:
            self.unit_box.selected_value = "m"
            self.len_box.text = round(m, 3)

    def _value(self):
        """The typed length in metres, or 0."""
        try:
            if self.ft:
                return ((float(self.ft_box.text or 0) * 12) + float(self.in_box.text or 0)) * 0.0254
            v = float(self.len_box.text or 0)
            return v / 100 if self.unit_box.selected_value == "cm" else v
        except (TypeError, ValueError):
            return 0.0

    def _preview(self):
        m = self._value()
        self.message.visible = False
        if m <= 0 or self.raw <= 0:
            self.preview.text = ""
            return
        k = m / self.raw
        change = k / self.k - 1
        if not K_MIN <= k <= K_MAX:
            self.preview.text = "That's more than twice as big or small: check the length, or set the real size in Studio."
        elif abs(change) < 0.005:
            self.preview.text = "That's what the scan says already."
        else:
            self.preview.text = ("Every size gets %d%% %s: width, depth, height, floor area, the labels and the scale bar."
                                 % (round(abs(change) * 100), "bigger" if change > 0 else "smaller"))

    def _preset(self, key):
        label, m = PRESETS[key]
        self.ref, self.ref_value = label, m
        self._fill(m)
        self._preview()

    @handle("p_door", "click")
    def p_door_click(self, **event_args):
        self._preset("door")

    @handle("p_a4", "click")
    def p_a4_click(self, **event_args):
        self._preset("a4")

    @handle("p_letter", "click")
    def p_letter_click(self, **event_args):
        self._preset("letter")

    @handle("len_box", "change")
    def len_box_change(self, **event_args):
        self._preview()

    @handle("unit_box", "change")
    def unit_box_change(self, **event_args):
        self._preview()

    @handle("ft_box", "change")
    def ft_box_change(self, **event_args):
        self._preview()

    @handle("in_box", "change")
    def in_box_change(self, **event_args):
        self._preview()

    @handle("len_box", "pressed_enter")
    def len_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("in_box", "pressed_enter")
    def in_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("", "show")
    def form_show(self, **event_args):
        (self.ft_box if self.ft else self.len_box).focus()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        m = self._value()
        if m <= 0:
            self.message.text, self.message.visible = "Type the real length.", True
            return
        k = m / self.raw if self.raw > 0 else 0
        if not K_MIN <= k <= K_MAX:
            self.message.text = ("That would make the room more than twice as big or small. Check the length, or set the real "
                                 "size in Studio on a computer.")
            self.message.visible = True
            return
        label = self.ref if self.ref and abs(m - self.ref_value) < 0.002 else "your tape measure"
        self.raise_event("x-close-alert", value={"real": round(m, 4), "label": label})
