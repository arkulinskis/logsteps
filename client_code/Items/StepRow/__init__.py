from anvil import *

from ._anvil_designer import StepRowTemplate


class StepRow(StepRowTemplate):
    """One step of a scan on its way (scan page). item = {icon, text, cls: "done" | "now" | ""}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.icon.classes.add("ic-" + self.item["icon"])
        self.text.text = self.item["text"]
        if self.item.get("cls"):
            self.row.classes[self.item["cls"]] = True
