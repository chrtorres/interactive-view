"""Inspect baked GLB channels and optional clip, motion, and seam expectations."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


def inspect_glb(path, loops=(), moving=(), tolerance=1e-5):
    raw = path.read_bytes()
    magic, version, size, length, chunk = struct.unpack_from("<4sIII4s", raw)
    if (magic, version, size, chunk) != (b"glTF", 2, len(raw), b"JSON"):
        raise ValueError("expected a glTF 2 binary container")
    doc = json.loads(raw[20:20+length])
    data_length, kind = struct.unpack_from("<I4s", raw, 20+length)
    start = 28 + length
    if kind != b"BIN\x00" or start + data_length != len(raw):
        raise ValueError("expected a single embedded binary chunk")
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def read(index):
        accessor = doc["accessors"][index]
        if "sparse" in accessor or accessor["componentType"] != 5126:
            raise ValueError("expected a dense float32 animation accessor")
        view = doc["bufferViews"][accessor["bufferView"]]
        if view["buffer"] != 0:
            raise ValueError("animation buffer must be embedded")
        width = widths[accessor["type"]]
        offset = accessor.get("byteOffset", 0)
        stride = view.get("byteStride", 4 * width)
        count = accessor["count"]
        if count < 1 or stride < 4 * width or offset + (count - 1) * stride + 4 * width > view["byteLength"]:
            raise ValueError("invalid animation accessor range")
        offset += view.get("byteOffset", 0)
        return [struct.unpack_from("<" + "f" * width, raw, start + offset + i * stride) for i in range(count)]

    def difference(left, right, rotation):
        direct = max(abs(a-b) for a, b in zip(left, right))
        return min(direct, max(abs(a+b) for a, b in zip(left, right))) if rotation else direct

    report = {}
    measured = {}
    for clip_index, clip in enumerate(doc.get("animations", [])):
        label = clip.get("name") or f"Clip {clip_index+1}"
        label = label if label not in report else f"{label} [#{clip_index+1}]"
        duration = 0
        maximum_seam = 0
        for channel in clip["channels"]:
            target = channel["target"]
            name = doc["nodes"][target["node"]].get("name", str(target["node"]))
            key = label, name, target["path"]
            sampler = clip["samplers"][channel["sampler"]]
            times = [row[0] for row in read(sampler["input"])]
            values = read(sampler["output"])
            if not all(math.isfinite(t) for t in times) or times[0] < 0 or any(
                a >= b for a, b in zip(times, times[1:])
            ):
                raise ValueError(f"{key} has invalid key times")
            cubic = sampler.get("interpolation") == "CUBICSPLINE"
            count = len(times) * (3 if cubic else 1)
            if len(values) % count or not all(math.isfinite(value) for row in values for value in row):
                raise ValueError(f"{key} has invalid animation values")
            # Weight tracks may pack multiple scalar values per key; group before comparing.
            size = len(values) // count
            if size < 1:
                raise ValueError(f"{key} has an empty channel")
            batched = [tuple(value for row in values[i:i+size] for value in row)
                       for i in range(0, len(values), size)]
            poses = batched[1::3] if cubic else batched
            rotation = target["path"] == "rotation"
            seam = difference(poses[0], poses[-1], rotation)
            maximum_seam = max(maximum_seam, seam)
            duration = max(duration, times[-1])
            measured.setdefault(key, []).append(max(difference(poses[0], pose, rotation) for pose in poses))
        report[label] = {"duration_s": duration, "channels": len(clip["channels"]),
                         "max_endpoint_delta": maximum_seam}
    if not report or not all(val["duration_s"] > 0 for val in report.values()):
        raise ValueError("expected at least one timed clip")
    for label in loops:
        if label not in report:
            raise ValueError(f"unknown loop clip {label}")
        if report[label]["max_endpoint_delta"] > tolerance:
            raise ValueError(f"{label} has an open animation seam")
    for key in moving:
        values = measured.get(tuple(key), [])
        if len(values) != 1 or values[0] <= tolerance:
            raise ValueError(f"{key} must identify one moving channel")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "clips": report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset", type=Path)
    parser.add_argument("--loop", action="append", default=[], metavar="CLIP")
    parser.add_argument("--moving", action="append", nargs=3, default=[], metavar=("CLIP", "NODE", "PATH"))
    parser.add_argument("--tolerance", type=float, default=1e-5)
    args = parser.parse_args()
    if not math.isfinite(args.tolerance) or args.tolerance <= 0:
        parser.error("--tolerance must be positive and finite")
    try:
        report = inspect_glb(args.asset, args.loop, args.moving, args.tolerance)
    except (OSError, ValueError, KeyError, TypeError, IndexError, struct.error) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
