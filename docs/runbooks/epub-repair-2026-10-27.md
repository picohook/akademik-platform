# EPUB 409 onarımı — çalıştırma runbook'u

Bu dosya **kod dışı** bir iştir. Kod tarafı `fix/v134-epub-download-409` (PR #29) ile geldi:
artık bu durumdaki dosyalar `upload`'ta reddediliyor ve 409'un nedeni audit'e yazılıyor.
Kalan iş: **mevcut bozuk dosyayı onarmak** ve **katalogda başka kaç tane olduğunu öğrenmek**.

> Sunucuda çalıştırılır. **`docker` her yerde `sudo` ile** — `ubuntu` kullanıcısı `docker`
> grubunda değil. `sudo -E` gerekmiyor: `$POSTGRES_*` değişkenleri `sudo` çalışmadan **önce,
> **Komutlar etkileşimli SSH kabuğuna elle yapıştırılır — `set -e` yok.** İnteraktif kabukta
> `set -e` ilk sıfır-dışı komutta **oturumu kapatır** (ör. `grep` eşleşme bulamazsa `exit 1`).
> Bu yüzden tüm `DUR` kontrolleri `return 1 2>/dev/null || true` + açık **“DUR, devam etme”**
> mesajı biçimindedir: karar sizde, oturum düşmez. Hiçbir blok `set -e` gerektirmez.

---

## 0. Hazırlık

```bash
cd /var/www/akademik-platform      # compose dosyasının olduğu dizin (DEPLOY.md ile aynı)
```

`dc` kısaltması **DEPLOY.md ile birebir** aynıdır: **iki `-f`** ve **iki `--env-file`**.

- `docker-compose.prod.yml` **zorunlu**: proje adı (`akademik-platform-prod`) ondan gelir.
  Yalnız `libedge.yml` verilirse proje adı farklı olur, `db` servisi **tanımsız** kalır ve
  `dc exec db` / `ps -q web` düşer.
- `.env.production`: `POSTGRES_*`, `DOMAIN`, `DATABASE_URL`, `SESSION_SECRET`.
- `.env.r2`: `LIBEDGE_IMAGE`, R2 ayarları.

Biri eksikse compose `required variable ... is missing` ile **durur** — 2026-10-27'de
`DOMAIN` için tam bu yaşandı.

```bash
dc() {
  sudo docker compose \
    -f /var/www/akademik-platform/docker-compose.prod.yml \
    -f /var/www/akademik-platform/docker-compose.libedge.yml \
    --env-file /var/www/akademik-platform/.env.production \
    --env-file /var/www/akademik-platform/.env.r2 "$@"
}
```

DB bağlantı değişkenleri: `.env.production` root'a ait olduğu için `sudo grep`. Değişken host
kabuğunda genişlediği için `sudo` bunları silmez.

```bash
export POSTGRES_USER="$(sudo grep -m1 '^POSTGRES_USER=' /var/www/akademik-platform/.env.production | cut -d= -f2-)"
export POSTGRES_DB="$(sudo grep -m1 '^POSTGRES_DB=' /var/www/akademik-platform/.env.production | cut -d= -f2-)"
echo "user=$POSTGRES_USER db=$POSTGRES_DB"
```

Çıktıda `user=` ya da `db=` **boşsa DUR, devam etme**:

```bash
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "DUR, devam etme: POSTGRES_USER/POSTGRES_DB okunamadı — .env.production'ı kontrol et"
  return 1 2>/dev/null || true
fi
```

> `return` fonksiyon içinde değilse hata verir; `|| true` onu yutar, `sudo`/kabuk oturumu
> ayakta kalır. Mesaj **DUR** dediğinde gerçekten durun — bu blok sizi zorla çıkarmaz.

Config'i **gerçekten** doğrula — `db` servisi ve imaj görünmeli:

```bash
dc config --services
dc config | grep -E 'image:|container_name:' | head
sudo grep -m1 '^LIBEDGE_IMAGE=' /var/www/akademik-platform/.env.r2   # deploy edilen imaj
```

Listede **`db` yoksa DUR, devam etme** — `docker-compose.prod.yml` devrede değil:

```bash
if ! dc config --services 2>/dev/null | grep -qx 'db'; then
  echo "DUR, devam etme: db servisi yok — prod.yml + libedge.yml birlikte verilmeli"
  return 1 2>/dev/null || true
fi
```

Çalışma dizini:

```bash
WORK=/tmp/epub-repair; mkdir -p "$WORK"; cd "$WORK"
```


---

## 1. Etkilenen dosyayı R2'den indir

| Alan | Değer |
| --- | --- |
| Kitap | Scientific Writing for Health Research |
| Asset ID | `4773fe55-2f2d-51d5-b7cb-740d477e75fa` |
| R2 key (eski) | `libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub` |
| R2 key (yeni) | `libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98-r1.epub` |

### 1.1 Önce DB'de doğrula (tahmin etme)

Asset **id** ile sorgula (`like` ile değil — desen başka satırı da yakalayabilir):

```bash
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select a.id as asset_id, a.format, a.storage_key, a.source_checksum,
         a.source_id, e.work_id, w.title
    from assets a
    join editions e on e.id = a.edition_id
    join works w on w.id = e.work_id
   where a.id = '4773fe55-2f2d-51d5-b7cb-740d477e75fa';"
```

> **Eski `storage_key` ve `source_checksum` değerlerini bir yere yaz** (ekran görüntüsü ya da
> `tee`). §10 geri dönüş bunları aynen geri yazacak.


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

> ⚠️ **Highlight/not CFI'ları kayabilir.** `ch003`'teki DOM yapısı değişiyor
> (`<p></li>` → `<p></p></li>`), yani o belgeye düşen CFI'lar artık **farklı bir düğüme**
> işaret eder. Etkilenen bölümdeki okuyucu highlight'ları/notları ya **kayar** ya da
> **çözülemez** hale gelir.
>
> Onarımdan **önce** bu asset'e bağlı notları say (`anchor` jsonb içinde CFI tutuyor;
> `cfi` diye bir kolon yok):
>
> ```bash
> dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
>   select status, count(*) as adet
>     from annotations
>    where asset_id = '4773fe55-2f2d-51d5-b7cb-740d477e75fa'
>    group by status;"
> ```
>
> **0 satır** ise kimse etkilenmiyor, devam. **Dolu** ise §8'de tekrar say ve `orphaned`
> sayısı arttıysa Altan'a haber ver — etkilenen kullanıcılara bilgi vermek gerekebilir.
> (`status` alanı `active`/`orphaned`; çözülemeyen bağlantılar `orphaned`'a düşer.)


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

## 6. Yeni key'e yükle

> ⚠️ **`storage.put()` `IfNoneMatch: '*'` kullanıyor** (`storage.mjs:140`) — aynı key'e
> üzerine **yazılamaz**. Bu yüzden onarım **yeni bir key**'e yazılır; **eski objeye hiç
> dokunulmaz** (geri dönüş için yerinde kalır, §10'da bir hafta sonra silinir).

```bash
KEY_OLD="uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub"
KEY_NEW="uploads/7ef29929-dbbd-415d-a008-c18f99362c98-r1.epub"
dc cp ./fixed.epub "$(dc ps -q web):/tmp/fixed.epub"

dc exec -T web node -e "
  import('./storage.mjs').then(async ({ createStorage }) => {
    const fs = await import('node:fs');
    const s = createStorage({ publicDir: process.cwd() + '/public' });
    const bytes = fs.readFileSync('/tmp/fixed.epub');
    const stored = await s.put('$KEY_NEW', bytes, 'application/epub+zip');
    fs.writeFileSync('/tmp/new-key.txt', stored);
    console.log('NEW_KEY=' + stored);
    console.log('yazıldı:', bytes.length, 'bayt');
    const back = await s.read(stored);
    console.log('geri okundu:', back.length, 'bayt, eşit:', back.equals(bytes));
  });
"
```

**`eşit: true` görmeden §7'ye geçme.** Dönen `r2://…` değerini **kopyala** — §7 onu
`storage_key` olarak yazacak:

```bash
dc cp "$(dc ps -q web):/tmp/new-key.txt" ./new-key.txt
NEW_KEY=$(cat new-key.txt)        # ör. r2://libedge/uploads/7ef29929-…-r1.epub
echo "yeni storage_key: $NEW_KEY"
```

> :warning: `new-key.txt` içinde `r2://` **dahil** olmalı (`storage.mjs:44` böyle okuyor).
> Eksikse §7'ye geçme.

Eski objenin yerinde durduğunu doğrula:

```bash
dc exec -T web node -e "
  import('./storage.mjs').then(async ({ createStorage }) => {
    const s = createStorage({ publicDir: process.cwd() + '/public' });
    const i = await s.info('r2://' + process.env.R2_PREFIX + '/$KEY_OLD');
    console.log('eski obje duruyor, bayt:', i.size);
  });
"
```

---

## 7. DB'yi güncelle — `storage_key` + `source_checksum` (tek update)

`storage_key` artık yeni key; checksum yeni dosyanın sha256'sı. **`id` ile**, `like` ile değil.

```bash
HASH=$(sha256sum /tmp/epub-repair/fixed.epub | cut -d' ' -f1)
echo "yeni sha256: $HASH"
echo "yeni key  : $NEW_KEY"
if [ -z "$NEW_KEY" ] || [ -z "$HASH" ]; then
  echo "DUR, devam etme: NEW_KEY veya HASH boş — update'i çalıştırma"
  return 1 2>/dev/null || true
fi

dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  update assets
     set storage_key     = '$NEW_KEY',
         source_checksum = '$HASH'
   where id = '4773fe55-2f2d-51d5-b7cb-740d477e75fa'
  returning id, format, storage_key, source_checksum;"
```

**`returning` satırı bir satır döndürmeli** ve `storage_key` `…-r1.epub` ile bitmeli.
`UPDATE 0` görürsen dur — yanlış asset id'sin. Birden fazla satır görürsen dur — `id` tekil
olduğu için bu bir şema sorunudur.

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

5. **CFI kontrolü** (§3 notu — DOM değişti):

```bash
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select status, count(*) as adet
    from annotations
   where asset_id = '4773fe55-2f2d-51d5-b7cb-740d477e75fa'
   group by status;"
```

`orphaned` sayısı §3'teki ilk sayımdan **fazlaysa** notlar kaymış demektir — Altan'a bildir.


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
dc cp /tmp/epub-repair/catalog.txt "$(dc ps -q web):/tmp/catalog.txt"

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
      // okuma hatası da (ENOENT vb.) indirilemez demektir — sessizce yutma
      bad.push({ id, key, title, error: e.message || String(e) });
      console.log('INDIRILEMEZ | ' + title + ' | ' + id + ' | ' + key + ' | ' + (e.message || e));
    }
  }
  console.log('---');
  console.log('TOPLAM ' + rows.length + ' | OK ' + ok + ' | INDIRILEMEZ ' + bad.length);
  fs.writeFileSync('/tmp/scan.json', JSON.stringify(bad, null, 2));
