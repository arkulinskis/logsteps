"""Make the demo scans: procedural rooms sampled like a real scan (noise, speckles, light from the window).

    python -I tools/make_demo_scans.py

Writes theme/assets/demo-<slug>.ply (binary point clouds: x y z float32 + red green blue uchar, metres, Y up,
floor at y=0, centred) and server_code/DemoScenes.py (each scene's size, point count and camera path, read by
DemoData.py). Pure Python and seeded, so the output is the same every run. The rooms are made up.
"""
import math
import pathlib
import random
import struct

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE.parent / "theme" / "assets"
SERVER = HERE.parent / "server_code"


def hexrgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


class Scene(object):
    def __init__(self, slug, w, d, h, seed, density=640):
        self.slug, self.w, self.d, self.h = slug, w, d, h
        self.rng = random.Random(seed)
        self.pts = []
        self.density = density
        self.lights = []  # (x, y, z, strength)

    # -------------------------------------------------- sampling
    def quad(self, o, u, v, color, density=1.0, holes=()):
        """Points on the parallelogram o + a*u + b*v (a, b in 0..1). color(a, b, p) -> rgb. holes: (a0, b0, a1, b1)."""
        area = math.sqrt(sum(c * c for c in cross(u, v)))
        n = int(area * self.density * density)
        r = self.rng
        for _ in range(n):
            a, b = r.random(), r.random()
            if any(h[0] <= a <= h[2] and h[1] <= b <= h[3] for h in holes):
                continue
            p = (o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2])
            self.add(p, color(a, b, p))

    def box(self, x0, y0, z0, x1, y1, z1, color, density=1.0, bottom=False):
        c = color if callable(color) else (lambda a, b, p, col=hexrgb(color): col)
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        self.quad((x0, y1, z0), (dx, 0, 0), (0, 0, dz), c, density)              # top
        if bottom:
            self.quad((x0, y0, z0), (dx, 0, 0), (0, 0, dz), c, density)
        self.quad((x0, y0, z0), (dx, 0, 0), (0, dy, 0), c, density)              # back (z0)
        self.quad((x0, y0, z1), (dx, 0, 0), (0, dy, 0), c, density)              # front (z1)
        self.quad((x0, y0, z0), (0, 0, dz), (0, dy, 0), c, density)              # left
        self.quad((x1, y0, z0), (0, 0, dz), (0, dy, 0), c, density)              # right

    def cylinder(self, cx, cz, r, y0, y1, color, density=1.0, cap=True):
        c = color if callable(color) else (lambda a, b, p, col=hexrgb(color): col)
        n = int(2 * math.pi * r * (y1 - y0) * self.density * density)
        for _ in range(n):
            t, y = self.rng.random() * 2 * math.pi, y0 + self.rng.random() * (y1 - y0)
            p = (cx + r * math.cos(t), y, cz + r * math.sin(t))
            self.add(p, c(t / (2 * math.pi), (y - y0) / max(y1 - y0, 1e-6), p))
        if cap:
            n = int(math.pi * r * r * self.density * density)
            for _ in range(n):
                t, rr = self.rng.random() * 2 * math.pi, r * math.sqrt(self.rng.random())
                p = (cx + rr * math.cos(t), y1, cz + rr * math.sin(t))
                self.add(p, c(0.5, 1, p))

    def blob(self, cx, cy, cz, rx, ry, rz, color, density=1.0, lumpy=0.18):
        c = color if callable(color) else (lambda a, b, p, col=hexrgb(color): col)
        area = 4 * math.pi * ((rx * ry) ** 1.6 + (rx * rz) ** 1.6 + (ry * rz) ** 1.6) / 3
        n = int(area ** (1 / 1.6) * self.density * density)
        for _ in range(n):
            u, v = self.rng.uniform(-1, 1), self.rng.random() * 2 * math.pi
            s = math.sqrt(1 - u * u)
            k = 1 + lumpy * (math.sin(5 * v + 3 * u) * math.cos(4 * u) + self.rng.uniform(-.5, .5))
            p = (cx + rx * s * math.cos(v) * k, cy + ry * u * k, cz + rz * s * math.sin(v) * k)
            if p[1] < 0:
                continue
            self.add(p, c(v / (2 * math.pi), (u + 1) / 2, p))

    def add(self, p, rgb):
        r = self.rng
        n = 0.0045
        p = (p[0] + r.gauss(0, n), p[1] + r.gauss(0, n), p[2] + r.gauss(0, n))
        light = 0.74
        for lx, ly, lz, s in self.lights:
            dd = (p[0] - lx) ** 2 + (p[1] - ly) ** 2 + (p[2] - lz) ** 2
            light += s / (1 + dd * 0.35)
        light = min(light, 1.18) + r.uniform(-0.035, 0.035)
        col = tuple(max(0, min(255, int(ch * light + r.uniform(-7, 7)))) for ch in rgb)
        self.pts.append((p, col))

    # -------------------------------------------------- room shell
    def shell(self, floor, walls, ceiling="#f3eee6", windows=None, wall_overrides=None):
        """floor/walls: colour fns or hex. windows: {wall: [(a0, b0, a1, b1)]} with walls 'n','s','e','w' (a along, b up)."""
        w, d, h = self.w, self.d, self.h
        x0, x1, z0, z1 = -w / 2, w / 2, -d / 2, d / 2
        windows = windows or {}
        wall_overrides = wall_overrides or {}
        fc = floor if callable(floor) else (lambda a, b, p, col=hexrgb(floor): col)
        self.quad((x0, 0, z0), (w, 0, 0), (0, 0, d), fc, 1.05)
        cc = hexrgb(ceiling)
        self.quad((x0, h, z0), (w, 0, 0), (0, 0, d), lambda a, b, p: cc, 0.55)
        spec = {"n": ((x0, 0, z0), (w, 0, 0)), "s": ((x1, 0, z1), (-w, 0, 0)), "w": ((x0, 0, z1), (0, 0, -d)), "e": ((x1, 0, z0), (0, 0, d))}
        for k, (o, u) in spec.items():
            col = wall_overrides.get(k, walls)
            wc = col if callable(col) else (lambda a, b, p, c=hexrgb(col): c)
            holes = windows.get(k, [])
            self.quad(o, u, (0, h, 0), wc, 1.0, holes)
            for (a0, b0, a1, b1) in holes:  # window frame + a hint of glass
                L = math.sqrt(u[0] ** 2 + u[2] ** 2)
                frame = hexrgb("#fbf8f2")
                for (fa0, fb0, fa1, fb1) in ((a0, b0, a1, b0 + .02), (a0, b1 - .02, a1, b1), (a0, b0, a0 + .012, b1), (a1 - .012, b0, a1, b1),
                                             ((a0 + a1) / 2 - .006, b0, (a0 + a1) / 2 + .006, b1)):
                    po = (o[0] + fa0 * u[0], fb0 * h, o[2] + fa0 * u[2])
                    self.quad(po, ((fa1 - fa0) * u[0], 0, (fa1 - fa0) * u[2]), (0, (fb1 - fb0) * h, 0), lambda a, b, p: frame, 2.2)
                glass = hexrgb("#cfe3ee")
                po = (o[0] + a0 * u[0], b0 * h, o[2] + a0 * u[2])
                self.quad(po, ((a1 - a0) * u[0], 0, (a1 - a0) * u[2]), (0, (b1 - b0) * h, 0), lambda a, b, p: mix(glass, (255, 255, 255), b * .6), 0.18)
                self.lights.append((o[0] + (a0 + a1) / 2 * u[0], (b0 + b1) / 2 * h, o[2] + (a0 + a1) / 2 * u[2], 0.32))
                _ = L
        # skirting boards
        sk = hexrgb("#f7f2ea")
        for k, (o, u) in spec.items():
            self.quad((o[0], 0, o[2]), u, (0, 0.08, 0), lambda a, b, p: sk, 1.4)

    def speckles(self, n):
        """Stray points, like a real scan has (Studio's "Clean up noise" removes them)."""
        r = self.rng
        for _ in range(n):
            p = (r.uniform(-self.w / 2, self.w / 2), r.uniform(0.2, self.h - 0.2), r.uniform(-self.d / 2, self.d / 2))
            g = r.randint(90, 200)
            self.pts.append((p, (g, g - 8, g - 16)))

    # -------------------------------------------------- output
    def path(self, n=120, inset=0.9, eye=1.42):
        """A slow loop around the room, the phone looking at the walls, like a real capture."""
        out = []
        ax, az = max(self.w / 2 - inset, 0.4), max(self.d / 2 - inset, 0.4)
        for i in range(n):
            t = i / n * 2 * math.pi
            x, z = ax * 0.55 * math.cos(t), az * 0.55 * math.sin(t)
            y = eye + 0.03 * math.sin(i * 0.9)
            look = t + math.pi * 0.35 + 0.25 * math.sin(i * 0.21)
            dx, dz = math.cos(look), math.sin(look)
            dy = -0.12 + 0.14 * math.sin(i * 0.13)
            m = math.sqrt(dx * dx + dy * dy + dz * dz)
            out.append([round(x, 3), round(y, 3), round(z, 3), round(dx / m, 3), round(dy / m, 3), round(dz / m, 3), i])
        return out

    def write(self):
        pts = self.pts
        head = ("ply\nformat binary_little_endian 1.0\ncomment Logsteps demo scan (procedural, made up)\nelement vertex %d\n"
                "property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n" % len(pts))
        buf = bytearray(head.encode("ascii"))
        pack = struct.Struct("<fffBBB").pack
        for (p, c) in pts:
            buf += pack(p[0], p[1], p[2], c[0], c[1], c[2])
        (ASSETS / ("demo-%s.ply" % self.slug)).write_bytes(bytes(buf))
        xs = [p[0] for p, _ in pts]
        ys = [p[1] for p, _ in pts]
        zs = [p[2] for p, _ in pts]
        return {"points": len(pts), "bbox": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3), round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)],
                "size": [round(self.w, 2), round(self.d, 2), round(self.h, 2)], "bytes": len(buf)}


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


