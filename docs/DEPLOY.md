# Deploy prosedürü

Production kaynağı: `akademik-platform-prod` compose projesi, web servisi
`spike/app` build context'i. Bu belge **hangi komutun gerçekten çalıştığını**
tek yerde tutar; sürüm geçmişi `docs/deployments/` altında, özet `PROJECT-STATE.md`'de.

## Sürüm doğrulama (her deploy'dan sonra)

```bash
curl -s https://elibrary.libedge.com/api/config
# {"version":"132","buildSha":"<deploy edilen SHA>","buildDate":"...","environment":"production",...}

curl -s https://elibrary.libedge.com/api/health
# {"ok":true,"mode":"db","tenantId":"..."}
```

> ### ⚠️ `version` tek başına yeterli DEĞİL — `buildSha`'yı da kontrol et
>
> **2026-10-26 olayı:** v131 deploy'unda `/api/config` `"version":"131"` döndü ama
> `"buildSha":"9f755d6"` — yani **v130 kodu** çalışıyordu. Sebep: `APP_VERSION=131`
> `.env.r2` içinde **elle** set edilmiş; imaj `1ded27c`'ten değil `9f755d6`'dan
> build edilmişti. `version` alanı env'den geldiği için doğru göründü.
>
> **Doğru kontrol:** `buildSha` = deploy etmeyi *amaçladığın* SHA olmalı.
> `APP_VERSION` ile `buildSha` çelişiyorsa **kod eskidir**.
>
> | Alan | Kaynak | Yanıltıcı olabilir mi |
> | --- | --- | --- |
> | `version` | `APP_VERSION` env | ✅ Evet — elle set edilir |
> | `buildSha` | `BUILD_SHA` env | ⚠️ Evet — elle set edilir, build'i kanıtlamaz |
> | image LABEL `revision` | `--build-arg` | ❌ Hayır — build anında gömülür |
>
> **Tek güvenilir kanıt** `docker inspect` LABEL'ıdır (aşağıya bak).

### Build kimliğini kesinleştirme

```bash
# Hangi SHA gerçekten derlendi?
docker inspect <imaj> --format '{{json .Config.Labels}}' | grep revision

# Env ile çelişiyor mu?
docker inspect $(docker ps -q --filter name=web) \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(APP_VERSION|BUILD_SHA|BUILD_DATE)='
```

