"""Logsteps scan station: turns the frames people capture in Logsteps into 3D rooms, with lingbot-map.

Runs on any computer with an NVIDIA GPU (8 GB+ of video memory is comfortable). It asks the Logsteps app for work,
downloads the frames, runs lingbot-map (https://github.com/Robbyant/lingbot-map), cleans and levels the result,
optionally builds a surface mesh (with Open3D), and uploads the point cloud + mesh + camera path back.

    python logsteps_station.py --app https://YOUR-APP.anvil.app --key lsk_...            run forever
    python logsteps_station.py --app ... --key ... --once                                one job, then stop
    python logsteps_station.py --app http://localhost:8771 --key ... --fake --once       test the plumbing (no GPU)

The key comes from Logsteps: Admin -> Scan station -> "Make a station key". You can also set LOGSTEPS_APP and
LOGSTEPS_KEY instead of the flags. See station/README.md for the setup (conda, PyTorch, lingbot-map, Open3D).
"""
import argparse
import io
import json
import math
import os
import random
import socket
import struct
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile

VERSION = "1.0"
PART = 4 * 1024 * 1024
QUALITY = {
    # stride: use every Nth frame; voxel: point spacing in metres; max_points for the browser; poisson depth for the mesh
    "fast": {"stride": 2, "voxel": 0.02, "max_points": 250000, "depth": 8, "faces": 120000, "cam_iters": 1},
    "balanced": {"stride": 1, "voxel": 0.012, "max_points": 450000, "depth": 9, "faces": 220000, "cam_iters": 4},
    "detailed": {"stride": 1, "voxel": 0.008, "max_points": 800000, "depth": 10, "faces": 400000, "cam_iters": 4},
}
EYE_HEIGHT = 1.4   # metres: phones are held at about this height, which gives the scan its scale


# ----------------------------------------------------------------------------------------------- talking to the app
class App(object):
    def __init__(self, base, key):
        self.base = base.rstrip("/") + "/_/api/station"
        self.key = key

    def _req(self, method, path, data=None, ctype="application/json", query=None, timeout=120):
        url = self.base + path + ("?" + urllib.parse.urlencode(query) if query else "")
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.key)
        if data is not None:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def post(self, path, payload, **kw):
        st, body = self._req("POST", path, json.dumps(payload).encode("utf-8"), **kw)
        try:
            out = json.loads(body.decode("utf-8") or "{}")
        except ValueError:
            out = {"error": body[:200].decode("utf-8", "replace")}
        if st == 401:
            sys.exit("The app refused the station key. Make a new one in Logsteps: Admin -> Scan station.")
        return st, out

    def claim(self, info):
        st, out = self.post("/claim", info)
        if st != 200:
            raise RuntimeError("claim failed (%s): %s" % (st, out))
        return out.get("job")

    def progress(self, token, stage, p):
        st, out = self.post("/progress/" + token, {"stage": stage, "progress": round(p, 3)})
        print("  [%3d%%] %s" % (int(p * 100), stage), flush=True)
        if out.get("cancelled"):
            raise Cancelled()

    def frames(self, token):
        st, body = self._req("GET", "/frames/" + token, timeout=600)
        if st != 200:
            raise RuntimeError("couldn't download the frames (%s)" % st)
        return body

    def upload(self, token, kind, data):
        parts = [data[i:i + PART] for i in range(0, len(data), PART)] or [b""]
        for i, chunk in enumerate(parts):
            for attempt in range(4):
                st, body = self._req("POST", "/part/" + token, chunk, "application/octet-stream", {"kind": kind, "idx": i}, timeout=600)
                if st == 200:
                    break
                if st == 409:
                    raise Cancelled()
                print("    part %d of %s failed (%s), retrying" % (i, kind, st), flush=True)
                time.sleep(2 + attempt * 3)
            else:
                raise RuntimeError("upload of %s failed" % kind)
        return len(parts)

    def done(self, token, payload):
        st, out = self.post("/done/" + token, payload, timeout=600)
        if st != 200:
            raise RuntimeError("the app didn't accept the result (%s): %s" % (st, out.get("error")))

    def fail(self, token, error):
        self.post("/fail/" + token, {"error": error[:300]})