# ------------------------------------------------------------------ patterns
def planks(c1, c2, width=0.18, along="x"):
    A, B = hexrgb(c1), hexrgb(c2)

    def f(a, b, p):
        u, v = (p[2], p[0]) if along == "x" else (p[0], p[2])
        k = math.floor(u / width)
        shade = (math.sin(k * 12.9898) * 43758.5453) % 1
        grain = 0.5 + 0.5 * math.sin(v * 9 + k * 3 + math.sin(v * 31 + k) * .6)
        col = mix(A, B, 0.25 + 0.5 * shade)
        col = mix(col, B, grain * 0.18)
        if (u / width) % 1 < 0.04:
            col = mix(col, (40, 28, 20), 0.35)
        return col
    return f


def tiles(c1, c2, size=0.3, grout="#d9d4cc", checker=True):
    A, B, G = hexrgb(c1), hexrgb(c2), hexrgb(grout)

    def f(a, b, p):
        u, v = p[0] / size, p[2] / size
        if u % 1 < 0.04 or v % 1 < 0.04:
            return G
        return A if (not checker or (math.floor(u) + math.floor(v)) % 2 == 0) else B
    return f


def subway(c, grout="#cfc7bb", w=0.15, h=0.075, axis=0):
    C, G = hexrgb(c), hexrgb(grout)

    def f(a, b, p):
        row = math.floor(p[1] / h)
        u = (p[axis] / w) + (0.5 if row % 2 else 0)
        if (p[1] / h) % 1 < 0.08 or u % 1 < 0.04:
            return G
        return C
    return f


