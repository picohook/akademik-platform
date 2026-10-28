# v137 deploy runbook — 021/022 migration'ları + `akademik_catalog` LOGIN

> **Durum: ÇALIŞTIRILMADI.** Bu dosya bir **plan**dır; hiçbir komut prod'da koşulmadı.
> Değerler `docs/DEPLOY.md` ve v136 kaydından türetildi, tahmin edilmedi. Gerçek çıktılar
> deploy sırasında **bu dosyaya** yazılır (WORKFLOW.md §Deploy kuralları).
>
> **Ön koşul:** komutları çalıştırmadan önce **Claude'a inceletin** (bkz. §11).
>
> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5`.
> ilgili: PR #40 (`feat/migrations-021-022`), `db/migrations/021-*.sql`, `022-*.sql`, `db/README.md`.

## 0. Bu sürümde ne değişiyor

| | |
| --- | --- |
| Kodsal değişiklik | **Yok.** v137 yalnız **şema** getiriyor; `server.mjs` davranışı v136 ile aynı |
| Migration | **021** (kimlik/abonelik tabloları) ve **022** (global katalog sınırı) — ilk kez prod'a girer. Prod şu an **001–020** |
| Veri taşıması | **Yok.** 021/022 tek bir eseri global kataloğa taşımaz; o **023** ve sözleşme §4.4 listesi onaylanana kadar yazılmaz |
| Yeni rol | `akademik_catalog` — 022'de **NOLOGIN** yaratılır. LOGIN + parola bu runbook'ta verilir |
| Kırılma riski | `collection_items` üzerine RLS **enable + force**. Prod'da `collection_items` satırlarının `tenant_id`'si doğru olmalı, yoksa koleksiyon grant'leri görünmez olur (bkz. §3.1 ön kontrol) |

## 1. Kurallar (bu runbook boyunca)

1. **Her komut tek satır.** Çok satırlı yapıştırma SSH'ta kilitleniyor; `\` ile bölünmüş komut yazılmaz.
2. `sudo` ortamı temizler: `LIBEDGE_IMAGE=... sudo docker compose` **çalışmaz**; imaj adı `.env.r2` içine yazılır.
3. Parola **komut satırına yazılmaz** → `ps`/`history`'ye düşer. Yalnız `read -rs` ile okunur ve doğrudan `psql`'in stdin'ine verilir.
4. `docker compose down` **kullanılmaz** (db'yi kaldırır; web sonra `EAI_AGAIN db` alır).
5. Sıra: **yedek → migration → imaj**. Migration'lar imajdan **önce** (yeni imaj fail-closed: grant yoksa katalog boş görünür).
6. Bir adım beklenen çıktıyı vermezse **DUR**; sonraki adıma geçilmez.

## 2. Ön kontrol — değişiklik yapmadan

```bash
cd /var/www/akademik-platform && git fetch origin && git checkout main && git pull --ff-only origin main && git log -1 --oneline
```

```bash
cd /var/www/akademik-platform && sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

Beklenen: `akademik-platform-prod-web-1` → `libedge-v136` `(healthy)`, `akademik-platform-prod-db-1` → `(healthy)`.

```bash
cd /var/www/akademik-platform && curl -s https://elibrary.libedge.com/api/config && echo && curl -s https://elibrary.libedge.com/api/health
```

Beklenen: `/api/config` → `"version":"136"` / `"buildSha":"96cc270"`; `/api/health` → `{"ok":true,"mode":"db",...}`.

