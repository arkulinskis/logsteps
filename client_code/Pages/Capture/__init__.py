from anvil import *

from ._anvil_designer import CaptureTemplate


class Capture(CaptureTemplate):
    """#capture, #capture/video, #capture/import: a new scan. The camera walk (sharp-frame Keeper, live coverage ring),
    frames from a video and the PLY/GLB import are one JavaScript engine (theme/assets/ls-screens.js, "capture"),
    mounted by Components/Screen. It uploads through UI.api (create_scan, add_frames, finish_capture, upload_*)."""

    waits = True  # router: the screen sets UI_READY itself once it has drawn

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
