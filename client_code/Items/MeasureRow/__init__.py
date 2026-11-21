from anvil import *

from ._anvil_designer import MeasureRowTemplate


class MeasureRow(MeasureRowTemplate):
    """A saved measurement or a kept furniture box (scan page, share page: the Measurements card).
    item = {kind: "measure" | "fit", i, label, text, can_edit}; Delete raises x-del (kind, i) on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        m = self.item
        fit = m.get("kind") == "fit"
        self.label.text = m.get("label") or ("Box" if fit else "Measurement %d" % (int(m.get("i") or 0) + 1))
        self.value.text = m.get("text") or ""
        self.icon.classes["ic-box" if fit else "ic-ruler"] = True
        self.row.classes["fit"] = fit
        self.del_button.visible = bool(m.get("can_edit"))
        self.del_button.tooltip = "Delete " + (self.label.text or "")

    @handle("del_button", "click")
    def del_button_click(self, **event_args):
        self.parent.raise_event("x-del", kind=self.item.get("kind"), i=self.item.get("i"))