## 3. Yedek — her şeyden önce

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 pg_dump -U akademik -Fc akademik > ~/backup-pre-v137-$(date +%Y%m%d-%H%M).dump
```

```bash
ls -l ~/backup-pre-v137-*.dump
```

**0 byte ise DUR.** Beklenen: MB mertebesinde tek dosya.

### 3.1 `collection_items` ön kontrolü (022 RLS'ten ÖNCE)

022 `collection_items`'e `enable` + `force row level security` uygular. O tabloda
`tenant_id` **null** kalan satır varsa app o satırları **artık görmez** ve o
koleksiyonlara bağlı grant'ler sessizce boşalır. Migration'dan **önce** ölçülür:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*) filter (where tenant_id is null) as null_tenant, count(*) as total from collection_items"
```

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select c.id, c.title, count(ci.*) from collections c left join collection_items ci on ci.collection_id = c.id group by 1,2 order by 3 desc"
```

| Sonuç | Karar |
| --- | --- |
| `null_tenant = 0` | Devam |
| `null_tenant > 0` | **DUR.** 022'deki backfill'e rağmen null kalan satır varsa hangi koleksiyona ait oldukları **Altan'ın kararı**; kendiliğinden düzeltilmez |

## 4. Migration — imajdan ÖNCE

Sunucuda node yok; runner throwaway `node:22-alpine` container'ında koşar (`db/README.md`).
`POSTGRES_PASSWORD` repo kökündeki `.env.production`'dan okunur — parola **komut satırına yazılmaz**:

```bash
cd /var/www/akademik-platform && set -a && . ./.env.production && set +a && echo "POSTGRES_PASSWORD set: ${POSTGRES_PASSWORD:+yes}"
```

Beklenen: `POSTGRES_PASSWORD set: yes`. Boşsa **DUR**.

### 4.1 Durum — önce

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

**Beklenen:** `021` ve `022` **pending**; geri kalanı `applied`.

> Prod 020'ye kadar runner ile ilerledi, yani `schema_migrations` dolu →
> **baseline GEREKMEZ**. `--status` "not baselined" derse **DUR ve sor**; körlemesine
> `--baseline` **çalıştırılmaz** (003 prod'a demo hesap geri ekler).

### 4.2 Kuru çalıştırma

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --dry-run'
```

**Beklenen:** yalnız `021` ve `022` listelenir; başka dosya yok.

### 4.3 Uygula

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs'
```

### 4.4 Durum — sonra

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

**Beklenen:** `pending = 0`. Değilse **DUR**.

### 4.5 RLS gerçekten açıldı mı (ölçüm)

022'nin asıl iddiası `collection_items`'te RLS'in **etkin** olması. Migration'ın
başarılı görünmesi yetmez, `pg_class` okunur:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'collection_items'"
```

**Beklenen:** `collection_items|t|t`. `f` dönerse **DUR** — 022 uygulanmamış ya da
üzerine yazılmış demektir, imaja geçilmez.

## 5. `akademik_catalog` — LOGIN ve parola

022 rolü **`NOLOGIN`** yaratır (`022-global-catalogue-boundary.sql:50`). Katalog yazma
yolu (köprü v1) bu rolle bağlanacak; **bugünkü v136 kodu bu rolü kullanmıyor**, yani bu
adım v137 için zorunlu değil ama **köprü PR'ından önce** gerekli. Yine de v137'de
yapılması öneriliyor: parola bir kez, kontrollü biçimde verilir.

Güvenlik kuralları:

- Parola **`gen_random_uuid()`** gibi sunucu tarafında üretilmez (bir zar **olmaz**) ve
  **komut satırına yazılmaz**. `read -rs` ile terminalden okunur, doğrudan `psql`'in
  **stdin**'ine verilir; `ps`, `.bash_history` ve container log'unda görünmez.
- Parola **en az 32 karakter**, rastgele (parola yöneticisi üretir). Kopyala-yapıştır
  yapılırken terminale **ekrana basılmaz**.
- `.env.r2.bak-v136` **ve** `.env.r2` yedeği bu adımdan önce alınır.

### 5.1 Parolayı `read` ile oku ve rolü aç — tek satır

```bash
cd /var/www/akademik-platform && read -rsp 'akademik_catalog password: ' P && echo && printf '\\password akademik_catalog\n%s\n' "$P" | sudo docker exec -i akademik-platform-prod-db-1 psql -U akademik -d akademik -v ON_ERROR_STOP=1 -c "alter role akademik_catalog login" && printf 'alter role akademik_catalog password %s;\n' "'${P//\'/\'\'}'" | sudo docker exec -i akademik-platform-prod-db-1 psql -U akademik -d akademik -v ON_ERROR_STOP=1 && unset P
```

> `\password` psql'in **kendi** meta-komutudur ve parolayı sunucuda hash'ler; parola
> `psql` stdin'inden okunur (ilk `printf |` bunun içindir). İkinci `printf` doğrudan
> `alter role ... password` çalıştırır — sunucu `scram-sha-256` ile saklar.
> **`unset P` komutun sonunda**: parola kabuk değişkeninde kalmaz.

### 5.2 Ölçüm — rol ve yetkiler

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_catalog'"
```

**Beklenen:** `akademik_catalog|t|f|f` — **LOGIN açık, süper kullanıcı ve `bypassrls` KAPALI**. `t` görürsen **DUR**.

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*) from information_schema.role_table_grants where grantee = 'akademik_catalog'"
```

