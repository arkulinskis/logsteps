from anvil import *

from ._anvil_designer import FrameThumbTemplate


class FrameThumb(FrameThumbTemplate):
    """One captured frame in the scan page's strip. item = {src} (a signed _/api/file link)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        img = self.dom_nodes["img"]
        img.addEventListener("error", self._gone)
        img.src = self.item["src"]

    def _gone(self, event):
        self.dom_nodes["img"].style.visibility = "hidden"
