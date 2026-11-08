from anvil import *

from ._anvil_designer import LandingTemplate
from ... import router, state

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "tLUZzG1_Jz0"


class Landing(LandingTemplate):
    """#landing (Persuade; "About" for members): the promise, the before/after hero (drag between the walk the phone
    filmed and the 3D room it becomes: a range input moving --x), the Watch section, how it works, three public rooms
    (list_explore, most loved), who it's for, features, questions. Static copy lives in the template."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        me = state.me()
        self.guest_cta.visible = self.band_guest.visible = not me
        self.member_cta.visible = self.band_member.visible = bool(me)
        self.dom_nodes["ba_range"].addEventListener("input", self._drag)
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)
        self.no_rooms.visible = False
        try:
            d = state.call_quiet("list_explore", {"sort": "loved"})
        except Exception as e:
            print("landing rooms: %r" % e)
            d = None
        scans = (d or {}).get("scans") or []
        self.rooms.items = [dict(s, _explore=True, _href=router.href("s", s["token"])) for s in scans[:3]]
        self.no_rooms.visible = d is not None and not scans

    def _drag(self, event):
        self.dom_nodes["ba"].style.setProperty("--x", str(event.target.value) + "%")

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="Logsteps video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
