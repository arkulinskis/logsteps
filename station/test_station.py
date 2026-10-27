"""Checks the scan station's geometry steps (no GPU or lingbot-map needed; needs numpy):  python station/test_station.py

A made-up room is put in lingbot-map's kind of coordinates (OpenCV cameras: y points down, the first camera is the
world, unknown scale, tilted), then tidy() must level it (floor at y=0, Y up), scale it from the eye height, and
the PLY writers must produce files the app can read.
"""
import math
import pathlib
import struct
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import logsteps_station as S  # noqa: E402

rng = np.random.default_rng(3)
W, D, H, EYE = 5.0, 4.0, 2.6, 1.4
pts = []
for _ in range(60000):  # floor, ceiling and four walls, Y up, metres
    f, a, b = rng.integers(6), rng.random(), rng.random()
    pts.append([(a - .5) * W, 0, (b - .5) * D] if f == 0 else [(a - .5) * W, H, (b - .5) * D] if f == 1 else
               [(a - .5) * W, b * H, -D / 2] if f == 2 else [(a - .5) * W, b * H, D / 2] if f == 3 else
               [-W / 2, b * H, (a - .5) * D] if f == 4 else [W / 2, b * H, (a - .5) * D])
true = np.array(pts)
# cameras walking a loop at eye height, looking outwards
cams, R_list = [], []
for i in range(40):
    t = i / 40 * 2 * math.pi
    c = np.array([math.cos(t) * 1.0, EYE, math.sin(t) * 0.8])
    fwd = np.array([math.cos(t), 0, math.sin(t)])
    up = np.array([0, 1.0, 0])
    right = np.cross(fwd, up)
    # OpenCV camera axes in world: x = right, y = down, z = forward
    R = np.stack([right, -up, fwd], axis=1)
    cams.append(c); R_list.append(R)
# lingbot world: an arbitrary rotation + scale + offset of the true world
k = 0.37
tilt = S.rotation_between(np.array([0, 1.0, 0]), np.array([0.2, 0.9, 0.3]) / np.linalg.norm([0.2, 0.9, 0.3]))
off = np.array([3.0, -1.0, 2.0])
to_lb = lambda p: (p @ tilt.T) * k + off  # noqa: E731
xyz = to_lb(true)
c2w = np.tile(np.eye(4), (len(cams), 1, 1))
for i, (c, R) in enumerate(zip(cams, R_list)):
    c2w[i, :3, :3] = tilt @ R
    c2w[i, :3, 3] = to_lb(c)
rgb = (rng.random((len(xyz), 3)) * 255).astype("u1")
conf = rng.random(len(xyz)) + 1
q = dict(S.QUALITY["balanced"])
out, col, cam_pos, fwd = S.tidy(xyz, rgb, conf, c2w, False, q, lambda s, p: None)

size = out.max(0) - out.min(0)
floor = np.percentile(out[:, 1], 1)
print("size", size.round(2), "floor", round(float(floor), 3), "points", len(out), "eye", round(float(np.median(cam_pos[:, 1])), 2))
assert abs(floor) < 0.05, "the floor is at 0"
assert abs(size[1] - H) < 0.2, "Y is up and the height is right (scale from the eye height)"
assert abs(sorted([size[0], size[2]])[1] - W) < 0.3 and abs(sorted([size[0], size[2]])[0] - D) < 0.3, "the room keeps its shape"
assert abs(np.median(cam_pos[:, 1]) - EYE) < 0.1, "cameras end up at eye height"
st = S.stats_for(out)
assert st["points"] == len(out) and 15 < st["area"] < 25, st
path = S.path_for(cam_pos, fwd, list(range(len(cam_pos))))
assert len(path) == 40 and len(path[0]) == 7 and abs(path[0][4]) < 0.1, "the path looks level"

ply = S.ply_points(out, col)
n = int(ply.split(b"element vertex ")[1].split(b"\n")[0])
body = ply[ply.index(b"end_header\n") + 11:]
assert n == len(out) and len(body) == n * 15
x, y, z, r, g, b = struct.unpack("<fffBBB", body[:15])
assert abs(x - out[0, 0]) < 1e-5 and r == col[0, 0]
mesh = S.ply_mesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]]), np.array([[255, 0, 0]] * 3), np.array([[0, 1, 2]]))
assert mesh.endswith(struct.pack("<Biii", 3, 0, 1, 2)) and b"element face 1" in mesh
print("station geometry: ALL OK")