def bricks(c1, c2, mortar="#cdbfae", axis=0):
    A, B, M = hexrgb(c1), hexrgb(c2), hexrgb(mortar)

    def f(a, b, p):
        row = math.floor(p[1] / 0.075)
        u = p[axis] / 0.23 + (0.5 if row % 2 else 0)
        if (p[1] / 0.075) % 1 < 0.13 or u % 1 < 0.05:
            return M
        k = (math.sin(math.floor(u) * 7.1 + row * 3.3) * 999) % 1
        return mix(A, B, k)
    return f


def speck(c, amount=22):
    C = hexrgb(c)

    def f(a, b, p):
        k = ((math.sin(p[0] * 91.7 + p[2] * 47.3 + p[1] * 13.1) * 9999) % 1 - 0.5) * amount
        return tuple(ch + k for ch in C)
    return f


def solid(c):
    C = hexrgb(c)
    return lambda a, b, p: C


def stripes(c1, c2, width=0.12, axis=0):
    A, B = hexrgb(c1), hexrgb(c2)
    return lambda a, b, p: A if (p[axis] / width) % 2 < 1 else B


def books(colors):
    cs = [hexrgb(c) for c in colors]

    def f(a, b, p):
        k = int(abs(p[0] * 31 + p[2] * 31)) % len(cs)
        return cs[k]
    return f


