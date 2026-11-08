from anvil import *

from ._anvil_designer import JobRowTemplate
from ... import ls, state


class JobRow(JobRowTemplate):
    """Admin → Scan station: a scan in the queue, processing or failed. Retry (failed) or Stop (waiting/processing);
    both raise x-changed on the panel so the station tab reloads."""

    def __init__(self, **properties):
        super().__init__(**properties)
        j = self.item
        self.title.text = j.get("title") or ""
        st = ls.status_badge(j)
        self.status.visible = st is not None
        if st is not None:
            self.status.text = st[0]
            self.status.role = ["badge", st[2]] if st[2] != "badge" else ["badge"]
        bits = [j.get("owner") or "", state.plural(j.get("frames") or 0, "frame"), state.ago(j.get("updated"))]
        if j.get("stage"):
            bits.append(j["stage"])
        self.meta.text = " · ".join(b for b in bits if b)
        self.error.text = j.get("error") or ""
        self.error.visible = bool(j.get("error"))
        self.bar.visible = j.get("status") == "processing"
        self.fill.style["width"] = "%d%%" % round((j.get("progress") or 0) * 100)
        failed = j.get("status") == "failed"
        self.retry_button.visible = failed
        self.stop_button.visible = not failed

    @handle("retry_button", "click")
    def retry_button_click(self, **event_args):
        if state.call("station_requeue", self.item["id"]):
            state.toast("Back in the queue", "ok")
            self.parent.raise_event("x-changed")

    @handle("stop_button", "click")
    def stop_button_click(self, **event_args):
        if state.call("station_cancel", self.item["id"]):
            state.toast("Stopped", "ok")
            self.parent.raise_event("x-changed")
