#!/usr/bin/env python3
"""Generate a synthetic scanned PDF for the spike.

The output has image-only pages (no text layer), mild skew, speckles and JPEG
artifacts. It is not a substitute for a real scan, but it exercises the OCR,
hOCR and highlight-alignment paths before a real scanned book is available.

Usage:
  python make_scan.py --pages 20 --dpi 200 --out ../fixtures/synthetic-scan.pdf
"""
from __future__ import annotations

import argparse
import io
import random
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

TITLE = "Diş Hekimliğinde İmplant Komplikasyonları"
SUBTITLE = "Klinik değerlendirme ve yönetim"
SECTIONS = [
    (
        "Giriş",
        "Dental implant tedavisi, eksik dişlerin rehabilitasyonunda yaygın olarak kullanılmaktadır. "
        "Ancak cerrahi ve protetik süreçlerin her aşamasında komplikasyon gelişebilir. "
        "Bu bölümde implant komplikasyonlarının sınıflandırılması, risk faktörleri ve klinik yönetimi ele alınmaktadır.",
    ),
    (
        "Peri-implantitis",
        "Peri-implantitis, implant çevresindeki dokularda ilerleyici kemik kaybı ve enflamasyon ile karakterizedir. "
        "Tanı; sondalama derinliği, kanama, radyografik kemik seviyesi ve klinik semptomların birlikte değerlendirilmesine dayanır. "
        "Erken tanı, implant kaybını önlemede belirleyicidir.",
    ),
    (
        "Risk faktörleri",
        "Sigara kullanımı, kontrolsüz diyabet, yetersiz oral hijyen, periodontal hastalık öyküsü ve aşırı okluzal yük "
        "peri-implant hastalıkların gelişimini kolaylaştırır. Hastaya ait faktörlerin yanı sıra implantın konumu, "
        "yumuşak doku kalınlığı ve restorasyon tasarımı da değerlendirilmelidir.",
    ),
    (
        "Tanı ve görüntüleme",
        "Konik ışınlı bilgisayarlı tomografi (KIBT), implant çevresi kemik defektlerinin değerlendirilmesinde önemli bilgi sağlar. "
        "Radyografik inceleme tek başına yeterli değildir; klinik bulgular ve hasta öyküsü ile birlikte yorumlanmalıdır.",
    ),
    (
        "Tedavi yaklaşımı",
        "Tedavi; mekanik debridman, kimyasal dezenfeksiyon, antibiyotik desteği ve gerektiğinde cerrahi girişimleri içerir. "
        "İleri defektlerde rejeneratif prosedürler veya implantın çıkarılması gerekebilir. "
        "Tedavi sonrası düzenli takip ve idame bakımı, nüksün önlenmesinde kritik öneme sahiptir.",
    ),
    (
        "Sonuç",
        "İmplant komplikasyonlarının yönetimi multidisipliner bir yaklaşım gerektirir. "
        "Risk değerlendirmesi, düzenli kontrol ve hasta eğitimi, uzun dönem implant başarısını artırır.",
    ),
]

ABSTRACT_EN = (
    "Dental implant complications include peri-implantitis, implant loss, nerve injury and esthetic failures. "
    "Diagnosis combines probing depth, bleeding, radiographic bone level and clinical symptoms. "
    "Prevention and early treatment are essential for long-term success."
)


def font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def make_page(index: int, total: int, dpi: int) -> Image.Image:
    width = int(8.27 * dpi)
    height = int(11.69 * dpi)
    margin = int(0.9 * dpi)
    image = Image.new("RGB", (width, height), (252, 250, 245))
    draw = ImageDraw.Draw(image)

    title_font = font(int(0.19 * dpi))
    section_font = font(int(0.115 * dpi))
    body_font = font(int(0.082 * dpi))
    small_font = font(int(0.06 * dpi))

    draw.text((margin, int(0.65 * dpi)), TITLE, font=title_font, fill=(25, 24, 22))
    draw.text((margin, int(0.88 * dpi)), SUBTITLE, font=small_font, fill=(90, 84, 74))
    draw.line((margin, int(1.05 * dpi), width - margin, int(1.05 * dpi)), fill=(120, 110, 95), width=2)

    y = int(1.25 * dpi)
    draw.text((margin, y), f"Bölüm {index + 1}", font=small_font, fill=(120, 90, 60))
    y += int(0.18 * dpi)

    section, paragraph = SECTIONS[index % len(SECTIONS)]
    draw.text((margin, y), section, font=section_font, fill=(20, 20, 20))
    y += int(0.24 * dpi)

    for line in wrap(draw, paragraph, body_font, width - 2 * margin):
        draw.text((margin, y), line, font=body_font, fill=(32, 30, 28))
        y += int(0.125 * dpi)

    if index == 0:
        y += int(0.12 * dpi)
        draw.text((margin, y), "Abstract", font=section_font, fill=(20, 20, 20))
        y += int(0.22 * dpi)
        for line in wrap(draw, ABSTRACT_EN, body_font, width - 2 * margin):
            draw.text((margin, y), line, font=body_font, fill=(32, 30, 28))
            y += int(0.125 * dpi)

    if index % 3 == 0:
        y += int(0.18 * dpi)
        draw.text((margin, y), "Tablo 1. Klinik bulgular", font=small_font, fill=(80, 70, 60))
        y += int(0.16 * dpi)
        rows = [
            ("Bulgu", "Sıklık", "Yaklaşım"),
            ("Sondalama kanaması", "Yüksek", "Debridman"),
            ("Kemik kaybı", "Orta", "Görüntüleme"),
            ("İmplant mobilitesi", "Düşük", "Çıkarım"),
        ]
        col = margin
        for row in rows:
            for cell in row:
                draw.text((col, y), cell, font=small_font, fill=(40, 38, 34))
                col += int(1.75 * dpi)
            col = margin
            y += int(0.095 * dpi)

    # Skew, speckles, blur: make the page look scanned without destroying OCR.
    angle = random.uniform(-0.6, 0.6)
    image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(250, 248, 242))
    pixels = image.load()
    for _ in range(int(width * height * 0.00005)):
        x = random.randrange(width)
        y = random.randrange(height)
        grey = random.randrange(150, 235)
        pixels[x, y] = (grey, grey, grey)
    image = image.filter(ImageFilter.GaussianBlur(0.35))

    draw = ImageDraw.Draw(image)
    draw.text((margin, height - int(0.55 * dpi)), f"{index + 1} / {total}", font=small_font, fill=(90, 85, 75))
    draw.text((margin, height - int(0.42 * dpi)), "Örnek tarama — gerçek tarama değildir.", font=small_font, fill=(140, 130, 115))

    # JPEG round-trip adds realistic compression artifacts.
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82, optimize=True)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=20)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--out", type=Path, default=Path("../fixtures/synthetic-scan.pdf"))
    args = parser.parse_args()

    random.seed(42)
    pages = [make_page(index, args.pages, args.dpi) for index in range(args.pages)]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(
        args.out,
        "PDF",
        resolution=args.dpi,
        save_all=True,
        append_images=pages[1:],
    )
    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"{args.out} · {args.pages} pages · {args.dpi} dpi · {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