def rug_rings(c1, c2, c3, cx=0.0, cz=0.0):
    A, B, C = hexrgb(c1), hexrgb(c2), hexrgb(c3)

    def f(a, b, p):
        r = math.hypot(p[0] - cx, p[2] - cz)
        k = int(r / 0.16) % 3
        return (A, B, C)[k]
    return f


def rug_geo(c1, c2, border):
    A, B, Bo = hexrgb(c1), hexrgb(c2), hexrgb(border)

    def f(a, b, p):
        if a < 0.06 or a > 0.94 or b < 0.08 or b > 0.92:
            return Bo
        u, v = a * 9, b * 6
        return A if (abs((u % 2) - 1) + abs((v % 2) - 1)) < 0.9 else B
    return f


def leaves(c1="#3f6b3a", c2="#7aa35a"):
    A, B = hexrgb(c1), hexrgb(c2)
    return lambda a, b, p: mix(A, B, ((math.sin(p[0] * 40) * math.cos(p[2] * 37) + 1) / 2))


# ------------------------------------------------------------------ the rooms
def loft():
    s = Scene("loft", 6.2, 4.8, 2.9, 11)
    s.shell(planks("#b98b5c", "#8a5f3a"), "#efe7dc", windows={"n": [(0.18, 0.28, 0.62, 0.86)]},
            wall_overrides={"w": bricks("#a8553a", "#7f3c28", axis=2)})
    s.lights.append((0, 2.6, 0, 0.12))
    # rug + sofa + coffee table
    s.quad((-1.7, 0.012, -0.2), (2.6, 0, 0), (0, 0, 1.9), rug_geo("#c2522b", "#e9c9a5", "#5b3a2a"), 1.3)
    sofa = "#6f8f7a"
    s.box(-1.5, 0.0, 1.2, 0.9, 0.42, 2.1, sofa)          # seat base
    s.box(-1.5, 0.42, 1.85, 0.9, 0.86, 2.1, sofa)        # back
    s.box(-1.7, 0.0, 1.2, -1.5, 0.62, 2.1, sofa)         # arms
    s.box(0.9, 0.0, 1.2, 1.1, 0.62, 2.1, sofa)
    for i, c in enumerate(("#d9b26a", "#c2522b", "#e8dfd0")):
        s.box(-1.2 + i * 0.75, 0.42, 1.7, -0.75 + i * 0.75, 0.78, 1.85, c, 1.4)   # cushions
    s.box(-0.95, 0.36, 0.25, 0.45, 0.42, 0.95, "#6b4329", 1.3)                  # coffee table top
    for (x, z) in ((-0.9, 0.3), (0.4, 0.3), (-0.9, 0.9), (0.4, 0.9)):
        s.box(x - 0.025, 0, z - 0.025, x + 0.025, 0.36, z + 0.025, "#4a2e1d", 2)
    s.box(-0.3, 0.42, 0.45, -0.05, 0.47, 0.62, "#e9e3d8", 3)                    # books on the table
    s.cylinder(0.2, 0.6, 0.06, 0.42, 0.55, "#c2522b", 3)                         # mug-ish vase
    # bookshelf on the east wall
    s.box(2.75, 0, -1.6, 3.1, 2.2, -0.2, "#e9e1d4")
    for k in range(5):
        y = 0.25 + k * 0.42
        s.quad((2.76, y, -1.55), (0, 0, 1.3), (0, 0.3, 0), books(["#c2522b", "#4f7f6a", "#d9b26a", "#2a4b6a", "#efe7dc", "#7a3b2e"]), 2.0)
    # TV console + TV on the north wall
    s.box(-0.9, 0, -2.4, 0.9, 0.5, -1.98, "#3b2a20")
    s.box(-0.75, 0.95, -2.39, 0.75, 1.78, -2.33, "#141210", 1.4)
    # floor lamp + plant
    s.cylinder(2.3, 1.7, 0.015, 0, 1.55, "#2a231e", 3, cap=False)
    s.cylinder(2.3, 1.7, 0.22, 1.45, 1.75, "#f2e3c6", 1.6)
    s.lights.append((2.3, 1.6, 1.7, 0.22))
    s.cylinder(-2.6, -1.8, 0.22, 0, 0.45, "#c9a27c", 1.8)
    s.blob(-2.6, 0.95, -1.8, 0.45, 0.55, 0.45, leaves(), 1.6, 0.3)
    s.cylinder(0, 0, 0.18, 2.55, 2.75, "#2a231e", 1.5)                          # pendant
    s.speckles(900)
    return s, {"title": "Maple Street loft", "room": "living", "notes": "Our living room before the repaint. The brick wall stays!"}


