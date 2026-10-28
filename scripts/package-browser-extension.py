#!/usr/bin/env python3
"""Build a reproducible, store-upload ZIP from the distribution allowlist only."""
import argparse
import json
from pathlib import Path, PurePosixPath
import tempfile
import zipfile


def package(root: Path, output: Path) -> Path:
    prefix = "common/browser-extension/"
    distribution = json.loads((root / "common/distribution.json").read_text())
    entries = []
    for source in distribution["common"]:
        if not source.startswith(prefix):
            continue
        name = source[len(prefix):]
        parts = PurePosixPath(name)
        if not name or str(parts) != name or parts.is_absolute() or ".." in parts.parts or "\\" in name:
            raise ValueError("Invalid extension archive path")
        if parts.suffix not in {".json", ".js", ".html", ".css", ".png", ".svg"}:
            raise ValueError("Unexpected extension archive file type")
        file = root / source
        if any(p.is_symlink() for p in [file, *file.parents] if p != root.parent):
            raise ValueError("Extension files must not be symbolic links")
        entries.append((name, file.read_bytes()))
    names = [name for name, _ in entries]
    if "manifest.json" not in names or len(set(names)) != len(names):
        raise ValueError("Missing manifest or duplicate extension entry")
    manifest = json.loads(dict(entries)["manifest.json"])
    if manifest.get("manifest_version") != 3:
        raise ValueError("Only Manifest V3 is supported")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Replace only a complete archive, without including local credentials/state.
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(entries):
                info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data, compresslevel=9)
        temporary_path.replace(output)
    finally:
        temporary_path.unlink(missing_ok=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(package(Path(__file__).resolve().parent.parent, args.output.resolve()))
