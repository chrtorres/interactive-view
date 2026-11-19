"""Package independently prepared static reviews in one same-origin tabbed workspace."""

import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile

TEMPLATE = Path(__file__).resolve().parents[1] / "viewer" / "workspace"


def assemble(manifest, output):
    config = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(config, dict) or not isinstance(config.get("views"), list) or len(config["views"]) < 2:
        raise ValueError("workspace requires at least two views")
    title = config.get("title", "3D review workspace")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("title must be nonempty text")
    views = {}
    for entry in config["views"]:
        if not isinstance(entry, dict):
            raise ValueError("each view must be an object")
        ident, label, source = (entry.get(key) for key in ("id", "label", "directory"))
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", ident) or ident in views:
            raise ValueError("view IDs must be unique lowercase slugs")
        if not isinstance(label, str) or not label.strip() or not isinstance(source, str) or not source.strip():
            raise ValueError(f"view {ident} requires a label and directory")
        source = (manifest.parent / source).resolve()
        if not (source / "index.html").is_file():
            raise ValueError(f"view {ident} is missing index.html")
        if any(path.is_symlink() for path in source.rglob("*")):
            raise ValueError(f"view {ident} must contain regular files and directories without symlinks")
        if output.is_relative_to(source):
            raise ValueError("output must be outside every source directory")
        exploded = entry.get("exploded", False)
        if type(exploded) is not bool:
            raise ValueError(f"view {ident} exploded must be a boolean")
        views[ident] = (source, {"id": ident, "label": label, "exploded": exploded})
    default = config.get("default", next(iter(views)))
    if not isinstance(default, str) or default not in views:
        raise ValueError("default must name a declared view")
    if output.exists() or output.is_symlink():
        raise ValueError("output must be new")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staged = Path(temporary) / "workspace"
        shutil.copytree(TEMPLATE, staged)
        for ident, (source, _) in views.items():
            shutil.copytree(source, staged / "views" / ident)
        browser_config = {"title": title, "default": default, "views": [item for _, item in views.values()]}
        (staged / "workspace.json").write_text(json.dumps(browser_config, indent=2) + "\n", encoding="utf-8")
        staged.rename(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        output = args.output.absolute()
        assemble(args.manifest.resolve(), output.parent.resolve() / output.name)
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
