"""Create a tiny public-domain EPUB 3 fixture for adapter/reader smoke tests.

Usage:
  python spike/tools/make_epub.py
  # writes spike/app/public/seed/sample.epub
"""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

OUT = Path(__file__).resolve().parents[1] / "app" / "public" / "seed" / "sample.epub"

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="tr">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:11111111-2222-4333-8444-555555555555</dc:identifier>
    <dc:title>Akademik Okuma Testi</dc:title>
    <dc:creator>Demo Yazar</dc:creator>
    <dc:language>tr</dc:language>
    <meta property="dcterms:modified">2026-10-21T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>
"""

NAV = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="tr">
<head><title>İçindekiler</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <nav epub:type="toc"><h1>İçindekiler</h1>
    <ol>
      <li><a href="ch1.xhtml">Akademik okuma</a></li>
      <li><a href="ch2.xhtml">Notlar ve atıflar</a></li>
    </ol>
  </nav>
</body>
</html>
"""

CH1 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="tr">
<head><title>Akademik okuma</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1>Akademik okuma</h1>
  <p>Bu dosya, EPUB motoru adaptörünü denemek için üretilmiş küçük bir kamu malı metindir.</p>
  <p>Metin seçimi, vurgu, içindekiler ve arama akışını sınamak için yeterli cümle içerir.</p>
  <p>Akademik okuma; kaynağı anlamak, not almak ve atıf vermekle ilgilidir.</p>
</body>
</html>
"""

CH2 = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="tr">
<head><title>Notlar ve atıflar</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1>Notlar ve atıflar</h1>
  <p>Vurgular CFI aralığı olarak saklanır; sayfa numarası yerine konum kullanılır.</p>
  <p>Bir EPUB dosyasında arama yapmak için bölüm metinlerini çıkarmak gerekir.</p>
  <p>Bu ikinci bölüm, içindekilerden gezinmeyi ve ilerlemeyi denemek içindir.</p>
</body>
</html>
"""

CSS = """body { font-family: Georgia, serif; line-height: 1.55; margin: 6%; color: #222; }
h1 { font-size: 1.5em; margin-bottom: 0.8em; }
p { margin: 0.8em 0; }
"""


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        archive.writestr("META-INF/container.xml", CONTAINER, compress_type=ZIP_DEFLATED)
        archive.writestr("OEBPS/content.opf", OPF, compress_type=ZIP_DEFLATED)
        archive.writestr("OEBPS/nav.xhtml", NAV, compress_type=ZIP_DEFLATED)
        archive.writestr("OEBPS/ch1.xhtml", CH1, compress_type=ZIP_DEFLATED)
        archive.writestr("OEBPS/ch2.xhtml", CH2, compress_type=ZIP_DEFLATED)
        archive.writestr("OEBPS/style.css", CSS, compress_type=ZIP_DEFLATED)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