class Cancelled(Exception):
    """The scan was deleted or stopped in the app while we worked on it."""


# ----------------------------------------------------------------------------------------------- PLY files
def ply_points(xyz, rgb):
    """Binary little-endian PLY: x y z float32 + red green blue uchar. xyz/rgb are numpy arrays (or lists)."""
    try:
        import numpy as np
        xyz = np.asarray(xyz, dtype="<f4")
        rgb = np.asarray(rgb, dtype="u1")
        arr = np.empty(len(xyz), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
        arr["x"], arr["y"], arr["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
        arr["r"], arr["g"], arr["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
        body = arr.tobytes()
        n = len(xyz)
    except ImportError:
        pack = struct.Struct("<fffBBB").pack
        body = b"".join(pack(p[0], p[1], p[2], c[0], c[1], c[2]) for p, c in zip(xyz, rgb))
        n = len(xyz)
    head = ("ply\nformat binary_little_endian 1.0\ncomment made by the Logsteps scan station with lingbot-map\nelement vertex %d\n"
            "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n" % n)
    return head.encode("ascii") + body


def ply_mesh(verts, rgb, faces):
    import numpy as np
    verts = np.asarray(verts, dtype="<f4")
    rgb = np.asarray(rgb, dtype="u1")
    faces = np.asarray(faces, dtype="<i4")
    v = np.empty(len(verts), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    v["x"], v["y"], v["z"] = verts[:, 0], verts[:, 1], verts[:, 2]
    v["r"], v["g"], v["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    f = np.empty(len(faces), dtype=[("n", "u1"), ("a", "<i4"), ("b", "<i4"), ("c", "<i4")])
    f["n"], f["a"], f["b"], f["c"] = 3, faces[:, 0], faces[:, 1], faces[:, 2]
    head = ("ply\nformat binary_little_endian 1.0\ncomment made by the Logsteps scan station (Open3D Poisson)\nelement vertex %d\n"
            "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n"
            "element face %d\nproperty list uchar int vertex_indices\nend_header\n" % (len(v), len(f)))
    return head.encode("ascii") + v.tobytes() + f.tobytes()


# ----------------------------------------------------------------------------------------------- lingbot-map
_MODEL = {}


def load_model(args):
    if "model" in _MODEL:
        return _MODEL["model"], _MODEL["dtype"], _MODEL["device"]
    import torch
    from lingbot_map.models.gct_stream import GCTStream
    path = args.model
    if not path:
        from huggingface_hub import hf_hub_download
        print("Downloading the lingbot-map checkpoint from Hugging Face (once)...", flush=True)
        path = hf_hub_download(repo_id="robbyant/lingbot-map", filename="lingbot-map.pt")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        print("WARNING: no CUDA GPU found. lingbot-map will be very slow on the CPU.", flush=True)
    model = GCTStream(img_size=518, patch_size=14, enable_3d_rope=True, max_frame_num=1024, kv_cache_sliding_window=64,
                      kv_cache_scale_frames=8, kv_cache_cross_frame_special=True, kv_cache_include_scale_frames=True,
                      use_sdpa=not args.flashinfer, camera_num_iterations=4)
    ckpt = torch.load(path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt.get("model", ckpt), strict=False)
    model = model.to(device).eval()
    dtype = torch.float32
    if device.type == "cuda":
        dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16
        if getattr(model, "aggregator", None) is not None:
            model.aggregator = model.aggregator.to(dtype=dtype)
    _MODEL.update(model=model, dtype=dtype, device=device)
    return model, dtype, device


def run_lingbot(args, paths, quality, app, token):
    """paths: frame files in order. Returns (points xyz Nx3, colours Nx3 uint8, conf N, c2w Sx4x4) in lingbot's world."""
    import numpy as np
    import torch
    from lingbot_map.utils.load_fn import load_and_preprocess_images
    from lingbot_map.utils.pose_enc import pose_encoding_to_extri_intri

    model, dtype, device = load_model(args)
    try:
        model.camera_num_iterations = quality["cam_iters"]
    except Exception:
        pass
    app.progress(token, "Preparing %d frames" % len(paths), 0.12)
    images = load_and_preprocess_images(paths, mode="crop", image_size=518, patch_size=14)
    n = images.shape[0]
    app.progress(token, "Reconstructing %d frames with lingbot-map" % n, 0.18)
    t0 = time.time()
    keyframe = 1 if n <= 320 else (n + 319) // 320
    with torch.no_grad(), torch.amp.autocast("cuda", dtype=dtype, enabled=device.type == "cuda"):
        pred = model.inference_streaming(images.to(device), num_scale_frames=min(8, max(1, n - 1)), keyframe_interval=keyframe,
                                         output_device=torch.device("cpu"))
    print("  inference: %.1fs for %d frames" % (time.time() - t0, n), flush=True)
    app.progress(token, "Reading out the 3D points", 0.6)
    imgs = pred.get("images")
    if imgs is None:
        imgs = images
    hw = images.shape[-2:]
    extrinsic, _ = pose_encoding_to_extri_intri(pred["pose_enc"], hw)   # camera-to-world (3x4), as the camera head predicts
    c2w = extrinsic.float().cpu().numpy()
    if c2w.ndim == 4:
        c2w = c2w[0]
    pts = pred["world_points"].float().cpu().numpy()
    conf = pred.get("world_points_conf")
    conf = conf.float().cpu().numpy() if conf is not None else np.ones(pts.shape[:-1], "f4")
    col = imgs.float().cpu().numpy() if hasattr(imgs, "cpu") else np.asarray(imgs)
    if pts.ndim == 5:
        pts, conf = pts[0], conf[0]
    if col.ndim == 5:
        col = col[0]
    col = np.transpose(col, (0, 2, 3, 1))  # S,H,W,3
    xyz = pts.reshape(-1, 3)
    rgb = (np.clip(col.reshape(-1, 3), 0, 1) * 255).astype("u1")
    cf = conf.reshape(-1)
    c2w4 = np.tile(np.eye(4, dtype="f4"), (len(c2w), 1, 1))
    c2w4[:, :3, :4] = c2w
    return xyz, rgb, cf, c2w4


def tidy(xyz, rgb, conf, c2w, portrait, quality, report):
    """Filter, level (floor flat, Y up), scale to metres from the phone's eye height, thin out and clean the points."""
    import numpy as np
    keep = np.isfinite(xyz).all(1) & (conf > 1e-5)
    if keep.sum() > 1000:
        keep &= conf >= np.percentile(conf[keep], 30)   # drop the least sure 30%
    xyz, rgb = xyz[keep], rgb[keep]
    report("Levelling the floor", 0.66)
    # OpenCV cameras: x right, y down, z forward. "Up" for a phone held upright is -y (or +x after we turned a portrait video).
    up_cam = np.array([1.0, 0, 0]) if portrait else np.array([0, -1.0, 0])
    R = c2w[:, :3, :3]
    ups = R @ up_cam
    up = ups.mean(0)
    up /= np.linalg.norm(up) + 1e-9
    rot = rotation_between(up, np.array([0, 1.0, 0]))
    xyz = xyz @ rot.T
    cams = (c2w[:, :3, 3]) @ rot.T
    fwd = (R @ np.array([0, 0, 1.0])) @ rot.T
    floor = np.percentile(xyz[:, 1], 1.5)
    eye = np.median(cams[:, 1]) - floor
    scale = EYE_HEIGHT / eye if eye > 1e-6 else 1.0
    centre = np.array([np.median(xyz[:, 0]), floor, np.median(xyz[:, 2])])
    xyz = (xyz - centre) * scale
    cams = (cams - centre) * scale
    # crop far-away strays (through windows, mirrors) to the bulk of the room
    lo, hi = np.percentile(xyz, 0.5, axis=0), np.percentile(xyz, 99.5, axis=0)
    pad = (hi - lo) * 0.08
    box = ((xyz >= lo - pad) & (xyz <= hi + pad)).all(1)
    xyz, rgb = xyz[box], rgb[box]
    report("Thinning %s points" % format(len(xyz), ","), 0.7)
    xyz, rgb = voxel_down(xyz, rgb, quality["voxel"])
    try:
        from scipy.spatial import cKDTree
        report("Removing stray points", 0.74)
        tree = cKDTree(xyz)
        d, _ = tree.query(xyz, k=9)
        md = d[:, 1:].mean(1)
        ok = md < md.mean() + 2.2 * md.std()
        xyz, rgb = xyz[ok], rgb[ok]
    except ImportError:
        pass
    if len(xyz) > quality["max_points"]:
        idx = np.random.default_rng(1).choice(len(xyz), quality["max_points"], replace=False)
        xyz, rgb = xyz[idx], rgb[idx]
    return xyz.astype("f4"), rgb, cams, fwd


def rotation_between(a, b):
    import numpy as np
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (np.linalg.norm(v) ** 2))


def voxel_down(xyz, rgb, size):
    import numpy as np
    keys = np.floor(xyz / size).astype(np.int64)
    keys -= keys.min(0)
    dims = keys.max(0) + 1
    flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
    _, inv, counts = np.unique(flat, return_inverse=True, return_counts=True)
    out_xyz = np.zeros((len(counts), 3))
    out_rgb = np.zeros((len(counts), 3))
    for k in range(3):
        out_xyz[:, k] = np.bincount(inv, xyz[:, k]) / counts
        out_rgb[:, k] = np.bincount(inv, rgb[:, k].astype("f8")) / counts
    return out_xyz, np.clip(out_rgb, 0, 255).astype("u1")


def build_mesh(xyz, rgb, cams, quality, report):
    """A coloured surface with Open3D's Poisson reconstruction. None if Open3D isn't installed."""
    try:
        import numpy as np
        import open3d as o3d
    except ImportError:
        print("  (no Open3D: skipping the mesh. pip install open3d to get surfaces too)", flush=True)
        return None
    report("Building the surface mesh", 0.78)
    pcd = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(xyz.astype("f8")))
    pcd.colors = o3d.utility.Vector3dVector(rgb.astype("f8") / 255.0)
    pcd.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=quality["voxel"] * 6, max_nn=30))
    pcd.orient_normals_towards_camera_location(cams.mean(0))  # the phone was inside the room: normals face inward
    mesh, dens = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=quality["depth"])
    dens = np.asarray(dens)
    mesh.remove_vertices_by_mask(dens < np.quantile(dens, 0.06))
    bbox = pcd.get_axis_aligned_bounding_box()
    mesh = mesh.crop(bbox)
    report("Simplifying the mesh", 0.86)
    if len(mesh.triangles) > quality["faces"]:
        mesh = mesh.simplify_quadric_decimation(quality["faces"])
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    v = np.asarray(mesh.vertices)
    c = (np.clip(np.asarray(mesh.vertex_colors), 0, 1) * 255).astype("u1") if mesh.has_vertex_colors() else np.full((len(v), 3), 200, "u1")
    f = np.asarray(mesh.triangles)
    if len(f) == 0:
        return None
    return v, c, f


