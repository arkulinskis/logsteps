# Logsteps

Walk slowly around a room with your phone and get a 3D model of it: step back into it, replay your walk, measure it,
pin notes on it, share it with a link, and edit it on a computer. The 3D reconstruction is done by
[lingbot-map](https://github.com/Robbyant/lingbot-map) (Robbyant, Apache-2.0) running on a "scan station": a computer
with an NVIDIA GPU that runs `station/logsteps_station.py`. Built on [Anvil](https://anvil.works).

- **App repo:** github.com/arkulinskis/logsteps (branch `master`). Anvil pulls `master`.
- **Live:** https://logsteps.com

## What it does

**For visitors:** a landing page (with three real public rooms), **Explore** (`#explore`: public rooms by room type,
newest / most loved / most viewed, search), and **shared rooms** (`#s/<token>`): the 3D view turns slowly until touched,
with Orbit / Walk / Plan, Replay, Measure, **Fit** (try furniture boxes, nothing saved), pins, size, the owner's saved
measurements and furniture boxes, notes, and a sign-up nudge. Every shared room has a free **floor plan sheet**
(`#plan/<token>`, see below). No account needed for any of this.

**For members:**
- **Rooms** (`#home`): the library with every state (ready, in the queue, processing with live progress, failed, upload
  unfinished), filters, totals, the scan station's status, tips. A new member gets one private sample room.
- **New scan** (`#capture`): a guided camera walk (about 3 sharp frames a second at 640 px; blurry frames and standing
  still are skipped; compass coverage ring; "slow down" and "too dark" warnings; screen kept awake), or **upload a
  video** (frames taken in the browser), or **import a 3D file** (PLY or GLB; units and Z-up are detected; GLB textures
  are sampled into colours). Review, then the upload in batches. Quality: Fast / Balanced / Detailed; surface on/off.
- **A room** (`#scan/<id>`): while waiting, the queue position, the station's stage and progress, the frames. When
  ready: the 3D view (Orbit, Walk at eye height with WASD or a touch stick, Plan from above with a scale bar,
  dollhouse cut, Photo / Height / Clay colours, points or surface, point size, **m | ft·in** units remembered per
  browser), **Replay** of the phone's path with the original frame picture-in-picture, **pins** (add, edit, colours),
  size (W × D × H, floor area), **share** (private / link / public, copy, native share, new link), **downloads** (PLY
  points, PLY surface, GLB), notes, **versions** (use, delete), footage (process again with another quality, delete),
  delete.
  - **Measurements:** Measure, tap two points, and the bar under the view shows "2.14 m · Save · It's really…". Save
    names the line and keeps it in the room, in the Measurements card, on the share link and on the floor plan.
  - **Size fix on the phone:** "It's really…" takes the real length (cm/m or ft/in, or a preset: door 2.03 m / 80″,
    A4 29.7 cm, Letter 11″) and rescales every size (W × D × H, floor area by k², labels, scale bar). The note says
    where it came from ("Corrected on your phone from “Door” (2.03 m)"), with **Undo the fix**. The 3D file never
    changes: the factor lives in the version's stats. Capture also asks for **your height** (optional, kept in the
    browser): the phone height it implies corrects the station's 1.4 m assumption when the room comes back.
  - **Will it fit?** Fit opens presets (3-seat sofa, corner sofa, queen/king bed, wardrobe, fridge, washer, desk,
    dining table, piano, moving box) or a custom size. A see-through box lands on the floor: drag it (Orbit and Plan,
    mouse or finger), turn it 15° at a time; sage when clear, terracotta when it touches points, with the gaps to the
    nearest wall or object on each side. Owners tap **Keep it** (shown on the share link and the plan).
- **Floor plan sheet** (`#plan/<token>`, free, signed out too for shared rooms; the owner can open a private room's):
  walls from a slice of the points (cut height slider), lower furniture in grey, straightened automatically (±1° / 90°
  nudges), W and D dimension lines, saved measurements, numbered pins with a legend, furniture boxes dashed, title
  block with floor area, scale bar, where the scale came from and a QR code of the share link. **Print / Save as PDF**
  (one landscape page) and **Download PNG**.
- **Studio** (`#studio/<id>`, made for a computer): box and lasso select (Shift adds, Alt removes, right-drag turns),
  select a height band, find stray points, delete / keep only / invert, thin out, **level the floor** (3 clicks),
  **set the real size** (2 clicks + the real length → "calibrated"), turn and recentre, colours (brightness, contrast,
  saturation, warmth), paint the selection, pins, undo/redo (12 steps), keyboard shortcuts, export PLY/GLB,
  **Save version** (uploads the edited points + surface; pins and the walk path move with the room).
- Hearts on shared rooms, and **Copy to my rooms** (a private copy to explore or edit).

**For admins** (`#admin`; your admin email (App Secret `admin_emails`) becomes an admin on first sign-in):
- **Overview:** people, scans, public scans, queue, failed, feedback, the station's status.
- **Scans:** every scan, search, filter (public / shared / failed), change visibility, delete.
- **Scan station:** online or offline, GPU, queue and problems (retry, stop), make a station key (shown once),
  setup steps and the script download.
- **Feedback inbox**, **Users**, **Demo data** (4 made-up people, 5 procedural rooms; remove or reload).

## The scan station (needed for real scans)

Anvil has no GPU, so new scans wait in the queue until a station is running. See `station/README.md`. In short, on a
computer with an NVIDIA GPU: install PyTorch with CUDA, `pip install -e ./lingbot-map open3d`, then
`python logsteps_station.py --app https://<the app's address> --key <key from Admin → Scan station>`.
`--fake --once` tests the connection without a GPU.

## Setting it up in Anvil (once)

1. In the Anvil editor: **Create app → Clone from GitHub**, and paste `https://github.com/arkulinskis/logsteps`.
2. **Users** service: email + password and "Continue with Google", sign-up allowed (already set in `anvil.yaml`; check it).
3. Open the app in the editor. If it shows a **Schema Mismatch** alert, choose **"The schema of the source code is correct"** so Anvil creates the tables.
4. **Run** it and sign up with **your admin email** (App Secret `admin_emails`) straight away (that account becomes the admin).
5. **Publish** (Publish → public URL, or your own domain).
6. Admin → Scan station → make a key, and start the station (above).

<!-- libraries:start -->
## Libraries and outside services

What this project uses besides its own code. Generated by `APP_MAKER/tools/libraries.py`; to change it, edit `APP_MAKER/libraries/catalog.py` and re-run the script.

| Name | How it gets in | Used here for |
|---|---|---|
| [three.js](https://threejs.org) r147 | Copied into the app | Draws 3D scenes in the browser: shapes, lights, cameras, textures and VR. |
| [PyTorch](https://pytorch.org) | Python package | The deep-learning library image and speech models run on (here with NVIDIA CUDA). |
| [YouTube embeds](https://developers.google.com/youtube/player_parameters) | Outside web service | Plays a YouTube video inside the page (the privacy-friendlier youtube-nocookie address). |
| [Google Fonts](https://fonts.google.com) | Loaded from a CDN | Fraunces, JetBrains Mono, Work Sans |
| [NumPy](https://numpy.org) | Python package | Fast number arrays for Python. |
| [PyTorch](https://pytorch.org) | Python package | The main Python toolkit for running neural networks, on the graphics card when there is one. |
| [SciPy](https://scipy.org) | Python package | Science and maths routines on top of NumPy (rotations, fitting, signal processing). |
| [Hugging Face Hub](https://huggingface.co/docs/huggingface_hub) | Python package | Downloads AI model files from Hugging Face. |
| [lingbot-map](https://huggingface.co) | Python package | The model that turns a walk of photos into a 3D map of the room. |
| [Open3D](https://www.open3d.org) | Python package | Works with 3D point clouds and meshes: clean up, join, simplify, save. |

**Built into the browser:** Canvas 2D, WebGL, Camera, microphone and screen, Device motion and orientation, Web Share, Screen Wake Lock, Vibration, localStorage, Clipboard, File downloads (Blob), Fullscreen.

**Anvil platform:** Anvil, Anvil Data Tables, Anvil Email, Anvil JS bridge (anvil.js), Anvil Secrets, Anvil Users, Anvil Google service, Anvil HTTP, Anvil timezones (anvil.tz).

**Build and test tools (not shipped):** axe-core, Node.js, Headless Chrome (DevTools Protocol), PyYAML, Pillow.

<!-- libraries:end -->

## Working on it

See `.claude/skills/logsteps/SKILL.md` and the code map `APP_MAP.md`. In short:

```
python tools/check.py                            # anvil validate, JS syntax, asset hashes, server tests → ALL CHECKS PASSED
python -I tools/ui_test.py                       # the app in the Anvil App Server (Docker) + headless Chrome smoke test
python station/test_station.py                   # the station's geometry steps (needs numpy)
git push origin master                           # deploy: Anvil pulls master
```

## Project layout

Native Anvil Forms (since 2026-11-08):

```
client_code/    startup.py, router.py (page addresses), state.py, ls.py (Python <-> the JS engines), auth.py, legal.py
                Layouts/Shell, Pages/ (Landing, Explore, Share, Plan, Home, Scan, Capture, Studio, Profile, Auth, Admin),
                Components/ (Viewer, Screen), Items/, Dialogs/ (PinEdit, Reprocess, RealLength, FitBox)
server_code/    Scans.py (library, capture, scan page, versions, uploads, measurements, size fix, furniture boxes),
                Share.py (links, plan sheet, Explore, hearts, copies), Files.py (signed file links), Station.py (the scan
                station's HTTP endpoints + admin), DemoData.py (+ DemoScenes.py, generated), Accounts, Admin, common ...
theme/assets/   ls-viewer.js (three.js viewer: measure, fit boxes, units), ls-plan.js (floor plan sheet), ls-screens.js
                (Capture + Studio), ls-kit.js, ls-cards.js, qrcode.js (qrcode-generator, MIT), three-r147.js, app.css
station/        logsteps_station.py (runs on the GPU computer, not in Anvil), README.md, test_station.py
tools/          check.py, assets.py, ui_test.py + ui/smoke.js, testing/ (server tests on an Anvil mock), make_demo_scans.py
```