def kitchen():
    s = Scene("kitchen", 4.2, 3.6, 2.6, 22)
    s.shell(tiles("#e7e2d9", "#5d6670", 0.3), "#f4efe6", windows={"n": [(0.55, 0.42, 0.85, 0.85)]})
    navy, top = "#2d4a63", "#f3f0ea"
    s.box(-2.1, 0, -1.8, 2.1, 0.88, -1.2, navy)                     # lower cabinets north
    s.box(-2.1, 0.88, -1.8, 2.1, 0.92, -1.17, top, 1.4)             # counter
    s.box(-2.1, 0, -1.2, -1.5, 0.88, 1.0, navy)                     # lower cabinets west
    s.box(-2.1, 0.88, -1.2, -1.47, 0.92, 1.0, top, 1.4)
    s.quad((-2.09, 0.92, -1.79), (2.3, 0, 0), (0, 0.6, 0), subway("#eef2f0"), 1.6)   # backsplash
    s.box(-2.1, 1.55, -1.8, 0.2, 2.3, -1.45, "#e9e4da")             # upper cabinets
    s.box(0.25, 0, -1.8, 0.95, 1.95, -1.15, "#b9bec4", 1.2)         # fridge
    s.box(-0.9, 0.92, -1.75, -0.3, 0.95, -1.35, "#9aa3ab", 2)       # sink
    s.box(-0.6, 0, -0.1, 0.9, 0.9, 0.85, "#4f7f6a")                 # island
    s.box(-0.7, 0.9, -0.2, 1.0, 0.95, 0.95, "#3a2b22", 1.4)          # island top (walnut)
    for x in (-0.3, 0.3, 0.8):
        s.cylinder(x, 1.25, 0.17, 0.62, 0.68, "#c2522b", 2.5)
        s.cylinder(x, 1.25, 0.02, 0, 0.62, "#2a231e", 3, cap=False)
    s.blob(0.1, 1.05, 0.35, 0.16, 0.08, 0.16, "#d9b26a", 2.5, 0.1)  # bread basket
    s.cylinder(1.7, -1.5, 0.11, 0.92, 1.12, "#c9d6c1", 3)
    s.blob(1.7, 1.28, -1.5, 0.18, 0.2, 0.18, leaves("#4c7a3c", "#93b86b"), 2.2, 0.35)
    for x in (-0.3, 0.4):
        s.cylinder(x, 0.35, 0.12, 1.9, 2.05, "#2a231e", 2)
    s.lights += [(-0.3, 1.9, 0.35, 0.14), (0.4, 1.9, 0.35, 0.14)]
    s.speckles(600)
    return s, {"title": "Sunny kitchen, flat 4B", "room": "kitchen", "notes": "Measured before ordering the new island stools."}


