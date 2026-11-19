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
from urllib.parse import urlsplit


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
    return validate_parts(parts)

def validate_parts(parts):
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
        structures = part.get("structures", [])
        if not isinstance(structures, list) or any(
            not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key].strip()
                                               for key in ("node", "label")) for item in structures
        ) or len({item["node"] for item in structures}) != len(structures):
            raise ValueError(f"part {index} needs uniquely named structures")
        for key in ("description", "evidence"):
            if key in part and not isinstance(part[key], str):
                raise ValueError(f"part {index} {key} must be text")
        sources = part.get("sources", [])
        if not isinstance(sources, list):
            raise ValueError(f"part {index} sources must be an array")
        for item in sources:
            if not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key].strip()
                                                for key in ("label", "url")):
                raise ValueError(f"part {index} source needs a label and URL")
            url = urlsplit(item["url"])
            if url.scheme not in ("https", "http") or not url.hostname or url.username is not None:
                raise ValueError(f"part {index} source must be an HTTP(S) URL without credentials")
    return parts


THREE_FILES = (
    "LICENSE", "build/three.module.js", "build/three.core.js",
    "examples/jsm/controls/OrbitControls.js", "examples/jsm/loaders/GLTFLoader.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
)
THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.180.0/"


def load_metadata(path):
    metadata = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be an object")
    validate_parts(metadata.get("parts", []))
    modes = metadata.get("modes", {})
    if not isinstance(modes, dict) or any(
        not key.strip() or not isinstance(nodes, list) or not nodes or
        any(not isinstance(name, str) or not name.strip() for name in nodes) or
        len(set(nodes)) != len(nodes) for key, nodes in modes.items()
    ):
        raise ValueError("modes must map names to nonempty lists of unique top-level nodes")
    labels = metadata.get("modeLabels", {})
    if not isinstance(labels, dict) or any(key not in modes or not isinstance(name, str) or not name.strip()
                                          for key, name in labels.items()):
        raise ValueError("modeLabels must map existing modes to text labels")
    if "defaultMode" in metadata and (
        not isinstance(metadata["defaultMode"], str) or metadata["defaultMode"] not in modes
    ):
        raise ValueError("defaultMode must identify a declared mode")
    animation = metadata.get("animation", {})
    if not isinstance(animation, dict):
        raise ValueError("animation must be an object")
    for key in ("defaultClip", "followNode"):
        if key in animation and (not isinstance(animation[key], str) or not animation[key].strip()):
            raise ValueError(f"animation {key} must be nonempty text")
    for key in ("autoplay", "loop"):
        if key in animation and type(animation[key]) is not bool:
            raise ValueError(f"animation {key} must be a boolean")
    labels = animation.get("labels", {})
    if not isinstance(labels, dict) or any(
        not name.strip() or not isinstance(label, str) or not label.strip()
        for name, label in labels.items()
    ):
        raise ValueError("animation labels must map clip names to nonempty text")
    return metadata


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
        subprocess.run([blender, "--background", "--python-exit-code", "1", "--python", script_path, "--", str(source), str(destination)], check=True)
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
    parser.add_argument("--status")
    parser.add_argument("--metadata", type=Path, help="JSON review metadata, including optional presets and sources")
    parser.add_argument("--three-dir", type=Path, help="Local Three.js 0.180.0 package for offline review")
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
        supplied = load_metadata(args.metadata.expanduser()) if args.metadata else {}
        parts = load_parts(args.parts.expanduser()) if args.parts else supplied.get("parts", [])
    except (OSError, ValueError, OverflowError) as error:
        parser.error(f"could not read review metadata: {error}")
    if args.three_dir and not all((args.three_dir.expanduser() / path).is_file() for path in THREE_FILES):
        parser.error("--three-dir must contain the Three.js build, example modules and LICENSE")
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    for item in VIEWER.iterdir():
        if item.name == "workspace":
            continue
        destination = output / item.name
        if item.is_dir():
            shutil.copytree(item, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(item, destination)

    if args.three_dir:
        for path in THREE_FILES:
            destination = output / "vendor" / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(args.three_dir.expanduser() / path, destination)
        for name in ("index.html", "viewer.js"):
            file = output / name
            file.write_text(file.read_text().replace(THREE_CDN, "./vendor/"))

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
        "status": "Unapproved · review geometry",
        "facts": {"Source": source.name, "Format": source.suffix.lower().lstrip(".").upper()},
        "note": "Interactive viewing does not certify printability, fit, strength, or load capacity.",
        "prompt": ("Use Explode to separate the assembly. Select a part to inspect it."
                   if parts else "Inspect the model from several angles, then send feedback or approve this exact version."),
        "parts": parts,
    }
    metadata.update(supplied)
    metadata["parts"] = parts
    if args.title is not None:
        metadata["title"] = args.title
    if args.status is not None:
        metadata["status"] = args.status
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
