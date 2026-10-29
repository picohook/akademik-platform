# v137 deploy runbook — 021/022/024/025/026 migration'ları + `akademik_catalog` LOGIN

> **Durum: ÇALIŞTIRILMADI.** Bu dosya bir **plan**dır; hiçbir komut prod'da koşulmadı.
> Değerler `docs/DEPLOY.md` ve v136 kaydından türetildi, tahmin edilmedi. Gerçek çıktılar
> deploy sırasında **bu dosyaya** yazılır (WORKFLOW.md §Deploy kuralları).
>
> **Ön koşul:** komutları çalıştırmadan önce **Claude'a inceletin** (bkz. §11).
>
> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5`.
> ilgili: PR #40 (`feat/migrations-021-022`), PR #43 (`maintenance_tenants` çağrısı, merge `bee0fa5`),
> PR #44 (`024-maintenance-tenants.sql`, merge `5d4f342`), PR #49 (`026-tenant-binding-nullif.sql`,
> merge `0e180cb`), PR #48 (`withBridgeTenant`'ın `finally` düzeltmesi — varsayılan **değişmedi**),
> `db/migrations/021-*.sql`, `022-*.sql`, `024-*.sql`, `025-*.sql`, `026-*.sql`, `db/README.md`.

## 0. Bu sürümde ne değişiyor

| | |
| --- | --- |
| Kodsal değişiklik | **Var, ama yalnız `maintenanceTenantIds()`.** #43 (`bee0fa5`) v137 imajıyla **ilk kez** prod'a girer: süpürme döngüsü artık `app.maintenance_tenants()`'ı çağırır. Kullanıcıya görünen yollar (`/opds`, `/api/*`, indirme) v136 ile aynı. **`withBridgeTenant` varsayılanı değişmedi** — hâlâ `client.release(true)`, bkz. §4.7 ve §8 |
| Migration | **021** (kimlik/abonelik tabloları), **022** (global katalog sınırı), **024** (`app.maintenance_tenants()`), **025** (köprü için `app.libedge_tenant_by_ref()` + `app.libedge_upsert_tenant()`), **026** (her tenant politikasını `nullif(current_setting(...), '')::uuid` biçimine çevirir) — beşi de ilk kez prod'a girer. Prod şu an **001–020** |
| Veri taşıması | **Yok.** 021/022/024/025/026 tek bir eseri global kataloğa taşımaz; o **023** ve sözleşme §4.4 listesi onaylanana kadar yazılmaz |
| Yeni rol | `akademik_catalog` — 022'de **NOLOGIN** yaratılır. LOGIN + parola bu runbook'ta verilir |
| Yeni şema | `app` — 024 yaratır (bir fonksiyon + iki grant); 025 iki fonksiyon daha ekler. **026 hiçbir fonksiyon eklemez ve hiçbir tablo/rol yaratmaz** — yalnız politikaları yeniden yazar |
| Kırılma riski | `collection_items` üzerine RLS **enable + force**. Prod'da `collection_items` satırlarının `tenant_id`'si doğru olmalı, yoksa koleksiyon grant'leri görünmez olur (bkz. §3.1 ön kontrol). **026'nın down migration'ı yok**: geri dönüş yalnız §3'teki `pg_dump` ile (§8) |


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

**Beklenen:** `021`, `022`, `024`, `025` ve `026` **pending**; geri kalanı `applied`.
Son `applied` satırı **`020`** olmalı (`schema_migrations`'ın bugünkü son kaydı).

> **026 öncesi / sonrası ayrımı burada başlıyor:** §4.3'ten **önce** `--status`'ün en büyük
> `applied` numarası **`025`**; §4.3'ten **sonra** **`026`**. Ayrıca doğrudan
> `schema_migrations`'a da bakılır (§4.4b); `--status` dosya sistemini de okur, o yüzden tek
> başına yetmez — çalıştırılanı kayıt tutar.

> Prod 020'ye kadar runner ile ilerledi, yani `schema_migrations` dolu → **baseline
> GEREKMEZ**. `--status` "not baselined" derse **DUR ve sor**; körlemesine
> `--baseline` **çalıştırılmaz** (003 prod'a demo hesap geri ekler).
>
> **Ölçüm komutu:** `--status` her dosyayı tek satır yazar — `    pending  021-….sql`
> (durum **başta**, dosya adı sonda; 2026-10-29'da aynı formatta ölçüldü). `grep`
> yalnız bu beş satıra daralır ve **sayar**; sessizce boş çıktı ile "beklediğim beş
> satır" ayırt edilebilsin diye `grep -c` kullanılır, düz `grep` değil:

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status' | grep -cE '^[[:space:]]+pending[[:space:]]+02[12456]-'
```

**Beklenen:** `5`. `4` dönerse eksik dosya `026`'dır (en yeni migration; checkout onu
içermiyorsa `ls db/migrations/026*` boş döner) → **DUR**. `3` dönerse **025** eksiktir.
`0` ya da `1` dönerse **DUR**, `--status` çıktısının tamamı okunur; hata mesajını
beklemeden yorumlama.

### 4.2 Kuru çalıştırma

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --dry-run'
```

**Beklenen:** yalnız `021`, `022`, `024`, `025` ve `026` listelenir; başka dosya yok.

Sanılmasın diye: **025'in bu deploy'da olması zorunlu değil.** Köprü henüz
`server.mjs`'e bağlanmadı (§11), yani 025 uygulanmadan da imaj sorunsuz çalışır. Ama
025 uygulanmazsa köprünün tenant ve üyelik uçları çalışmaz — 025 bu yüzden aynı
pencerede uygulanır.

> **024 ayrı bir deploy'da uygulanacaksa** (alternatif plan): o zaman 024 o deploy'un
> runbook'una taşınır ve buradaki beklenen sayı **`4`** (`021/022/025/026`) olur. Seçim §11'de.

### 4.3 Uygula

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs'
```

### 4.4 Durum — sonra

```bash
cd /var/www/akademik-platform && sudo docker run --rm --network akademik-platform-prod_default -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app -e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

**Beklenen:** `pending = 0`. Değilse **DUR**.

### 4.4b `schema_migrations` — son kayıt 025'ten 026'ya geçti mi

`--status` **dosya sistemini** de okur: yeni bir `.sql` geldiğinde onu `pending` gösterir.
Kaydın gerçekten yazıldığını gösteren yer `schema_migrations`'tır. Tablo
`db/migrate.mjs` §`REGISTRY_DDL`'de tanımlı: `filename` (PK), `checksum`, `applied_at`,
`duration_ms` — **`version` kolonu yok**, sürüm `filename`'in başındadır.

Ölçüm §4.3'ten **önce** ve **sonra** yapılır — iki farklı sonuç **beklenir**:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*), max(filename) from schema_migrations"
```

| Ne zaman | Beklenen |
| --- | --- |
| §4.3'ten **önce** | son kayıt **`025-…sql`** (`max(filename)`), `026` **yok**; satır sayısı `N` |
| §4.3'ten **sonra** | son kayıt **`026-tenant-binding-nullif.sql`**; satır sayısı **`N+5`** (021, 022, 024, 025, 026) |

`max(filename)` metin sıralamasıdır ve `020` < `021` < `022` < `024` < `025` < `026`
olduğu için bu beş dosyada sıralama sürüm sırasıyla aynıdır — `max` gerçekten en son
uygulananı verir. `026` satırı görünmüyorsa migration **uygulanmamış** demektir: §4.6a
koşulmaz, **DUR**.

> **Yarım 026 beklenmez.** `db/migrate.mjs` her dosyayı tek transaction'da çalıştırır ve
> kaydı **aynı** transaction'da yazar (`insert … ; commit`). 026'nın kendi doğrulaması
> düşerse dosya `0A000` (`feature_not_supported`) ile geri alınır, kayıt **hiç yazılmaz**.
> Yani `026` satırı varsa dosyanın *tamamı* koştu; yoksa *hiçbiri*. Bunun dışında bir
> durum görülürse (kayıt var ama §4.6a düşüyor) bu bir arıza işaretidir — §8.

### 4.5 RLS gerçekten açıldı mı (ölçüm)

022'nin asıl iddiası `collection_items`'te RLS'in **etkin** olması. Migration'ın
başarılı görünmesi yetmez, `pg_class` okunur:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'collection_items'"
```

**Beklenen:** `collection_items|t|t`. `f` dönerse **DUR** — 022 uygulanmamış ya da
üzerine yazılmış demektir, imaja geçilmez.

### 4.6 `app.maintenance_tenants()` — app rolüyle ölçüm (024'ün asıl kanıtı)

024'ün iddiası tek bir cümle: **app rolü, hiçbir tenant bağlı değilken tüm tenant'ları
görür**. Migration'ın "başarılı" görünmesi bunu kanıtlamaz — SECURITY DEFINER'ı
çıkarılmış bir sürüm de tabloyu yaratır ve sessizce **tek** satır döndürür. Bu yüzden
ölçüm app rolünün kendisiyle yapılır (§7.4 ile aynı gerekçe: süper kullanıcı testi
kendini kandırır — o `FORCE RLS`'i zaten atlar).

Önce kıyas: düz sorgu app rolünde **kaç satır** görüyor. Bu sayı **fonksiyonun
döndürdüğünden küçük** olmalı; eşitse fonksiyon bir şey yapmıyor demektir.

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; select count(*) as plain_visible from tenants"
```

**Beklenen:** `0` (bir tenant bağlı değilken politika `id = ''::uuid` üzerinden hiçbir
satır göstermez) ya da `1` (havuzda bağlı bir bağlantı kaldıysa). **`0` doğru kıyas**;
`1` görürsen sorun değil, ama o zaman aşağıdaki sayı **1'den büyük** olmak zorunda.

Şimdi fonksiyon — app rolüyle, bağlı tenant **yokken**:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; select tenant_id from app.maintenance_tenants() order by tenant_id"
```

**Beklenen:** prod'daki **tüm** tenant id'leri, biri `5799f2a5-3d90-41b1-90de-9da07d776052`.
Kıyasla karşılaştırma:

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| Fonksiyon `>=` düz sorgu, ve `5799f2a5` içinde | Fonksiyon çalışıyor; hediyesi prod tenant'ı | **Devam** |
| Fonksiyon çıktısı ile düz sorgu **aynı** ve **1** satır | SECURITY DEFINER ya da grant etkisiz — 024 sessizce daralmış | **DUR** |
| Boş küme | `tenants` boş **ya da** grant yok; ayırt etmek için §4.6c | **DUR** |
| `permission denied for function` | grant yok / yanlış role | **DUR** |
| `schema "app" does not exist` (`3F000`) | 024 uygulanmamış, `app` şeması da yok | **DUR** |
| `function app.maintenance_tenants() does not exist` (`42883`) | `app` şeması var ama fonksiyon yok — 024 yarım kalmış | **DUR** |

> İki ayrı hata kodu, iki ayrı anlam. 2026-10-29'da ölçüldü: şema yokken Postgres
> **`3F000`** veriyor (şemayı fonksiyondan önce çözer); şema **var**, fonksiyon yokken
> **`42883`**. Prod'daki bugünkü durum birincisi. `server.mjs` dördünü de yakalar
> (`3F000`, `42P01`, `42883`, `42501`) — bu **ölçüm öncesi bir düzeltmeydi**, yani
> prod'da hiçbir tick throw etmedi: 024 uygulanmadan yeni kod prod'a çıkmadı, ve
> süpürme o zaman eski tek-tenant yolundan gidiyordu. `3F000` yalnız süit ölçümünde
> görüldü. `server.mjs` yalnız `42883`/`42501` yakalasaydı, 024 uygulandıktan sonra
> başka bir arıza süpürmeyi sessizce stack'e düşürürdü.

Aynı soruyu **owner** ile tekrarlamak, farkın rol kaynaklı olduğunu doğrular (`tenants`
FORCE'd olduğu için owner de politika altındadır; fonksiyon `set local
row_security = off` ile çalışır, app **çalışamaz**):

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select tenant_id from app.maintenance_tenants() order by tenant_id"
```

**Beklenen:** app rolünün gördüğü **aynı liste** — bu, iki rolün de aynı doğru cevabı
aldığını gösterir.

#### 4.6c Boş küme çıkarsa — sebebi ayır

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*) from tenants"
```

Bu sorgu **süper kullanıcıyla** koşar, yani politikayı atlar ve doğru toplamı verir:

| `count(*)` | Anlamı | Karar |
| --- | --- | --- |
| `0` | Gerçekten tenant yok — fonksiyon doğru cevabı veriyor, boş küme **masum** | Devam — ama `5799f2a5` bekleniyorsa §2 ile karşılaştır |
| `>= 1` | Tenant var, fonksiyon **görmüyor** → definer/grant etkisiz | **DUR** |

> 2026-10-29'da boş bir fixture'da ölçüldü: `tenants` 0 satırken fonksiyon **boş küme**
> döndü ve bu **doğruydu**; aynı DB'ye 2 tenant eklendiğinde app rolü de owner da iki
> satırı gördü. Yani "boş küme" tek başına arıza kanıtı değil — ayırt edici olan,
> `tenants` **dolu iken** fonksiyonun boş dönmesi.

#### 4.6d 025'in çalıştığını gör — köprü henüz bağlı değilken

025 uygulandığında `app` şemasında iki fonksiyon daha olur ve **ikisi de aynı
`tenants_self` duvarını** aşar. Köprü `server.mjs`'e bağlanmadan uçları çağıramazsın,
ama fonksiyonları doğrudan çağırabilirsin — §4.6'nın aynı gerekçesiyle **app rolüyle**:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; select has_function_privilege('akademik_app', 'app.libedge_tenant_by_ref(text, text)', 'execute') as by_ref, has_function_privilege('akademik_app', 'app.libedge_upsert_tenant(text, text, text, text, text)', 'execute') as upsert"
```

**Beklenen:** `t|t`. `f` dönerse 025 uygulanmamış ya da grant düşmüş → **DUR**.

Şimdi çözümleyici — prod'daki gerçek tenant'ın `(kind, ref)`'iyle:

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; select tenant_id, status from app.libedge_tenant_by_ref('institution', '5799f2a5-3d90-41b1-90de-9da07d776052')"
```

**Beklenen:** tam **bir** satır ve `id` `5799f2a5-…`. **Boş küme de bir cevaptır** —
tenant bu `(kind, ref)` ile kayıtlı değilse doğru cevap budur; ayırt etmek için
`select id, libedge_kind, libedge_ref from tenants where id = '5799f2a5-…'` ile
karşılaştır (owner, politikayı atlar). `libedge_kind`/`libedge_ref` NULL ise prod tenant'ı
henüz köprüye bağlanmamış demektir ve bu **normaldir** — köprü bağlanana kadar herhangi
bir tenant'ın bu iki sütunu yazılmaz.

> **Dokunma:** bu adımda `libedge_upsert_tenant()`'ı prod tenant'ının gerçek
> `(kind, ref)`'iyle çağırma. Update yolu slug'ı **dondurur** ama `name`/`status`
> yazar; yanlış bir `status` prod tenant'ını etkiler. Create yolu ise gerçek bir satır
> yaratır. 025'in yazma yolu süitte ölçülür (62 kontrol, `postgres:16-alpine`), prod'da
> yalnız **grant ve okuma** ölçülür.

### 4.6a 026'nın iki kanıtı — sayım ve bağsız okuma

026'nın iddiası: **bağlı bir bağlantı çözülebilir.** Bunun iki ayrı ölçümü var ve
**ikisi de** geçmek zorunda; biri "politikalar çevrildi"yi, diğeri "gerçekten çalışıyor"u
gösterir. İkisi de §4.3'ten **sonra** koşulur.

**1) Kaç politika korumaya alındı — tam `25` olmalı.**

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%nullif(current_setting(%app.tenant_id%'"
```

**Beklenen: `25`.**

Bu, 026'nın kendi içinde de koştuğu doğrulamayla aynı sayı (`026-tenant-binding-nullif.sql`
sonundaki `remaining < 20` kontrolü). Fark şu: migration'ın kendi kontrolü **alt sınırı**
(`>= 20`) korur, buradaki ölçüm **tam sayıyı** bekler — biri 24'e düşerse migration geçer
ama bu adım düşer.

Sayının nereden geldiği: `pg_policies`'te `public` şemasında 50 politika var, 25'i
`nullif(...)` biçimine çevrildi, 25'i **bayt bayt aynı** kaldı (021'in
`bridge_idempotency` politikası bilinçli olarak `coalesce(...)` biçiminde bırakıldı —
`''` ve NULL'ı aynı sayar, `nullif`'e çevirmek onu gevşetirdi). `public` dışında politika
**yok**, dolayısıyla başka şemada korumasız kalan politika da yok.

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| `25` | 026 tam uygulandı | **Devam** |
| `24` | Bir politika çevrilmemiş (ya da sonradan eklenmiş ve çevrilmemiş) | **DUR** — §8 |
| `> 25` | İki kez `nullif` yuvalanmış ya da fazladan politika var | **DUR** — §8 |
| `0` | 026 hiç koşmamış | **DUR** |

**2) Bağsız okuma `22P02` vermemeli — `akademik_app` ile, `0` satır.**

Bu, 026'nın *asıl* kanıtı: politikalar metin olarak doğru görünse bile bağsız bir oturum
hata vermeden çalışmalı. §7.4 ile aynı gerekçeyle **app rolüyle** ölçülür (süper kullanıcı
politikayı atlar; test kendini kandırır).

```bash
cd /var/www/akademik-platform && sudo docker exec akademik-platform-prod-db-1 psql -U akademik -d akademik -Atc "set role akademik_app; set app.tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'; reset app.tenant_id; select count(*) from works"
```

**Beklenen:** `0` — **ve hata yok.**

```
0
```

`set` + `reset` çifti kasıtlı: 026'nın çözdüğü durum tam olarak bu. `reset` GUC'u
`''`'a bırakır (unset etmez); **026 olmadan** bir sonraki `select` `22P02` verir.
**026 ile** `nullif(..., '')` → NULL, `is null` doğru olur ve sorgu `0` döner.

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| `0`, hata yok | 026 çalışıyor | **Devam** |
| `ERROR: invalid input syntax for type uuid: ""` (`22P02`) | 026 uygulanmadı ya da `works` politikası çevrilmedi | **DUR** — §8 |
| `ERROR: permission denied` / `must be member of role` | `akademik_app` rolü yok / `set role` yetkisi yok | **DUR**, rolü §5 ile karşılaştır |
| `1` | Bağsız okuma bir tenant'ın satırlarını görüyor — **sızıntı** | **DUR** — §8 |

> **`0` neden doğru cevap:** `works` politikası `tenant_id is null or tenant_id = ...`
> biçiminde; bağsız oturumda `nullif(...)::uuid` NULL olur, `tenant_id = NULL` hiçbir
> satırı tutmaz, `tenant_id is null` ise yalnız **global** eserleri tutar. 022 tek bir
> eseri global kataloğa taşımadığı için (§7.4'te de `0` bekleniyor) bugün hiç global eser
> yok → `0`. Yani `0`, "global eser yok" demektir; **`0` dönmesi `22P02` dönmemesinden
> daha az şey kanıtlar** — iddia edilen şey hatanın **yokluğu**dur.
>
> **Negatif kontrol (süitte yapıldı, prod'da yapılmaz):** `db/026.test.mjs` aynı sorguyu
> 026 uygulanmadan önce koşuyor ve **`22P02`** alıyor; `db/026-release-flag.test.mjs` ise
> `withBridgeTenant` altında bayrak açıkken 026 yoksa `resetFailed=1, destroyed=1`, 026
> varsa `reset=1, destroyed=0` ölçüyor. Yani buradaki `0`, gerçekten bir davranış
> değişikliğini gösteriyor.

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
| **Env** | `.env.r2.bak-v137` ve `.env.r2.bak-v136`. **`LIBEDGE_BRIDGE_MEASURE_RESET` prod'da tanımlanmaz** (aşağıya bak) |
| **Migration 021/022** | **Geri alınmaz** (aşağıya bak) |
| **Migration 026** | **Down migration'ı yok.** Tek yol §3'teki `pg_dump` (aşağıya bak) |

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

### 8.1 026'dan sonra bir sorun çıkarsa — tek dönüş yolu yedek

026 **veri taşımaz**, yalnız politika metnini değiştirir. Bu yüzden geri dönüşün
**en olası** biçimi yedek değil, imajın geri alınmasıdır (§8 tablosu): v136 ve v137
imajlarının ikisi de 026'lı politikaların altında çalışır — `nullif` biçimi bağlı
oturumlarda `current_setting(...)::uuid` ile **aynı** karşılaştırmadır, yani davranış
değişmez. İmajı geri almak 026'yı **geri almaz**, almaya da gerek yoktur.

**Ama topluca politika kaybı gibi bir arıza görülürse** (ör. §4.6a `0` döndürüyor,
uygulamada her sorgu `42501` veriyor, ya da `pg_policies` beklenmedik biçimde azalmış):

> **026'nın down migration'ı yok. Geri dönüş, §3'te alınan `pg_dump`'tan tam geri
> yüklemedir. Başka bir yol yok.**

Gerekçesi: her politikayı eski `current_setting(...)::uuid` biçimine döndürmek 22P02'yi
**geri getirir** — yani "düzeltmeyi geri al" işlemi, çözdüğü hatayı yeniden üretir.
Yarım geri alma (birkaç politikayı geri çevirmek) iki biçimin karıştığı bir katalog
bırakır ve §4.6a'nın sayımı artık hiçbir şey kanıtlamaz. Bu yüzden geri alma **ya
tamamen yedekten**, ya hiç.

Prosedür:

```bash
cd /var/www/akademik-platform && ls -l ~/backup-pre-v137-*.dump
```

**Tek dosya, MB mertebesinde.** §3'te alınmış olan dosyanın adını §9'a yaz.
Sonra (onay alındıktan sonra, tek satır):

```bash
cd /var/www/akademik-platform && sudo docker exec -i akademik-platform-prod-db-1 pg_restore -U akademik -d akademik --clean --if-exists --no-owner -v < ~/backup-pre-v137-<TARİH>.dump
```

> **Yedekten dönüş 026'yı *ve* §4.3'te uygulanan 021/022/024/025'i birlikte geri alır** —
> yedek v136'nın şemasını (001–020) taşır. Yani bu adımdan sonra prod **v136 şemasına**
> döner ve v137 imajı çalışmaya devam ederse `app` şeması/fonksiyonlar yok olur
> (`3F000`/`42883` — bunlar yakalanıyor, süpürme env tenant'a düşer ama köprü uçları
> çalışmaz). Bu yüzden yedekten dönüş, **imajın da v136'ya alınmasıyla birlikte** yapılır.
>
> Restore **`--clean --if-exists`** kullanır: mevcut nesneleri düşürüp yedekten yeniden
> yaratır. Prod'da geri alınacak başka bir yazma (yeni kitap, yeni kullanıcı) varsa
> **kaybolur**. Karar verilmeden önce §9'daki zaman damgasıyla karşılaştır.

### 8.2 `LIBEDGE_BRIDGE_MEASURE_RESET` prod'da **tanımlanmaz**

`withBridgeTenant`'ın varsayılanı hâlâ **`client.release(true)`** — yani her
tenant-scoped işlemden sonra bağlantı yok edilir. Reset kolunu (`reset` + `release()`)
ölçen yol yalnız `LIBEDGE_BRIDGE_MEASURE_RESET=1` ile açılır ve **yalnız testte**
kullanılır (`db/026-release-flag.test.mjs`).

- Prod'da bu değişkeni **tanımlama**. Tanımlanırsa kod 026'lı reset kolunu seçer;
  ertesi gün 026 geri alınmış bir veritabanında (yedekten dönüş, §8.1) bu kol
  22P02 verir ve **her tenant-scoped istek kırılır**.
- Varsayılanı çevirmek ayrı bir iş: `docs/TODO.md` §3. Sıra **önce 026 prod'da ve
  doğrulanmış olmalı**, sonra varsayılan çevrilir, sonra bu env dalı koddan çıkarılır.
- `.env.r2` içine bu satırı **elle de ekleme** — ölçüm kolu prod'a `git pull` ile değil,
  ortam değişkeniyle sızar; tek koruma bu nottur.

## 9. Deploy kaydı

`docs/deployments/2026-10-??-v137.md` yalnız **gerçek çıktılarla** doldurulur:

- `/api/config` ve `/api/health` gövdeleri (birebir)
- `curl / | grep -o '/app.js?v=...'` çıktısı
- `R2 PASS` satırı
- `docker ps` satırları
- `--status` çıktısı (§4.1 ve §4.4)
- §4.4b'nin **iki** satırı: §4.3 öncesi ve sonrası `select count(*), max(filename) from schema_migrations`
  (beklenen: önce `…|025-…sql`, sonra `…|026-tenant-binding-nullif.sql`)
- §4.6'nın üç satırı: `plain_visible` sayısı, app rolünün gördüğü id listesi, owner'ın gördüğü liste
- §4.6a'nın **iki** satırı: politika sayımı (**`25`**) ve bağsız okuma (**`0`**, hata yok)
- §7.4'ün `UPDATE 0` / `DELETE 0` satırları (ya da "global eser yok" notu)
- §7.1'in `/api/config` sürümü; `LIBEDGE_BRIDGE_MEASURE_RESET`'in **tanımlı olmadığının** teyidi

- Rollback imajı (`libedge-v136` + `96cc270`) ve `bak` dosyası adları
- **§3 yedeğinin tam yolu ve zaman damgası** — 026'nın tek geri dönüş yolu bu (§8.1)

## 10. Kalan riskler (kabul edildi)

| Risk | Durum |
| --- | --- |
| v137 **yalnız `maintenanceTenantIds()`** değiştiriyor (#43); 021/022/024 **ve 025** prod'da **ilk kez** koşuyor | İzole testte `021-022` 35/35, `024` 17/17, 025 62/62, ama prod verisiyle ilk temas bu runbook. Ana risk bu |
| 025 `tenants`'a iki `SECURITY DEFINER` fonksiyonla yazma yetkisi veriyor | Dar tutuldu: yalnız `institution` kind, `id`/`slug` mevcut kayıtta dondurulmuş, EXECUTE yalnız `akademik_app`. Yine de `tenants_self`'in yanında ikinci bir yol; review'de ayrıca bakılmalı (§11.5) |
| `akademik_catalog` parolası `.env.r2`'de plaintext | Docker env dosyası; `R2_SECRET_ACCESS_KEY` de orada. Bileşen düzeyinde ayrı sır yönetimi yok — bilinen sınır |
| §7.4 bugün anlamsız olabilir | Global eser 0 ise UPDATE edilecek satır yok; 023'ten sonra ölçülür |
| `/opds` hâlâ env tenant'ı | TODO §3 — bu sürümde **çözülmüyor** |
| 024 uygulanırsa ama imaj eski kalırsa | Zararsız: v136 kodu fonksiyonu hiç çağırmıyor. Ters yön (imaj yeni, 024 yok) de **kırılmıyor**: `3F000`/`42883` yakalanıp env tenant'a düşülür, her tick'te bir uyarı loglanır. Yine de §4 imajdan önce koşuyor |
| **026 geri alınamaz** (down migration yok) | Yalnız §3'teki `pg_dump` ile dönülür — ve o dönüş 021/022/024/025'i de geri alır, yani imajın da v136'ya çekilmesi gerekir (§8.1). 026 politika metnini ~305 ms boyunca kilitler, veri taşımaz |
| 026 tek transaction'da 50 tablonun politikasını yeniden yazıyor | Migration ~305 ms sürdü (izole ölçüm). Bu süre boyunca `pg_policies` üzerinde kilit var; Migration imajdan **önce** koştuğu için (§1.5) o an yeni trafik yok. Süre uzarsa §4.3 `lock timeout` verebilir → **DUR**, aynı komut yeniden koşulur (026 idempotent değil: ikinci kez `0A000` verir, ama ilk koşu rollback olduysa kayıt da yoktur, yani yeniden koşmak **ilk** koşudur) |
| §4.6a'nın `25` sayısı | 025 sonradan bir politika ekler ya da 023 gelirse sayı değişir. O zaman **bu runbook'un beklenen sayısı** güncellenir; sayıyı "yakın bir değere" gevşetmek ölçümü anlamsızlaştırır |
| `LIBEDGE_BRIDGE_MEASURE_RESET` yanlışlıkla tanımlanırsa | Prod'da reset kolu seçilir ve 026 yoksa her tenant-scoped istek 22P02 verir (§8.2). Bugün 026 var, yani kırılmaz — ama 026 geri alınırsa kırılır. Tanımlanmaz |

## 11. Çalıştırmadan önce: inceleme

Bu runbook **çalıştırılmadı**. Komutlar çalıştırılmadan önce **Claude'a inceletilecek**;
özellikle şu dört nokta:

1. **§5.1** — `read -rs` + iki `printf | docker exec -i psql` zinciri. Gerçekten tek
   satır mı, parola `ps`/`.bash_history`/container log'una düşmüyor mu?
2. **§3.1** — `collection_items` null `tenant_id` ölçümü. 022'deki backfill'in hangi
   satırları kapsadığı okunup doğrulanmalı.
3. **§7.4** — `set role akademik_app` sonrası politika gerçekten uygulanıyor mu;
   süper kullanıcıdan `set role` yapıldığında RLS'in devreye girdiği ölçülmeli.
   (Kontrol: aynı test `set role` **olmadan** `UPDATE n` dönmeli, `set role` **ile**
   `UPDATE 0`. İkisi de aynıysa test hiçbir şey kanıtlamıyor demektir.)
4. **§4.6** — 024'ün kanıtı. Kıyas sorgusu (`set role akademik_app; select count(*) from
   tenants`) **0** dönerken fonksiyon **tüm** tenant'ları döndürmeli; ikisi eşitse
   SECURITY DEFINER etkisiz. Bu, §7.4 ile aynı "süper kullanıcı kendini kandırır"
   gerekçesiyle app rolüyle ölçülüyor. Ayrıca `--status` sayacının **4** dönmesi
   beklenir; `3` dönerse checkout 025'i içermiyor demektir.
5. **§4.6d** — 025'in grant'ı ve okuma yolu. `has_function_privilege` app rolünde
   `t|t` dönmeli; çözümleyici prod tenant'ı için **bir** satır vermeli. Bu adım
   kasıtlı olarak **yazmıyor** — `libedge_upsert_tenant()` prod tenant'ının gerçek
   `(kind, ref)`'iyle çağrılırsa `name`/`status`'u yazar.
6. **§4.6a** — 026'nın kanıtı. İki kontrol de **birlikte** geçmeli: sayım `25` ve
   bağsız okuma `0`/hata yok. Sayım tek başına yetmez (politika metni doğru olup
   davranış bozuk olabilir); bağsız okuma tek başına da yetmez (`0`, "global eser yok"
   demektir, hatanın yokluğunu ancak negatif kontrol kanıtlar — `db/026.test.mjs`).
7. **§8.1** — 026 için **tek** dönüş yolu yedek. `pg_restore --clean --if-exists`
   komutunun prod'da neyi düşüreceği (021–026 dahil) ve yedeğin **imaj geri alma ile
   birlikte** yapılması gerektiği okunmalı.

> **Köprü bu sürümde bağlanmadı.** 025 yalnız `app` şemasına iki fonksiyon ekler;
> `server.mjs`'te route, token kontrolü ve `BRIDGE_NOT_CONFIGURED` **yok**. Yani 025
> uygulanıp uygulanmaması v137 imajının davranışını değiştirmez. Bir sonraki PR'ın konusu.

> **Not (2026-10-30):** §4.6a ve §4.4b bu tarihte eklendi, 026 (#49) `main`'e girdikten
> sonra. Sayılar (`25`, `0`, `50`) izole bir `postgres:16-alpine` üzerinde şema + tüm
> migration'lar uygulanarak ölçüldü: `select schemaname, count(*) from pg_policies group by 1`
> → **`public: 50`**, başka şema **yok**. 026'nın kendi süiti (`db/026.test.mjs`, 18 kontrol)
> ve kanıt dosyası (`db/026-before-after.mjs`, 101 kontrol) 25 politikanın yeniden yazıldığını,
> 25'inin bayt bayt aynı kaldığını doğruluyor. §4.6a'nın bağsız okuması
> `db/026-release-flag.test.mjs`'in ölçtüğü kolun aynısı: 026 yokken `22P02`, 026 varken
> temiz.

> **Not (2026-10-29):** §4.6 ve §4.1'in beklenen çıktıları boş bir postgres'te
> (001–022 → 024) gerçekten koşularak ölçüldü, tahmin edilmedi. Ölçülen kodlar:
> şema yokken `3F000`, şema var/fonksiyon yokken `42883`. 025'in yazma yolu ayrı
> bir süitte ölçüldü: 62 kontrol, `schema.sql` + 021/022/024/025, `postgres:16-alpine`;
> prod'da yalnız grant ve okuma ölçülür.


> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5`. İlgili: PR #40, `db/README.md`,
> `docs/DEPLOY.md` §"Migration'lar — imajdan ÖNCE".