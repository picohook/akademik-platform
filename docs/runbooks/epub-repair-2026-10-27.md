# EPUB 409 onarımı — çalıştırma runbook'u

Bu dosya **kod dışı** bir iştir. Kod tarafı `fix/v134-epub-download-409` (PR #29) ile geldi:
artık bu durumdaki dosyalar `upload`'ta reddediliyor ve 409'un nedeni audit'e yazılıyor.
Kalan iş: **mevcut bozuk dosyayı onarmak** ve **katalogda başka kaç tane olduğunu öğrenmek**.

> Sunucuda çalıştırılır. `sudo` kullanılıyorsa **`sudo -E`** ya da değişkenleri `sudo`'dan sonra
> tekrar export edin — 26 Ekim kesintisinin nedeni buydu (`sudo` env siliyor).

---

## 0. Hazırlık

```bash
cd /opt/libedge            # compose dosyasının olduğu dizin
set -a; . ./.env.r2; set +a
docker compose -f docker-compose.libedge.yml ps
echo "IMAGE=$LIBEDGE_IMAGE"
```

Çalışma dizini:

```bash
WORK=/tmp/epub-repair; mkdir -p "$WORK"; cd "$WORK"
```

Servis adı **`web`** (`docker-compose.libedge.yml`). Aşağıdaki komutlarda
`dc` kısaltması kullanılır:

```bash
dc() { docker compose -f /opt/libedge/docker-compose.libedge.yml "$@"; }
```

---

## 1. Etkilenen dosyayı R2'den indir

| Alan | Değer |
| --- | --- |
| Kitap | Scientific Writing for Health Research |
| Asset | `4773fe55-…` (tam UUID'yi §1.1 verir) |
| R2 key | `libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub` |

### 1.1 Önce DB'de doğrula (tahmin etme)

```bash
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select a.id as asset_id, a.format, a.storage_key, a.source_checksum,
         e.work_id, w.title
    from assets a
    join editions e on e.id = a.edition_id
    join works w on w.id = e.work_id
   where a.storage_key like '%7ef29929-dbbd-415d-a008-c18f99362c98%';"
```

`storage_key` (`r2://` dahil) ve `source_checksum`'ı **not al** — §5 ve §9'da lazım.

### 1.2 İndir

```bash
KEY="uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub"

dc exec -T web node -e "
  import('./storage.mjs').then(async ({ createStorage }) => {
    const fs = await import('node:fs');
    const s = createStorage({ publicDir: process.cwd() + '/public' });
    const bytes = await s.read('r2://' + process.env.R2_PREFIX + '/$KEY');
    fs.writeFileSync('/tmp/source.epub', bytes);
    console.log('bytes', bytes.length);
  });
"
dc cp "$(dc ps -q web):/tmp/source.epub" ./source.epub
sha256sum source.epub
```

→ `sha256sum` **DB'deki `source_checksum` ile aynı olmalı**. Tutmuyorsa dur, yanlış dosyadasın.

---

## 2. Bozuk dosyaları bul (yalnız `ch003` değil, hepsi)

### 2.1 Prod watermark koduyla — ilk hatayı adıyla söyler

```bash
dc cp ./source.epub "$(dc ps -q web):/tmp/source.epub"
dc exec -T web node -e "
  import('./social-watermark.mjs').then(async ({ inspectWatermarkable }) => {
    const fs = await import('node:fs');
    try {
      const r = await inspectWatermarkable(fs.readFileSync('/tmp/source.epub'), 'epub');
      console.log('OK — temizlenebilir, ' + r.documents.length + ' belge');
      for (const d of r.documents) console.log('  ' + d);
    } catch (e) { console.log('FAIL — ' + e.message); }
  });
"
```

**Beklenen (onarım öncesi):** `FAIL — EPUB/text/ch003.xhtml: Invalid EPUB package: mismatched XML closing tag`

### 2.2 Well-formed olmayan **tüm** girdileri işaretle

`inspectWatermarkable` ilk hatada durur; tam listeyi `xmllint` verir:

```bash
sudo apt-get install -y libxml2-utils zip unzip   # bir kez
cd /tmp/epub-repair
rm -rf unpack && mkdir unpack && cd unpack
unzip -q ../source.epub
find . -type f \( -name '*.xhtml' -o -name '*.html' -o -name '*.opf' -o -name '*.xml' \) -print0 |
  while IFS= read -r -d '' f; do
    xmllint --noout "$f" 2>/dev/null || echo "BOZUK: $f"
  done | tee ../broken-list.txt
cd ..
```

`broken-list.txt` = onarılacak dosyaların **tam** listesi. Boşsa §2.1'in hatası ile çelişki var —
dur ve incele.

---

## 3. Onar

> **İçeriği uydurma.** Yalnızca kapanış sırasını düzelt. Metin kaybı olmamalı.

### 3.1 Yedek

```bash
cd /tmp/epub-repair
cp -r unpack unpack.bak
```

### 3.2 Bildirilen kalıbı düzelt

```html
<!-- BOZUK (Pandoc çıktısı) -->
<li>Hypothesis and aims<p></li>

<!-- DOĞRU -->
<li>Hypothesis and aims<p></p></li>
```

```bash
cd /tmp/epub-repair/unpack
grep -rlZ '<p></li>' --include='*.xhtml' --include='*.html' . |
  while IFS= read -r -d '' f; do
    echo "düzeltiliyor: $f"
    sed -i 's|<p></li>|<p></p></li>|g' "$f"
  done
```

### 3.3 Tekrar tara — temizlenene kadar

```bash
cd /tmp/epub-repair/unpack
find . -type f \( -name '*.xhtml' -o -name '*.html' -o -name '*.opf' -o -name '*.xml' \) -print0 |
  while IFS= read -r -d '' f; do
    xmllint --noout "$f" 2>/dev/null || echo "HALA BOZUK: $f"
  done
```

**Hiçbir satır çıkmayana kadar** devam et. Başka kalıplar varsa (kapanmayan `<em>`, `<div>`,
kaçışsız `&`) `xmllint` satır numarası verir — elle, tek tek düzelt. Yedek: `unpack.bak/`.

---

## 4. Yeniden paketle — `mimetype` ilk ve **STORE**

```bash
cd /tmp/epub-repair/unpack
rm -f ../fixed.epub
zip -X0 ../fixed.epub mimetype          # İLK girdi, SIKIŞTIRMASIZ
zip -rX9 ../fixed.epub . -x mimetype    # geri kalanı
cd ..
unzip -l fixed.epub | head -4           # mimetype ilk satırda olmalı
unzip -v fixed.epub mimetype            # "Stored" olmalı, "Defl:N" DEĞİL
```

`unzip -v` çıktısında **`Stored`** görmeli; `Defl:N` görürsen EPUB spec'i bozuktur, tekrar paketle.

---

## 5. Doğrula — yüklemeden önce

```bash
dc cp ./fixed.epub "$(dc ps -q web):/tmp/fixed.epub"
dc exec -T web node -e "
  const fs = await import('node:fs');
  const { watermarkDownload, inspectWatermarkable } = await import('./social-watermark.mjs');
  const buf = fs.readFileSync('/tmp/fixed.epub');
  const auth = { userId: '11111111-1111-4111-8111-111111111111',
                 tenantId: '22222222-2222-4222-8222-222222222222',
                 email: 'verify@example.org' };
  const r = await inspectWatermarkable(buf, 'epub');
  console.log('dry-run OK:', r.documents.length, 'belge');
  const out = await watermarkDownload(buf, 'epub', auth);
  console.log('watermark OK:', out.length, 'bayt');
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(out);
  const hit = [];
  for (const n of Object.keys(z.files)) {
    if (z.files[n].dir || !/\.(xhtml|html)$/i.test(n)) continue;
    if ((await z.file(n).async('string')).includes(auth.userId)) hit.push(n);
  }
  console.log('kimlik yazılan belge:', hit.length);
"
```

**Beklenen:** `dry-run OK` + `watermark OK` + `kimlik yazılan belge: >0`.

`kimlik yazılan belge: 0` çıkarsa **dur** — damga gövdeye girmiyor, yükleme yapma.

Okuyucu kontrolü (metin kaybı yok):

```bash
unzip -p fixed.epub EPUB/text/ch003.xhtml | head -40
```

---

## 6. Yükle — **aynı key**

> ⚠️ **`storage.put()` `IfNoneMatch: '*'` kullanıyor** (`storage.mjs:140`) — aynı key'e
> `put()` ile **üzerine yazılamaz**. Bu yüzden önce `remove()`, sonra `put()`.

```bash
KEY="uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub"
dc cp ./fixed.epub "$(dc ps -q web):/tmp/fixed.epub"

dc exec -T web node -e "
  import('./storage.mjs').then(async ({ createStorage }) => {
    const fs = await import('node:fs');
    const s = createStorage({ publicDir: process.cwd() + '/public' });
    const bytes = fs.readFileSync('/tmp/fixed.epub');
    await s.remove('r2://' + process.env.R2_PREFIX + '/$KEY');
    const stored = await s.put('$KEY', bytes, 'application/epub+zip');
    console.log('yazıldı:', stored, bytes.length, 'bayt');
    const back = await s.read(stored);
    console.log('geri okundu:', back.length, 'bayt, eşit:', back.equals(bytes));
  });
"
```

**`eşit: true` görmeden §7'ye geçme.**

---

## 7. DB'yi güncelle — `source_checksum`

`storage_key` **değişmiyor** (aynı key), yalnız checksum:

```bash
HASH=$(sha256sum /tmp/epub-repair/fixed.epub | cut -d' ' -f1)
echo "yeni sha256: $HASH"

dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  update assets
     set source_checksum = '$HASH'
   where storage_key like '%7ef29929-dbbd-415d-a008-c18f99362c98%'
  returning id, format, source_checksum;"
```

> **`source_id`'ye dokunma.** Upload akışında `source_id` = `source_checksum` = sha256,
> ama bu satır `import-catalog` kaynaklıysa `source_id` dış sistemin kimliğidir.

---

## 8. Canlıda doğrula

Tarayıcıda, bir okuyucu hesabıyla:

1. Kitabı aç → **İndir** → dosya inmeli, `unzip -l` ile açılmalı.
2. İnen EPUB'da filigran var mı (kullanıcı kimliği metni).
3. **Çevrimdışı kaydet** → “Çevrimdışı kaydedildi” görmeli.
4. Audit/log temiz mi:

```bash
dc logs --since 10m web | grep -i 'delivery failed' || echo "temiz"
```

> PR #29 sonrası 409 artık audit'e `delivery_failed` + `error` olarak düşer.
> Onarım çalıştıysa bu satır **hiç çıkmaz**.

---

## 9. Katalog taraması — kaç tane daha var?

### 9.1 Listeyi al

```bash
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F '|' -c "
  select a.id, a.storage_key, w.title
    from assets a
    join editions e on e.id = a.edition_id
    join works w on w.id = e.work_id
   where a.format = 'epub'
   order by w.title;" > /tmp/epub-repair/catalog.txt
wc -l /tmp/epub-repair/catalog.txt
```

### 9.2 Tara

```bash
dc cp ./catalog.txt "$(dc ps -q web):/tmp/catalog.txt"

dc exec -T web node -e "
  const fs = await import('node:fs');
  const { createStorage } = await import('./storage.mjs');
  const { inspectWatermarkable } = await import('./social-watermark.mjs');
  const s = createStorage({ publicDir: process.cwd() + '/public' });
  const rows = fs.readFileSync('/tmp/catalog.txt', 'utf8').trim().split('\n').filter(Boolean);
  let ok = 0; const bad = [];
  for (const row of rows) {
    const [id, key, title] = row.split('|');
    try {
      await inspectWatermarkable(await s.read(key), 'epub');
      ok++;
    } catch (e) {
      bad.push({ id, key, title, error: e.message });
      console.log('INDIRILEMEZ | ' + title + ' | ' + key + ' | ' + e.message);
    }
  }
  console.log('---');
  console.log('TOPLAM ' + rows.length + ' | OK ' + ok + ' | INDIRILEMEZ ' + bad.length);
  fs.writeFileSync('/tmp/scan.json', JSON.stringify(bad, null, 2));
"
```

Sonucu al:

```bash
dc cp "$(dc ps -q web):/tmp/scan.json" ./scan.json
cat scan.json
```

`scan.json` → `docs/TODO.md` §2b'ye ekle. Her bozuk dosya için §1–§8 tekrarlanır.

---

## 10. Geri dönüş

Yükleme sonrası kitap açılmıyorsa:

```bash
# 1) R2'ye orijinali geri yaz (source.epub elinde) — §6'daki komutun aynısı,
#    yalnız /tmp/fixed.epub yerine /tmp/source.epub
# 2) DB'de source_checksum'u §1.1'de not aldığın ESKİ değere döndür
```

Kod geri dönüşü **gerekmiyor**: PR #29 veri bozmaz, yalnız 409'u açıklamalı hale getirir
ve bozuk dosyanın yeni yüklenmesini engeller.

`source.epub` ve `unpack.bak/` silinmesin.

---

## Kontrol listesi

- [ ] §1 `sha256sum source.epub` = DB `source_checksum`
- [ ] §2.2 `broken-list.txt` — bozuk dosyaların **tam** listesi
- [ ] §3.1 `unpack.bak/` yedeği alındı
- [ ] §3.3 `xmllint` **tüm** dosyalarda temiz (hiçbir satır çıkmıyor)
- [ ] §4 `mimetype` ilk ve **STORE**
- [ ] §5 `dry-run OK` + `watermark OK` + `kimlik yazılan belge > 0`
- [ ] §6 aynı key'e yazıldı, **`eşit: true`**
- [ ] §7 `source_checksum` güncellendi, `source_id`'ye dokunulmadı
- [ ] §8 tarayıcıda indirme + çevrimdışı kaydet çalışıyor
- [ ] §9 `scan.json` üretildi, `docs/TODO.md` §2b'ye eklendi
