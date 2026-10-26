# Deploy prosedürü

Production kaynağı: `akademik-platform-prod` compose projesi, web servisi
`spike/app` build context'i. Bu belge **hangi komutun gerçekten çalıştığını**
tek yerde tutar; sürüm geçmişi `docs/deployments/` altında, özet `PROJECT-STATE.md`'de.

## Sürüm doğrulama (her deploy'dan sonra)

```bash
curl -s https://elibrary.libedge.com/api/config
# {"version":"130","buildSha":"9f755d6","buildDate":"2026-10-26","environment":"production",...}

curl -s https://elibrary.libedge.com/api/health
# {"ok":true,"mode":"db","tenantId":"..."}
```

`/api/config` içindeki üç alan (`version`, `buildSha`, `buildDate`) build zamanı
metadata'sının tek kaynağıdır. Footer bunları gösterir (`app.js` → `applyFooter`).

> **`APP_VERSION` unutulursa** `version` alanı `0-dev` döner ve footer `v0-dev`
> yazar. Bu bilinçli bir fail-loud davranıştır; gerçek bir sürüm numarası asla
> varsayılan olarak gösterilmez.

## Metadata nereden geliyor

| Katman | Değer | Not |
| --- | --- | --- |
| Runtime env | `APP_VERSION`, `BUILD_SHA`, `BUILD_DATE` | `docker-compose.prod.yml` `web.environment` bunları okur; container'a bu yolla girer |
| Build arg → LABEL | `BUILD_SHA`, `APP_VERSION`, `BUILD_DATE` | Yalnız `docker inspect` görünürlüğü. Container env'ini **beslemez** |
| `ARG` varsayılanı | `unknown` | `--build-arg` verilmezse image etiketinde `unknown` yazar |

Build arg'ları imaj etiketine işlemek için:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build \
  --build-arg BUILD_SHA="$(git rev-parse --short HEAD)" \
  --build-arg APP_VERSION="${APP_VERSION}" \
  --build-arg BUILD_DATE="$(date -u +%F)"
```

## Env dosyaları (sunucuda, git dışında)

`.gitignore` `.env.*` desenini yok sayar; bu dosyalar **repoda yoktur**, EC2'de durur.

| Dosya | İçerik | Zorunlu mu |
| --- | --- | --- |
| `.env.production` | `POSTGRES_*`, `DATABASE_URL`, `SESSION_SECRET`, `DOMAIN`, `APP_VERSION`, `BUILD_SHA`, `BUILD_DATE` | Evet — `docker-compose.prod.yml` `${VAR:?}` ile zorunlu tutuyor |
| `.env.r2` | `LIBEDGE_IMAGE`, R2 ayarları | Yalnız `docker-compose.libedge.yml` kullanıldığında |

`--env-file` verilmezse compose `set POSTGRES_DB` benzeri hatalarla **durur**;
deploy komutunda `--env-file` opsiyonel değildir.

## Varyant 1 — `docker-compose.prod.yml` (v127'ye kadar kullanılan yol)

```bash
# 1) .env.production içindeki üç public alanı güncelle:
#    APP_VERSION=131
#    BUILD_SHA=<git rev-parse --short HEAD>
#    BUILD_DATE=2026-10-27

# 2) Build + up
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 3) Doğrula
curl -s https://elibrary.libedge.com/api/config
```

Kanıt: `docs/deployments/2026-10-25-v127.md` (aynı akış, `APP_VERSION=127`).

## Varyant 2 — `docker-compose.libedge.yml` (libedge-copy) — ⚠️ EC2'de doğrulanacak

Bu dosya `image:` + `pull_policy: never` tanımlar, yani `--build` ile üretilen
imajın **`LIBEDGE_IMAGE` adıyla etiketlenmesi** gerekir:

```yaml
web:
  image: ${LIBEDGE_IMAGE:-akademik-platform:libedge-r2}
  pull_policy: never
  ports: ["127.0.0.1:3001:3000"]
```

```bash
LIBEDGE_IMAGE=akademik-platform:libedge-copy \
docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 up -d --build
```

**Açık soru:** Canlıdaki imaj `akademik-platform:libedge-copy`
(`sha256:c9730bf3c0af86063b797331859301ee93b7b5924f1b504225a8200a8b025693`),
ne compose varsayılanı (`libedge-r2`) ne de v127 konvansiyonu (`v127-fbeed6e`).
v128–v130'un hangi komutla deploy edildiği **kanıtlanmadı**. Kapatmak için EC2'de:

```bash
docker inspect $(docker ps -q --filter name=web) \
  --format '{{json .Config.Env}}{{"\n"}}{{json .Config.Labels}}{{"\n"}}{{.Config.Image}}{{"\n"}}{{.Image}}'
