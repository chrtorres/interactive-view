#!/usr/bin/env python3
"""Convert a model file into a local interactive Three.js review package."""

import argparse
import functools
import http.server
import json
import math
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
SUPPORTED = {".glb", ".blend", ".stl", ".obj", ".ply"}


def find_browser(explicit=None):
    if explicit:
        return explicit
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    return None


def find_blender(explicit=None):
    return explicit or shutil.which("blender")


def load_parts(path):
    parts = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parts, list) or len(parts) == 1:
        raise ValueError("expected an array with zero or at least two parts")
    names = set()
    for index, part in enumerate(parts, start=1):
        if not isinstance(part, dict):
            raise ValueError(f"part {index} must be an object")
        for key in ("node", "label"):
            if not isinstance(part.get(key), str) or not part[key].strip():
                raise ValueError(f"part {index} needs a nonempty {key}")
        if part["node"] in names:
            raise ValueError(f"duplicate part node: {part['node']}")
        names.add(part["node"])
        offset = part.get("offset")
        if not (isinstance(offset, list) and len(offset) == 3 and all(
            type(value) in (int, float) and math.isfinite(value) for value in offset
        )):
            raise ValueError(f"part {index} needs three finite offset components")
    return [{key: part[key] for key in ("node", "label", "offset")} for part in parts]


def export_with_blender(source, destination, blender):
    script = """
import bpy, sys
source = sys.argv[sys.argv.index('--') + 1]
destination = sys.argv[sys.argv.index('--') + 2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
suffix = source.lower().rsplit('.', 1)[-1]
if suffix == 'blend':
    bpy.ops.wm.open_mainfile(filepath=source)
elif suffix == 'stl':
    bpy.ops.wm.stl_import(filepath=source)
elif suffix == 'obj':
    bpy.ops.wm.obj_import(filepath=source)
elif suffix == 'ply':
    bpy.ops.wm.ply_import(filepath=source)
else:
    raise RuntimeError('Unsupported Blender conversion input')
bpy.ops.export_scene.gltf(filepath=destination, export_format='GLB', use_selection=False)
"""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as handle:
        handle.write(script)
        script_path = handle.name
    try:
        subprocess.run([blender, "--background", "--python", script_path, "--", str(source), str(destination)], check=True)
    finally:
        os.unlink(script_path)


def start_server(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def generate_screenshot(output, browser):
    server = start_server(output)
    try:
        url = f"http://127.0.0.1:{server.server_port}/"
        with urllib.request.urlopen(url, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError(f"viewer returned HTTP {response.status}")
        screenshot = output / "preview.png"
        subprocess.run([
            browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--virtual-time-budget=6000", "--window-size=1200,800", f"--screenshot={screenshot}", url,
        ], check=True)
        if not screenshot.is_file() or screenshot.stat().st_size == 0:
            raise RuntimeError("browser did not generate a non-empty preview.png")
        return url, screenshot
    finally:
        server.shutdown()
        server.server_close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help=".glb, .blend, .stl, .obj, or .ply model file")
    parser.add_argument("--output", type=Path, required=True, help="review package directory")
    parser.add_argument("--title", default=None)
    parser.add_argument("--status", default="Unapproved · review geometry")
    parser.add_argument("--parts", type=Path, help="JSON array of named GLB parts and explosion offsets")
    parser.add_argument("--browser", default=None)
    parser.add_argument("--blender", default=None)
    parser.add_argument("--no-screenshot", action="store_true")
    args = parser.parse_args(argv)

    source = args.input.expanduser().resolve()
    if not source.is_file():
        parser.error(f"input does not exist: {source}")
    if source.suffix.lower() not in SUPPORTED:
        parser.error(f"unsupported input extension: {source.suffix}")
    try:
        parts = load_parts(args.parts.expanduser()) if args.parts is not None else []
    except (OSError, ValueError, OverflowError) as error:
        parser.error(f"could not read --parts: {error}")
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    for item in VIEWER.iterdir():
        destination = output / item.name
        if item.is_dir():
            shutil.copytree(item, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(item, destination)

    glb = output / "model.glb"
    if source.suffix.lower() == ".glb":
        shutil.copy2(source, glb)
    else:
        blender = find_blender(args.blender)
        if not blender:
            parser.error("Blender is required for non-GLB inputs")
        export_with_blender(source, glb, blender)

    metadata = {
        "title": args.title or source.stem,
        "status": args.status,
        "facts": {"Source": source.name, "Format": source.suffix.lower().lstrip(".").upper()},
        "note": "Interactive viewing does not certify printability, fit, strength, or load capacity.",
        "prompt": ("Use Explode to separate the assembly. Select a part to inspect it."
                   if parts else "Inspect the model from several angles, then send feedback or approve this exact version."),
        "parts": parts,
    }
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    url = None
    if not args.no_screenshot:
        browser = find_browser(args.browser)
        if not browser:
            parser.error("A Chromium-compatible browser is required for preview.png; use --no-screenshot to skip it")
        url, _ = generate_screenshot(output, browser)
    print(f"review_directory={output}")
    print(f"model_glb={glb}")
    print(f"preview_png={output / 'preview.png' if not args.no_screenshot else 'not generated'}")
    if url:
        print(f"review_url={url}")


if __name__ == "__main__":
    main()
