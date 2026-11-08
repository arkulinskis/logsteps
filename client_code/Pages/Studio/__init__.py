from anvil import *

from ._anvil_designer import StudioTemplate


class Studio(StudioTemplate):
    """#studio/<scan id>: the desktop 3D editor (crop, select, clean strays, thin out, recolour, level, calibrate,
    turn, pins; undo/redo; save as a new version). One JavaScript engine (theme/assets/ls-screens.js, "studio") in
    Components/Screen; non-owners are sent to the share view by the engine itself."""

    waits = True  # router: the screen sets UI_READY itself once the room has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
