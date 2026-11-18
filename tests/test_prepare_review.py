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
            self.assertTrue((output / "index.html").is_file())


if __name__ == "__main__":
    unittest.main()