def stats_for(xyz, faces=0):
    import numpy as np
    lo, hi = np.percentile(xyz, 1, axis=0), np.percentile(xyz, 99, axis=0)
    size = (hi - lo)
    floor = xyz[xyz[:, 1] < 0.25]
    area = 0.0
    if len(floor):
        cells = np.unique(np.floor(floor[:, [0, 2]] / 0.1).astype(np.int64), axis=0)
        area = len(cells) * 0.01
    return {"points": int(len(xyz)), "faces": int(faces), "size": [round(float(size[0]), 3), round(float(size[2]), 3), round(float(size[1]), 3)],
            "area": round(area, 2)}


def path_for(cams, fwd, frame_ids):
    import numpy as np
    out = []
    step = max(1, len(cams) // 600)
    for i in range(0, len(cams), step):
        d = fwd[i] / (np.linalg.norm(fwd[i]) + 1e-9)
        out.append([round(float(cams[i][0]), 3), round(float(cams[i][1]), 3), round(float(cams[i][2]), 3),
                    round(float(d[0]), 3), round(float(d[1]), 3), round(float(d[2]), 3), int(frame_ids[i])])
    return out


def process(app, job, args):
    token = job["token"]
    quality = QUALITY.get(job.get("quality"), QUALITY["balanced"])
    t0 = time.time()
    print("\nJob: %s (%d frames, %s%s)" % (job["title"], job["frames"], job.get("quality"), ", portrait" if job.get("portrait") else ""), flush=True)
    app.progress(token, "Downloading %d frames" % job["frames"], 0.03)
    data = app.frames(token)
    work = tempfile.mkdtemp(prefix="logsteps-")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".jpg"))
        z.extractall(work, names)
    if len(names) < 8:
        raise ValueError("Only %d frames arrived; a room needs more." % len(names))
    ids = list(range(0, len(names), quality["stride"])) if len(names) > 60 else list(range(len(names)))
    paths = [os.path.join(work, names[i]) for i in ids]
    report = lambda stage, p: app.progress(token, stage, p)  # noqa: E731
    if args.fake:
        cloud, mesh, path, st = fake_result(job, report)
    else:
        if job.get("portrait"):
            from PIL import Image
            report("Turning portrait frames", 0.08)
            for p in paths:
                Image.open(p).transpose(Image.ROTATE_270).save(p, quality=92)
        xyz, rgb, conf, c2w = run_lingbot(args, paths, quality, app, token)
        xyz, rgb, cams, fwd = tidy(xyz, rgb, conf, c2w, bool(job.get("portrait")), quality, report)
        mesh_parts = build_mesh(xyz, rgb, cams, quality, report) if job.get("mesh", True) else None
        report("Packing the files", 0.9)
        cloud = ply_points(xyz, rgb)
        mesh = ply_mesh(*mesh_parts) if mesh_parts else None
        st = stats_for(xyz, len(mesh_parts[2]) if mesh_parts else 0)
        path = path_for(cams, fwd, ids)
    report("Uploading the 3D model", 0.93)
    files = {"cloud": app.upload(token, "cloud", cloud)}
    if mesh:
        files["mesh"] = app.upload(token, "mesh", mesh)
    app.done(token, {"files": files, "stats": st, "path": path, "ms": int((time.time() - t0) * 1000),
                     "model": "fake" if args.fake else "lingbot-map.pt", "scale_source": "estimated"})
    print("  done in %.0fs: %s points%s" % (time.time() - t0, format(st["points"], ","), ", %s faces" % format(st["faces"], ",") if st["faces"] else ""), flush=True)