**Beklenen:** 6 satır (`works`, `editions`, `assets`, `asset_pages`, `collections`, `collection_items`, `tenants` → SELECT; tablo sayısı neyse o). Sayı **0 ise DUR**: 022 uygulanmamış demektir.

### 5.3 Parolayı `.env.r2`'ye yaz — dosyaya, komut satırına değil

```bash
cd /var/www/akademik-platform && sudo cp .env.r2 .env.r2.bak-v137 && echo 'CATALOG_DATABASE_URL=postgres://akademik_catalog:REPLACE_ME@db:5432/akademik' | sudo tee -a .env.r2 >/dev/null && grep -c '^CATALOG_DATABASE_URL=' .env.r2
```

**Beklenen:** `1`. Sonra `sudo nano .env.r2` (ya da `sudoedit`) ile `REPLACE_ME` **elle**
değiştirilir — yani parola komut geçmişine hiç girmez.

> **Not (bilinçli sınır):** `CATALOG_DATABASE_URL` **v136/v137 kodunda okunmuyor**;
> yalnız köprü PR'ı için yer tutucu. Kullanılmayan bir env değişkeni sessiz kalmamalı:
> köprü PR'ı bunu okuyana kadar `.env.r2`'de durmasının zararı yok, ama **deploy
> doğrulamasında kanıt sayılmaz**.

## 6. İmaj — build, etiket, geçiş

