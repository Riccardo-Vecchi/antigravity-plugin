"""Archive boundaries are tested separately; Python is a release-build tool only."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("browser_package", ROOT / "scripts/package-browser-extension.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BrowserPackageTests(unittest.TestCase):
    def test_allowlist_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extension = root / "common/browser-extension"
            extension.mkdir(parents=True)
            (extension / "manifest.json").write_text('{"manifest_version":3,"version":"1.0.0"}')
            (extension / "worker.js").write_text("// public worker")
            (extension / "private.pem").write_text("must never ship")
            files = ["common/browser-extension/" + name for name in ["worker.js", "manifest.json"]]
            (root / "common/distribution.json").write_text(json.dumps({"common": files}))
            first = module.package(root, root / "first.zip")
            second = module.package(root, root / "second.zip")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.namelist(), ["manifest.json", "worker.js"])
                self.assertIsNone(archive.testzip())

    def test_rejects_path_escape_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extension = root / "common/browser-extension"
            extension.mkdir(parents=True)
            manifest = root / "common/distribution.json"
            manifest.write_text(json.dumps({"common": ["common/browser-extension/../private.pem"]}))
            with self.assertRaises(ValueError):
                module.package(root, root / "bad.zip")

            (extension / "manifest.json").symlink_to(manifest)
            manifest.write_text(json.dumps({"common": ["common/browser-extension/manifest.json"]}))
            with self.assertRaises(ValueError):
                module.package(root, root / "bad.zip")

    def test_real_archive_has_manifest_branding_and_locales(self):
        with tempfile.TemporaryDirectory() as directory:
            output = module.package(ROOT, Path(directory) / "browser.zip")
            with zipfile.ZipFile(output) as archive:
                names = set(archive.namelist())
                self.assertTrue({"manifest.json", "assets/icon128.png", "_locales/it/messages.json"} <= names)
                manifest = json.loads(archive.read("manifest.json"))
                self.assertEqual(manifest["manifest_version"], 3)
                self.assertEqual(manifest["name"], "Antigravity Browser")
                self.assertTrue(manifest["key"])
                self.assertFalse(any(name.endswith((".pem", ".key", ".db")) for name in names))


if __name__ == "__main__":
    unittest.main()