def office():
    s = Scene("office", 3.4, 3.0, 2.7, 33)
    s.shell(speck("#8f8a84", 26), "#dfe6dc", windows={"e": [(0.3, 0.32, 0.7, 0.84)]})
    s.box(-1.6, 0.72, -1.48, 0.2, 0.76, -0.8, "#c8a170", 1.4)         # desk top
    for (x, z) in ((-1.55, -1.43), (0.15, -1.43), (-1.55, -0.85), (0.15, -0.85)):
        s.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.72, z + 0.02, "#f2efe9", 3)
    s.box(-1.0, 0.95, -1.44, -0.3, 1.36, -1.41, "#151515", 2)          # monitor
    s.box(-0.67, 0.76, -1.43, -0.63, 0.95, -1.4, "#222", 3)
    s.box(-0.95, 0.76, -1.1, -0.45, 0.78, -0.95, "#d8d4ce", 3)         # keyboard
    s.cylinder(-0.65, -0.35, 0.26, 0.42, 0.5, "#232323", 2)             # chair seat
    s.box(-0.9, 0.5, -0.1, -0.4, 1.05, -0.04, "#232323", 2)             # chair back
    s.cylinder(-0.65, -0.35, 0.03, 0, 0.42, "#555", 3, cap=False)
    s.quad((-1.69, 1.2, 0.2), (0, 0, 1.0), (0, 0.7, 0), speck("#b98e5e", 30), 2.0)    # pinboard
    for i, c in enumerate(("#f4d35e", "#ee8f6b", "#a6d1c3", "#fffaf0")):
        s.quad((-1.68, 1.3 + (i % 2) * 0.28, 0.3 + i * 0.2), (0, 0, 0.12), (0, 0.15, 0), solid(c), 4)
    s.box(0.6, 0, -1.5, 1.7, 1.9, -1.2, "#f2efe9")                      # shelves
    for k in range(4):
        s.quad((0.65, 0.2 + k * 0.45, -1.21), (1.0, 0, 0), (0, 0.3, 0), books(["#4f7f6a", "#c2522b", "#2a4b6a", "#d9b26a", "#f2efe9"]), 2.2)
    s.cylinder(1.35, 1.1, 0.18, 0, 0.38, "#efe7dc", 2)
    s.blob(1.35, 0.8, 1.1, 0.32, 0.42, 0.32, leaves(), 1.8, 0.3)
    s.quad((-0.9, 0.012, -0.9), (1.6, 0, 0), (0, 0, 1.4), stripes("#e9e1d4", "#c9bca9", 0.1), 1.2)
    s.speckles(500)
    return s, {"title": "Corner office", "room": "office", "notes": "Home office in the old guest room."}


def bedroom():
    s = Scene("bedroom", 4.0, 3.5, 2.6, 44)
    s.shell(planks("#d8b98f", "#b8946a", along="z"), stripes("#f6e7c8", "#f1dcb2", 0.16, 0), windows={"w": [(0.3, 0.3, 0.7, 0.82)]})
    s.box(-0.6, 0, -1.75, 1.0, 0.3, 0.35, "#e9e1d4")                    # bed frame
    s.box(-0.55, 0.3, -1.7, 0.95, 0.5, 0.3, "#fbfaf7")                  # mattress
    s.quad((-0.56, 0.51, -0.9), (1.52, 0, 0), (0, 0, 1.21), stripes("#7fa7c9", "#5a86ad", 0.14, 0), 1.6)   # duvet
    s.box(-0.5, 0.5, -1.68, 0.2, 0.66, -1.35, "#fdfdfb", 1.6)            # pillows
    s.box(0.25, 0.5, -1.68, 0.9, 0.66, -1.35, "#f4d35e", 1.6)
    s.box(-0.62, 0, -1.75, 1.02, 1.1, -1.7, "#c9a27c")                  # headboard
    s.box(1.3, 0, 1.2, 1.95, 0.48, 1.7, "#c2522b")                      # toy chest
    s.blob(1.6, 0.6, 1.45, 0.12, 0.12, 0.12, "#4f7f6a", 3, 0.05)        # ball
    s.box(-1.95, 0, 0.6, -1.35, 2.1, 1.7, "#efe9df")                    # wardrobe
    s.quad((-1.34, 1.0, 0.95), (0, 0, 0.02), (0, 0.15, 0), solid("#8a6a48"), 6)
    s.quad((0.0, 0.012, 0.6), (1.2, 0, 0), (0, 0, 1.2), rug_rings("#f4d35e", "#7fa7c9", "#fbfaf7", 0.6, 1.2), 1.3)
    s.box(1.15, 0, -1.7, 1.6, 0.5, -1.25, "#e9e1d4")                    # bedside table
    s.cylinder(1.38, -1.48, 0.1, 0.5, 0.85, "#fbf2dc", 2.5)
    s.lights.append((1.38, 0.8, -1.48, 0.2))
    for (y0, y1) in ((0.7, 2.25),):
        s.quad((-1.98, y0, 0.95), (0, 0, -0.35), (0, y1 - y0, 0), stripes("#c2522b", "#b04a26", 0.06, 2), 1.5)  # curtain
        s.quad((-1.98, y0, -0.7), (0, 0, 0.35), (0, y1 - y0, 0), stripes("#c2522b", "#b04a26", 0.06, 2), 1.5)
    s.speckles(500)
    return s, {"title": "Kofi's room (bunk-bed planning)", "room": "bedroom", "notes": "To check if a bunk bed fits under the slope."}