" 2>&1 | tee /tmp/epub-repair/scan.log
```

> `2>&1 | tee` sayesinde çıktı hem ekrana hem `scan.log`'a yazılır — katalog uzun olabilir.
> `scan.log`'u bir hafta sakla.


Sonucu al:

```bash
dc cp "$(dc ps -q web):/tmp/scan.json" ./scan.json
cat scan.json
```

`scan.json` → `docs/TODO.md` §2b'ye ekle. Her bozuk dosya için §1–§8 tekrarlanır.

---

## 10. Geri dönüş

Yükleme sonrası kitap açılmıyorsa **R2'ye hiçbir şey yazma** — eski obje yerinde duruyor.
Yalnız DB'yi §1.1'de not aldığın **eski değerlere** döndür:

```bash
KEY_OLD_SAVED='r2://libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub'   # §1.1'den
HASH_OLD_SAVED='<§1.1 kaydettiğin source_checksum>'                                # §1.1'den

dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  update assets
     set storage_key     = '$KEY_OLD_SAVED',
         source_checksum = '$HASH_OLD_SAVED'
   where id = '4773fe55-2f2d-51d5-b7cb-740d477e75fa'
  returning id, storage_key, source_checksum;"
```

Tek update, tek transaction. `returning` eski key'i göstermeli. Uygulama dosyayı bir sonraki
istekte yeni key'den okumaz, eski key'den okur — **restart gerekmez** (`storage_key` her
istekte DB'den okunuyor).

**Yeni objeyi hemen silme.** §8 doğrulaması bir hafta boyunca sorun çıkarmazsa:

```bash
# Yalnız geri dönüş YAPILMADIYSA (yani canlı yeni key'i kullanıyorsa) çalıştır:
KEY_OLD="uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub"
dc exec -T web node -e "
  import('./storage.mjs').then(async ({ createStorage }) => {
    const s = createStorage({ publicDir: process.cwd() + '/public' });
    await s.remove('r2://' + process.env.R2_PREFIX + '/$KEY_OLD');
    console.log('eski obje silindi');
  });