def fake_result(job, report):
    """--fake: a made-up room (no GPU, no lingbot-map), to test the app <-> station plumbing."""
    rng = random.Random(len(job["token"]))
    report("Pretending to reconstruct (--fake)", 0.4)
    time.sleep(1)
    w, d, h = 4.0 + rng.random(), 3.0 + rng.random(), 2.6
    pts, cols = [], []
    wall = (230, 222, 210)
    for _ in range(40000):
        face = rng.random()
        a, b = rng.random(), rng.random()
        if face < 0.3:
            p, c = (-w / 2 + a * w, 0, -d / 2 + b * d), ((170, 120, 80) if int(a * 20) % 2 else (150, 100, 65))
        elif face < 0.45:
            p, c = (-w / 2 + a * w, h, -d / 2 + b * d), (245, 242, 236)
        elif face < 0.65:
            p, c = (-w / 2 + a * w, b * h, -d / 2 if rng.random() < .5 else d / 2), wall
        elif face < 0.85:
            p, c = (-w / 2 if rng.random() < .5 else w / 2, b * h, -d / 2 + a * d), wall
        else:
            p, c = (-0.6 + a * 1.2, rng.random() * 0.45, -0.4 + b * 0.8), (194, 82, 43)
        pts.append(p)
        cols.append(c)
    path = [[round(math.cos(i / 20) * 0.6, 3), 1.4, round(math.sin(i / 20) * 0.5, 3), round(math.cos(i / 20 + 1.2), 3), -0.1,
             round(math.sin(i / 20 + 1.2), 3), i] for i in range(max(2, job["frames"]))]
    st = {"points": len(pts), "faces": 0, "size": [round(w, 2), round(d, 2), h], "area": round(w * d, 1)}
    return ply_points(pts, cols), None, path, st


