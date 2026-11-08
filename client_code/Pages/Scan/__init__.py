import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import ScanTemplate
from ... import ls, router, state

STEPS = [("upload", "Frames uploaded"), ("clock", "In the queue"), ("cpu", "Reconstructing with lingbot-map"),
         ("layers", "Cleaning up and building the surface"), ("cube", "Ready to explore")]
SCALE_NOTE = {"calibrated": "Calibrated in Studio: measurements are exact to the reference you gave.",
              "import": "Sizes come from the imported file."}


class Scan(ScanTemplate):
    """#scan/<id> (Operate): one of your rooms.
    Not ready yet: where it is (queue position, station progress, steps, a few frames), polled every 4 s (Timer).
    Ready: the 3D view (Components/Viewer) + the side panel: name and room type, measurements, pins (Dialogs/PinEdit,
    placed by tapping the view), sharing (private / link / public, copy, new link), downloads, notes (saved when the box
    loses focus), versions, footage (process again: Dialogs/Reprocess), delete. Makes the card picture on the owner's
    first open (set_thumb from the viewer)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.title, 1)
        state.heading(self.w_title, 1)
        self.scan_id = args[0] if args else ""
        self.scan: dict = {}
        self.retry_quality.items = ls.QUALITY
        self.retry_quality.selected_value = "balanced"
        state.set_control_attr(self.retry_quality, "aria-label", "Quality")
        self.room_box.items = [(label, key) for key, label in ls.ROOMS]
        state.set_control_attr(self.link_box, "aria-label", "Share link")
        state.set_control_attr(self.notes_box, "aria-label", "Notes")
        state.set_control_attr(self.link_box, "readonly", "readonly")
        self.title_edit.visible = False
        self.pins.add_event_handler("x-edit-pin", self._edit_pin)
        self.versions.add_event_handler("x-use", self._use_version)
        self.versions.add_event_handler("x-delete", self._delete_version)
        self.hero_img_node = self.dom_nodes["hero_img"]
        self.hero_img_node.addEventListener("error", self._hide_hero)
        self.missing.visible = self.wait_part.visible = self.ready_part.visible = False
        self.top_badge.visible = False
        self.load(first=True)

    # ---------------------------------------------------------------- loading
    def load(self, first=False):
        if not self.scan_id:
            self.missing.visible = True
            self.missing_text.text = "This scan doesn't exist."
            return
        r: dict = anvil.server.call("get_scan", self.scan_id)
        if not r.get("ok"):
            self.missing.visible = True
            self.missing_text.text = r.get("error") or "This scan doesn't exist any more."
            self.wait_part.visible = self.ready_part.visible = False
            return
        if r.get("redirect"):
            window.location.hash = r["redirect"]
            return
        was = self.scan["status"] if self.scan else None
        self.scan = r["scan"]
        if was and was != "ready" and self.scan["status"] == "ready":
            state.toast("Your room is ready in 3D!", "ok")
        self.render()

    def render(self):
        s = self.scan
        self._top_badge()
        if s["status"] == "ready":
            self.wait_part.visible = False
            self.ready_part.visible = True
            self.timer.interval = 0
            self.draw_ready()
            if self.visible_on_page():
                self.viewer.show_scan(s)
        else:
            self.viewer.dispose()
            self.ready_part.visible = False
            self.wait_part.visible = True
            self.draw_wait()
            self.timer.interval = 4 if s["status"] in ("queued", "processing") else 0

    def visible_on_page(self):
        return self.parent is not None or getattr(self, "_shown", False)

    @handle("", "show")
    def form_show(self, **event_args):
        self._shown = True
        if self.scan and self.scan["status"] == "ready" and not self.viewer.is_ready():
            self.viewer.show_scan(self.scan)

    def leave(self):
        self.timer.interval = 0
        self.viewer.dispose()

    def _top_badge(self):
        s = self.scan
        info = ls.vis_badge(s.get("visibility")) if s["status"] == "ready" else ls.status_badge(s)
        self.top_badge.visible = info is not None
        if info is None:
            return
        self.top_text.text = info[0]
        for name in ("lock", "link", "globe", "upload", "clock", "cpu", "info"):
            self.top_icon.classes["ic-" + name] = name == info[1]
        for cls in ("accent", "warn", "brand", "bad"):
            self.top_badge.classes[cls] = info[2] == "badge-" + cls

    # ---------------------------------------------------------------- not ready yet
    def draw_wait(self):
        s = self.scan
        cap = s.get("capture") or {}
        failed, stuck = s["status"] == "failed", s["status"] == "capturing"
        if s.get("cover"):
            self.hero_img_node.src = s["cover"]
            self.hero_img_node.style.display = ""
            self.dom_nodes["hero_art"].innerHTML = ""
        else:
            self.hero_img_node.style.display = "none"
            self.dom_nodes["hero_art"].innerHTML = ls.room_art(s["id"])
        self.scanline.visible = not failed and not stuck
        self.w_title.text = s["title"]
        self.w_room.text = s.get("room_label") or ""
        self.failed_part.visible = failed
        self.stuck_part.visible = stuck
        self.progress_part.visible = not failed and not stuck
        if failed:
            self.w_error.text = s.get("error") or "The scan station couldn't line the frames up."
            self.retry_part.visible = bool(s.get("frames"))
        else:
            self._draw_progress()
        self.w_frames.text = str(s.get("frames") or 0)
        self.row_walk.visible = bool(cap.get("seconds"))
        self.w_walk.text = "%s s" % cap.get("seconds")
        self.w_quality.text = (s.get("settings") or {}).get("quality") or "balanced"
        n = min(6, s.get("frames") or 0) if s.get("frames_url") else 0
        self.strip.items = [{"src": "%s&i=%d" % (s["frames_url"], (i * ((s["frames"] or 1) - 1)) // max(1, n - 1))} for i in range(n)]
        self.strip.visible = n > 0

    def _draw_progress(self):
        s = self.scan
        st = s.get("station") or {}
        progress = s.get("progress") or 0
        self.w_stage.text = s.get("stage") or "Waiting for the scan station"
        self.w_bar.style["width"] = "%d%%" % max(3, round(progress * 100))
        if st.get("online"):
            self.w_station.text = "✓ The scan station is online" + (" (%s)" % st["gpu"] if st.get("gpu") else "") + "."
        else:
            self.w_station.text = "The scan station is offline right now. Your scan waits safely in the queue and starts as soon as it's back."
        now = 1 if s["status"] == "queued" else 2 if progress < 0.6 else 3 if progress < 0.9 else 4
        rows = []
        for i, (icon, text) in enumerate(STEPS):
            if i == 1 and s.get("queue_position"):
                text += " (number %d)" % s["queue_position"]
            rows.append({"icon": "check" if i < now else icon, "text": text, "cls": "done" if i < now else "now" if i == now else ""})
        self.steps.items = rows

    def _hide_hero(self, event):
        self.hero_img_node.style.display = "none"

    @handle("timer", "tick")
    def timer_tick(self, **event_args):
        s = self.scan
        if not s or s["status"] not in ("queued", "processing"):
            self.timer.interval = 0
            return
        r = state.call_quiet("poll_scans", [s["id"]])
        if not r:
            return
        u = r["scans"].get(s["id"])
        if not u:
            return
        if u["status"] != s["status"]:
            self.load()
            return
        s["stage"], s["progress"], s["station"] = u.get("stage"), u.get("progress"), r.get("station")
        self._draw_progress()

    @handle("retry_button", "click")
    def retry_button_click(self, **event_args):
        r = state.call("reprocess", self.scan["id"], {"quality": self.retry_quality.selected_value or "balanced"})
        if r:
            self.scan = r["scan"]
            self.render()

    # ---------------------------------------------------------------- ready
    def draw_ready(self):
        s = self.scan
        st = (s.get("model") or {}).get("stats") or {}
        edit = bool(s.get("can_edit"))
        self._draw_title()
        size = s.get("size") or st.get("size")
        self.dims.visible = bool(size)
        if size:
            self.dim_w.text, self.dim_d.text, self.dim_h.text = ls.fmt_m(size[0]), ls.fmt_m(size[1]), ls.fmt_m(size[2])
        self.row_floor.visible = bool(s.get("area"))
        self.kv_floor.text = "≈ %s m²" % s.get("area")
        self.kv_points.text = ls.fmt_num(st.get("points") or s.get("points"))
        faces = st.get("faces") or s.get("faces")
        self.row_faces.visible = bool(faces)
        self.kv_faces.text = ls.fmt_num(faces) + " triangles"
        self.row_ms.visible = bool(s.get("process_ms"))
        self.kv_ms.text = "%d s" % round((s.get("process_ms") or 0) / 1000)
        self.scale_note.text = SCALE_NOTE.get(s.get("scale_source") or "", "Sizes are estimated from how high your phone was held. For exact measurements, calibrate in Studio.")
        self._draw_pins()
        self.add_pin.visible = edit
        self.share_card.visible = edit
        if edit:
            self._draw_share()
        state.set_attr(self.studio_link, "href", router.href("studio", s["id"]))
        self.dl_mesh.visible = bool((s.get("model") or {}).get("mesh"))
        self.notes_card.visible = edit
        self.notes_box.text = s.get("notes") or ""
        vers = s.get("versions") or []
        self.versions_card.visible = bool(vers)
        self.versions.items = [dict(v, can_edit=edit) for v in vers]
        self.footage_card.visible = edit
        self.delete_button.visible = edit
        if s.get("frames"):
            self.footage_text.text = "%d frames are kept for the replay picture-in-picture and to process the room again." % s["frames"]
        else:
            self.footage_text.text = "No footage kept for this room."
        self.footage_actions.visible = bool(s.get("frames"))

    def _draw_title(self):
        s = self.scan
        self.title.text = s["title"]
        bits = ["%s · scanned %s" % (s.get("room_label") or "", ls.fmt_date(s.get("created")))]
        if s.get("frames"):
            bits.append(state.plural(s["frames"], "frame"))
        if s.get("source") == "sample":
            bits.append("sample")
        if s.get("views"):
            bits.append(state.plural(s["views"], "view"))
        if s.get("hearts"):
            bits.append("%d ♥" % s["hearts"])
        self.meta.text = " · ".join(bits)
        self.rename_button.visible = bool(s.get("can_edit"))

    @handle("viewer", "ready")
    def viewer_ready(self, **event_args):
        s = self.scan
        if s and s.get("can_edit") and not s.get("thumb") and s["status"] == "ready":
            pic = self.viewer.thumbnail()
            if pic:
                try:
                    anvil.server.call_s("set_thumb", s["id"], pic)
                except Exception as e:
                    print("thumbnail: %r" % e)

    # ---- rename
    @handle("rename_button", "click")
    def rename_button_click(self, **event_args):
        self.title_box.text = self.scan["title"]
        self.room_box.selected_value = self.scan.get("room") or "other"
        self.title_show.visible, self.title_edit.visible = False, True
        self.title_box.focus()

    @handle("rename_cancel", "click")
    def rename_cancel_click(self, **event_args):
        self.title_show.visible, self.title_edit.visible = True, False

    @handle("title_box", "pressed_enter")
    def title_box_pressed_enter(self, **event_args):
        self.rename_save_click()

    @handle("rename_save", "click")
    def rename_save_click(self, **event_args):
        r = state.call("update_scan", self.scan["id"], {"title": self.title_box.text or "", "room": self.room_box.selected_value})
        if r:
            self.scan = r["scan"]
            self._draw_title()
            self.title_show.visible, self.title_edit.visible = True, False
            state.toast("Saved", "ok")

    # ---- pins
    def _draw_pins(self):
        s = self.scan
        pins = s.get("annotations") or []
        edit = bool(s.get("can_edit"))
        self.pins.items = [dict(a, i=i, can_edit=edit) for i, a in enumerate(pins)]
        self.pins.visible = bool(pins)
        self.no_pins.visible = not pins
        self.no_pins.text = ("Pin notes to things in the room: furniture to keep, a crack to fix, where the socket is."
                             if edit else "No pins yet.")
        self.viewer.set_pins(pins)

    @handle("add_pin", "click")
    def add_pin_click(self, **event_args):
        if not self.viewer.pick("Tap the spot for your pin."):
            state.toast("The room is still loading.", "error")
            return
        if window.innerWidth < 980:
            self.viewer.scroll_into_view(smooth=True)

    @handle("viewer", "picked")
    def viewer_picked(self, point=None, **event_args):
        if not point:
            state.toast("Tap right on the room to place a pin.", "error")
            return
        self._pin_dialog({"p": point, "label": "", "note": "", "color": "brand"}, -1)

    def _edit_pin(self, i=0, **event_args):
        pins = self.scan.get("annotations") or []
        if 0 <= i < len(pins):
            self._pin_dialog(pins[i], i)

    def _pin_dialog(self, pin, idx):
        from ...Dialogs.PinEdit import PinEdit
        out = alert(PinEdit(pin=pin, is_new=idx < 0), buttons=[], role="app-dialog", dismissible=True)
        if not out:
            return
        pins = list(self.scan.get("annotations") or [])
        if out == "remove":
            if 0 <= idx < len(pins):
                pins.pop(idx)
        else:
            item = {"p": pin["p"], "label": out["label"], "note": out["note"], "color": out["color"]}
            if idx < 0:
                pins.append(item)
            else:
                pins[idx] = item
        r = state.call("save_annotations", self.scan["id"], pins)
        if r:
            self.scan["annotations"] = r["annotations"]
            self._draw_pins()
            if out != "remove":
                state.toast("Pin saved", "ok")

    # ---- sharing
    def _share_url(self):
        return window.location.origin + window.location.pathname + "#s/" + self.scan["token"]

    def _draw_share(self):
        s = self.scan
        v = s.get("visibility") or "private"
        for key, b, icon in (("private", self.v_private, "ic-lock"), ("link", self.v_link, "ic-link"), ("public", self.v_public, "ic-globe")):
            b.role = ["seg", icon, "on"] if key == v else ["seg", icon]
        self.private_note.visible = v == "private"
        self.link_part.visible = v != "private"
        self.link_box.text = self._share_url()
        self.send_button.visible = bool(ls.LS.canShare())
        state.set_attr(self.see_link, "href", router.href("s", s["token"]))
        self.link_note.text = ("Anyone with the link can open it, and it shows in Explore." if v == "public"
                               else "Anyone with the link can open it, even without an account.")

    def _set_vis(self, v):
        r = state.call("update_scan", self.scan["id"], {"visibility": v})
        if r:
            self.scan = r["scan"]
            self._draw_share()
            self._top_badge()
            vis = self.scan["visibility"]
            state.toast("Only you can see it now" if vis == "private" else "Anyone with the link can see it" if vis == "link"
                        else "It's public, and in Explore", "ok")

    @handle("v_private", "click")
    def v_private_click(self, **event_args):
        self._set_vis("private")

    @handle("v_link", "click")
    def v_link_click(self, **event_args):
        self._set_vis("link")

    @handle("v_public", "click")
    def v_public_click(self, **event_args):
        self._set_vis("public")

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        if ls.LS.copy(self._share_url()):
            state.toast("Link copied", "ok")
        else:
            state.toast(self._share_url())

    @handle("send_button", "click")
    def send_button_click(self, **event_args):
        ls.LS.share(self.scan["title"], "A room I scanned in 3D with Logsteps", self._share_url())

    @handle("newlink_button", "click")
    def newlink_button_click(self, **event_args):
        if ls.ask("The current link stops working. People who had it can't open the room any more.", "Make a new link?", "New link"):
            r = state.call("reset_link", self.scan["id"])
            if r:
                self.scan = r["scan"]
                self._draw_share()
                state.toast("New link made", "ok")

    # ---- downloads, notes
    @handle("dl_cloud", "click")
    def dl_cloud_click(self, **event_args):
        self.viewer.download("cloud")

    @handle("dl_mesh", "click")
    def dl_mesh_click(self, **event_args):
        self.viewer.download("mesh")

    @handle("dl_glb", "click")
    def dl_glb_click(self, **event_args):
        self.viewer.download("glb")

    @handle("notes_box", "lost_focus")
    def notes_box_lost_focus(self, **event_args):
        text = self.notes_box.text or ""
        if text == (self.scan.get("notes") or ""):
            return
        r = state.call_quiet("update_scan", self.scan["id"], {"notes": text})
        if r and r.get("ok"):
            self.scan["notes"] = r["scan"]["notes"]
            state.toast("Notes saved", "ok")

    # ---- versions
    def _use_version(self, n=0, **event_args):
        r = state.call("set_current_version", self.scan["id"], n)
        if r:
            self.scan = r["scan"]
            self.viewer.dispose()
            self.render()
            state.toast("Switched version", "ok")

    def _delete_version(self, n=0, **event_args):
        if not ls.ask("This version's 3D files are deleted for good.", "Delete version %d?" % n, "Delete"):
            return
        r = state.call("delete_version", self.scan["id"], n)
        if r:
            self.scan = r["scan"]
            self.draw_ready()

    # ---- footage, delete
    @handle("delfootage_button", "click")
    def delfootage_button_click(self, **event_args):
        if not ls.ask("The 3D room stays. You lose the replay pictures and can't process this room again.",
                      "Delete the footage?", "Delete footage"):
            return
        r = state.call("delete_footage", self.scan["id"])
        if r:
            self.scan = r["scan"]
            self.viewer.dispose()
            self.render()
            state.toast("Footage deleted", "ok")

    @handle("reprocess_button", "click")
    def reprocess_button_click(self, **event_args):
        from ...Dialogs.Reprocess import Reprocess
        settings = alert(Reprocess(), buttons=[], role="app-dialog", dismissible=True)
        if not settings:
            return
        r = state.call("reprocess", self.scan["id"], settings)
        if r:
            self.scan = r["scan"]
            self.render()

    def _delete(self):
        if not ls.ask("The room, its versions, footage and share link are deleted for good.", 'Delete "%s"?' % self.scan["title"], "Delete"):
            return
        if state.call("delete_scan", self.scan["id"]):
            state.toast("Deleted")
            router.go("home")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self._delete()

    @handle("w_delete", "click")
    def w_delete_click(self, **event_args):
        self._delete()
