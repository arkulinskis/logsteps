import json

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import PlanTemplate
from ... import ls, router, state


class Plan(PlanTemplate):
    """#plan/<token>: the free floor plan sheet of a shared room (or the owner's own private room). The sheet is drawn
    by theme/assets/ls-plan.js (LS.planSheet) on one canvas: walls from a slice of the points, W/D, saved measurements,
    numbered pins, furniture boxes, title block with a QR code of the share link. Print / Save as PDF prints only the
    sheet (app.css @media print); Download PNG saves the same canvas. Server: get_plan (no view counted)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.title, 1)
        self.token = args[0] if args else ""
        self.scan: dict = {}
        self.h = ls.NULL
        self.plan_part.visible = False
        self.not_shared.visible = False
        if not self.token:
            self.not_shared.visible = True
            self.not_shared_text.text = "The link is missing its code."
            return
        r: dict = anvil.server.call("get_plan", self.token)
        if not r.get("ok"):
            self.not_shared.visible = True
            self.not_shared_text.text = str(r.get("error") or "")
            return
        self.scan = s = r["scan"]
        window.document.title = "Floor plan: %s · Logsteps" % (s.get("title") or "Room")
        self.plan_part.visible = True
        self.title.text = s.get("title") or "Room"
        self.sub.text = "Floor plan · %s · scanned %s" % (s.get("room_label") or "", ls.fmt_date(s.get("created")))
        back = router.href("scan", s["id"]) if s.get("owner_view") else router.href("s", self.token)
        state.set_attr(self.back_link, "href", back)
        cut = self.dom_nodes["cut"]
        cut.addEventListener("input", self._cut_input)
        cut.addEventListener("change", self._cut_change)
        self._draw_units()

    @handle("", "show")
    def form_show(self, **event_args):
        if self.scan and self.h is None:
            link = ""
            if self.scan.get("shared_link"):
                link = window.location.origin + window.location.pathname + "#s/" + self.token
            self.h = ls.LS.planSheet(self.dom_nodes["sheet"], json.dumps(self.scan), ls.js_value({"link": link}))

    def leave(self):
        if self.h is not None:
            self.h.dispose()
            self.h = ls.NULL

    def _redraw(self):
        if self.h is not None:
            self.h.redraw()

    # ---- units, wall slice, straightening
    def _draw_units(self):
        u = ls.units()
        self.u_m.role = ["seg", "on"] if u == "m" else ["seg"]
        self.u_ft.role = ["seg", "on"] if u == "ft" else ["seg"]
        state.set_control_attr(self.u_m, "aria-pressed", "true" if u == "m" else "false")
        state.set_control_attr(self.u_ft, "aria-pressed", "true" if u == "ft" else "false")
        self.dom_nodes["cut_text"].textContent = ls.fmt_len(float(self.dom_nodes["cut"].value or 1))

    @handle("u_m", "click")
    def u_m_click(self, **event_args):
        ls.set_units("m")
        self._draw_units()
        self._redraw()

    @handle("u_ft", "click")
    def u_ft_click(self, **event_args):
        ls.set_units("ft")
        self._draw_units()
        self._redraw()

    def _cut_input(self, event):
        self.dom_nodes["cut_text"].textContent = ls.fmt_len(float(self.dom_nodes["cut"].value or 1))

    def _cut_change(self, event):
        if self.h is not None:
            self.h.setCut(float(self.dom_nodes["cut"].value or 1))

    @handle("turn_left", "click")
    def turn_left_click(self, **event_args):
        if self.h is not None:
            self.h.turn(-1)

    @handle("turn_right", "click")
    def turn_right_click(self, **event_args):
        if self.h is not None:
            self.h.turn(1)

    @handle("turn_90", "click")
    def turn_90_click(self, **event_args):
        if self.h is not None:
            self.h.turn(90)

    # ---- print, PNG
    @handle("print_button", "click")
    def print_button_click(self, **event_args):
        if self.h is None or not self.h.canvas.parentNode:
            state.toast("The floor plan is still being drawn.", "error")
            return
        window.print()

    @handle("png_button", "click")
    def png_button_click(self, **event_args):
        if self.h is None or not self.h.canvas.parentNode:
            state.toast("The floor plan is still being drawn.", "error")
            return
        name = "".join(c for c in (self.scan.get("title") or "room") if c.isalnum() or c in " -_").strip() or "room"
        a = window.document.createElement("a")
        a.href = self.h.png()
        a.download = name + " floor plan.png"
        window.document.body.appendChild(a)
        a.click()
        a.remove()
        state.toast("Floor plan saved", "ok")