`revision` LABEL'ı `unknown` ise imaj `--build-arg` **verilmeden** derlenmiştir
(v130 Dockerfile'ında `ARG` yoktu — LABEL hiç üretilmez). Bu durumda hangi kodun
çalıştığı yalnızca elle doğrulanabilir; **deploy doğrulanmamış sayılır**.

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
| `.env.r2` | `LIBEDGE_IMAGE` (**zorunlu** — verilmezse compose `libedge-v131` yedeğine düşer), `APP_VERSION`, `BUILD_SHA`, `BUILD_DATE`, R2 ayarları | Yalnız `docker-compose.libedge.yml` kullanıldığında |

> **`LIBEDGE_IMAGE=... sudo docker compose` YAZMA.** `sudo` ortamı temizler
> (`env_reset`); değişken compose'a ulaşmaz ve compose yedeğe düşer. Ya `.env.r2`
> içine yaz ya da `sudo LIBEDGE_IMAGE=... docker compose` biçimini kullan.

`--env-file` verilmezse compose `set POSTGRES_DB` benzeri hatalarla **durur**;
deploy komutunda `--env-file` opsiyonel değildir.

## Varyant 1 — `docker-compose.prod.yml` (v127'ye kadar kullanılan yol)

```bash
# 1) .env.production içindeki üç public alanı güncelle:
#    APP_VERSION=132
#    BUILD_SHA=<git rev-parse --short HEAD>
#    BUILD_DATE=2026-10-27

# 2) Build + up
#    caddy bu dosyada `profiles: [proxy]` ile kapalı. Ön yüz cloudflared'dır
#    (`127.0.0.1:3001`'e tüneller); nginx kapalı. 80/443 dinleyen bir şey AÇMA:
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

#    Yalnızca caddy ön yüz olacaksa (bugün canlıda DEĞİL) profili aç:
# docker compose -f docker-compose.prod.yml --env-file .env.production \
#   --profile proxy up -d --build

# 3) Doğrula
curl -s https://elibrary.libedge.com/api/config
```

Kanıt: `docs/deployments/2026-10-25-v127.md` (aynı akış, `APP_VERSION=127`).

## Varyant 2 — `docker-compose.libedge.yml` (canlı, 2026-10-27'den beri)

Bu dosya `image:` + `pull_policy: never` tanımlar. **`--build` yeni imaj üretir ama
devreye girmez** — compose `image:` satırındaki adı kullanır. Satır bir değişken
okur ve varsayılanı **yalnızca yedek**tir:

```yaml
web:
  image: ${LIBEDGE_IMAGE:-libedge-v131}   # yedek; canlıda .env.r2'den geliyor
  pull_policy: never
  ports: ["127.0.0.1:3001:3000"]
```

**Gerçek imaj adı `.env.r2` içinde verilir:**

```bash
LIBEDGE_IMAGE=libedge-v132
```

v132 bu şekilde deploy edildi. Compose `env_file: [.env.r2]` ile bu değeri okur;
`--env-file .env.r2` de aynı değeri verir. İki yol da `LIBEDGE_IMAGE`'ı görür.

> ### 🔴 2026-10-26 kesintisinin kök nedeni — düzeltilmiş anlatım
>
> **Eski (yanlış) anlatım:** "satır sabit `libedge-v131` yazıyordu, `LIBEDGE_IMAGE`
> kullanılmıyordu."
>
> **Doğrusu:** satır **zaten** `${LIBEDGE_IMAGE:-akademik-platform:libedge-r2}`
> biçimindeydi, yani değişken **kullanılıyordu** — sadece **hiç verilmiyordu**.
> Verilmeyen değişken varsayılana, yani **eski `libedge-r2` imajına** düşüyordu;
> yeni build edilen `libedge-v131` hiç devreye girmiyordu.
>
> **Ve `sudo` bu değişkeni siler.** Şu biçim çalışmaz:
>
> ```bash
> LIBEDGE_IMAGE=libedge-v132 sudo docker compose ... up -d --no-deps web   # ❌
> ```
>
> `sudo` varsayılan olarak ortamı temizler (`env_reset`). Değişken `sudo`'nun
> çocuk süreci olan `docker compose`'a **ulaşmaz**; compose varsayılana düşer.
> Bu, "değişkeni verdim ama etkisi olmadı" şeklinde görünür ve tam olarak
> 26 Ekim'de olan budur.
>
> **Doğrusu — şu iki yoldan biri:**
>
> ```bash
> # 1) .env.r2 içinde tut (canlıda kullanılan yol, önerilen)
> #    LIBEDGE_IMAGE=libedge-v132  satırını .env.r2'ye yaz.
>
> # 2) Değişkeni sudo'ya açıkça geçir
> sudo LIBEDGE_IMAGE=libedge-v132 docker compose ...
> #    veya: sudo --preserve-env=LIBEDGE_IMAGE docker compose ...
> ```
>
> **Sürüm atlarken ilk kontrol:** `docker compose config` ile compose'un imaj
> adını **gerçekten** ne gördüğünü yazdır. Tahmin etme:
>
> ```bash
> sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
>   --env-file .env.production --env-file .env.r2 config | grep image:
> ```
>
> Çıktı yeni imajı göstermiyorsa deploy **başlamamalı**.


### Doğru deploy akışı (canlıda çalışan)

> ⚠️ **`--env-file` iki tane.** `.env.production` `DOMAIN`, `POSTGRES_*`,
> `DATABASE_URL`, `SESSION_SECRET` sağlar; `.env.r2` uygulama/R2 ayarlarını.
> Sadece `.env.r2` verirsen compose
> `required variable DOMAIN is missing a value: set DOMAIN` ile **durur**
> (2026-10-27'de tam bu yaşandı). İkisi de zorunlu, sıra önemli değil.

```bash
cd /var/www/akademik-platform
git fetch origin && git checkout main && git pull --ff-only origin main
SHA=$(git rev-parse --short HEAD)

# 0) Disk temizliği — 2026-10-27'de disk %95 doluydu, deploy bundan önce durdu.
sudo docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.Size}}'
sudo docker image prune -a -f
#    ÇALIŞAN imaj (bu deploy'un rollback'i) otomatik korunur — prune yalnız
#    hiçbir container'ın kullanmadığı imajlara dokunur. Önceki sürümün ARTIK
#    imajları ve node:22-alpine silinir; node:22-alpine build sırasında
#    yeniden çekilir, bu normaldir.
#    NOT: çalışan container'a bağlı olmayan etiketli bir rollback imajı
#    (ör. libedge-v131-9f755d6) prune tarafından SİLİNİR. Rollback için
#    çalışan imajı kullan; farklı bir imajı elde tutmak istiyorsan
#    `docker tag <imaj> <ad>:rollback` ile sabitle veya prune -a KULLANMA.

# Build context = spike/app. Dockerfile `npm ci --omit=dev`'i zaten KENDİSİ
# yapar (Dockerfile:17); host'ta node YOK, `npm ci` host'ta ÇALIŞTIRILMAZ
# (bkz. db/README.md → "Running it on the EC2 host").
cd spike/app
sudo docker build \
  --build-arg BUILD_SHA=$SHA \
  --build-arg APP_VERSION=132 \
  --build-arg BUILD_DATE=$(date -I) \
  -t libedge-v132 .

# Build kimliği gerçekten gömüldü mü?
sudo docker inspect libedge-v132 --format '{{json .Config.Labels}}'
# {"...revision":"<SHA>","...version":"132"} — "unknown" ise --build-arg unutulmuş

# Container env'i de aynı SHA'yı göstermeli — VE imaj adı .env.r2'de olmalı.
# .env.r2 repo KÖKÜNDE, o yüzden önce geri dön.
cd /var/www/akademik-platform
sudo sed -i "s/^BUILD_SHA=.*/BUILD_SHA=$SHA/" .env.r2
sudo sed -i "s/^APP_VERSION=.*/APP_VERSION=132/" .env.r2
sudo sed -i "s/^LIBEDGE_IMAGE=.*/LIBEDGE_IMAGE=libedge-v132/" .env.r2
grep -E '^(APP_VERSION|BUILD_SHA|LIBEDGE_IMAGE)=' .env.r2

# 1) Compose gerçekten yeni imajı görüyor mu? GÖRMÜYORSA DURDUR.
sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 config | grep image:
# beklenen: image: libedge-v132

# 2) Başlat
sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 up -d --no-deps web
```

### Migration'lar — imajdan ÖNCE

Yeni imaj fail-closed çalışır: **grant yoksa katalog boş görünür.** Bu yüzden
migration'lar imaj başlatılmadan önce uygulanır. Sunucuda node yok; runner
throwaway bir `node:22-alpine` container'ında koşar (`db/README.md`).

```bash
cd /home/ubuntu/akademik-platform

# 0) Yedek — her şeyden önce
sudo docker exec akademik-platform-prod-db-1 \
  pg_dump -U akademik -Fc akademik > ~/backup-$(date +%Y%m%d-%H%M).dump
ls -l ~/backup-*.dump     # 0 byte değil, MB mertebesinde olmalı

# 1) Durum
sudo docker run --rm --network akademik-platform-prod_default \
  -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app \
  -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" \
  node:22-alpine \
  sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'

# 2) Registry boşsa YALNIZCA ilk seferde baseline
#    (001–017 uygulanmış kabul edilir, SQL çalışmaz)
#    ... node /repo/db/migrate.mjs --baseline

# 3) Uygula
#    ... node /repo/db/migrate.mjs
```

Registry boşken `users` tablosu varsa runner **baseline'sız apply'ı reddeder** —
bu hata değil, korumadır: yoksa `003` demo hesabını prod'a geri eklerdi.

**Beklenen çıktılar (v132'de ölçüldü):**

| Komut | Çıktı |
| --- | --- |
| `--status` | `19 files, 0 applied, 19 pending` — 018/019 **ve** henüz merge edilmemiş olanlar. `013–017 cannot run: manages its own transaction (begin;)` satırı **normaldir**: o dosyalar kendi `begin;`'ini yönetir, runner onları çalıştırmaz, baseline ile "uygulanmış" sayar |
| `--baseline` | 001–017 işaretlenir, SQL çalışmaz |
| `--status` (baseline sonrası) | `20 files, 17 applied, 3 pending` (018, 019, 020) |
| apply | 018/019/020 uygulanır; `--status` → hepsi applied |

> Sayılar **o gün repoda kaç migration olduğuna** bağlıdır. Kontrol ölçütü sayı
> değil: baseline sonrası **pending = yeni dosya sayısı**, apply sonrası
> **pending = 0**.


**`--no-deps web` neden:** servis adı + `--no-deps` olmadan compose db'ye ve
caddy'ye de dokunur. caddy artık `profiles: [proxy]` ile kapalı, ama db'yi
gereksiz yere yeniden yaratmamak için `web`'i hedefle.

**`down` KULLANMA.** `down` db'yi de kaldırır; tekrar `up` yaptığında db yeni
bir IP alır ve eski web container'ı `getaddrinfo EAI_AGAIN db` ile kopar.
Yeniden başlatmak için:

```bash
sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 stop web
sudo docker rm akademik-platform-prod-web-1
sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 up -d --no-deps web
```

`port is already allocated` alırsan sebebi budur: eski container hâlâ 3001'i
tutuyor. `rm` ile önce kaldır, sonra `up`.

### Canlı gerçek (2026-10-27 doğrulandı)

| | |
| --- | --- |
| İmaj | `libedge-v132` (**`.env.r2` → `LIBEDGE_IMAGE=libedge-v132`**; rollback: `libedge-v131`) |
| Port | `127.0.0.1:3001` → container `3000` |
| Trafik | **cloudflared** (Zero Trust tüneli `libedge-elibrary`) → `127.0.0.1:3001` → `akademik-platform-prod-web-1`. **nginx kapalı**, 80/443 güvenlik grubunda kapalı |
| Env | `.env.production` + `.env.r2` — `DEMO_TENANT_ID=5799f2a5-...`, `STORAGE_DRIVER=r2`, `APP_VERSION=132`, `BUILD_SHA=8df115f`, `LIBEDGE_IMAGE=libedge-v132` |
| DB | PostgreSQL, container `akademik-platform-prod-db-1`, süper kullanıcı `akademik` |
| Migration | 001–020. 001–017 **baseline** (SQL çalıştırılmadan işaretlendi); 018/019/020 runner ile uygulandı |
| Container adları | **`prod` öneki var**: `akademik-platform-prod-web-1`, `-db-1` |


> ### ✅ Ağ: ayrı bir network tanımı GEREKMEZ (2026-10-27 doğrulandı)
>
> `docker-compose.prod.yml` başında `name: akademik-platform-prod` var. Compose
> bu yüzden proje için **`akademik-platform-prod_default`** ağını oluşturuyor ve
> **db ile web ikisi de zaten onun içinde**:
>
> ```
> prod.yml tek başına:
>   db  networks = default
>   web networks = default
>   default.name = akademik-platform-prod_default   ← aynı ağ
> ```
>
> Yani 2026-10-26'da elle çalıştırılan
> `docker network connect akademik-platform-prod_default ...` **gereksizdi**;
> zaten bağlıydı. O gün görülen `EAI_AGAIN db` bir **ağ eksikliği değil**,
> eski web container'ının `down` sonrası yeniden yaratılan db'nin yeni IP'sine
> ulaşamamasıydı.
>
> `docker-compose.libedge.yml` içine `networks:` bloğu **eklemeyin** — hiçbir şey
> kazandırmaz, web'i gereksiz ikinci bir ağa bağlar.
>
> `mode:"demo"` dönerse önce container'ın **imaj adını ve yaşını** kontrol et:
>
> ```bash
> sudo docker inspect $(sudo docker ps -q -f name=akademik-platform-prod-web-1) \
>   --format '{{.Config.Image}} {{.State.StartedAt}}'
> ```
>
> Eski imaj adı veya saatler öncesi bir `StartedAt` → container hiç yenilenmemiş.

### Tenant durumu

`DEMO_TENANT_ID=5799f2a5-...` → **LibEdge**. `/api/health` bu değeri döndürüyor.

> **Dikkat:** Eski "Demo Üniversitesi" tenant'ı (`11111111-1111-...` varsayılanı)
> boş kaldı ama eski kullanıcılar (`librarian@example.edu.tr` vb.) hâlâ **orada**.
> Bu kullanıcılar LibEdge tenant'ına taşınmadı — giriş yaparlarsa boş bir kütüphane
> görürler. Karar bekliyor: taşı (UPDATE `users`/`memberships`) veya sil.

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

**Rollback (v132 → v131):** yalnızca `.env.r2` içindeki imaj adını değiştir — compose
dosyasına dokunma:

```bash
sudo sed -i 's/^LIBEDGE_IMAGE=.*/LIBEDGE_IMAGE=libedge-v131/' .env.r2
sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=131/' .env.r2
sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  --env-file .env.production --env-file .env.r2 up -d --no-deps web
```

**Rollback imajı nasıl korunur:** `docker image prune -a` yalnız **hiçbir
container'ın kullanmadığı** imajları siler. Yani rollback hedefi, **o an çalışan
container'ın imajıdır** ve prune'a takılmaz — v132'den v133'e geçerken korunan şey
`libedge-v132`'dir, çünkü v133 deploy'u başlarken hâlâ o çalışıyor.

Etiketli ama **çalışmayan** bir "artık" imaj (ör. v131 kesintisinden kalan
`libedge-v131-9f755d6`) prune tarafından **silinir**. Böyle bir imajı bilinçli
olarak elde tutmak istiyorsan önce `docker tag` ile bir ada bağla ve
`prune -a` kullanma. Kural: **çalışan imaj dışında bir şey saklama.**

**Dikkat:** v131'ten itibaren yüklenen
dosyaların `storage_key` değeri `r2://<prefix>/...` biçimindedir
(`storage.mjs:10,141`). v130 kodu bu anahtarları **okuyamaz** — `storage.mjs:45`
`R2 asset requires R2 configuration` fırlatır. Yani v130'a kadar geri inmek,
o sürümden sonra yüklenmiş yeni dosyaları erişilemez bırakır (R2 objeleri
silinmez, sadece okunamaz). Rollback'ten sonra yüklenen dosyalar listelenmeli ve
gerekirse yeniden yüklenmelidir.



## Deploy sonrası kontrol listesi

- [ ] **Deploy SONRASI:** `sudo docker exec akademik-platform-prod-web-1 node scripts/check-r2.mjs`
  → `R2 PASS: put/read/range/delete; temporary object removed`
  (host'ta `node` yok; betik **container içinde** koşar — `db/README.md` ile aynı kural).
  `STORAGE_DRIVER=r2` canlıda set; env bozuksa container açılmaz.
- [ ] `/api/config` → `version` beklenen değer, `buildSha` = `git rev-parse --short HEAD`
  Env unutulduysa `version` **`0-dev`** döner (eski davranış: sessizce `127`/`130`).
- [ ] `docker inspect <imaj> --format '{{json .Config.Labels}}'` → `org.opencontainers.image.revision`
  gerçek SHA'yı gösteriyor (`unknown` değil). `unknown` ise build `--build-arg`'sız yapılmıştır.
- [ ] `/api/health` → `ok: true`, `mode: db`
- [ ] Container `healthy`, restart `0`
- [ ] `docs/deployments/<tarih>-v<NNN>.md` oluşturuldu (v127.md tablosunu izle)
- [ ] `docs/deployments/<tarih>-v<NNN>/` altına `config-health-assets.json` kanıtı
- [ ] `PROJECT-STATE.md` "Sürümler" bölümü güncellendi
- [ ] Rollback imajı korunuyor: **çalışan container'ın imajı** (prune silmez). Önceki sürümlerin artık imajları silindi mi?

## Bilinen sınırlar

- `/api/config` **kimlik doğrulamasız** — bilinçli karar (2026-10-26): build
  metadata düşük hassasiyetli, `/api/health` zaten `mode`/`tenantId` veriyor.
  Deployment SHA'sının numaralanabilir olması istenmiyorsa yeniden değerlendir.
- `libedge-copy` imajında `org.opencontainers.image.revision` LABEL'ı **yok**
  (LABEL desteği bu sürümden sonraki build'lerde geçerli).
- Migration uygulaması deploy komutunun parçası **değil**; ayrı adım ve ayrı
  kayıt gerektirir (`docs/deployments/v122-2026-10-24/deployment.json` örneği).