```

Çıktı bu belgeye işlenene kadar Varyant 2 bir **varsayımdır**.

### `STORAGE_DRIVER=r2` — canlıda doğrulandı (2026-10-26)

Canlıda `STORAGE_DRIVER=r2` **set edilmiş** (ürün sahibi teyidi). Bu, v131 deploy'unda
şu davranışı zorunlu kılar:

`storage.mjs` `createStorage()` açılışta şunları ister (hepsi **test edilmiş** davranış):

| Env / koşul | Yoksa veya geçersizse |
| --- | --- |
| `R2_ENDPOINT` | `missing R2_ENDPOINT` |
| `R2_BUCKET` | `missing R2_BUCKET` |
| `R2_ACCESS_KEY_ID` | `missing R2_ACCESS_KEY_ID` |
| `R2_SECRET_ACCESS_KEY` | `missing R2_SECRET_ACCESS_KEY` |
| `R2_ENDPOINT` biçimi | `invalid R2 endpoint` |
| `R2_BUCKET` biçimi | `invalid R2 bucket` |
| `DATABASE_URL` | `R2 requires database mode` (`server.mjs`, `createStorage` değil) |

**`R2_ENDPOINT` kuralı** (`storage.mjs:31`): `https://<hesap>.r2.cloudflarestorage.com`
— şema `https`, path tam `/`, host `.r2.cloudflarestorage.com` ile bitmeli. username /
password / port / query / hash **reddedilir**.

**`R2_BUCKET` kuralı** (`storage.mjs`, S3 adlandırma): `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`
— 3–63 karakter, **sadece küçük harf**, rakam ve tire. `libedge_books` (alt çizgi),
`LibEdge` (büyük harf), `b` (çok kısa) **reddedilir**. Cloudflare bucket adını
`LibEdge_Books` gibi yazdıysan deploy **açılmaz** — önce küçük harfe çevir.

> **Deploy riski:** bu değerlerden biri eksikse container **açılmaz** — sessizce
> local'a düşmez (`storage.mjs` fail-loud). `--env-file .env.production --env-file .env.r2`
> ikisinin de verildiğinden emin ol; `.env.r2` **git dışında**, sunucuda durur.
>
> **Deploy öncesi ÖN KOŞUL** (container'ı düşürmeden doğrula):
>
> ```bash
> cd spike/app && node scripts/check-r2.mjs
> ```
>
> `R2 PASS: put/read/range/delete; temporary object removed.` görmelisin. Bu script
> kendi rastgele objesini yazıp siler; mevcut veriye dokunmaz.

**Rollback notu:** v131'de `buildSha=1ded27c` ve `version=131` beklenir. R2 env'i
bozuksa önceki imaja (`akademik-platform:libedge-copy`) dönülür. **Dikkat:** v131'te
yüklenen dosyaların `storage_key` değeri `r2://<prefix>/...` biçimindedir
(`storage.mjs:10,141`). v130 kodu bu anahtarları **okuyamaz** — `storage.mjs:45`
`R2 asset requires R2 configuration` fırlatır. Yani rollback, v131'te yüklenmiş
yeni dosyaları erişilemez bırakır (R2 objeleri silinmez, sadece okunamaz).
Rollback'ten sonra yüklenen dosyalar listelenmeli ve gerekirse yeniden yüklenmelidir.

## Deploy sonrası kontrol listesi

- [ ] **Deploy ÖNCESİ:** `cd spike/app && node scripts/check-r2.mjs` → `R2 PASS`
  (`STORAGE_DRIVER=r2` canlıda set; env bozuksa container açılmaz)
- [ ] `/api/config` → `version` beklenen değer, `buildSha` = `git rev-parse --short HEAD`
  Env unutulduysa `version` **`0-dev`** döner (eski davranış: sessizce `127`/`130`).
- [ ] `docker inspect <imaj> --format '{{json .Config.Labels}}'` → `org.opencontainers.image.revision`
  gerçek SHA'yı gösteriyor (`unknown` değil). `unknown` ise build `--build-arg`'sız yapılmıştır.
- [ ] `/api/health` → `ok: true`, `mode: db`
- [ ] Container `healthy`, restart `0`
- [ ] `docs/deployments/<tarih>-v<NNN>.md` oluşturuldu (v127.md tablosunu izle)
- [ ] `docs/deployments/<tarih>-v<NNN>/` altına `config-health-assets.json` kanıtı
- [ ] `PROJECT-STATE.md` "Sürümler" bölümü güncellendi
- [ ] Rollback imajı (`akademik-platform-prod-web:v<NNN>-<sha>`) korunuyor

## Bilinen sınırlar

- `/api/config` **kimlik doğrulamasız** — bilinçli karar (2026-10-26): build
  metadata düşük hassasiyetli, `/api/health` zaten `mode`/`tenantId` veriyor.
  Deployment SHA'sının numaralanabilir olması istenmiyorsa yeniden değerlendir.
- `libedge-copy` imajında `org.opencontainers.image.revision` LABEL'ı **yok**
  (LABEL desteği bu sürümden sonraki build'lerde geçerli).
- Migration uygulaması deploy komutunun parçası **değil**; ayrı adım ve ayrı
  kayıt gerektirir (`docs/deployments/v122-2026-10-24/deployment.json` örneği).