def gallery():
    s = Scene("gallery", 8.0, 2.4, 3.0, 55, density=620)
    s.shell(speck("#a9a49b", 18), "#f7f4ee", ceiling="#fbfaf7")
    colors = [("#c2522b", "#e9c9a5"), ("#2a4b6a", "#d9b26a"), ("#4f7f6a", "#f2efe9"), ("#7a3b2e", "#f4d35e"), ("#151515", "#efe7dc")]
    for i, (a, b) in enumerate(colors):
        x = -3.3 + i * 1.6
        w, h = (1.0, 0.75) if i % 2 == 0 else (0.7, 0.95)
        s.quad((x, 1.15, -1.19), (w, 0, 0), (0, h, 0), solid("#2a231e"), 3)
        A, B = hexrgb(a), hexrgb(b)
        s.quad((x + 0.05, 1.2, -1.18), (w - 0.1, 0, 0), (0, h - 0.1, 0),
               lambda u, v, p, A=A, B=B, k=i: mix(A, B, (math.sin(u * (3 + k) * math.pi) * math.cos(v * (2 + k) * math.pi) + 1) / 2), 3)
        s.lights.append((x + w / 2, 2.6, -0.9, 0.18))
    for i in range(3):
        x = -2.4 + i * 2.4
        s.quad((x, 1.2, 1.19), (1.2, 0, 0), (0, 0.8, 0), solid("#2a231e"), 2.5)
        s.quad((x + 0.06, 1.26, 1.18), (1.08, 0, 0), (0, 0.68, 0), stripes(["#c2522b", "#4f7f6a", "#2a4b6a"][i], "#f2efe9", 0.09, 0), 2.5)
    s.box(-0.9, 0.38, -0.25, 0.9, 0.45, 0.25, "#8a5f3a")                # bench
    for x in (-0.8, 0.8):
        s.box(x - 0.05, 0, -0.2, x + 0.05, 0.38, 0.2, "#2a231e", 2)
    s.speckles(700)
    return s, {"title": "Studio gallery hallway", "room": "hallway", "notes": "For planning the spring show. Spots every 1.6 m."}


SCENES = [("loft", loft, "maya"), ("kitchen", kitchen, "theo"), ("office", office, "ines"), ("bedroom", bedroom, "kofi"), ("gallery", gallery, "maya")]


def main():
    meta = {}
    for slug, fn, who in SCENES:
        s, info = fn()
        stats = s.write()
        info.update(stats)
        info["owner"] = who
        info["path"] = s.path()
        meta[slug] = info
        print("demo-%s.ply  %d points  %.1f MB" % (slug, stats["points"], stats["bytes"] / 1e6))
    lines = ['"""Generated by tools/make_demo_scans.py: the demo scans\' facts (sizes in metres, camera paths). Don\'t edit by hand."""', "", "SCENES: dict = {"]
    for slug, info in meta.items():
        lines.append("    %r: %r," % (slug, info))
    lines.append("}")
    (SERVER / "DemoScenes.py").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("wrote server_code/DemoScenes.py")


if __name__ == "__main__":
    main()
