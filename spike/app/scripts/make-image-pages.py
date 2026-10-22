"""Generate noisy JPEG pages for a large image-heavy PDF fixture.

Usage (bundled Pillow):
  python scripts/make-image-pages.py 188 tmp/image-pages
"""
import os
import sys
from pathlib import Path

from PIL import Image

pages = int(sys.argv[1] if len(sys.argv) > 1 else 188)
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'tmp/image-pages')
out.mkdir(parents=True, exist_ok=True)
width, height = 1600, 2200
for index in range(1, pages + 1):
    raw = os.urandom(width * height * 3)
    image = Image.frombytes('RGB', (width, height), raw)
    image.save(out / f'page-{index:04d}.jpg', 'JPEG', quality=85, optimize=False)
    if index % 10 == 0 or index == pages:
        print(f'{index}/{pages}', flush=True)
print(out)