Disk 8 GB gp3 ve %85 doluydu (v136'da `docker rmi libedge-v134` ile açıldı). Build
öncesi **çalışan imajın dışındakiler** temizlenir; çalışan imaj (`libedge-v136`)
prune'dan korunur ve **rollback odur**.

```bash
cd /var/www/akademik-platform && sudo docker image ls --format '{{.Repository}}:{{.Tag}}' && df -h / | tail -1
```

```bash
cd /var/www/akademik-platform && sudo docker image prune -a -f && df -h / | tail -1
```

> `prune -a` **çalışmayan etiketli** imajları da siler. Rollback için `libedge-v136`
> **çalışan** imaj olduğu için korunur. Farklı bir imajı elde tutmak istiyorsan
> `sudo docker tag <imaj> libedge-keep` ile sabitle ve bu adımı **atla**.

```bash
cd /var/www/akademik-platform && git rev-parse --short HEAD
```

```bash
cd /var/www/akademik-platform/spike/app && sudo docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) --build-arg APP_VERSION=137 --build-arg BUILD_DATE=$(date -I) -t libedge-v137 .
```

```bash
cd /var/www/akademik-platform && sudo docker inspect libedge-v137 --format '{{json .Config.Labels}}'
```

**Beklenen:** `revision` gerçek SHA, `version` `137`. `unknown` ise `--build-arg` unutulmuş → **DUR**.

```bash
cd /var/www/akademik-platform && sudo sed -i "s/^BUILD_SHA=.*/BUILD_SHA=$(git rev-parse --short HEAD)/" .env.r2 && sudo sed -i "s/^APP_VERSION=.*/APP_VERSION=137/" .env.r2 && sudo sed -i "s/^LIBEDGE_IMAGE=.*/LIBEDGE_IMAGE=libedge-v137/" .env.r2 && grep -E '^(APP_VERSION|BUILD_SHA|LIBEDGE_IMAGE)=' .env.r2
```

**Beklenen:** `APP_VERSION=137`, `BUILD_SHA=<sha>`, `LIBEDGE_IMAGE=libedge-v137`.

```bash
cd /var/www/akademik-platform && sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml --env-file .env.production --env-file .env.r2 config | grep image:
```

**Beklenen:** `image: libedge-v137`. Başka bir şey yazıyorsa **DUR** (v131 kesintisinin nedeni tam buydu).

```bash
cd /var/www/akademik-platform && sudo docker compose -f docker-compose.prod.yml -f docker-compose.libedge.yml --env-file .env.production --env-file .env.r2 up -d --no-deps web
```

### 6.1 `OPDS_TENANT_ID` / `OPDS_API_KEY` (bu sürümde tanımlanmıyor)

Kodu okudum, davranış tahmin değil (`server.mjs:1232` `opdsTokenAuth`):

- API-key kimlik doğrulaması üç env ister: **`OPDS_API_KEY` + `OPDS_USER_EMAIL` + `OPDS_TENANT_ID`**. Üçü de dolu değilse `opdsTokenAuth` **`null` döner** — yani anahtar verilmiş olsa bile kimlik doğrulanmaz. **Yalnız `OPDS_TENANT_ID` yazmak bir şey yapmaz.**
- Anahtar verilmezse `/opds` bugünkü gibi **açık** kalır (cookie/paylaşımlı) ve `tenantId` olarak `/api/health`'in döndürdüğü env tenant kullanılır.
- `OPDS_TENANT_ID`, üçlü tanımlandığında `users` sorgusunu **o tenant içinde** koşturur (`FORCE RLS`); kullanıcı başka tenant'taysa eşleşmez ve istek reddedilir.

**v137'de tanımlanmıyor.** Tek tenant olduğu için avantajı yok, ve yanlış `OPDS_USER_EMAIL`
yazmak `/opds`'i sessizce kapatır (feed boş kalır, 401 döner). İkinci kurum geldiğinde
(`docs/TODO.md` §3) ayrı bir karar + doğrulama adımı olarak ele alınır.

## 7. Doğrulama — imaj geçtikten sonra

Her satır **ölçülmüş çıktıyla** kapanır; boş/tahmini satır `docs/deployments/`'a yazılmaz.

### 7.1 Container ve sürüm

```bash
cd /var/www/akademik-platform && sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

**Beklenen:** `web-1` → **`libedge-v137`** `(healthy)`, `db-1` → `(healthy)`.

```bash
cd /var/www/akademik-platform && curl -s https://elibrary.libedge.com/api/config && echo && curl -s https://elibrary.libedge.com/api/health
```

**Beklenen:** `"version":"137"`, `"buildSha"` = `git rev-parse --short HEAD`'in ilk 7'si, `"buildDate"` = bugün, `"environment":"production"`; health → `"ok":true`, `"mode":"db"`, `tenantId` = `5799f2a5-…` (**değişmemeli**).

```bash
cd /var/www/akademik-platform && curl -s https://elibrary.libedge.com/ | grep -o '/app.js?v=[^"]*'
```

**Beklenen:** `/app.js?v=<sha>` — `?v=0-dev` **değil**.

### 7.2 R2

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-web-1 sh -c 'cd /app && node scripts/check-r2.mjs'
```

**Beklenen:** `R2 PASS: put/read/range/delete; temporary object removed.` Başka bir şey (yığın izi, `missing R2_ENDPOINT`) → **DUR**.

### 7.3 Giriş, katalog, kitap düzenleme

Tarayıcıda (Altan):

| Adım | Beklenen |
| --- | --- |
| `https://elibrary.libedge.com` → giriş | Form açılır, giriş **başarılı** |
| Katalog | **13 kitap** görünüyor (v136 ile aynı sayı — 021/022 eser taşımadı) |
| Bir kitabı aç → **Düzenle** → **Yazar** alanı dolu mu | Dolu; kaydet → sayfa yenilendiğinde **korunmuş** (`updateBook` yolu, #38) |
| PDF aç / EPUB aç | İkisi de açılıyor |
| PDF indir | İner (filigranlı) |

### 7.4 Global yazma denemesi `akademik_app` ile **reddedilmeli**

022'nin iddiası: app rolü global katalog satırlarını **değiştiremez/silemez**. Ölçüm
prod'da, gerçek veriye dokunmadan yapılır: **etkilenen satır sayısı 0** olmalı — kısıtlayıcı
politika satırı gizler, hata fırlatmaz.

Önce kaç global eser var:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*) from works where tenant_id is null"
```

**Beklenen:** `0` — 022 tek eser taşımadı. **`0` ise aşağıdaki iki test anlamsızdır**
(etkilenecek satır yok); atla ve deploy kaydına "global eser yok, 023'ten sonra ölçülecek"
yaz. `> 0` ise devam:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; update works set title = title where tenant_id is null"
```

**Beklenen:** `UPDATE 0`. `UPDATE 1+` → **DUR** (başlık aynı yazıldığı için veri bozulmaz, ama 022 tutmuyor demektir).

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; delete from works where tenant_id is null"
```

**Beklenen:** `DELETE 0`.

> **`set role akademik_app` neden:** migration'lar `akademik` (süper kullanıcı) ile koşar.
> `FORCE RLS` tablo **sahibini** de kapsar ama **süper kullanıcıyı kapsamaz** — süper
> kullanıcıyla yapılan test kendini kandırır. Prod'da app'in gerçekten kullandığı rol
> `akademik_app`; ölçüm onunla yapılır.

### 7.5 `akademik_catalog` (yalnız §5 yapıldıysa)

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_catalog'"
```

**Beklenen:** `akademik_catalog|t|f|f`.

## 8. Rollback

| Katman | Geri dönüş |
| --- | --- |
| **İmaj** | `.env.r2`: `LIBEDGE_IMAGE=libedge-v136`, `APP_VERSION=136`, `BUILD_SHA=96cc270` → compose `config \| grep image:` → `up -d --no-deps web` |
| **Env** | `.env.r2.bak-v137` ve `.env.r2.bak-v136` |
| **Migration 021/022** | **Geri alınmaz** (aşağıya bak) |

**021/022 neden geri alınmaz:**

- İkisi de **additive**: yeni tablolar, yeni **nullable** kolonlar (`works.withdrawn_at`,
  `collection_items.tenant_id`), yeni indeksler, yeni fonksiyonlar. v136 kodu bu
  kolonları **okumaz**; varlıkları zarar vermez.
- Geri alınabilir tek şey `collection_items`'teki `enable` + `force` RLS'tir. Onu geri
  almak, v137 geri alınmış olsa bile uygulamayı **korumasız** bırakır.
- Gerçek bir sorun çıkarsa önce **image** geri alınır. Sorun RLS'in kendisindeyse
  (ör. 7.3'te koleksiyon kitapları görünmüyorsa) **elle RLS kapatılmaz**;
  `docs/TODO.md`'ye iş açılır, düzeltme ayrı migration ile gelir. Elle
  `alter table ... disable row level security` **çalıştırılmaz**.
- Migration'ı geri almanın gerçekten gerektiği tek durum: 021/022'deki bir SQL hatası
  **v136 kodunu kırıyorsa** (ör. adı çakışan nesne). O zaman yedekten dönüş tartışılır —
  `pg_dump`'ın ilk adım olmasının sebebi bu.

## 9. Deploy kaydı

`docs/deployments/2026-10-??-v137.md` yalnız **gerçek çıktılarla** doldurulur:

- `/api/config` ve `/api/health` gövdeleri (birebir)
- `curl / | grep -o '/app.js?v=...'` çıktısı
- `R2 PASS` satırı
- `docker ps` satırları
- `--status` çıktısı (§4.1 ve §4.4)
- §7.4'ün `UPDATE 0` / `DELETE 0` satırları (ya da "global eser yok" notu)
- Rollback imajı ve `bak` dosyası adları

## 10. Kalan riskler (kabul edildi)

| Risk | Durum |
| --- | --- |
| v137 **kod değişikliği yok**; 021/022 prod'da **ilk kez** koşuyor | İzole testte `021-022` 35/35, ama prod verisiyle ilk temas bu runbook. Ana risk bu |
| `akademik_catalog` parolası `.env.r2`'de plaintext | Docker env dosyası; `R2_SECRET_ACCESS_KEY` de orada. Bileşen düzeyinde ayrı sır yönetimi yok — bilinen sınır |
| §7.4 bugün anlamsız olabilir | Global eser 0 ise UPDATE edilecek satır yok; 023'ten sonra ölçülür |
| `/opds` hâlâ env tenant'ı | TODO §3 — bu sürümde **çözülmüyor** |

## 11. Çalıştırmadan önce: inceleme

Bu runbook **çalıştırılmadı**. Komutlar çalıştırılmadan önce **Claude'a inceletilecek**;
özellikle şu üç nokta:

1. **§5.1** — `read -rs` + iki `printf | docker exec -i psql` zinciri. Gerçekten tek
   satır mı, parola `ps`/`.bash_history`/container log'una düşmüyor mu?
2. **§3.1** — `collection_items` null `tenant_id` ölçümü. 022'deki backfill'in hangi
   satırları kapsadığı okunup doğrulanmalı.
3. **§7.4** — `set role akademik_app` sonrası politika gerçekten uygulanıyor mu;
   süper kullanıcıdan `set role` yapıldığında RLS'in devreye girdiği ölçülmeli.
   (Kontrol: aynı test `set role` **olmadan** `UPDATE n` dönmeli, `set role` **ile**
   `UPDATE 0`. İkisi de aynıysa test hiçbir şey kanıtlamıyor demektir.)

> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5`. İlgili: PR #40, `db/README.md`,
> `docs/DEPLOY.md` §"Migration'lar — imajdan ÖNCE".

