"""Compare calibrated photo landmarks with model bounds in millimeters."""

import argparse
import json
import math
from pathlib import Path


def finite(value):
    return type(value) in (float, int) and math.isfinite(value)


def compare(geometry, landmarks):
    if geometry["units"] != "mm" or not isinstance(landmarks, list) or not landmarks:
        raise ValueError("Expected millimeter bounds and a nonempty landmark list")

    features = []
    for index, item in enumerate(landmarks, 1):
        try:
            axis = {"x": 0, "y": 1, "z": 2}[item["axis"]]
            low, high = geometry["part_bounds_xyz_mm"][item["part"]]
            start, end = low[axis], high[axis]
            if not all(map(finite, (start, end))) or start > end:
                raise ValueError("expected finite, ordered bounds")
            actual = {"span": end - start, "center": (start + end) / 2,
                      "min": start, "max": end}[item["kind"]]
            calibration = item["calibration"]
            pixels, length = calibration["span_px"], calibration["span_mm"]
            allowance, reading = item["allowance_px"], item["reading_px"]
            if not all(finite(v) and v > 0 for v in (pixels, length, allowance)):
                raise ValueError("calibration spans and pixel allowance must be positive and finite")
            if not finite(reading):
                raise ValueError("pixel reading must be finite")
            basis = item["basis"]
            if basis not in ("fit", "holdout"):
                raise ValueError("basis must be fit or holdout")
            scale = length / pixels
            expected = reading * scale
            delta = abs(expected - actual)
            features.append({
                "feature": item["feature"],
                "basis": basis,
                "reference_mm": expected,
                "mesh_mm": actual,
                "absolute_delta_mm": delta,
                "relative_delta": delta / abs(expected) if expected else None,
                "reading_allowance_mm": allowance * scale,
            })
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ValueError(f"Landmark {index}: {error}") from error
    return {"features": features, "overall_fidelity": "unverified"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("geometry", type=Path)
    parser.add_argument("landmarks", type=Path)
    args = parser.parse_args()
    try:
        geometry = json.loads(args.geometry.read_text(encoding="utf-8"))
        landmarks = json.loads(args.landmarks.read_text(encoding="utf-8"))
        print(json.dumps(compare(geometry, landmarks), indent=2, allow_nan=False))
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