# ----------------------------------------------------------------------------------------------- main loop
def gpu_name():
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    return "no GPU"


def main():
    ap = argparse.ArgumentParser(description="Logsteps scan station (lingbot-map)")
    ap.add_argument("--app", default=os.environ.get("LOGSTEPS_APP"), help="the app's address, e.g. https://logsteps.anvil.app")
    ap.add_argument("--key", default=os.environ.get("LOGSTEPS_KEY"), help="the station key from Admin -> Scan station")
    ap.add_argument("--model", default=os.environ.get("LINGBOT_MODEL"), help="path to lingbot-map.pt (default: download from Hugging Face)")
    ap.add_argument("--name", default=socket.gethostname(), help="the name shown in the app")
    ap.add_argument("--flashinfer", action="store_true", help="use FlashInfer attention (Linux, faster) instead of PyTorch SDPA")
    ap.add_argument("--once", action="store_true", help="process one job (or none) and stop")
    ap.add_argument("--fake", action="store_true", help="no GPU: send a made-up room back (tests the connection)")
    ap.add_argument("--every", type=float, default=8, help="seconds between checks for new scans")
    args = ap.parse_args()
    if not args.app or not args.key:
        ap.error("--app and --key are needed (or LOGSTEPS_APP / LOGSTEPS_KEY)")
    app = App(args.app, args.key)
    info = {"name": args.name, "gpu": "fake" if args.fake else gpu_name(), "version": VERSION}
    print("Logsteps scan station %s: %s, %s. Waiting for scans (Ctrl+C to stop)." % (VERSION, info["name"], info["gpu"]), flush=True)
    if not args.fake:
        load_model(args)  # load once up front, so the first scan doesn't wait for it
    idle = 0
    while True:
        try:
            job = app.claim(info)
        except (urllib.error.URLError, socket.timeout, RuntimeError) as e:
            print("Can't reach the app (%s). Trying again soon." % e, flush=True)
            time.sleep(min(60, args.every * 3))
            continue
        if job:
            idle = 0
            try:
                process(app, job, args)
            except Cancelled:
                print("  stopped: the scan was cancelled or deleted in the app", flush=True)
            except Exception as e:
                traceback.print_exc()
                msg = str(e) or type(e).__name__
                if "out of memory" in msg.lower():
                    msg = "The scan station ran out of GPU memory. Try Fast quality, or a shorter walk."
                app.fail(job["token"], "Processing failed: " + msg)
        else:
            idle += 1
            if args.once:
                print("No scans waiting.")
        if args.once:
            break
        time.sleep(args.every if idle else 1)


if __name__ == "__main__":
    main()
