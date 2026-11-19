import unittest

from tools.compare_landmarks import compare


class CompareLandmarksTests(unittest.TestCase):
    def setUp(self):
        self.geometry = {"units": "mm", "part_bounds_xyz_mm": {"Plate": [[-20, 0, 0], [20, 20, 3]]}}
        self.landmark = {
            "feature": "Plate width", "part": "Plate", "axis": "x", "kind": "span",
            "basis": "fit", "reading_px": 80, "allowance_px": 2,
            "calibration": {"span_px": 80, "span_mm": 40},
        }

    def test_fit_and_independent_offset(self):
        offset = dict(self.landmark, kind="min", basis="holdout", reading_px=-38)
        report = compare(self.geometry, [self.landmark, offset])
        fit, holdout = report["features"]
        self.assertEqual(fit["absolute_delta_mm"], 0)
        self.assertEqual(holdout["reference_mm"], -19)
        self.assertEqual(holdout["absolute_delta_mm"], 1)
        self.assertEqual(holdout["reading_allowance_mm"], 1)
        self.assertEqual(holdout["basis"], "holdout")
        self.assertEqual(report["overall_fidelity"], "unverified")

    def test_zero_reference_has_no_relative_delta(self):
        row = dict(self.landmark, kind="center", reading_px=0)
        self.assertIsNone(compare(self.geometry, [row])["features"][0]["relative_delta"])

    def test_rejects_invalid_calibration_and_unknown_part(self):
        for row in (dict(self.landmark, calibration={"span_px": 0, "span_mm": 40}),
                    dict(self.landmark, part="Missing")):
            with self.assertRaisesRegex(ValueError, "Landmark 1"):
                compare(self.geometry, [row])
