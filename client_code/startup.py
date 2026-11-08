"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, the bridge to the 3D engines, then the page for the address."""
import anvil.server

from . import legal, ls, router, state

LEGAL_THEME = {"accent": "#c2522b", "accentDark": "#e07a52"}  # matches --c-brand in app.css (light, dark)

legal.setup(LEGAL_THEME)
ls.setup()
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
