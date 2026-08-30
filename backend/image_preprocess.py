"""image_preprocess.py — Pure-Pillow image preprocessing before OCR.

Pipeline: grayscale -> optional binarization -> deskew -> upscale.  No OpenCV
hard dependency: everything is built on Pillow's operators so the local-OCR
path stays light to install.

Modes:
- ``auto`` (default): binarize only when the image looks like a photo
  (mid-tones present); near-binary scans are kept grayscale to avoid grain.
- ``photo``: always binarize (autocontrast + Otsu global threshold).
- ``scan``: never binarize; only grayscale / deskew / upscale.
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps

#: Binarize when the share of near-black/white pixels stays below this (auto).
_SCAN_EXTREME_FRACTION = 0.75
#: Upscale images whose short side falls below this.
MIN_SHORT_SIDE = 1600
#: Short side target after upscaling.
TARGET_SHORT_SIDE = 2000
#: Skew search range and step in degrees.
SKEW_RANGE = 5.0
SKEW_STEP = 0.5
#: Working width for skew estimation (keeps the projection loop cheap).
SKEW_MAX_DIM = 400

_BINARY_TABLE = [0 if i <= 127 else 255 for i in range(256)]


def _otsu_threshold(hist: list[int]) -> int:
    """Global threshold that maximizes between-class variance (Otsu)."""
    total = sum(hist)
    if total == 0:
        return 128
    sum_all = sum(i * count for i, count in enumerate(hist))
    weight_bg = 0
    sum_bg = 0
    best = -1.0
    best_thresh = 128
    for t in range(256):
        weight_bg += hist[t]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break
        sum_bg += t * hist[t]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_all - sum_bg) / weight_fg
        between = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if between > best:
            best = between
            best_thresh = t
    return best_thresh


def _binarize(image: Image.Image) -> Image.Image:
    """Autocontrast then global (Otsu) threshold to pure 0/255."""
    stretched = ImageOps.autocontrast(image, cutoff=1)
    threshold = _otsu_threshold(stretched.histogram())
    table = [0 if i <= threshold else 255 for i in range(256)]
    return stretched.point(table)


def _looks_like_scan(image: Image.Image) -> bool:
    """True when the original image is already near-binary (scan-like).

    Measured on the un-stretched histogram: a scan already has most pixels at
    the extremes, while a photo has mid-tones (shadows/gradients) even if the
    document itself is light.
    """
    hist = image.histogram()
    total = max(1, sum(hist))
    extreme = sum(hist[:32]) + sum(hist[224:])
    return extreme / total >= _SCAN_EXTREME_FRACTION


def _projection_score(image: Image.Image, threshold: int = 128) -> float:
    """Energy concentration of dark pixels per row (higher = more line-like)."""
    data = image.convert("L").tobytes()
    width, height = image.size
    row_counts = [0.0] * height
    for y in range(height):
        start = y * width
        row_counts[y] = sum(
            1 for byte in data[start : start + width] if byte < threshold
        )
    total = sum(row_counts)
    if not total:
        return 0.0
    return sum(count * count for count in row_counts) / total


def estimate_skew(image: Image.Image) -> float:
    """Return the rotation angle (degrees) that makes text lines horizontal.

    The angle matches ``Image.rotate`` semantics (positive = counter-clockwise)
    and is meant to be applied directly: ``image.rotate(estimate_skew(image))``.
    Blank images (no dark pixels) return 0.0.
    """
    scale = SKEW_MAX_DIM / max(image.width, image.height)
    small = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.BILINEAR,
    )
    best_angle = 0.0
    best_score = -1.0
    step = int(round(SKEW_STEP * 10))
    for angle10 in range(
        -int(round(SKEW_RANGE * 10)), int(round(SKEW_RANGE * 10)) + 1, step
    ):
        angle = angle10 / 10.0
        rotated = small.rotate(angle, resample=Image.BILINEAR, fillcolor=255)
        score = _projection_score(rotated)
        if score > best_score:
            best_score = score
            best_angle = angle
    return best_angle


def preprocess_image(data: bytes, mode: str = "auto") -> Image.Image:
    """Preprocess an encoded image (PNG/JPG/TIFF/BMP) for OCR."""
    mode = (mode or "auto").strip().lower()
    if mode not in ("auto", "photo", "scan"):
        mode = "auto"

    opened = Image.open(BytesIO(data))
    image = ImageOps.exif_transpose(opened).convert("L")

    # Blank images (all-white / all-black) carry no text to fix or upscale:
    # return them unchanged at the original size.  Blank means the image is a
    # single uniform color, not merely "no dark pixels" (light-on-light text
    # still needs enhancing).
    if image.getextrema()[0] == image.getextrema()[1]:
        return image

    binarize = mode == "photo" or (mode == "auto" and not _looks_like_scan(image))
    if binarize:
        image = _binarize(image)

    angle = estimate_skew(image)
    if angle:
        image = image.rotate(
            angle, resample=Image.BICUBIC, expand=True, fillcolor=255
        )

    min_side = min(image.size)
    if min_side < MIN_SHORT_SIDE:
        scale = TARGET_SHORT_SIDE / min_side
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )
        # Upscaling a binary image with LANCZOS softens strokes into grays;
        # re-threshold to keep the crisp 0/255 bitmap the binarizer produced.
        if binarize:
            image = image.point(_BINARY_TABLE)
    return image


