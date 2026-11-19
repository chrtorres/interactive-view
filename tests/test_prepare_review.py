import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "prepare_review.py"


class PrepareReviewTests(unittest.TestCase):
    def test_help_and_syntax(self):
        result = subprocess.run([sys.executable, str(TOOL), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("interactive Three.js", result.stdout)
        compile(TOOL.read_text(), str(TOOL), "exec")

    def test_glb_input_copies_viewer_and_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / "sample.glb"
            source.write_bytes(b"synthetic-glb-fixture")
            output = pathlib.Path(temp) / "review"
            result = subprocess.run([sys.executable, str(TOOL), str(source), "--output", str(output), "--no-screenshot"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((output / "model.glb").read_bytes(), source.read_bytes())
            metadata = json.loads((output / "metadata.json").read_text())
            self.assertEqual(metadata["facts"]["Format"], "GLB")
            self.assertEqual(metadata["parts"], [])
            self.assertTrue((output / "index.html").is_file())

    def test_part_layout_passes_to_the_viewer(self):
        parts = [
            {"node": "Left plate", "label": "Left plate", "offset": [-0.05, 0, 0]},
            {"node": "Right plate", "label": "Right plate", "offset": [0.05, 0, 0]},
        ]
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root / "sample.glb"
            source.write_bytes(b"synthetic-glb-fixture")
            layout = root / "parts.json"
            layout.write_text(json.dumps(parts))
            output = root / "review"
            result = subprocess.run([
                sys.executable, str(TOOL), str(source), "--output", str(output),
                "--parts", str(layout), "--no-screenshot",
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            metadata = json.loads((output / "metadata.json").read_text())
            self.assertEqual(metadata["parts"], parts)
            self.assertIn("Explode", metadata["prompt"])

    def test_reference_metadata_round_trips_through_cli(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root / "sample.glb"
            source.write_bytes(b"synthetic-glb-fixture")
            spec = root / "spec.json"
            output = root / "review"
            metadata = {
                "title": "Reference",
                "animation": {"defaultClip": "Bend", "followNode": "Rig root", "loop": True,
                              "labels": {"Bend": "Sweep"}, "autoplay": False},
                "modes": {"detail": ["Layer"]},
                "defaultMode": "detail",
                "modeLabels": {"detail": "Detail"},
                "parts": [
                    {"node": "Layer", "label": "Layer", "offset": [1, 0, 0],
                     "structures": [{"node": "Child", "label": "Child"}],
                     "evidence": "Illustrative", "sources": [{"label": "Reference", "url": "https://example.org/"}]},
                    {"node": "Case", "label": "Case", "offset": [-1, 0, 0]},
                ],
            }
            spec.write_text(json.dumps(metadata))
            command = [sys.executable, str(TOOL), str(source), "--output", str(output),
                       "--metadata", str(spec), "--no-screenshot"]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for key, value in metadata.items():
                self.assertEqual(json.loads((output / "metadata.json").read_text())[key], value)
            output = root / "invalid"
            command[4] = str(output)
            metadata["parts"][0]["sources"][0]["url"] = "javascript:alert(1)"
            spec.write_text(json.dumps(metadata))
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("HTTP(S)", result.stderr)
            self.assertFalse(output.exists())

            metadata["parts"] = []
            metadata["animation"]["autoplay"] = "yes"
            spec.write_text(json.dumps(metadata))
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("animation autoplay must be a boolean", result.stderr)
            self.assertFalse(output.exists())

    def test_invalid_part_layout_is_rejected_before_preparation(self):
        first = {"node": "Plate", "label": "Plate", "offset": [0, 0, 0]}
        layouts = (
            ([first], "at least two"),
            ([first, first], "duplicate part node"),
            ([first, {"node": "Pad", "label": "Pad", "offset": [True, 0, 0]}], "finite offset"),
            ([first, {"node": "Pad", "label": "Pad", "offset": [float("inf"), 0, 0]}], "finite offset"),
        )
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root / "sample.glb"
            source.write_bytes(b"synthetic-glb-fixture")
            layout = root / "parts.json"
            output = root / "review"
            for parts, diagnostic in layouts:
                with self.subTest(diagnostic=diagnostic, parts=parts):
                    layout.write_text(json.dumps(parts))
                    result = subprocess.run([
                        sys.executable, str(TOOL), str(source), "--output", str(output),
                        "--parts", str(layout), "--no-screenshot",
                    ], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn(diagnostic, result.stderr)
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
