---
name: logsteps
description: Context, workflow and recipes for Logsteps (folder logsteps-forms), the user's Anvil app built as native Anvil Forms (Python + HTML templates, a layout, custom components, RepeatingPanels) around JavaScript engines (three.js viewer, Capture, Studio). Phone room scanning: walk a room, lingbot-map on a GPU scan station makes a 3D model to replay, measure, pin, share by link and edit in a desktop Studio. Load this before any feature request, bug fix, restyle, content change or deploy for this app.
---

# Logsteps: working on the app

**What it is:** members walk around a room with their phone camera; the frames go to a queue in Anvil; a separate
"scan station" (`station/logsteps_station.py` on a computer with an NVIDIA GPU, not in Anvil) runs lingbot-map
(github.com/Robbyant/lingbot-map) and sends back a point cloud (+ an Open3D surface) and the camera path. Members
explore the room in a three.js viewer (orbit / walk / plan, replay with picture-in-picture, measure, pins), share it
(private / link / public in Explore), copy others' rooms (remix), and edit it in Studio (desktop) as new versions.
Admins moderate scans and manage the station (key, queue).

**Where it lives:**
- Folder `C:\Users\arkvi\Documents\CLAUDE\logsteps-forms\` = the git clone of **github.com/arkulinskis/logsteps**,
  branch `master`. "git" layout: the folder *is* the Anvil app. Anvil pulls master; pushing is the deploy.
  Live: https://logsteps.com.
- Native Forms since 2026-11-08 (forms branch merged that day). The old source folder `..\logsteps` is retired
  (RETIRED.md; its deploy.py refuses to run): never deploy from it.
- Made like `APP_MAKER\template-forms`; its guide has the general Forms patterns, accessibility and design-kit rules.
- **README.md** lists every feature. **APP_MAP.md** is the code map: read it first, regenerate after changes
  (`python -I C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/standard/app_map.py logsteps`).

**What the user wants:** "an app that can use the camera and create a 3D model of a room, using Robbyant/lingbot-map;
users can save their scans and link to them; the app can reproduce them; if possible edit the meshes on a PC
interface". Design: **Architect's studio**: drafting paper (#f5efe6 + a 28 px grid), terracotta brand #c2522b, sage
accent #4f7f6a, ink #2a231e, dark bg #1a1512; Fraunces headings, Work Sans body, JetBrains Mono for measurements;
radius 18/12, soft paper shadows, isometric line drawings, dimension lines. Claude assumes details and builds; Claude
deploys. Every page fits 390 px. Light and dark.

## Workflow for any change

1. `git pull --ff-only` (Anvil commits "Edited ..." when the user changes something in the IDE).
2. Edit a page's template and Python side by side (`client_code/Pages/X/`), or an engine in `theme/assets/ls-*.js`.
3. `python tools/check.py` (no -I) -> **ALL CHECKS PASSED**: `anvil validate`, JS syntax, asset hashes
   (`tools/assets.py`), server tests (tools/testing/test_server.py reads the schema from anvil.yaml; the mock keeps
   `run_endpoint` for the scan-station HTTP tests).
4. `python -I tools/ui_test.py` (Docker Desktop running) -> the smoke test (tools/ui/smoke.js: every address signed
   out / member / admin, desktop + phone). Server edits need `--restart`; `--stop` at the end.
5. Commit as arkulinskis with the Co-Authored-By line; `git push origin master`. New tables/columns: tell the user to
   accept the **Schema Mismatch** alert ("The schema of the source code is correct"). Regenerate APP_MAP.md.

## Architecture

```
client_code/
  startup.py, router.py, state.py, auth.py, legal.py   as template-forms (legal.py = the kit: don't edit);
                 router.show() calls leave() on the old page (timers, 3D views)
  ls.py          Python <-> engines: _bridge (window.LS_BRIDGE: the engines' UI.api), LS.host (toasts, yes/no, go)
  Layouts/Shell  header, account menu, footer (4 links), phone tab bar
  Pages/         Landing, Explore, Share (#s/<token>), Home (library), Scan (#scan/<id>), Capture, Studio, Profile,
                 Auth, Admin (overview, scans, station, feedback, users, demo)
  Components/    Viewer (scan + share pages: room view + control bar; events ready, picked; pick() = next tap is a pin)
                 Screen (Capture, Studio: the whole editor is one engine screen)
  Items/         room cards, admin rows, FeedbackRow, NavLink ...   Dialogs/  PinEdit, Reprocess
server_code/     Scans.py (library, capture create_scan/add_frames/finish_capture, scan page, versions, uploads in
                 parts), Share.py (get_shared, list_explore, toggle_heart, remix), Files.py (GET
                 _/api/file/<token>/<what>?t=<ticket>, signed + expiring), Station.py (the station's HTTP endpoints
                 _/api/station/..., Bearer key + admin station_*), DemoData.py, DemoScenes.py (generated), Accounts,
                 Admin, Feedback, common.py, SchemaCheck, legal_server, seo_routes
theme/assets/    ls-viewer.js (LS.Viewer: orbit/walk/plan, replay, measure, pins, cut, snapshot; LS.controls,
                 LS.writePLY), ls-cards.js (LS.roomArt, LS.ROOMS), ls-screens.js (Capture + Studio editors),
                 ls-kit.js (the old window.UI helpers the engines need, UI.page/UI.mountScreen, LS.mountView),
                 three-r147.js (+ OrbitControls, PLYLoader, GLTFLoader, GLTFExporter), demo-*.ply/jpg,
                 logsteps_station.txt (station download), app.css, app-kit.js, theme.css
station/         logsteps_station.py (GPU computer; NOT in Anvil), README, test_station.py
tools/           check.py, assets.py, make_demo_scans.py, make_icons.py, build_icons.py, ui_test.py + ui/, live/, testing/
```

**Tables** (anvil.yaml db_schema, all server-only): `users` (+ display_name, is_admin, is_demo, last_seen,
samples_given, legal_*), `app_settings`, `feedback`, `scans` (owner, title, room, status
capturing|queued|processing|ready|failed, stage, progress, visibility private|link|public, token, source
capture|video|import|remix|sample, settings, current -> scan_versions, cover, thumb, path, annotations, views, hearts,
is_demo ...), `scan_frames` (scan, idx, image JPEG), `scan_versions` (n, source, note, cloud PLY, mesh PLY, stats,
author), `uploads` (parts: "u:<user>:<kind>:<rand>" from the browser, "st:<token>:<kind>" from the station), `hearts`.

## How things are done here

- Pages, lists, dialogs, buttons, server calls: the template-forms patterns (its guide).
- **Engines in pages:** Components/Viewer for a room view; Components/Screen for a whole engine screen (pages set
  `waits = True`; the screen sets UI_READY itself). Engines call the server through `UI.api` -> `LS_BRIDGE` (ls.py).
- **Polling** (Home 5 s, Scan 4 s) = Anvil Timers with quiet calls (`call_s`).
- **Card picture:** the Scan page sends `set_thumb` from the viewer's snapshot the first time the owner opens a ready room.
- **Files never travel through anvil.server.call as Media:** pages get signed `_/api/file/...` links (C.ticket, 8 h,
  rounded to the hour so browsers cache). Uploads are base64 parts of 700 KB (browser) / 4 MB raw (station).

## Recipes

- **New page / server function / table:** template-forms recipes (public callables in `PUBLIC` in test_server.py;
  ownership checks; `C.ok` / `C.fail`). Add the address to tools/ui/smoke.js. Personal data -> the legal kit.
- **Coordinates:** metres, Y up, floor at y = 0, room centred. The station (tidy), the import (normalise in Capture)
  and Studio (level/scale/recentre) all keep this. Colours: PLY files hold sRGB bytes; PLYLoader turns them linear;
  the renderer outputs sRGB; LS.writePLY converts back (toSRGB). Keep that chain or every save darkens the room.
- **Viewer feature:** add to `LS.Viewer` in ls-viewer.js and a button in `LS.controls`. The render loop only draws when
  `V.needs` is true (or orbit damping). Point size depends on the mode (`setPointSize`).
- **Studio tool:** in ls-screens.js add to `TOOLS` (id, icon, tip, key), a panel block in `drawSide()`, and do the edit
  inside `commit(label, fn)` (undo + history). Geometry edits go through `keepVertices` or `transformAll` (moves pins
  and the path too). Selections are per layer (`V.selection.points/surface`, Uint8Array).
- **Station protocol change:** Station.py endpoints + `App` in station/logsteps_station.py + the station tests in
  test_server.py (`anvil.server.run_endpoint`). The station is versioned (VERSION); people run old copies, so keep old
  fields working. Copy the script to theme/assets/logsteps_station.txt too.
- **Demo rooms:** edit `tools/make_demo_scans.py` and run it (`python -I`): writes theme/assets/demo-*.ply +
  server_code/DemoScenes.py. The demo JPG thumbnails stay as they are (the old thumbnail maker wasn't carried over).
  DemoData.DEMO_SCANS has pins/visibility/views.
- **Capture tests:** `?fakecam=1` swaps the camera for a moving canvas; `window.LS_CAPTURE.toggle()` starts/stops.
  Studio exposes `window.LS_STUDIO` (selectHeight, deleteSel, setTool, undo, stats).

## Gotchas

- Labels render `<div><i></i><span>`: CSS never targets bare `i`/`span` inside places holding Labels (`.lb-dot`, `.tick`).
- A Studio save uploads full PLYs: a 500k-point room is ~7.5 MB (about 11 upload calls). The station caps points per quality.
- Private scans opened by someone else redirect to `#s/<token>` if shared, else "This scan is private". Studio for a
  non-owner redirects to the share view.
- Headless Chrome on this machine has WebGL, so screenshots show real 3D.
- Email confirmation is off: whoever first signs up with an ADMIN_EMAILS address (Accounts.py) becomes admin.
- Never write Anvil's theme-colour token pattern (percent, `color:`, name, percent) in theme.css.
- No `gh` CLI; git pushes over HTTPS through Git Credential Manager.

## Privacy & Terms (legal kit)

From `C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/legal-kit` (`apps/logsteps.json`): `python -I build.py logsteps &&
python -I install.py logsteps` there (writes theme/assets/legal-kit.js, client_code/legal.py,
server_code/legal_server.py, the head_html tag), then `python tools/assets.py` and deploy. Sign-up keeps the tick box
(Pages/Auth). Continue with Google: `login_with_google()` returns None for someone without an account, so auth.py then
calls `signup_with_google()` (needs the tick first). Consent is stored in `users.legal_version`, `legal_accepted_at`,
`legal_source`. Feedback = Prepsto only ("Submit feedback"). New camera/device permissions or third-party scripts ->
update `apps/logsteps.json`.
