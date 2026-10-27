# Logsteps scan station

The scan station turns the frames people capture in Logsteps into 3D rooms. It runs
[lingbot-map](https://github.com/Robbyant/lingbot-map) (Apache-2.0) on a computer with an NVIDIA GPU, and talks
to the Logsteps app over HTTPS: it asks for waiting scans, downloads their frames, reconstructs them, and uploads the
point cloud, an optional surface mesh and the camera path.

Anvil's servers have no GPU, so this is the one part of Logsteps that runs on your own machine (or a rented cloud GPU).
Scans wait in the queue until a station is online; the app shows people where their scan is.

## What you need

- An NVIDIA GPU with 8 GB+ of memory (more for long walks), recent drivers, Windows or Linux.
- Python 3.10 (Miniconda is the easiest way).
- About 6 GB of disk for PyTorch and the lingbot-map checkpoint.

## Set it up (once)

```bash
conda create -n logsteps python=3.10 -y
conda activate logsteps

# PyTorch with CUDA (pick the line for your CUDA version at https://pytorch.org)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# lingbot-map
git clone https://github.com/Robbyant/lingbot-map.git
pip install -e ./lingbot-map

# surfaces (optional but recommended: without it you get point clouds only)
pip install open3d
```

The first run downloads the `lingbot-map.pt` checkpoint from Hugging Face (`robbyant/lingbot-map`). To use a copy you
already have, pass `--model C:\path\to\lingbot-map.pt`.

## Run it

1. In Logsteps, sign in as an admin, open **Admin → Scan station** and click **Make a station key**. Copy it (it's shown once).
2. Download `logsteps_station.py` from the same page (or take it from this folder).
3. Start it:

```bash
conda activate logsteps
python logsteps_station.py --app https://YOUR-APP-ADDRESS --key lsk_...
```

Leave it running. The Scan station tab shows it as online, and scans start moving through the queue. Ctrl+C stops it.

Useful flags: `--once` (one job, then stop), `--name kitchen-pc` (the name shown in the app), `--flashinfer` (Linux
with FlashInfer installed: faster attention), `--fake` (no GPU: sends a made-up room back, to test the connection).
`LOGSTEPS_APP` and `LOGSTEPS_KEY` work instead of `--app` and `--key`.

## What it does with a scan

1. Downloads the frames (JPEGs, about 3 per second of walking). Portrait videos are turned sideways first, as lingbot-map prefers.
2. Runs lingbot-map's streaming reconstruction (518 px frames, KV cache, keyframes for long walks).
3. Keeps the confident 70% of points, levels the room so the floor is flat (from which way the phone was held), and
   sets the scale from the phone's height above the floor (about 1.4 m). That makes measurements roughly right; people
   can calibrate exactly in Studio.
4. Thins the points to an even spacing (Fast 2 cm, Balanced 1.2 cm, Detailed 8 mm), removes strays, and caps the count
   so phones can still show it.
5. With Open3D: builds a coloured surface (Poisson), trims it and simplifies it.
6. Uploads everything in 4 MB parts and marks the scan ready.

If something fails, the scan is marked failed with the reason, and its owner can try again.
