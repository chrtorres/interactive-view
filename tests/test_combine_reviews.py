import json
from pathlib import Path
import tempfile
import unittest

from tools.combine_reviews import assemble


class CombineReviewsTests(unittest.TestCase):
    def test_bundle_and_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for key in ("view-a", "view-b"):
                source = root / key
                source.mkdir()
                (source / "index.html").write_text(key)
            manifest = root / "source.json"
            output = root / "bundle"
            data = {
                "default": "second",
                "views": [
                    {"id": "first", "label": "First", "directory": "view-a"},
                    {"id": "second", "label": "Second", "directory": "view-b", "exploded": True},
                ],
            }
            manifest.write_text(json.dumps(data))
            assemble(manifest, output)
            actual = json.loads((output / "workspace.json").read_text())
            self.assertEqual(actual["default"], "second")
            self.assertNotIn("directory", actual["views"][0])
            self.assertIs(actual["views"][1]["exploded"], True)
            self.assertEqual((output / "views" / "first" / "index.html").read_text(), "view-a")
            with self.assertRaisesRegex(ValueError, "output must be new"):
                assemble(manifest, output)
            with self.assertRaisesRegex(ValueError, "outside"):
                assemble(manifest, root / "view-a" / "recursive")
            data["views"][1]["id"] = "../escape"
            manifest.write_text(json.dumps(data))
            rejected = root / "rejected"
            with self.assertRaisesRegex(ValueError, "slugs"):
                assemble(manifest, rejected)
            self.assertFalse(rejected.exists())
