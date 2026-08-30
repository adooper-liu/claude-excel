"""Behavioral contract for local image preprocessing before OCR."""

import sys
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from image_preprocess import estimate_skew, preprocess_image  # noqa: E402


def _image_bytes(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, "PNG")
    return buf.getvalue()


def _text_image(width: int = 600, height: int = 240, fill: int = 255, text_fill: int = 0):
    image = Image.new("L", (width, height), fill)
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    for y, line in enumerate(
        ["INVOICE NUMBER 12345", "AMOUNT 1,234.56", "DATE 2018-09-04"]
    ):
        draw.text((20, 20 + y * 60), line, fill=text_fill, font=font)
    return image


def test_preprocess_corrects_rotated_text():
    source = _text_image()
    rotated = source.rotate(3.0, resample=Image.BICUBIC, expand=True, fillcolor=255)
    out = preprocess_image(_image_bytes(rotated))
    assert abs(estimate_skew(out)) < 1.0


def test_preprocess_improves_low_contrast_image():
    image = _text_image(fill=200, text_fill=170)
    out = preprocess_image(_image_bytes(image))
    low, high = out.getextrema()
    assert low < 64
    assert high > 192
    dark = sum(1 for byte in out.tobytes() if byte < 64)
    light = sum(1 for byte in out.tobytes() if byte > 192)
    assert dark > 0 and light > 0


def test_preprocess_upscales_small_images():
    image = _text_image(width=800, height=300)
    out = preprocess_image(_image_bytes(image))
    assert min(out.size) >= 1600


def test_preprocess_handles_blank_images():
    white = Image.new("L", (120, 90), 255)
    out = preprocess_image(_image_bytes(white))
    assert out.size == (120, 90)
    black = Image.new("L", (80, 60), 0)
    out = preprocess_image(_image_bytes(black))
    assert out.size == (80, 60)