"
```

> Bu komutu **ancak** bir hafta sonra ve **DB hâlâ `-r1.epub` key'ini gösteriyorsa** çalıştır.
> Geri dönüş yaptıysan eski obje canlıdır — silme.

Kod geri dönüşü **gerekmiyor**: PR #29 veri bozmaz, yalnız 409'u açıklamalı hale getirir
ve bozuk dosyanın yeni yüklenmesini engeller.

`source.epub`, `fixed.epub` ve `unpack.bak/` bir hafta saklanır, sonra silinir.

---

## Kontrol listesi

- [ ] §0 `dc` **iki `-f`** (prod + libedge) ve **iki `--env-file`** ile tanımlı; `sudo` içeride
- [ ] §0 `dc config --services` çıktısında **`db`** görünüyor; yoksa `DUR` bloğu uyardı
- [ ] §0 `POSTGRES_USER`/`POSTGRES_DB` dolu; boşsa `DUR, devam etme` çıktı, **oturum düşmedi**
- [ ] §1.1 **eski `storage_key` + `source_checksum` not alındı** (§10 için şart)
- [ ] §1 `sha256sum source.epub` = DB `source_checksum`
- [ ] §2.2 `broken-list.txt` — bozuk dosyaların **tam** listesi
- [ ] §3.1 `unpack.bak/` yedeği alındı
- [ ] §3.3 `xmllint` **tüm** dosyalarda temiz (hiçbir satır çıkmıyor)
- [ ] §4 `mimetype` ilk ve **STORE**
- [ ] §5 `dry-run OK` + `watermark OK` + `kimlik yazılan belge > 0`
- [ ] §6 **yeni** key'e (`-r1.epub`) yazıldı, **`eşit: true`**, eski obje duruyor
- [ ] §7 tek update: `storage_key` + `source_checksum`, `id` ile, `returning` 1 satır
- [ ] §8 tarayıcıda indirme + çevrimdışı kaydet çalışıyor
- [ ] §9 `scan.json` üretildi, `docs/TODO.md` §2b'ye eklendi
- [ ] Bir hafta sonra: §10 eski objeyi sil (yalnız geri dönüş yapılmadıysa)
