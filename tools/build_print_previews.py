"""Make labeled PNG sheets from checksum-recorded individual print STLs."""

import argparse
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1520
COLORS = {"background": "#101923", "card": "#182532", "line": "#344657",
          "title": "#f0f5f8", "detail": "#afc1ce", "accent": "#a3ddeb"}


def font(size):
    return ImageFont.truetype("DejaVuSans.ttf", size)


def text(draw, xy, value, size, color="title", width=1424):
    face = font(size)
    if draw.textlength(value, font=face) > width:
        face = font(max(1, int(size * width / draw.textlength(value, font=face))))
    draw.text(xy, value, font=face, fill=COLORS[color])


def sheet(height, info, title):
    image = Image.new("RGBA", (WIDTH, height), COLORS["background"])
    draw = ImageDraw.Draw(image)
    text(draw, (42, 24), title, 39)
    text(draw, (44, 79), f"{info['title']}  /  {info['version']}", 22, "detail")
    draw.line((42, 121, WIDTH - 42, 121), fill=COLORS["line"], width=2)
    return image, draw


def place_render(image, path, position):
    with Image.open(path) as preview:
        bounds = preview.getchannel("A").getbbox()
        if not bounds or min(*bounds[:2], preview.width - bounds[2], preview.height - bounds[3]) < 2:
            raise ValueError(f"Empty or clipped rendered geometry: {path}")
        image.alpha_composite(preview, dest=position)


def exploded_sheet(scratch, output, info):
    groups = (len(info["parts"]) + 2) // 3
    image, draw = sheet(1118 + groups * 42, info, "Exploded print parts")
    place_render(image, scratch / "exploded.png", (0, 130))
    for index, part in enumerate(info["parts"]):
        x, y = part["anchor"]
        y += 130
        draw.ellipse((x - 17, y - 17, x + 17, y + 17), fill=COLORS["card"], outline=COLORS["accent"], width=2)
        draw.text((x, y), str(index + 1), font=font(17), fill=COLORS["title"], anchor="mm")
        row, col = divmod(index, 3)
        text(draw, (44 + col * 480, 1064 + row * 42), f"{index + 1}. {part['label']}", 23, "accent", 462)
    image.convert("RGB").save(output / "exploded-print-parts.png")


def individual_sheet(scratch, output, info):
    rows = (len(info["parts"]) + 2) // 3
    image, draw = sheet(150 + rows * 427, info, "Individual print parts")
    for index, part in enumerate(info["parts"]):
        row, col = divmod(index, 3)
        x, y = 26 + col * 492, 140 + row * 427
        draw.rounded_rectangle((x, y, x + 484, y + 415), radius=14,
                               fill=COLORS["card"], outline=COLORS["line"])
        text(draw, (x + 16, y + 12), f"{index + 1}. {part['label']}", 26, "accent", 452)
        place_render(image, scratch / f"{index}.png", (x + 2, y + 43))
        dimensions = " × ".join(f"{value:.2f}".rstrip("0").rstrip(".") for value in part["dimensions"])
        text(draw, (x + 16, y + 352), f"{dimensions} mm", 21, width=452)
        text(draw, (x + 16, y + 382), part["file"], 18, "detail", 452)
    image.convert("RGB").save(output / "individual-print-parts.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blender", default="blender")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    renderer = Path(__file__).resolve().with_name("render_print_meshes.py")
    with TemporaryDirectory(prefix="print-preview-") as work:
        scratch = Path(work)
        subprocess.run([
            args.blender, "-b", "--factory-startup", "--python-exit-code", "1",
            "--python", str(renderer), "--", "--manifest", str(args.manifest.resolve()), "--scratch", work,
        ], check=True)
        info = json.loads((scratch / "rendered.json").read_text())
        exploded_sheet(scratch, args.output, info)
        individual_sheet(scratch, args.output, info)


if __name__ == "__main__":
    main()
