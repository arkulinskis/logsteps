from anvil import *
import anvil.js

from ._anvil_designer import ScreenTemplate
from ... import ls


class Screen(ScreenTemplate):
    """An editor engine (ls-screens.js) in a page: UI.mountScreen(name, element, args) on show, destroy() on hide.
    The engine draws its own markup, talks to the server through UI.api (ls.py's bridge) and shows toasts and yes/no
    questions through LS.host (Python)."""

    def __init__(self, **properties):
        self.screen = ""
        self._args = []
        self.ctl = ls.NULL
        super().__init__(**properties)

    def mount(self, args):
        self._args = [str(a) for a in (args or [])]

    @handle("", "show")
    def form_show(self, **event_args):
        self.destroy()
        self.ctl = ls.UI.mountScreen(self.screen, self.dom_nodes["host"], ls.js_value(self._args))

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.destroy()

    def destroy(self):
        if self.ctl is not None:
            self.ctl.destroy()
            self.ctl = ls.NULL
