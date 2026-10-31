# v137 deploy runbook — 021/022/024/025/026/**027** migration'ları + `akademik_catalog` LOGIN

> **Durum: ÇALIŞTIRILMADI.** Bu dosya bir **plan**dır; hiçbir komut prod'da koşulmadı.
> Değerler `docs/DEPLOY.md` ve v136 kaydından türetildi, tahmin edilmedi. Gerçek çıktılar
> deploy sırasında **bu dosyaya** yazılır (WORKFLOW.md §Deploy kuralları).
>
> **Ön koşul:** komutları çalıştırmadan önce **Claude'a inceletin** (bkz. §11).
>
> **Ön koşul 2 (2026-10-30'da eklendi):** §4.1/§4.2'deki beklenen sayı **6**'dır ve
> bu sayı yalnız **`db/migrate.mjs` düzeltmesi** (#54) checkout'ta varsa çıkar. Düzeltme
> olmadan runner **025 ve 027'yi reddeder** ve deploy sessizce onları atlar; ayrıntı ve
> kanıt §4.2b'de. Önce §4.0 kontrol edilir.
>
> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5` / `e4b12f4`.
> ilgili: PR #40 (`feat/migrations-021-022`), PR #43 (`maintenance_tenants` çağrısı, merge `bee0fa5`),
> PR #44 (`024-maintenance-tenants.sql`, merge `5d4f342`), PR #49 (`026-tenant-binding-nullif.sql`,
> merge `0e180cb`), PR #48 (`withBridgeTenant`'ın `finally` düzeltmesi — varsayılan **değişmedi**),
> PR #50 (`027-reader-sso.sql` + okuyucu SSO), PR #51 (indirme yetkisi), PR #53 (abonelik
> senkron sırası), PR #54 (`db/migrate.mjs` dollar-quote düzeltmesi).
> `db/migrations/021-*.sql`, `022-*.sql`, `024-*.sql`, `025-*.sql`, `026-*.sql`, `027-*.sql`, `db/README.md`.

## 0. Bu sürümde ne değişiyor

| | |
| --- | --- |
| Kodsal değişiklik | **Var, ve yalnız `maintenanceTenantIds()` değil.** Üç kod değişikliği v137 imajıyla **ilk kez** prod'a girer: (1) #43 (`bee0fa5`) süpürme döngüsü artık `app.maintenance_tenants()`'ı çağırır; (2) **köprü bağlı** — `server.mjs` içinde `const BRIDGE_PREFIX = '/api/libedge/v1'` ve `isBridgePath()` isteği `handleBridgeRoute()`'a yönlendirir, tenant'ı `libedge-bridge-db.mjs` tek transaction içinde bağlar (bugün prod'a `BRIDGE_NOT_CONFIGURED` döner, bkz. §4.6d ve §6.1); (3) #50 okuyucu SSO yolu — `LIBEDGE_SSO_PUBLIC_KEYS` **tanımlıysa** `libedge_sessions`'a yazar (§7.6). **(2) ve (3) çalışma zamanında env ile kapalıdır**, yani 025/027 uygulanmadan da imaj açılışta kırılmaz; ama uçları o an **çalışmaz**. Görünen yollar (`/opds`, mevcut `/api/*`, indirme) v136 ile aynı davranır. **`withBridgeTenant` varsayılanı değişmedi** — hâlâ `client.release(true)`, bkz. §8.2 |
| Migration | **021** (kimlik/abonelik tabloları), **022** (global katalog sınırı), **024** (`app.maintenance_tenants()`), **025** (köprü için `app.libedge_tenant_by_ref()` + `app.libedge_upsert_tenant()`), **026** (her tenant politikasını `nullif(current_setting(...), '')::uuid` biçimine çevirir), **027** (okuyucu SSO: `libedge_sessions`, `sso_auth_events`, `app.sso_auth_events_purge()`) — **altısı da** ilk kez prod'a girer. Prod şu an **001–020** |
| Veri taşıması | **Yok.** 021/022/024/025/026/027 tek bir eseri global kataloğa taşımaz; o **023** ve sözleşme §4.4 listesi onaylanana kadar yazılmaz |
| Yeni rol | `akademik_catalog` — 022'de **NOLOGIN** yaratılır. LOGIN + parola bu runbook'ta verilir |
| Yeni şema | `app` — 024 yaratır (bir fonksiyon + iki grant); 025 iki fonksiyon daha ekler, 027 bir tane daha. **026 hiçbir fonksiyon eklemez ve hiçbir tablo/rol yaratmaz** — yalnız politikaları yeniden yazar |
| Yeni tablo | **027**: `libedge_sessions` (FORCE RLS, tek tenant politikası) ve `sso_auth_events` (audit, app rolü için append-only). İkisi de boş başlar |
| Kırılma riski | `collection_items` üzerine RLS **enable + force**. Prod'da `collection_items` satırlarının `tenant_id`'si doğru olmalı, yoksa koleksiyon grant'leri görünmez olur (bkz. §3.1 ön kontrol). **026'nın down migration'ı yok**: geri dönüş yalnız §3'teki `pg_dump` ile (§8) |
| **Runner düzeltmesi** | v137 öncesi `db/migrate.mjs`, **025 ve 027'yi "manages its own transaction (end;)" diyerek reddediyordu** — dosyaların kendi transaction'ı yok; reddedilen şey bir plpgsql gövdesinin `end;`'i. Ret sessizdir: `--dry-run` ve gerçek koşu ikisi de dosyayı **atlar**, hata vermez. Düzeltme PR #54; aynı PR'ın review'ında maskelemenin **ikinci** hatası da bulundu (iki gövde arasındaki gerçek `commit;` yetkilendiriliyordu) ve kapatıldı. §4.0 ve §4.2b |
| **Deploy düzeni** | Kod **canlı dizine girmez**: canlı dizin (`/home/ubuntu/libedge-oracle-v136`) Git checkout değildir, runner da orayı okumaz. v137 **release dizinine** klonlanır (§2.1), imaj etiketi bir kez üretilir ve build/run **aynı** etiketi kullanır (§6.0). Sırlar iki **korumalı** dosyaya ayrılır: `config/admin.env` (yalnız `DATABASE_ADMIN_URL`, **yalnız runner'a**; §5.3) ve `config/web-catalog.env` (yalnız `DATABASE_CATALOG_URL`, **web'e**; §5.4). Web'e **admin bağlantısı verilmez**. Parolalar URL'ye **percent-encode** edilir (§5.3a) |



## 1. Kurallar (bu runbook boyunca)

1. **Her komut tek satır.** Çok satırlı yapıştırma SSH'ta kilitleniyor; `\` ile bölünmüş komut yazılmaz. Runbook komutları **bash**'te koşar (Ubuntu varsayılan kabuğu); `<(…)` süreç değiştirme burada geçerlidir. `sh`/`dash`/`busybox sh` **varsayılmaz**: ölçüldü, `busybox sh` `<(…)`'i kabul ediyor ama `<<<` here-string'ini **`syntax error` ile reddediyor**, bu yüzden hiçbir komut `<<<` kullanmaz.
2. `sudo` ortamı temizler: değişken **komutun başına** yazılmaz; sırlar host kabuğunda **hiç** tanımlanmaz. Üç env dosyası vardır ve her biri **yalnız `--env-file` ile** kullanılır: `config/web-runtime.env` (web runtime), `config/web-catalog.env` (yalnız `DATABASE_CATALOG_URL` → **web'e verilir**, §5.4) ve `config/admin.env` (yalnız `DATABASE_ADMIN_URL` → **yalnız migration runner'a verilir, web'e verilmez**, §5.3). **Hiçbiri kabukta `source` edilmez** (`set -a; . …` dahil) ve hiçbir sır `-e VAR="${...}"` ile **host kabuğundan enterpole edilmez**: parola host'ta tanımlı olmadığı için böyle bir yazım sessizce **boş** değer üretir — yerel Docker'da ölçüldü, `postgres://akademik:@db:5432/akademik` (§10.3).
3. Parola **komut satırına yazılmaz** → `ps`/`history`'ye düşer. Yalnız `read -rs` ile okunur ve doğrudan `psql`'in stdin'ine verilir.
4. **db container'ı durdurulmaz/yeniden yaratılmaz** (web sonra `EAI_AGAIN db` alır). Bu sunucuda Compose **yok**; `docker compose …` komutu burada **hiç çalışmaz**.
5. Sıra: **yedek → migration → imaj**. Migration'lar imajdan **önce** (yeni imaj fail-closed: grant yoksa katalog boş görünür).
6. Bir adım beklenen çıktıyı vermezse **DUR**; sonraki adıma geçilmez.
7. **İsimler §4.0'a göre ölçülür.** Sunucu `92.5.157.233`, canlı dizin `/home/ubuntu/libedge-oracle-v136`; başka bir host/dizin/isim varsayılmaz.
8. **Canlı dizin Git checkout değildir**: orada `git fetch/checkout/pull` çalıştırılmaz. Kaynak kod §2.1'deki **release dizininden** gelir.
9. **Port ve domain sabit yazılmaz**: §4.0a'da `docker inspect` / `curl` ile ölçülür; sonraki adımlar yalnız o değişkenleri kullanır.

## 2. Ön kontrol — değişiklik yapmadan

Doğru sunucuda ve doğru dizinde olduğunu **ölç** (çıktı §9'a yazılır):

```bash
cd /home/ubuntu/libedge-oracle-v136 && pwd && hostname && ls -d .git 2>/dev/null || echo 'Git checkout DEGIL (beklenen)'
```

**Beklenen:** `/home/ubuntu/libedge-oracle-v136` ve `Git checkout DEGIL`. Bu dizin **canlı
dizindir**: içinde sürüm izi (Git geçmişi) tutulmaz, dosyaları elle değiştirilmez; yalnız
çalışan stack'in ve `config/web-runtime.env`'in yanında durur. v137 kodu **ayrı bir release
dizinine** çıkarılır (§3.2). `cd` hata verirse **DUR** — o dizin bu sunucuda yok demektir, §4.0.

**Bu dizinde `git` komutu çalıştırılmaz** (`git fetch` / `git checkout` / `git pull` yok):
canlı dizin bir çalışma kopyası değildir, orada `checkout` yapmak çalışan servisin dosyalarını
habersiz değiştirir.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

Beklenen: `libedge-oracle-v136-web` → `libedge-oracle-v136:96cc270-arm64` `(healthy)`,
`libedge-oracle-v136-db` → `(healthy)`, `libedge-oracle-live-tunnel` → `Up`. Ayrıntılı
doğrulama §4.0a'da; buradaki satır yalnız "stack ayakta" kontrolüdür.

Canlı domain **ölçülür** (kodda sabit yok; §4.0a `$LIVE_DOMAIN`'i tanımlar, tekrar tanımla):

```bash
read -rp 'canlı domain (https:// olmadan): ' LIVE_DOMAIN && export LIVE_DOMAIN && curl -s "https://$LIVE_DOMAIN/api/config" && echo && curl -s "https://$LIVE_DOMAIN/api/health"
```

Beklenen: `/api/config` → `"version":"136"` / `"buildSha":"96cc270"`; `/api/health` → `{"ok":true,"mode":"db",...}`.
Bu iki `curl` **Cloudflare Tunnel** üzerinden gelir (host'ta 80/443 dinleyen nginx ya da
benzeri bir servis yok) — boş ya da `502` dönerse sorun sırası şudur: önce §7.1'in
`127.0.0.1:$TUNNEL_PORT` çağrısı, sonra tünel. **Tünel bu runbook'ta onarılmaz.**

### 2.1 Release dizini — kaynak kod canlı dizine girmez

v137 kodu **canlı dizinin içine** çıkarılmaz; ayrı bir release dizinine alınır. Böylece
çalışan stack'in dosyaları ile yeni sürümün dosyaları birbirine karışmaz ve geri dönüş
"dosyaları eski hâline getir" değil, "eski container'ı aç" olur (§8.0).

```bash
export RELEASE_DIR=/home/ubuntu/libedge-oracle-v137 && test ! -e "$RELEASE_DIR" && echo "release dizini bos: $RELEASE_DIR" || echo "UYARI: $RELEASE_DIR zaten var — once incele (DUR)"
```

**Beklenen:** `release dizini bos`. Dizin zaten varsa **DUR**: içinde ne olduğu (yarım
kalmış bir önceki deneme mi?) bilinmeden üzerine yazılmaz.

Doldurma — kaynak **Git'ten**, hedef **release dizini**; canlı dizine hiçbir şey yazılmaz:

```bash
mkdir -p "$RELEASE_DIR" && cd "$RELEASE_DIR" && git clone --depth 1 --branch main https://github.com/picohook/akademik-platform.git src && cd src && git rev-parse --short HEAD && test -f spike/app/Dockerfile && echo 'Dockerfile var'
```

**Beklenen:** bir SHA ve `Dockerfile var`. SHA'yı §9'a yaz — imaj etiketi bu SHA'yı taşır (§6.0),
yani hangi kodun canlıya çıktığı **kanıtlanabilir** olur. Klon başarısızsa **DUR** (canlı
dizinden kopyalama yapılmaz: orada sürüm izi yok).

> **Release dizini her deploy'da yeniden kullanılmaz.** Aynı dizine ikinci kez deploy
> edilecekse önce yeni bir `src` klonu alınır (`src-<sha>`), eskisi §7 geçtikten sonra silinir.
> Çalışan imajın kaynağı **asla** yerinde değiştirilmez.

## 3. Yedek — her şeyden önce

Yedek **`db` container'ının içinden** alınır ve **host'a** yazılır: veri `pgdata`
volume'ünde durur (`/var/lib/postgresql/data`), yani host'ta bir dosya kopyalamak yerine
`pg_dump` kullanılır — bir volume'ü kopyalamak, çalışan bir sunucunun sayfa dosyalarını
kopyalamak demektir.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db pg_dump -U akademik -Fc akademik > ~/backup-pre-v137-$(date +%Y%m%d-%H%M).dump
```

```bash
ls -l ~/backup-pre-v137-*.dump
```

**0 byte ise DUR.** Beklenen: MB mertebesinde tek dosya.

> **Yön önemli.** `>` **host** tarafında çalışır (root shell), `pg_dump` container içinde
> çalışır; dosya host'ta `~` altında biter. `docker exec … > ~/…` yazımı bu yüzden
> doğrudur ama `sudo` ile birlikte `~`'ın **root'un** ev dizinine çözülebileceğini unutma:
> dosyayı §9'a **tam yolla** yaz (`sudo ls -l ~/backup-pre-v137-*.dump` ile teyit et).
> Restore (§8.1) aynı yolu `<` ile geri okur.

> **Disk:** yedek host'ta büyür; `pgdata` volume'ü de aynı diskte. `df -h /` ile boş yer
> kontrol edilir (§6.0'da disk adımı var). Yedek alındıktan **sonra** hiçbir `volume prune`
> çalıştırılmaz (§4.0).

### 3.1 `collection_items` ön kontrolü (022 RLS'ten ÖNCE)

022 `collection_items`'e `enable` + `force row level security` uygular. O tabloda
`tenant_id` **null** kalan satır varsa app o satırları **artık görmez** ve o
koleksiyonlara bağlı grant'ler sessizce boşalır. Migration'dan **önce** ölçülür:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*) filter (where tenant_id is null) as null_tenant, count(*) as total from collection_items"
```

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select c.id, c.title, count(ci.*) from collections c left join collection_items ci on ci.collection_id = c.id group by 1,2 order by 3 desc"
```

| Sonuç | Karar |
| --- | --- |
| `null_tenant = 0` | Devam |
| `null_tenant > 0` | **DUR.** 022'deki backfill'e rağmen null kalan satır varsa hangi koleksiyona ait oldukları **Altan'ın kararı**; kendiliğinden düzeltilmez |

## 4. Migration — imajdan ÖNCE

Sunucuda node yok; runner throwaway `node:22-alpine` container'ında koşar (`db/README.md`).

### 4.0 Ortam: hangi sunucu, hangi container, hangi volume

Bu runbook **canlı Oracle sunucusundaki mevcut Docker yapısına** dokunur, yenisini
kurmaz. Aşağıdaki isimler her komutta tekrar eder; yanlış ağa bağlanan bir runner `db`
adını **çözemez** (`EAI_AGAIN`) ve hiçbir şey yapmadan düşer — tanı koyması zaman alır.

> **Hangi ortam canlı?** **Oracle.** AWS EC2 kurulumu 2026-10-30'da **devre dışı
> bırakıldı** (`docs/deployments/2026-10-30-oracle-cutover.md`): V136 cutover / final
> parity / public health **PASS**, tarayıcı kontrolü başarılı, EC2 instance
> `i-0b0c3d5032408d855` **durduruldu**. EC2'ye ait kayıtlar (`docs/DEPLOY.md`,
> `docs/deployments/2026-10-28-v136.md` §5 ve öncesi) **tarihsel**dir; bu runbook onları
> kaynak olarak **kullanmaz**.

> **Eski isim uyarısı (yalnız AWS/Compose kalıntıları içindir).** Aşağıdaki adlar **bu
> ortamın** adlarıdır ve uyarı kapsamı **dışındadır**: ağ `libedge-oracle-v136`, volume
> `libedge-oracle-v136-pgdata`, container'lar `libedge-oracle-v136-db` /
> `libedge-oracle-v136-web` / `libedge-oracle-live-tunnel`. Bunlar Oracle'ın **gerçek**
> adlarıdır. Yalnız şu biçimler eski AWS kurulumuna aittir ve **düzeltilmeden
> çalıştırılmaz**: `akademik-platform-prod*` container adları, `akademik-platform-prod_default`
> ağı, `akademik-platform-prod_pgdata` volume'ü, `libedge-v136` (etiketsiz eski imaj adı),
> `docker compose -f docker-compose.*.yml`. Canlı domain ve tünel portu **tahmin
> edilmez**: §4.0a'da `curl` ve `docker inspect` ile ölçülür.

| Ne | Beklenen | Nasıl doğrulanır |
| --- | --- | --- |
| Host | **`92.5.157.233`** | §2 |
| Canlı dizin (Git checkout **değil**) | **`/home/ubuntu/libedge-oracle-v136`** | §2 (`pwd`) |
| Release dizini (v137'nin kopyası) | **`/home/ubuntu/libedge-oracle-v137`** | §3.2 |
| Admin env (korumalı, `0600 root`) — **yalnız `DATABASE_ADMIN_URL`**, runner'a | **`/home/ubuntu/libedge-oracle-v137/config/admin.env`** | §5.3 |
| Web katalog env (korumalı, `0600 root`) — **yalnız `DATABASE_CATALOG_URL`**, web'e | **`/home/ubuntu/libedge-oracle-v137/config/web-catalog.env`** | §5.4 |
| Web container | **`libedge-oracle-v136-web`** | §4.0a |
| DB container | **`libedge-oracle-v136-db`** | §4.0a |
| DB adı / sahibi | **`akademik` / `akademik`** | §4.0a (`POSTGRES_DB`, `POSTGRES_USER`) |
| Ağ | **`libedge-oracle-v136`** | §4.0a |
| **Verinin durduğu volume** | **`libedge-oracle-v136-pgdata`** | §4.0a (`docker inspect … .Mounts`) |
| Canlı imaj (v136, geri dönüş için) | **`libedge-oracle-v136:96cc270-arm64`** | §4.0a + §6 |
| Yeni imaj (v137) | **`libedge-oracle-v137:137`** — build ve run **aynı** etiket | §6.0 |
| Tünel container'ı | **`libedge-oracle-live-tunnel`** | §4.0a |
| Tünel host portu | **§4.0a'da ölçülür** (kodda sabit yok) | §4.0a `$TUNNEL_PORT` |
| Canlı domain | **§4.0a'da ölçülür** (kodda sabit yok) | §4.0a `$LIVE_DOMAIN` |
| Çalıştırma | **`docker run`; Compose kullanılmıyor** | §6 |
| Runtime env (host'ta, container'a `--env-file`) | **`/home/ubuntu/libedge-oracle-v136/config/web-runtime.env`** | §4.0a |
| Runner'ın gördüğü repo | `-v "$PWD":/repo:ro` (salt okunur) | §4.1'deki `docker run` |
| Runner'ın `node_modules`'ı | `-v /repo/spike/app/node_modules` (isimsiz volume) | Aynı komut; imaja yazmaz |
| `app` rolü (RLS) | `akademik_app` | `schema.sql` |
| Tablo sahibi (DDL) | `akademik` | `POSTGRES_USER` |

**Bilinmeyenler — tahmin edilmez.** Bu runbook yazılırken sunucuya **bağlanılmadı**;
`config/web-runtime.env`'in içeriği ve web container'ının tam başlatma parametreleri
(`docker run` argümanları) **görülmedi**. Bu yüzden §4.0a bunları **salt okunur**
komutlarla operatöre ölçtürür; ölçüm tabloyla uyuşmazsa §4.0b'deki kural uygulanır.
Hiçbir adım bu değerleri varsayarak yazılmaz.

> **Tünel bir bağımlılık değil, korunacak bir şeydir.** `libedge-oracle-live-tunnel`
> host portuna tünelliyor ve o port **§4.0a'da ölçülür** (`$TUNNEL_PORT`); bu runbook'un
> hiçbir adımı tüneli durdurmaz, yeniden başlatmaz veya yeniden yapılandırmaz. Tünel yalnız
> §7'nin `curl` doğrulamasında dolaylı görünür. Tünel bozulursa bu ayrı bir arızadır.

#### 4.0a Ortamı salt okunur doğrula — yapacak bir şey yok, yalnız ölçüm

Aşağıdaki komutların **hiçbiri** container durdurmaz, volume'e dokunmaz, imaj silmez,
sunucuda dosya yaratmaz; hepsi `docker ps` / `network ls` / `inspect` — yani **salt okunur**.

Çalışan container'lar ve imajları:

```bash
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort
```

**Beklenen:** `libedge-oracle-v136-db`, `libedge-oracle-v136-web` ve
`libedge-oracle-live-tunnel` satırları; web imajı `libedge-oracle-v136:96cc270-arm64`.
Fazladan bir `*-web`/`*-db` çifti görünüyorsa (eski bir stack hâlâ ayakta) **DUR**: hangi
stack'in canlı olduğunu tünelin hedefi belirler.

Ağ:

```bash
sudo docker network ls --format '{{.Name}}'
```

**Beklenen:** `libedge-oracle-v136` listede. Runner `--network libedge-oracle-v136` ile
koşar; bu ad yoksa `db` çözülmez (§4.1).

Volume — **bu adım yedeğin nereye gittiğini de belirler** (§3):

```bash
sudo docker inspect libedge-oracle-v136-db --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
```

**Beklenen:** `volume libedge-oracle-v136-pgdata -> /var/lib/postgresql/data`.
`bind` görürsen (host dizini) yedek ve restore komutları **değişmez** — `pg_dump`/
`pg_restore` container içinden çalışır — ama yedek dosyasının host'taki yolu §9'a aynen
yazılır. **Volume adı başkaysa DUR**: §8.1'in tek dönüş yolu bu volume'deki veridir.

**`db` adı gerçekten çözülüyor mu — runner'ın bağlanacağı ad.** Env dosyalarındaki host kısmı
`db:5432`'dir; `db` bir **ağ takma adıdır** ve container adı `libedge-oracle-v136-db` olduğu için
kendiliğinden yoktur. Container'ın bu ağdaki `DNSNames` listesi ölçülür:

```bash
sudo docker inspect libedge-oracle-v136-db --format '{{json .NetworkSettings.Networks}}' | grep -o 'DNSNames":\[[^]]*\]'
```

**Beklenen:** listede **`db`** var (ör. `["libedge-oracle-v136-db","<id>","db"]`). **Yoksa DUR**:
`--env-file` ile gelen `@db:5432` çözülmez ve runner `EAI_AGAIN db` verir (yerelde birebir
ölçüldü, §10.4). Düzeltme `db` container'ına ağ takma adı eklemektir — bu **container'ı yeniden
yaratmadan** yapılır ve tek satırdır:

```bash
sudo docker network disconnect libedge-oracle-v136 libedge-oracle-v136-db && sudo docker network connect --alias db libedge-oracle-v136 libedge-oracle-v136-db && sudo docker run --rm --network libedge-oracle-v136 postgres:16-alpine getent hosts db
```

**Beklenen:** `db` için bir IP satırı (ör. `172.x.x.y  db`). Boşsa **DUR**. Bu adım `db`
container'ını durdurmaz/yaratmaz; yalnız ağ üyeliğini aynı ağa **alias ile** yeniden bildirir.
`web` container'ı da aynı takma adı kullanır, bu yüzden §6.1'deki yeni web container'ı bu
alias olmadan `db`'ye ulaşamaz.

Portlar ve tünel — **container portunu ve host portunu ölç, tahmin etme**:

```bash
sudo docker inspect libedge-oracle-v136-web --format '{{range $p, $b := .NetworkSettings.Ports}}{{$p}} -> {{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{"\n"}}{{end}}'
```

Çıktıyı değişkenlere al (sonraki bölümler bunları kullanır):

```bash
read -r CONTAINER_PORT HOST_ADDR HOST_PORT < <(sudo docker inspect libedge-oracle-v136-web --format '{{range $p, $b := .NetworkSettings.Ports}}{{$p}}{{" "}}{{range $b}}{{.HostIp}} {{.HostPort}}{{end}}{{end}}' | tr -d '/tcp') && export CONTAINER_PORT HOST_ADDR HOST_PORT && echo "container=$CONTAINER_PORT host=$HOST_ADDR:$HOST_PORT"
```

**Beklenen:** tek bir eşleme, `HostIp` **`127.0.0.1`** (yalnız localhost, `0.0.0.0` değil).
`CONTAINER_PORT` **ölçülen değerdir** ve §6.1'deki `docker run -p` bu değerle kurulur; runbook
hiçbir yerde port numarası **sabitlemez**. Birden fazla eşleme ya da `0.0.0.0` görürsen **DUR**
(§4.0b): hangi portun canlı olduğunu tünelin hedefi belirler.

Tünelin hedefi (host ağı kullanıyorsa `Ports` boş görünür — bu **hata değil**):

```bash
export TUNNEL_PORT="$HOST_PORT" && echo "tunnel hedefi: 127.0.0.1:$TUNNEL_PORT" && sudo docker inspect libedge-oracle-live-tunnel --format '{{.HostConfig.NetworkMode}} {{json .NetworkSettings.Ports}} {{range .Config.Cmd}}{{println .}}{{end}}' | head -20
```

**Beklenen:** tünelin yapılandırması `127.0.0.1:$TUNNEL_PORT`'a işaret ediyor. Farklı bir port
görünüyorsa `$TUNNEL_PORT`'u **ölçülen** değere göre düzelt (§7'de kullanılır); tünelle **oynanmaz**.

Canlı domain — **sabit yazılmaz, ölçülür**:

```bash
read -rp 'canlı domain (ör. host adı, https:// olmadan): ' LIVE_DOMAIN && export LIVE_DOMAIN && curl -s -o /dev/null -w "http=%{http_code} host=$LIVE_DOMAIN\n" "https://$LIVE_DOMAIN/api/config" && curl -s "https://$LIVE_DOMAIN/api/config"
```

**Beklenen:** `http=200` ve gövdede canlı sürüm bilgisi. `$LIVE_DOMAIN` §7'nin tüm dış çağrılarında
kullanılır; kod içinde domain sabiti **yoktur**. Boş/yanlış domain girilirse §7'deki dış kontrol
anlamsızlaşır → **DUR**.

DB adı ve sahibi:

```bash
sudo docker inspect libedge-oracle-v136-db --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^POSTGRES_(DB|USER)='
```

**Beklenen:** `POSTGRES_DB=akademik`, `POSTGRES_USER=akademik`. Farklıysa §3/§4/§7'deki
`-U akademik -d akademik` **yanlıştır** → **DUR**, doğru değerle düzeltilir. Bu komut
yalnız `POSTGRES_DB`/`POSTGRES_USER` süzer; `POSTGRES_PASSWORD` bu komutun **hiçbir yerinde geçmez**.

Sunucu mimarisi (canlı imaj etiketi `-arm64` ile bitiyor; §6'daki build buna bağlı):

```bash
uname -m && sudo docker inspect libedge-oracle-v136:96cc270-arm64 --format '{{.Architecture}}/{{.Os}}'
```

**Beklenen:** ikisi **uyumlu** (ör. `aarch64` ↔ `arm64/linux`). Uyuşmuyorsa **DUR**:
§6'daki build farklı mimaride çıkar ve yeni container açılmaz.

> **Web container'ının `docker run` argümanları henüz yazılmadı — ve tahmin edilmez.**
> §6'daki geçiş adımı container'ı **aynı bayraklarla** yeniden başlatmak zorundadır
> (`--network`, `--env-file`, port, volume, restart policy). Bunları uydurmak yerine §6.1
> mevcut container'ın `.Config`/`.HostConfig` değerlerini **yazdırır**; geçiş o çıktıya
> göre yapılır. §6.1'e geçmeden önce §4.0a'nın çıktıları §9'a yazılır.

#### 4.0b Ölçüm tabloyla uyuşmazsa

| Ölçüm | Karar |
| --- | --- |
| Adlar ve volume birebir uyuşuyor | Devam |
| Yalnız `Status` farklı (ör. `(unhealthy)`) | **DUR** — önce sağlık sorunu çözülür; sağlıksız stack üstüne deploy yapılmaz |
| Volume adı farklı | **DUR** — yedek yolu ve §8.1 belirsizleşir; önce hangi volume'ün canlı olduğu kanıtlanır |
| `uname -m` ile imaj mimarisi uyuşmuyor | **DUR** — §6'daki build bu sunucuda çalışmayacak bir imaj üretir |
| Container/yol adı farklı | **DUR** — runbook'un 50+ komutu yanlış hedefe gider; adlar **ölçümle** güncellenir, tahminle değil |
| Web için birden fazla port eşlemesi ya da `0.0.0.0` | **DUR** — hangi portun canlı olduğu belirsiz; kanıtlanmadan §6.1 çalıştırılmaz |
| `$LIVE_DOMAIN` boş / `http != 200` | **DUR** — dış kontrol (§7) yapılamaz; domain ölçülür, uydurulmaz |

> **Yapılmayacaklar:** **db** container'ını `docker stop`/`docker rm` ile kaldırmak
> (web sonra `EAI_AGAIN db` alır), `docker volume prune` / `docker system prune --volumes`
> (**`libedge-oracle-v136-pgdata` gider**), runner'ı `--network host` ile koşmak
> (container adı `db` çözülmez; ayrıca host'taki Postgres'e bağlanma riski), ve
> `docker image prune -a`'nın **rollback imajını** (`libedge-oracle-v136:96cc270-arm64`)
> almasına izin vermek — §8'deki dönüş yolu odur.
>
> Bu sunucuda **Compose yoktur**: eski `docker compose down/up` komutlarının buradaki
> karşılığı **hiç yoktur**; onları "docker eşdeğerine çevirerek" yazmak da yanlıştır.

**Migration'ın bağlanacağı admin env — parola host kabuğunda hiç tanımlanmaz.**

Eski hâlde burada `POSTGRES_PASSWORD`'ü `config/web-runtime.env`'den kabuğa alıp runner'a
`--env-file "$ADMIN_ENV"` ile
veren bir komut vardı. **O yazım hatalıydı ve runbook'tan kaldırıldı:** `sudo`/`env_reset`
yüzünden `POSTGRES_PASSWORD` host kabuğunda **tanımlı değildir**, dolayısıyla `${POSTGRES_PASSWORD}`
**boş** genişler ve runner'a parolasız bir URL gider. Yerel Docker'da birebir ölçüldü (§10.3):
`DATABASE_ADMIN_URL=postgres://akademik:@db:5432/akademik` — hata vermeyen, sessizce geçersiz
bir bağlantı.

Bağlantı artık **tek bir dosyadan** gelir: `$RELEASE_DIR/config/admin.env` (§5.3), içinde
**yalnız** `DATABASE_ADMIN_URL` satırı. Runner dosyayı `--env-file` ile alır; host kabuğunda
ne parola ne URL tanımlanır. Bu dosya **§5.3'ten önce yoktur**, yani §4.1/§4.2 ilk koşuda
`--env-file` hatası verir. Sıra bu yüzden değişmez: **§5.3 (dosya) → §4.1/§4.2 (runner)**.

Bu adımda yalnız **varlığı ve izinleri** ölçülür (değer basılmaz):

```bash
sudo ls -l /home/ubuntu/libedge-oracle-v137/config/admin.env && sudo grep -c '^DATABASE_ADMIN_URL=.' /home/ubuntu/libedge-oracle-v137/config/admin.env
```

**Beklenen:** `-rw------- 1 root root` ve `1`. Dosya yoksa §5.3 henüz yapılmamıştır → §5.3'e dön.
`0` dönerse satır boş ya da eksik → **DUR**.

> **`POSTGRES_PASSWORD` runbook'un hiçbir yerinde artık kullanılmıyor.** `db` container'ının
> parolası yalnız container'ın kendi env'indedir (§4.0a'nın `POSTGRES_DB`/`POSTGRES_USER`
> çıktısı `POSTGRES_PASSWORD`'ü zaten süzmez); migration ile web bu parolayı hiç görmez.

> **`/var/www/akademik-platform` ve `/home/ubuntu/akademik-platform` bu sunucuda yok.**
> İkisi de **eski EC2 kurulumunun** yollarıdır. Canlı dizin `/home/ubuntu/libedge-oracle-v136`,
> kaynak kodun okunduğu yer ise **release dizinidir** (`$RELEASE_DIR/src`, §2.1).
>
> **Aşağıdaki runner komutları `$RELEASE_DIR/src` içinde koşar** — canlı dizinde değil.
> `$RELEASE_DIR` §2.1'de tanımlandı; yeni bir kabukta yeniden tanımlanmalı. Tanımsızken komut
> `cd ""` ile **yanlış yerde** koşar, bu yüzden önce şunu çalıştır:
>
> ```bash
> test -d "$RELEASE_DIR/src/db" && echo "release OK: $RELEASE_DIR/src" || echo 'DUR: $RELEASE_DIR tanimsiz ya da src yok'
> ```


### 4.1 Durum — önce

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

**Beklenen:** `021`, `022`, `024`, `025`, `026` ve `027` **pending**; geri kalanı `applied`.
Son `applied` satırı **`020`** olmalı (`schema_migrations`'ın bugünkü son kaydı).

**Beklenen sayı `6`.** Beş değil: `027-reader-sso.sql` de bu deploy'da giriyor. Aşağıdaki
altı satırın **hiçbirinde** `cannot run: …` notu **görünmemeli** — görünüyorsa §4.2b.

> **026 öncesi / sonrası ayrımı burada başlıyor:** §4.3'ten **önce** `--status`'ün en büyük
> `applied` numarası **`025`**; §4.3'ten **sonra** **`027`**. Ayrıca doğrudan
> `schema_migrations`'a da bakılır (§4.4b); `--status` dosya sistemini de okur, o yüzden tek
> başına yetmez — çalıştırılanı kayıt tutar.

> Prod 020'ye kadar runner ile ilerledi, yani `schema_migrations` dolu → **baseline
> GEREKMEZ**. `--status` "not baselined" derse **DUR ve sor**; körlemesine
> `--baseline` **çalıştırılmaz** (003 prod'a demo hesap geri ekler).
>
> **Ölçüm komutu:** `--status` her dosyayı tek satır yazar — `    pending  021-….sql`
> (durum **başta**, dosya adı sonda; 2026-10-29'da aynı formatta ölçüldü). `grep`
> yalnız bu altı satıra daralır ve **sayar**; sessizce boş çıktı ile "beklediğim altı
> satır" ayırt edilebilsin diye `grep -c` kullanılır, düz `grep` değil:

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status' | grep -cE '^[[:space:]]+pending[[:space:]]+02[124567]-'
```

**Beklenen:** `6`. `5` dönerse eksik dosya `027`'dir (en yeni migration; checkout onu
içermiyorsa `ls db/migrations/027*` boş döner) → **DUR**. `4` dönerse **025** de eksiktir —
bu, §4.2b'deki runner sorununun ta kendisidir. `0` ya da `1` dönerse **DUR**, `--status`
çıktısının tamamı okunur; hata mesajını beklemeden yorumlama.

> **`6` sayısını görene kadar devam yok.** Bu sayı, düzeltilmiş runner'ın checkout'ta
> olduğunun **tek** ölçümüdür — ve düzeltme yoksa hiçbir şey kırılmaz, sadece 025/027
> yokmuş gibi davranılır. Sessiz atlamayı görünür kılan tek adım burasıdır.

### 4.2 Kuru çalıştırma

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --dry-run' | grep -E 'would apply'
```

**Beklenen:** tek satır, ve içinde **altısı da** olmalı:

```
  would apply: 021-…sql, 022-…sql, 024-…sql, 025-libedge-tenant-provisioning.sql, 026-…sql, 027-reader-sso.sql
```

`025` ya da `027` listede **yoksa DUR** — §4.2b.

### 4.2b Runner 025/027'yi gerçekten kabul ediyor mu (yanlış ret kontrolü)

**Neden bu adım var.** `db/migrate.mjs`, bir migration dosyasının **kendi** `begin`/`commit`
içermesini reddeder: dosyanın `commit`'i runner'ın transaction'ını erken kapatır ve
`schema_migrations` satırı dışarıda kalır. Kural doğru; **uygulanışı hatalıydı.** Denetim
satır başına bakan bir regex'ti ve bir `plpgsql` gövdesinin kendi `begin` … `end;`'ini
dosyanın transaction'ı sanıyordu:

| Dosya | Gerçek üst düzey `begin`/`commit` | Eski runner'ın kararı | Doğru karar |
| --- | --- | --- | --- |
| `013`–`017` | **Var** (`begin;` … `commit;`) | reddet | reddet |
| `025-libedge-tenant-provisioning.sql` | **Yok** (tek `end;` gövdenin sonu) | **yanlışlıkla reddetti** | çalıştır |
| `027-reader-sso.sql` | **Yok** (tek `end;` gövdenin sonu) | **yanlışlıkla reddetti** | çalıştır |

2026-10-30'da ölçüldü (düzeltmesiz `main`, `c03442c`): `--status` her iki dosyaya da
`cannot run: manages its own transaction (end;)` yazıyor; düzeltmeyle `0` (temiz). Düzeltme
gövdeyi `$tag$` sınırlarına göre **maskeleyip** denetler; üst düzey `commit;` yine reddedilir,
ve kapanmayan bir `$tag$` dosyanın geri kalanını denetimden **gizlemez** (`db/migrate.test.mjs`,
red→yeşil regresyon).

Maskelemenin kendisi de review'da düzeltildi: ilk sürüm kapanış etiketinden **sonra**
ilerlemiyordu, yani iki gövde arasındaki gerçek `commit;` **yetkilendiriliyordu**. Bugün
maskeleme tek geçişte ilerler ve kapanış etiketinden sonra devam eder; ayrıca string,
identifier, satır ve blok yorumlarını tanır, böylece yorum veya string içindeki `$$`
gerçek bir komutu gizleyemez. Regresyon bunu `commit;`/`rollback;`/`savepoint`/
`begin;`/`end;`/`start transaction`/`\begin` için ayrı ayrı ölçer (`db/migrate.test.mjs`,
14/14). Düzeltmesiz sürümde bu testlerin ilki **kırmızı** veriyordu:
`two bodies around "commit;" -> []`.

Bu adım, §4.1'in `6` sayısını **tek başına** yeterli görmeyen kişi için: `cannot run` satırı
**yalnız** `013`–`017`'de olmalı. Tam liste, dosya adlarıyla:

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status' | grep 'cannot run' | awk '{print $2}'
```

| Çıktı | Anlamı | Karar |
| --- | --- | --- |
| Tam olarak `013-…` `014-…` `015-…` `016-…` `017-…` (5 satır) | Runner doğru karar veriyor — **beklenen** | **Devam** |
| Listede `025-libedge-tenant-provisioning.sql` var | Runner düzeltmesi **yok**: 025 sessizce atlanır | **DUR** — `git log -1 --oneline -- db/migrate.mjs` ile #54'ü doğrula, `git pull` |
| Listede `027-reader-sso.sql` var | Aynı sorun, en yeni dosyada | **DUR** |
| Liste boş | Denetim hiç çalışmamış olabilir | **DUR**, `--status` çıktısının tamamını oku |

> Beklenen liste `013`–`017`: onlar **gerçekten** kendi `begin;`/`commit;`'lerini taşıyor
> (o yüzden yalnız baseline edilirler, hiç çalıştırılmazlar) ve bu liste deploy'dan
> **önce ve sonra aynıdır**. `021`/`022`/`024`/`026` bu listede hiç görünmez: onlar `$body$`
> gövdesi kullanıyor ve zaten düzeltmeden önce de geçiyorlardı.

Sanılmasın diye: **025 uygulanmadan imaj kırılmaz ama köprü uçları çalışmaz.** Köprü
v137 imajında **bağlıdır** — `server.mjs:2198` `isBridgePath()` ile `/api/libedge/v1/*`'i
`handleBridgeRoute()`'a devreder — ama iki ayrı kapısı vardır: token tanımlı değilse
her istek `503 BRIDGE_NOT_CONFIGURED` (`libedge-bridge-api.mjs:146`), tanımlıysa ve 025
yoksa `app.libedge_tenant_by_ref()`/`app.libedge_upsert_tenant()` bulunamaz. Yani 025
bu deploy'da uygulanmazsa **açılış kırılmaz, köprünün tenant/üyelik uçları çalışmaz**.
025 bu yüzden aynı pencerede uygulanır. 027 için durum **aynıdır**: okuyucu SSO yolu
v137 imajında bağlıdır (#50) ve `LIBEDGE_SSO_PUBLIC_KEYS` ile açılır; anahtar tanımlıysa
ve 027 yoksa SSO oturumu yazılamaz, tanımlı değilse SSO kapalı kalır. §7.6 ölçer.

> **024 ayrı bir deploy'da uygulanacaksa** (alternatif plan): o zaman 024 o deploy'un
> runbook'una taşınır ve buradaki beklenen sayı **`5`** (`021/022/025/026/027`) olur. Seçim §11'de.


### 4.3 Uygula

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs'
```

**Beklenen:** altı `applying … <ms> ms` satırı, sonra `6 migration(s) applied`. `applying`
satırlarında bir `error` görürsen **DUR** — o dosyanın hiçbir kısmı yazılmadı (§4.4b).

> Bu komut **imajdan önce** koşar (§1.5). Çıktıyı kaybetmemek için terminalde kalınır;
> çıktı §9'a birebir yazılır.


### 4.4 Durum — sonra

```bash
cd "$RELEASE_DIR/src" && sudo docker run --rm --network libedge-oracle-v136 -v "$PWD":/repo:ro -v /repo/spike/app/node_modules -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

**Beklenen:** `pending = 0`. Değilse **DUR**.

### 4.4b `schema_migrations` — son kayıt 025'ten 027'ye geçti mi

`--status` **dosya sistemini** de okur: yeni bir `.sql` geldiğinde onu `pending` gösterir.
Kaydın gerçekten yazıldığını gösteren yer `schema_migrations`'tır. Tablo
`db/migrate.mjs` §`REGISTRY_DDL`'de tanımlı: `filename` (PK), `checksum`, `applied_at`,
`duration_ms` — **`version` kolonu yok**, sürüm `filename`'in başındadır.

Ölçüm §4.3'ten **önce** ve **sonra** yapılır — iki farklı sonuç **beklenir**:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*), max(filename) from schema_migrations"
```

| Ne zaman | Beklenen |
| --- | --- |
| §4.3'ten **önce** | son kayıt **`025-…sql`** (`max(filename)`), `026` ve `027` **yok**; satır sayısı `N` |
| §4.3'ten **sonra** | son kayıt **`027-reader-sso.sql`**; satır sayısı **`N+6`** (021, 022, 024, 025, 026, 027) |

`max(filename)` metin sıralamasıdır ve `020` < `021` < `022` < `024` < `025` < `026` < `027`
olduğu için bu altı dosyada sıralama sürüm sırasıyla aynıdır — `max` gerçekten en son
uygulananı verir. `027` satırı görünmüyorsa migration **uygulanmamış** demektir: §4.6a ve
§4.6e koşulmaz, **DUR**. Sayı `N+5` çıkarsa altı dosyadan biri eksiktir — **hangi**
olduğunu §4.4'ün `--status` çıktısı söyler (`pending` kalan satır); o dosya §4.2b'deki
yanlış retin kurbanıdır ve **025 ise köprü, 027 ise SSO** çalışmaz.

> **Yarım 027 beklenmez.** `db/migrate.mjs` her dosyayı tek transaction'da çalıştırır ve
> kaydı **aynı** transaction'da yazar (`insert … ; commit`). 027'nin kendi doğrulaması
> düşerse dosya geri alınır, kayıt **hiç yazılmaz**. Yani `027` satırı varsa dosyanın
> *tamamı* koştu; yoksa *hiçbiri*. Bunun dışında bir durum görülürse (kayıt var ama
> §4.6e düşüyor) bu bir arıza işaretidir — §8.

> **Yarım 026 beklenmez.** `db/migrate.mjs` her dosyayı tek transaction'da çalıştırır ve
> kaydı **aynı** transaction'da yazar (`insert … ; commit`). 026'nın kendi doğrulaması
> düşerse dosya `0A000` (`feature_not_supported`) ile geri alınır, kayıt **hiç yazılmaz**.
> Yani `026` satırı varsa dosyanın *tamamı* koştu; yoksa *hiçbiri*. Bunun dışında bir
> durum görülürse (kayıt var ama §4.6a düşüyor) bu bir arıza işaretidir — §8.


### 4.5 RLS gerçekten açıldı mı (ölçüm)

022'nin asıl iddiası `collection_items`'te RLS'in **etkin** olması. Migration'ın
başarılı görünmesi yetmez, `pg_class` okunur:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'collection_items'"
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
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; select count(*) as plain_visible from tenants"
```

**Beklenen:** `0` (bir tenant bağlı değilken politika `id = ''::uuid` üzerinden hiçbir
satır göstermez) ya da `1` (havuzda bağlı bir bağlantı kaldıysa). **`0` doğru kıyas**;
`1` görürsen sorun değil, ama o zaman aşağıdaki sayı **1'den büyük** olmak zorunda.

Şimdi fonksiyon — app rolüyle, bağlı tenant **yokken**:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; select tenant_id from app.maintenance_tenants() order by tenant_id"
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
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select tenant_id from app.maintenance_tenants() order by tenant_id"
```

**Beklenen:** app rolünün gördüğü **aynı liste** — bu, iki rolün de aynı doğru cevabı
aldığını gösterir.

#### 4.6c Boş küme çıkarsa — sebebi ayır

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*) from tenants"
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

#### 4.6d 025'in çalıştığını gör — köprü bağlı, uçları kapalı

025 uygulandığında `app` şemasında iki fonksiyon daha olur ve **ikisi de aynı
`tenants_self` duvarını** aşar. Köprü `server.mjs`'te **bağlıdır** (`/api/libedge/v1`),
ama token tanımlı olmadığı için her istek `503 BRIDGE_NOT_CONFIGURED` döner — yani uç
üzerinden ölçüm yapılamaz. Fonksiyonlar doğrudan çağrılır, §4.6'nın aynı gerekçesiyle
**app rolüyle**:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; select has_function_privilege('akademik_app', 'app.libedge_tenant_by_ref(text, text)', 'execute') as by_ref, has_function_privilege('akademik_app', 'app.libedge_upsert_tenant(text, text, text, text, text)', 'execute') as upsert"
```

**Beklenen:** `t|t`. `f` dönerse 025 uygulanmamış ya da grant düşmüş → **DUR**.

Şimdi çözümleyici — prod'daki gerçek tenant'ın `(kind, ref)`'iyle:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; select tenant_id, status from app.libedge_tenant_by_ref('institution', '5799f2a5-3d90-41b1-90de-9da07d776052')"
```

**Beklenen:** tam **bir** satır ve `id` `5799f2a5-…`. **Boş küme de bir cevaptır** —
tenant bu `(kind, ref)` ile kayıtlı değilse doğru cevap budur; ayırt etmek için
`select id, libedge_kind, libedge_ref from tenants where id = '5799f2a5-…'` ile
karşılaştır (owner, politikayı atlar). `libedge_kind`/`libedge_ref` NULL ise prod tenant'ı
henüz köprüye bağlanmamış demektir ve bu **normaldir** — bu iki sütun köprü token'ı
tanımlanıp ilk yazma çağrısı gelene kadar **hiçbir** tenant için yazılmaz, yani 025'in
uygulanması onları doldurmaz.

> **Dokunma:** bu adımda `libedge_upsert_tenant()`'ı prod tenant'ının gerçek
> `(kind, ref)`'iyle çağırma. Update yolu slug'ı **döndürür** ama `name`/`status`
> yazar; yanlış bir `status` prod tenant'ını etkiler. Create yolu ise gerçek bir satır
> yaratır. 025'in yazma yolu süitte ölçülür (62 kontrol, `postgres:16-alpine`), prod'da
> yalnız **grant ve okuma** ölçülür.

### 4.6a 026'nın iki kanıtı — sayım ve bağsız okuma

026'nın iddiası: **bağlı bir bağlantı çözülebilir.** Bunun iki ayrı ölçümü var ve
**ikisi de** geçmek zorunda; biri "politikalar çevrildi"yi, diğeri "gerçekten çalışıyor"u
gösterir. İkisi de §4.3'ten **sonra** koşulur.

**1) Kaç politika korumaya alındı — tam `26` olmalı.**

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%nullif(current_setting(%app.tenant_id%'"
```

**Beklenen: `26`.**

Bu sayı **§4.3'ten sonra**, yani 021/022/024/025/**026**/**027** uygulandıktan sonra ölçülür.
026 tek başına **25** politika çevirdi (kendi içindeki `remaining < 20` kontrolü alt sınırı
korur); **027 iki yeni tablo yaratıp `libedge_sessions` için `nullif` biçiminde bir politika
eklediği için sayı 26'dır.** 2026-10-31'de ölçüldü: boş bir `postgres:16-alpine` üzerine
`schema.sql` + 021/022/024/025/026/027 uygulanıp aynı sorgu koşuldu → **`26`**
(`pg_policies` toplamı `public`'te **51**; 026 tek başına **25**, 027 `+1`).

Sayının nereden geldiği: `pg_policies`'te `public` şemasında 51 politika var, 26'sı
`nullif(...)` biçimine çevrildi, 25'i **bayt bayt aynı** kaldı (021'in
`bridge_idempotency` politikası bilinçli olarak `coalesce(...)` biçiminde bırakıldı —
`''` ve NULL'ı aynı sayar, `nullif`'e çevirmek onu gevşetirdi). `public` dışında politika
**yok**, dolayısıyla başka şemada korumasız kalan politika da yok.

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| `26` | 026 ve 027 tam uygulandı | **Devam** |
| `25` | **027 yok** (ya da yalnız o politikası yazılmadı) — SSO oturumu yazılamaz | **DUR** — §4.4b, §8 |
| `24` | Bir politika çevrilmemiş (ya da 026'dan sonra eklenmiş ve çevrilmemiş) | **DUR** — §8 |
| `> 26` | İki kez `nullif` yuvalanmış ya da fazladan politika var | **DUR** — §8 |
| `0` | 026 hiç koşmamış | **DUR** |


**2) Bağsız okuma `22P02` vermemeli — `akademik_app` ile, `0` satır.**

Bu, 026'nın *asıl* kanıtı: politikalar metin olarak doğru görünse bile bağsız bir oturum
hata vermeden çalışmalı. §7.4 ile aynı gerekçeyle **app rolüyle** ölçülür (süper kullanıcı
politikayı atlar; test kendini kandırır).

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; set app.tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'; reset app.tenant_id; select count(*) from works"
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
### 4.6e 027'nin iki kanıtı — nesneler yerinde mi, RLS gerçekten kesiyor mu

027'nin iddiası: **oturum satırı tenant'a bağlıdır ve bağsız okuma hiçbir satır görmez.**
İki ölçüm, ikisi de §4.3'ten **sonra**, ikisi de **app rolüyle**.

**1) Nesneler ve grant'lar.** 027 dosyasının sonundaki doğrulama bloğunun aynısı; migration
kendi sonucunu zaten yazdı, burada **bağımsız olarak** tekrar okunur:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select to_regclass('public.libedge_sessions') is not null as sessions, to_regclass('public.sso_auth_events') is not null as events, (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.libedge_sessions'::regclass) as sessions_forced, (select count(*) from pg_policies where schemaname = 'public' and tablename = 'libedge_sessions') as sessions_policies, has_table_privilege('akademik_app', 'sso_auth_events', 'delete') as app_can_delete_audit, has_function_privilege('akademik_app', 'app.sso_auth_events_purge(interval)', 'execute') as app_can_purge"
```

**Beklenen (2026-10-31'de ölçüldü, `schema.sql` + 021/022/024/025/026/027):**

```
t|t|t|1|f|t
```

| Alan | Beklenen | Anlamı |
| --- | --- | --- |
| `sessions` | `t` | `libedge_sessions` var |
| `events` | `t` | `sso_auth_events` var |
| `sessions_forced` | `t` | RLS **enable + force**; tablo sahibi de politikaya tâbi |
| `sessions_policies` | `1` | tek politika, `for all`, `using` **ve** `with check` nullif biçiminde |
| `app_can_delete_audit` | `f` | audit **append-only**: app rolü silAMAZ (silme yalnız `sso_auth_events_purge`) |
| `app_can_purge` | `t` | süpürme fonksiyonu app rolünde çalışır |

`app_can_delete_audit` `t` dönerse denetim izi uygulama tarafından **silinebilir** demektir —
027'nin sözleşme 7.5 iddiası düşmüş olur: **DUR**, §8.

**2) RLS kesiyor mu — bağsız `0`, bağlı `1`, komşu tenant `0`.**

Bu, 027'nin *asıl* kanıtı ve §4.6a'nın `0` tuzağına düşmemek için **üç ölçüm** ister:
prod'da **hiç oturum satırı yokken** `0` dönmek hiçbir şey kanıtlamaz (boş tablo her zaman
`0`'dır). 2026-10-31'de izole bir tümleşik DB'de bu üç ölçüm **gerçekten yapıldı**: iki
tenant, iki oturum satırı eklendi, ardından app rolüyle okundu →
`unbound=0`, `bound_A=1`, `bound_B=1`, `cross_tenant_read=0`. Yani aşağıdaki tablo
tahmin değil; negatif kontrolü yapılmış bir ölçümün prod'daki karşılığı.

Önce **prod'da kaç satır olduğu** (owner, politikayı atlar):

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set row_security = off; select count(*) from libedge_sessions"
```

Prod'da SSO henüz açılmadığı için **`0` beklenir**. `> 0` ise bir istemci önce yazmış
demektir; aşağıdaki karşılaştırma o zaman anlamlı olur — `0` ise bu adım **yapısal** olarak
geçer (politika metni + `forced`), **davranışsal** kanıt §7.6'da gerçek bir SSO girişiyle
aranır.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; reset app.tenant_id; select count(*) from libedge_sessions"
```

**Beklenen:** `0` — **ve hata yok.** `22P02` görülürse politikası çevrilmemiş (026/027
eksik) → **DUR**.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; set app.tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'; select count(*) from libedge_sessions; reset role"
```

**Beklenen:** bağlı okuma **`22P02` vermez** ve bir tenant'ın satırlarını **başka** bir
tenant'a göstermez. Prod'da satır olmadığı için `0` normaldir; satır varsa bu sayı,
`tenant_id = 5799f2a5…` olan satır sayısına **eşit** olmalı — owner'la doğrula:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set row_security = off; select count(*) from libedge_sessions where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'"
```

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| Bağsız `0` / hatasız, bağlı sayı = owner'ın o tenant sayısı | 027 ve 026 birlikte çalışıyor | **Devam** |
| `t&#124;t&#124;t&#124;1&#124;f&#124;t` ve tablo boş | Yapısal olarak doğru; davranış kanıtı §7.6'ya kalır | **Devam** (not düş) |
| `22P02` | Politika `nullif` biçiminde değil | **DUR** — §8 |
| Bağlı sayı ≠ owner'ın sayısı, ya da bağsız `> 0` | Tenant sınırı sızdırıyor | **DUR** — §8 |
| `app_can_delete_audit = t` | Audit silinebilir | **DUR** — §8 |

> **Prod'da yazma yapılmaz.** Bu adım yalnız okur. Politikanın gerçekten *kestiğini* kanıtlamak
> için prod'a sahte oturum satırı eklenmez: `libedge_sessions` gerçek oturumların tablosu ve
> `users`/`tenants`'a FK'li; test verisi buraya yazılırsa §8.1'in yedekten dönüş karşılaştırması
> da bozulur. Davranış kanıtı, §7.6'da **gerçek** bir okuyucu girişiyle alınır.



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
- `config/web-runtime.env` (canlı runtime env dosyası) bu adımdan önce yedeklenir; yedek adı §9'a yazılır.

### 5.1 Parolayı `read` ile oku ve rolü aç — tek satır

```bash
cd /home/ubuntu/libedge-oracle-v136 && read -rsp 'akademik_catalog password: ' P && echo && printf '\\password akademik_catalog\n%s\n' "$P" | sudo docker exec -i libedge-oracle-v136-db psql -U akademik -d akademik -v ON_ERROR_STOP=1 -c "alter role akademik_catalog login" && printf 'alter role akademik_catalog password %s;\n' "'${P//\'/\'\'}'" | sudo docker exec -i libedge-oracle-v136-db psql -U akademik -d akademik -v ON_ERROR_STOP=1 && unset P
```

> `\password` psql'in **kendi** meta-komutudur ve parolayı sunucuda hash'ler; parola
> `psql` stdin'inden okunur (ilk `printf |` bunun içindir). İkinci `printf` doğrudan
> `alter role ... password` çalıştırır — sunucu `scram-sha-256` ile saklar.
> **`unset P` komutun sonunda**: parola kabuk değişkeninde kalmaz.

### 5.2 Ölçüm — rol ve yetkiler

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_catalog'"
```

**Beklenen:** `akademik_catalog|t|f|f` — **LOGIN açık, süper kullanıcı ve `bypassrls` KAPALI**. `t` görürsen **DUR**.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*) from information_schema.role_table_grants where grantee = 'akademik_catalog'"
```

**Beklenen:** 6 satır (`works`, `editions`, `assets`, `asset_pages`, `collections`, `collection_items`, `tenants` → SELECT; tablo sayısı neyse o). Sayı **0 ise DUR**: 022 uygulanmamış demektir.

### 5.3 `admin.env` — **yalnız** `DATABASE_ADMIN_URL`, yalnız runner'a

Migration'ın kullandığı **admin** (sahip) bağlantısı web container'ına **verilmez**. Parola
**runtime env dosyasına** da yazılmaz: `config/web-runtime.env` web container'ının okuduğu,
sık yedeklenen ve sık kopyalanan dosyadır. Bunun yerine **ayrı, korumalı** bir dosya
kullanılır: `$RELEASE_DIR/config/admin.env` (`0600`, sahibi `root`).

**Docker env dosyası biçimi:** `KEY=VALUE`, satır başına bir anahtar, `#` ile başlayan satır
yorum, satır sonu `\n` (CRLF **değil**), tırnak/boşluk kaçışı yok. Değer **tırnaksız** yazılır;
URL'de `@`, `:`, `/`, `?`, `#`, `&`, `%` ayrıştırıcıdır — bu yüzden parola
**percent-encode** edilir (§5.3a).

Dosya `0600 root` olarak **sıfırdan** yaratılır; içerik yalnız `sudoedit` ile girer, yani
parola `ps`/`history`/`>` yönlendirmesine düşmez:

```bash
export ADMIN_ENV=/home/ubuntu/libedge-oracle-v137/config/admin.env && sudo install -d -m 0700 -o root -g root "$(dirname "$ADMIN_ENV")" && sudo install -m 0600 -o root -g root /dev/null "$ADMIN_ENV" && sudo ls -l "$ADMIN_ENV"
```

**Beklenen:** `-rw------- 1 root root`. `0644` ya da başka sahip görürsen **DUR**. Bu adım
§4.1/§4.2'den **önce** yapılır; runner bu dosyaya `--env-file` ile bağlıdır.

#### 5.3a Parolayı percent-encode et — değer ekrana basılmaz

```bash
read -rsp 'akademik_catalog password: ' P && ENC=$(printf '%s' "$P" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(encodeURIComponent(s)))') && unset P && echo "encoded length: ${#ENC}" && echo "$ENC"
```

**Beklenen:** `encoded length: 32+` ve yalnız `A-Za-z0-9` ile `-_.!~*'()` ve `%XX`
üçlülerinden oluşan metin (ham parolada `%` varsa çıktıda `%25` görünür — **doğrudur**).
`unset P` ham parolayı kabuktan siler; `$ENC` yalnız kodlanmış metindir ve bir sonraki
`sudoedit` oturumuna yapıştırılır, komut argümanına **girmez**.

> **Doğru encode'un kanıtı parolayı geri çözmek değildir** (parola asla okunmaz): kanıt
> **bağlantının çalışmasıdır** (§5.4b). Yanlış encode `password authentication failed` verir.

#### 5.3b `admin.env` içeriği — tek satır, yalnız `sudoedit` ile

```bash
sudoedit "$ADMIN_ENV"
```

İçine **tek satır** (§5.3a'nın çıktısı yapıştırılır):

```
DATABASE_ADMIN_URL=postgres://akademik:<PERCENT_ENCODED>@db:5432/akademik
```

> Sahip rol **`akademik`** (tablo sahibi, DDL); kullanıcı adı sabit ASCII olduğu için
> encode edilmez. Dosyada **başka anahtar yoktur** — özellikle `DATABASE_CATALOG_URL`
> buraya **yazılmaz**, o web'e giden ayrı dosyadadır (§5.4).

Doğrulama yalnız **anahtar adları, sayım ve izin** üzerinden yapılır — **değer basılmaz**:

```bash
sudo ls -l "$ADMIN_ENV" && sudo grep -c '^DATABASE_ADMIN_URL=.\+' "$ADMIN_ENV" && sudo grep -oP '^[A-Z_]+(?==)' "$ADMIN_ENV" | sort -u && echo -n 'catalog keys: ' && (sudo grep -c '^DATABASE_CATALOG_URL=' "$ADMIN_ENV" || true)
```

**Beklenen:** `-rw------- 1 root root`, `1`, yalnız `DATABASE_ADMIN_URL`, ve `catalog keys: 0`
(`grep -c` eşleşme bulamazsa `1` çıkış kodu verir; `|| true` bunu yutar). Katalog anahtarı
burada görünürse **DUR**.

> **Bu dosya kabukta `source` edilmez** (`source` / `.` / `set -a; . …` yasak) ve hiçbir
> komutun `-e VAR="$(...)"` argümanına okunmaz. Kullanımı yalnız `--env-file`'dır (§4.1,
> §4.2, §4.3): değeri Docker container'ın kendi env'ine yazar, host kabuğu hiç görmez.

### 5.4 `web-catalog.env` — **yalnız** `DATABASE_CATALOG_URL`, rol `akademik_catalog`

Web container'ı kataloğa **yalnız `akademik_catalog`** rolüyle bağlanır. **Admin bağlantısı
(`DATABASE_ADMIN_URL`) web'e verilmez** — web'in sahip rolüyle bağlanması, katalog sınırının
(022/`FORCE RLS` + tablo grant'leri) tek amacını ortadan kaldırır. Katalog bağlantısı kendi
korumalı dosyasında durur; `web-runtime.env`'e **yazılmaz** (o dosya sık kopyalanır/yedeklenir).

```bash
export WEB_CATALOG_ENV=/home/ubuntu/libedge-oracle-v137/config/web-catalog.env && sudo install -m 0600 -o root -g root /dev/null "$WEB_CATALOG_ENV" && sudo ls -l "$WEB_CATALOG_ENV" && sudoedit "$WEB_CATALOG_ENV"
```

**Beklenen:** `-rw------- 1 root root`, sonra editör açılır. İçine **tek satır** — §5.3a'nın
**aynı** percent-encode çıktısı, **aynı** parola:

```
DATABASE_CATALOG_URL=postgres://akademik_catalog:<PERCENT_ENCODED>@db:5432/akademik
```

> Rol **`akademik_catalog`**'dur (§5.1'de LOGIN aldı; §5.2'de süper/`bypassrls` olmadığı
> ölçüldü). Sahip rol `akademik` bu dosyada **geçmez** — geçerse web'e admin bağlantısı
> verilmiş olur → **DUR**.

```bash
sudo ls -l "$WEB_CATALOG_ENV" && sudo grep -c '^DATABASE_CATALOG_URL=.\+' "$WEB_CATALOG_ENV" && sudo grep -oP '^[A-Z_]+(?==)' "$WEB_CATALOG_ENV" | sort -u && echo -n 'host ok: ' && sudo grep -c '@db:5432/akademik$' "$WEB_CATALOG_ENV" && echo -n 'catalog role ok: ' && sudo grep -cE '^DATABASE_CATALOG_URL=postgres://akademik_catalog:' "$WEB_CATALOG_ENV"
```

**Beklenen:** `-rw------- 1 root root`, `1`, yalnız `DATABASE_CATALOG_URL`, `host ok: 1`,
`catalog role ok: 1`. Değerler **basılmaz**; sahip rolle eşleşen satır sayısı **0**'dır
(`postgres://akademik:` hiç geçmez).

#### 5.4b Bağlantının kendisi kanıt — dosya biçimi yetmez

Dosya biçimi doğru olsa da parola/encode yanlış olabilir. Katalog bağlantısı **`--env-file`
ile**, admin dosyası **verilmeden** denenir; yalnız `akademik_catalog` rolüne bağlanabildiği
ve **yazma yetkisi olmadığı** ölçülür. SQL **tek satırlık `sh -c` içine gömülür** (ayrı
dosya/`psql -f` yok; `$$` yerine `chr()` ile kurulan adlar kullanılır ki kabuk kaçışı
sorun olmasın) — §10.2'de yerel Docker'da birebir ölçüldü:

```bash
sudo docker run --rm --network libedge-oracle-v136 --env-file "$WEB_CATALOG_ENV" postgres:16-alpine sh -c 'psql "$DATABASE_CATALOG_URL" -Atc "select current_user||q||session_user from (select chr(124) q) x" && psql "$DATABASE_CATALOG_URL" -Atc "select coalesce(has_table_privilege(chr(119)||chr(111)||chr(114)||chr(107)||chr(115), chr(68)||chr(69)||chr(76)||chr(69)||chr(84)||chr(69)), false)"'
```

**Beklenen:** `akademik_catalog|akademik_catalog` ve `f` (silmeye yetkisi yok).
`akademik|akademik` dönerse **yanlış dosya** kullanılıyor → **DUR**. `password authentication
failed` dönerse percent-encode (§5.3a) ya da parola (§5.1) yanlıştır → §5.3a'ya dön.



## 6. İmaj — build, etiket, geçiş

**Bu sunucuda Compose yok.** Container'lar düz `docker run` ile başlatıldı ve runtime env
host'taki `config/web-runtime.env` dosyasında duruyor. Yani "imajı değiştirmek" burada
`docker run` argümanlarının **birebir** tekrarı demektir; bayraklardan biri eksikse web
sessizce yanlış ağa ya da yanlış env ile kalkar. Bu yüzden §6.1 **önce ölçer**, sonra
yeniden yaratır.

### 6.0 Etiketi bir kez belirle — build ve run **aynı** etiketi kullanır

Etiket iki yerde geçer (`docker build -t`, `docker run <imaj>`) ve ikisi **birebir aynı
olmak zorundadır**. İki ayrı isim (`libedge-v137` ile `libedge-v137:137` gibi) kullanmak
§7'deki doğrulamayı ve §8.0'daki geri dönüşü belirsizleştirir: hangi imajın koştuğu
container adından değil, **etiketten** okunur.

```bash
export RELEASE_SHA=$(cd /home/ubuntu/libedge-oracle-v137/src && git rev-parse --short HEAD) && export NEW_IMAGE="libedge-oracle-v137:137-${RELEASE_SHA}-$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')" && echo "NEW_IMAGE=$NEW_IMAGE"
```

**Beklenen:** `libedge-oracle-v137:137-<sha>-<arch>` — sürüm, **release sha'sı** (§2.1'de
kanıtlanan commit) ve sunucunun **ölçülen** mimarisi tek etikette. Aşağıdaki tüm `docker build`
ve `docker run` komutları **`$NEW_IMAGE`** kullanır; runbook hiçbir yerde ikinci bir v137 adı
yazmaz. Deploy kaydına (§9) bu tam etiket yazılır.

Disk durumu (v136 döneminde disk %85 doluydu; bu sunucuda **ölçülmemiştir**):

```bash
df -h / | tail -1 && sudo docker image ls --format '{{.Repository}}:{{.Tag}}'
```

**Beklenen:** boş alan **en az 3 GB** ve listede `libedge-oracle-v136:96cc270-arm64`.
Disk doluysa **DUR**; aşağıdaki temizlik adımı yalnız **ölçümden sonra** çalıştırılır.

```bash
cd /home/ubuntu/libedge-oracle-v137/src && sudo docker build --build-arg BUILD_SHA="$RELEASE_SHA" --build-arg APP_VERSION=137 --build-arg BUILD_DATE=$(date -I) -t "$NEW_IMAGE" spike/app
```

> **Mimari.** Etiketin son parçası `uname -m`'den gelir (§4.0a ile aynı kaynak). `uname -m`
> `aarch64` dönerse `docker build` yerel olarak doğru imajı üretir; **çapraz build'e
> (`--platform`) bu runbook'ta yer yok** — çıktı farklı mimaride olursa container açılmaz.

```bash
sudo docker inspect "$NEW_IMAGE" --format '{{json .Config.Labels}} {{.Architecture}}' && sudo docker inspect libedge-oracle-v136:96cc270-arm64 --format '{{.Architecture}}'
```

**Beklenen:** `revision` = `$RELEASE_SHA`, `version` `137`, ve `Architecture` canlı imajla
**aynı**. `unknown` ise `--build-arg` unutulmuş → **DUR**. Mimari uyuşmuyorsa **DUR**.


### 6.1 Geçiş — ölç, durdur, sakla, başlat, sağlık, değilse geri aç

**Bu bölüm tahmin içermez.** Web container'ının `docker run` argümanları bu runbook
yazılırken görülmedi; o yüzden önce mevcut container'ın kendi tanımı **yazdırılır**, geçiş
o çıktıya bakılarak yapılır.

**Kapsam ve değişmezler:**

| Nesne | Geçişte |
| --- | --- |
| `libedge-oracle-v136-web` | **Durdurulur, saklanır; yerine `$NEW_IMAGE` ile yenisi açılır** |
| `libedge-oracle-v136-db` | **Dokunulmaz** — durdurulmaz, yeniden başlatılmaz, yeniden yaratılmaz |
| `libedge-oracle-v136-pgdata` | **Dokunulmaz** — volume'e yazılmaz, kopyalanmaz, silinmez |
| `libedge-oracle-live-tunnel` | **Dokunulmaz** — aynı host portuna bakmaya devam eder |
| `config/web-runtime.env` | **Dokunulmaz** — yeni container aynı `--env-file` ile kalkar |
| `config/web-catalog.env` | **Dokunulmaz** — yeni container'a **ikinci** `--env-file` olarak verilir (§5.4) |
| `config/admin.env` | **Yalnız runner'a** — **yeni web container'ına verilmez** (§5.3) |

#### 6.1.1 Ölç — salt okunur

Ağ, port, restart policy ve volume'ler:

```bash
sudo docker inspect libedge-oracle-v136-web --format 'network={{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}restart={{json .HostConfig.RestartPolicy}} binds={{json .HostConfig.Binds}} mounts={{range .Mounts}}{{.Type}}:{{.Name}}{{.Source}}->{{.Destination}} {{end}}ports={{json .HostConfig.PortBindings}}'
```

Env **anahtar adları** (değer yok) ve `--env-file`:

```bash
sudo docker inspect libedge-oracle-v136-web --format '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}' | sort && echo 'envfile: /home/ubuntu/libedge-oracle-v136/config/web-runtime.env'
```

Entrypoint, cmd, workdir, user ve sağlık kontrolü:

```bash
sudo docker inspect libedge-oracle-v136-web --format 'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}} workdir={{json .Config.WorkingDir}} user={{json .Config.User}} health={{json .Config.Healthcheck}}'
```

**Karar kuralı:** Yeniden yaratma komutu bu üç çıktıdaki değerleri **aynen** taşır;
`--network`, `--restart`, port eşlemesi (`$HOST_ADDR:$HOST_PORT:$CONTAINER_PORT` —
**§4.0a'da ölçülen** değerler, sabit değil), `--env-file` ve `--health-*` bayrakları
değişmeden gelir. Tek değişen **imaj etiketidir** (`libedge-oracle-v136:96cc270-arm64` →
`$NEW_IMAGE`). Çıktı ile yazacağın komut arasında imaj dışında **tek bir fark** bile varsa
**DUR** ve §9'a yaz. Env listesinde **`DATABASE_ADMIN_URL` görünürse** web'e admin bağlantısı
verilmiş demektir → **DUR**. `DATABASE_CATALOG_URL` **görünmelidir** (web kataloğa bu bağlantıyla
bağlanır, §5.4); yoksa §6.1.2'nin ikinci `--env-file`'ı unutulmuş demektir → **DUR**.

#### 6.1.2 Durdur → sakla → başlat → sağlık → başarısızsa geri aç

Sıra **sabittir**; adımlar atlanmaz. Eski container **silinmez**, saklanır: §8.0'ın hızlı
dönüşü imajı geri almak değil, **eski container'ı geri açmaktır**.

**1) Durdur ve sakla.** Yeni container aynı portu bağlayacağı için eski önce durdurulur;
`rm` **edilmez**, `rename` edilir:

```bash
export PREV_NAME="libedge-oracle-v136-web-prev-$(date +%Y%m%d-%H%M)" && sudo docker stop libedge-oracle-v136-web && sudo docker rename libedge-oracle-v136-web "$PREV_NAME" && sudo docker ps -a --filter name="$PREV_NAME" --format '{{.Names}} {{.Image}} {{.Status}}' && echo "PREV_NAME=$PREV_NAME"
```

**Beklenen:** tek satır, `Exited` ve **eski imaj** (`libedge-oracle-v136:96cc270-arm64`).
`$PREV_NAME`'i §9'a yaz — geri dönüşün tek anahtarı budur. `restart` politikası
`unless-stopped`/`always` olsa da **elle durdurulan** container kendiliğinden kalkmaz; yine de
teyit et:

```bash
sudo docker ps --filter name=libedge-oracle-v136-web --format '{{.Names}} {{.Status}}'
```

**Beklenen:** **boş**. Hâlâ `Up` görünüyorsa **DUR** (port çakışır, restart policy beklenenden farklı).

**2) Yeniyi başlat.** Komut 6.1.1'in çıktısından **birebir** kurulur; `<>` içindeki her değer
**ölçülen** değerdir (tahmin değil), imaj §6.0'ın `$NEW_IMAGE`'ı:

```bash
sudo docker run -d --name libedge-oracle-v136-web --network libedge-oracle-v136 --restart <ölçülen> -p "$HOST_ADDR:$HOST_PORT:$CONTAINER_PORT" --env-file /home/ubuntu/libedge-oracle-v136/config/web-runtime.env --env-file "$WEB_CATALOG_ENV" --health-cmd=<ölçülen> --health-interval=<ölçülen> --health-retries=<ölçülen> "$NEW_IMAGE"
```

> **İki `--env-file`, tek `-e` yok.** Birincisi canlı dizindeki runtime dosyasıdır ve
> **değişmez**; ikincisi `$WEB_CATALOG_ENV` (§5.4) ve **yalnız `DATABASE_CATALOG_URL`** taşır.
> Docker birden çok `--env-file`'ı soldan sağa okur (aynı anahtar sonra gelen dosyadaki
> değeri alır) — bu yüzden `web-catalog.env` içinde `web-runtime.env`'de olan **hiçbir anahtar
> bulunmaz**, §5.4'ün anahtar sayımı bunu garanti eder. **`config/admin.env` buraya
> eklenmez**: web container'ına admin bağlantısı **verilmez**. `binds`/`mounts` çıktısı boş
> değilse o bayraklar da aynen taşınır.

**3) Sağlık kontrolü — yalnız "Up" yetmez.** Docker healthcheck **ve** doğrudan HTTP:

```bash
sleep 15 && sudo docker ps --filter name=libedge-oracle-v136-web --format '{{.Names}} {{.Image}} {{.Status}}' && curl -s -o /dev/null -w 'local=%{http_code}\n' "http://$HOST_ADDR:$HOST_PORT/api/config" && curl -s "http://$HOST_ADDR:$HOST_PORT/api/config"
```

**Beklenen (üçü birlikte):** `(healthy)`, `local=200`, gövdede `"version":"137"` ve
`"buildSha"` = `$RELEASE_SHA`; imaj etiketi `$NEW_IMAGE`. Biri bile tutmuyorsa **adım 4**
çalıştırılır — "biraz bekleyip tekrar bakmak" **değil**.

**4) Başarısızsa eskiyi geri aç.** Yalnız **başarısız yeni** kaldırılır; saklanan eskiye
dokunulmaz:

```bash
sudo docker rm -f libedge-oracle-v136-web && sudo docker rename "$PREV_NAME" libedge-oracle-v136-web && sudo docker start libedge-oracle-v136-web && sleep 10 && sudo docker ps --filter name=libedge-oracle-v136-web --format '{{.Names}} {{.Image}} {{.Status}}' && curl -s -o /dev/null -w 'local=%{http_code}\n' "http://$HOST_ADDR:$HOST_PORT/api/config" && curl -s "http://$HOST_ADDR:$HOST_PORT/api/config"
```

**Beklenen:** `Up`/`(healthy)`, **eski imaj**, `local=200` ve `"version":"136"` — yani canlı
ortam geçiş öncesi hâline döndü. Buradan sonra §8.0 uygulanır: kök neden bulunmadan ikinci
deneme yapılmaz.

> **DB ve tünel bu dört adımın hiçbirinde geçmez.** Geçişte `stop`/`start`/`restart` **yalnız**
> `libedge-oracle-v136-web` adına uygulanır; `libedge-oracle-v136-db`,
> `libedge-oracle-live-tunnel` ve volume'e giden hiçbir komut bu bölümde yoktur. Tünel aynı
> `$HOST_ADDR:$HOST_PORT`'a baktığı için web değişimi tünelde **yapılandırma değişikliği
> gerektirmez**.

### 6.2 `OPDS_TENANT_ID` / `OPDS_API_KEY` (bu sürümde tanımlanmıyor)

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

Tünel hedefi **önce doğrudan** ölçülür: iki `curl` aynı gövdeyi vermeli. Cloudflare
katmanı ayrı bir arıza kaynağıdır ve tünel bu runbook'ta onarılmaz (§4.0).

```bash
curl -s "http://$HOST_ADDR:$HOST_PORT/api/config" && echo && curl -s "https://$LIVE_DOMAIN/api/config"
```

**Beklenen:** iki çağrı da yeni sürümü döndürür. HOST_ADDR:HOST_PORT doğru ama dış URL
yanlışsa arıza **tüneldedir** -> **DUR**, tünel ayrı ele alınır. HOST_ADDR:HOST_PORT
yanıt vermiyorsa arıza **web container'ındadır**. (Değişkenler 4.0a'da ölçüldü; yeni kabukta
yeniden tanımlanmalı - port ve domain **sabit yazılmaz**.)

```bash
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

**Beklenen:** `libedge-oracle-v136-web` (ad 6.1'de korunur) -> **`$NEW_IMAGE`** `(healthy)`,
`libedge-oracle-v136-db` -> `(healthy)`, `libedge-oracle-live-tunnel` -> `Up` (aynı container,
yeniden başlatılmamış: `CreatedAt` değişmemiş olmalı).

```bash
curl -s "https://$LIVE_DOMAIN/api/config" && echo && curl -s "https://$LIVE_DOMAIN/api/health"
```

**Beklenen:** `version` `137`, `buildSha` = `$RELEASE_SHA`, `buildDate` = bugün, `environment` `production`; health -> `ok:true`, `mode` `db`, `tenantId` = `5799f2a5-...` (**değişmemeli**).

```bash
curl -s "https://$LIVE_DOMAIN/" | grep -o '/app.js?v=[^\"]*'
```

**Beklenen:** `/app.js?v=<sha>` - `?v=0-dev` **değil**.

### 7.2 R2

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-web sh -c 'cd /app && node scripts/check-r2.mjs'
```

**Beklenen:** `R2 PASS: put/read/range/delete; temporary object removed.` Başka bir şey (yığın izi, `missing R2_ENDPOINT`) → **DUR**.

### 7.3 Giriş, katalog, kitap düzenleme

Tarayıcıda (Altan):

| Adım | Beklenen |
| --- | --- |
| `https://$LIVE_DOMAIN` → giriş | Form açılır, giriş **başarılı** |
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
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select count(*) from works where tenant_id is null"
```

**Beklenen:** `0` — 022 tek eser taşımadı. **`0` ise aşağıdaki iki test anlamsızdır**
(etkilenecek satır yok); atla ve deploy kaydına "global eser yok, 023'ten sonra ölçülecek"
yaz. `> 0` ise devam:

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; update works set title = title where tenant_id is null"
```

**Beklenen:** `UPDATE 0`. `UPDATE 1+` → **DUR** (başlık aynı yazıldığı için veri bozulmaz, ama 022 tutmuyor demektir).

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set role akademik_app; delete from works where tenant_id is null"
```

**Beklenen:** `DELETE 0`.

> **`set role akademik_app` neden:** migration'lar `akademik` (süper kullanıcı) ile koşar.
> `FORCE RLS` tablo **sahibini** de kapsar ama **süper kullanıcıyı kapsamaz** — süper
> kullanıcıyla yapılan test kendini kandırır. Prod'da app'in gerçekten kullandığı rol
> `akademik_app`; ölçüm onunla yapılır.

### 7.5 `akademik_catalog` (yalnız §5 yapıldıysa)

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_catalog'"
```

**Beklenen:** `akademik_catalog|t|f|f`.
### 7.6 Okuyucu SSO — 027'nin davranış kanıtı (§4.6e'nin prod karşılığı)

§4.6e yapıyı ölçer; **gerçek** kanıt 027'nin var olma sebebinin çalışmasıdır: okuyucu
LibEdge üzerinden eLibrary'ye SSO ile girerken `libedge_sessions`'a bir satır, `sso_auth_events`'e
de bir deneme satırı yazılmalı. Ölçüm **tarayıcıdan** yapılır, psql'den değil — ve prod'a elle
satır **yazmaz**, uygulamanın yazdığını **okur**.

**Önce: operatör kapısı açık mı.** 027 uygulanmış olması SSO'nun açık olduğu anlamına
**gelmez**. `server.mjs` SSO'yu yalnız `LIBEDGE_SSO_PUBLIC_KEYS` tanımlıysa açar; tanımlı
değilse `[sso] LIBEDGE_SSO_PUBLIC_KEYS not set, reader SSO disabled` yazar ve giriş düğmesi
hiç görünmez.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker logs --tail 200 libedge-oracle-v136-web 2>&1 | grep -E '^\[sso\]' | tail -5
```

| Görülen | Anlamı | Karar |
| --- | --- | --- |
| `[sso] N handoff key(s) loaded` | SSO **açık** | Aşağıdaki tabloyu uygula |
| `[sso] LIBEDGE_SSO_PUBLIC_KEYS not set, reader SSO disabled` | SSO **kapalı** — bu bir arıza değil, bir karar | §7.6 tablosunu **atla**; deploy kaydına "SSO kapalı, 027 yapısal olarak doğrulandı (§4.6e)" yaz |
| Hiç `[sso]` satırı yok | v136 çalışıyor olabilir (`sso/` modülü ondan yeni) | **DUR** — §7.1'i tekrar oku |

SSO açıksa (Altan, tarayıcıda):

| Adım | Beklenen |
| --- | --- |
| LibEdge okuyucu tarafında bir eseri aç → **eLibrary'de oku** | eLibrary açılır, kullanıcı **giriş yapmış** durumda (handoff kabul edildi) |
| Aynı sekmeyi yenile | Oturum **sürüyor** — `libedge_sessions` satırı tenant bağlamasıyla okunuyor demektir |
| Çıkış yap, sonra aynı handoff bağlantısını **ikinci kez** kullan | **Reddedilir** (jti tek kullanımlık — `sso_consumed_jti`, 021'den beri var) |

Ardından (owner ile, salt okuma):

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "set row_security = off; select (select count(*) from libedge_sessions) as sessions, (select count(*) from sso_auth_events) as events"
```

**Beklenen:** ikisi de **`> 0`** (en az bir başarılı giriş ve onun audit satırı). `0|0` ise
SSO yolu hiç çalışmamış demektir — §4.6e geçmiş olsa bile **DUR**: ya imaj
`LIBEDGE_SSO_PUBLIC_KEYS`'i görmüyor ya da 027 yok. `sessions=0` ama `events>0` ise
**girişler reddediliyor** demektir; aşağıdaki `reason` sütununa bak.

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc "select outcome, coalesce(reason, '-') as reason, count(*) from sso_auth_events group by 1, 2 order by 1, 2"
```

**Beklenen:** en az bir `login|-|1`. `reject` satırları **tek başına sorun değildir** —
reddedilen bir handoff'un izi tam olarak burada olmalı (operatörün görmek istediği şey bu).
Ama **hepsi** `reject` ise hiçbir giriş kabul edilmemiştir → **DUR**, `reason` değerleri
sözleşme 7.5'teki kodlarla karşılaştırılır.

> **Bu tabloda token/e-posta/claim yoktur** — sözleşme gereği yalnız sonuç, sebep, ctx, opak
> LibEdge kullanıcı id'si ve IP. Bir satırda token benzeri bir değer görürsen bu bir
> **arıza**dır (§8), sadece bir log değil.

> **027 yalnız flag açıkken gerekir.** SSO kapalıyken 027 uygulanmasa bile uygulama kırılmaz
> (`startSsoMaintenance` yalnız `ssoKeys` varken başlar; `sso_auth_events_purge` yokken bir
> `42883` uyarısı loglanır ve geçilir). 027 yine de bu deploy'da uygulanıyor çünkü flag'i
> açmak migration gerektirmemeli.

> **Geri dönüş notu:** 027 uygulandıysa imaj geri alınsa bile (`libedge-oracle-v136:96cc270-arm64`) bu iki tablo
> **kalır**. v136 imajında `libedge_sessions` okuyan kod **yoktur** (okuyucu SSO #50 ile
> geldi) ve `libedge_sessions`'a yazan tek yol SSO callback'idir; yani v136 bu tabloları hiç
> görmez. §8'deki imaj geri alma 027'yi geri almayı **gerektirmez**; 027'nin tek geri dönüşü
> yedektir (§8.1).



## 8. Rollback

### 8.0 En hızlı dönüş — eski web container'ı geri al (imaj rebuild yok)

§6.1'de eski container `libedge-oracle-v136-web-prev-<ts>` adıyla **saklandı** (§6.1.2 adım 1);
yani dönüş bir imaj build'i değil, iki `docker` komutudur. Yeni container'ın adı **değişmez**
(`libedge-oracle-v136-web`); yeni imajla kalkan container bu adı taşır, yani var olmayan bir
`libedge-oracle-v137-web` adı **yoktur**. Container **silinmemişse**:

```bash
sudo docker stop libedge-oracle-v136-web && sudo docker rename libedge-oracle-v136-web libedge-oracle-v136-web-bad-$(date +%Y%m%d-%H%M) && sudo docker rename "$PREV_NAME" libedge-oracle-v136-web && sudo docker start libedge-oracle-v136-web && sudo docker ps --filter name=libedge-oracle-v136-web --format '{{.Names}} {{.Image}} {{.Status}}'
```

`$PREV_NAME` yerine §9'a yazılan gerçek ad gelir. **Beklenen:** `docker ps`'te
`libedge-oracle-v136-web` çalışıyor, imajı **eski imaj** (`libedge-oracle-v136:96cc270-arm64`) ve
§7.1'in `/api/config` çağrısı `"version":"136"` döndürüyor. Bu yol container'ı **yeni env
dosyasıyla** başlatmaz — eski container kendi `docker run` anındaki env'i taşır. `config/admin.env`
web container'ına **zaten hiç verilmediği** ve `config/web-catalog.env` yalnız **yeni** container'a
eklendiği (§6.1.2/2) için, eski container geri açılınca web **katalog env'siz** çalışır — v136
zaten kataloğa bu env ile bağlanmıyordu, yani geri alınacak bir env değişikliği yoktur. İki dosya
**silinmez**: §8.1'den sonraki ikinci denemede yeniden gerekir.

> Eski container silinmişse (`docker rm`), yukarıdaki yol yoktur: §6.1.1'de ölçülmüş
> bayraklarla `docker run … libedge-oracle-v136:96cc270-arm64` komutu kurulur. Bu yüzden
> §6.1.1'in `docker inspect` çıktısı **§9'a yazılmadan** eski container **silinmez**.

### 8.0a Sonra ne geri alınır

| Katman | Geri dönüş |
| --- | --- |
| **Web container** (en hızlı) | §6.1'de saklanan eski container'a dön: yeni container'ı durdur, eskisini eski adına geri adlandır (§8.0) |
| **İmaj** | Geri dönüş imajı **`libedge-oracle-v136:96cc270-arm64`** (rebuild yok, `docker run` ile aynı bayraklar + bu imaj) |
| **Env** | `config/web-runtime.env` **değiştirilmedi** (yedek gerekmez). Katalog parolası zaten web container'ına verilmedi (§5.3). **`LIBEDGE_BRIDGE_MEASURE_RESET` prod'da tanımlanmaz** (aşağıya bak) |
| **Migration 021/022** | **Geri alınmaz** (aşağıya bak) |
| **Migration 025** | **Geri alınmaz**: `create or replace function` + grant. v136 kodu bu iki fonksiyonu hiç çağırmaz; durmaları zarar vermez |
| **Migration 026** | **Down migration'ı yok.** Tek yol §3'teki `pg_dump` (aşağıya bak) |
| **Migration 027** | **Down migration'ı yok** ama geri almayı **gerektirmez**: iki yeni tablo + bir fonksiyon, hiçbir mevcut nesneye dokunmaz. v136 imajında onları okuyan kod yok (§7.6) |

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

### 8.1 026/027'den sonra bir sorun çıkarsa — tek dönüş yolu yedek

026 **veri taşımaz**, yalnız politika metnini değiştirir; 027 iki tablo yaratır, veri
taşımaz. Bu yüzden geri dönüşün **en olası** biçimi yedek değil, imajın geri alınmasıdır
(§8 tablosu):

- **026 için**: v136 ve v137 imajlarının ikisi de 026'lı politikaların altında çalışır —
  `nullif` biçimi bağlı oturumlarda `current_setting(...)::uuid` ile **aynı**
  karşılaştırmadır, yani davranış değişmez. İmajı geri almak 026'yı **geri almaz**, almaya
  da gerek yoktur.
- **027 için**: v136 imajında `libedge_sessions` okuyan/yazan kod **yoktur** (§7.6). İki
  tablo boş durur; imajı geri almak 027'yi **geri almaz**, almaya da gerek yoktur. Tek
  istisna: SSO flag'i **açık** bırakılırsa v136 onu hiç okumaz (o değişkeni bilmez), yani
  yine zararsızdır.

**Ama topluca politika kaybı gibi bir arıza görülürse** (ör. §4.6a `26` yerine `0`
döndürüyor, uygulamada her sorgu `42501` veriyor, ya da `pg_policies` beklenmedik biçimde
azalmış):

> **026'nın down migration'ı yok. Geri dönüş, §3'te alınan `pg_dump`'tan tam geri
> yüklemedir. Başka bir yol yok.**

Gerekçesi: her politikayı eski `current_setting(...)::uuid` biçimine döndürmek 22P02'yi
**geri getirir** — yani "düzeltmeyi geri al" işlemi, çözdüğü hatayı yeniden üretir.
Yarım geri alma (birkaç politikayı geri çevirmek) iki biçimin karıştığı bir katalog
bırakır ve §4.6a'nın sayımı artık hiçbir şey kanıtlamaz. Bu yüzden geri alma **ya
tamamen yedekten**, ya hiç.

Prosedür:

```bash
cd /home/ubuntu/libedge-oracle-v136 && ls -l ~/backup-pre-v137-*.dump
```

**Tek dosya, MB mertebesinde.** §3'te alınmış olan dosyanın adını §9'a yaz.
Sonra (onay alındıktan sonra, tek satır):

```bash
cd /home/ubuntu/libedge-oracle-v136 && sudo docker exec -i libedge-oracle-v136-db pg_restore -U akademik -d akademik --clean --if-exists --no-owner -v < ~/backup-pre-v137-<TARİH>.dump
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
- `config/web-runtime.env` içine bu satırı **elle de ekleme** — ölçüm kolu prod'a `git pull`
  ile değil, ortam değişkeniyle sızar; tek koruma bu nottur. Canlı dizinde `git pull` zaten
  **yoktur** (§2); dosyayı değiştiren tek yol §6.1'deki `--env-file`'dır ve o dosya bu runbook'ta
  **değiştirilmez**.

## 9. Deploy kaydı

`docs/deployments/2026-10-??-v137.md` yalnız **gerçek çıktılarla** doldurulur:

- `/api/config` ve `/api/health` gövdeleri (birebir)
- `curl / | grep -o '/app.js?v=...'` çıktısı
- `R2 PASS` satırı
- `docker ps` satırları
- §4.0'ın `docker inspect … .Mounts` satırı (veri hangi volume/bind'de) ve `docker network ls` satırı
- §4.0a'nın **altı** satırı: `docker ps` (üç container + imaj adı), `network ls`,
  `.Mounts` (volume adı), port eşlemesi, `POSTGRES_DB`/`POSTGRES_USER`, ve
  `/home/ubuntu/libedge-oracle-v137/config/admin.env`'in varlığı + izni (`-rw------- root root`)
- §6.1'in `docker inspect` çıktıları (network/ports/restart/mounts, env **anahtar** listesi,
  cmd/entrypoint) — §8.0'ın dönüşü bunlara dayanır
- Saklanan eski container'ın adı (`$PREV_NAME` = `libedge-oracle-v136-web-prev-<ts>`) ve silindiği/zamanı
- §6.0'ın `$NEW_IMAGE` etiketi ve `$RELEASE_SHA` (§2.1'deki release klonunun SHA'sı)
- §4.0a'nın **ölçülen üçlüsü**: `$CONTAINER_PORT`, `$HOST_ADDR:$HOST_PORT`, `$TUNNEL_PORT`, `$LIVE_DOMAIN`
  (bunlar sabit değil; kayda **ölçülen değer** yazılır)
- §5.3'ün `sudo ls -l "$ADMIN_ENV"` satırı (`-rw------- root root`) + **anahtar sayımı** (`DATABASE_ADMIN_URL=1`, `DATABASE_CATALOG_URL=0`) ve §5.4'ün `web-catalog.env` sayımı (`DATABASE_CATALOG_URL=1`, `catalog role ok: 1`) — değer basılmaz
- §5.4b'nin çıktısı (`akademik_catalog|akademik_catalog` ve `f`)
- `uname -m` ve `docker inspect $NEW_IMAGE … .Architecture` (mimari eşleşmesi)
- `--status` çıktısı (§4.1 ve §4.4)
- §4.2'nin `would apply:` satırı (**altı** dosya) ve §4.2b'nin `cannot run` listesi (**yalnız 013–017**)
- §4.3'ün `6 migration(s) applied` satırı ve dosya başına `ms`
- §4.4b'nin **iki** satırı: §4.3 öncesi ve sonrası `select count(*), max(filename) from schema_migrations`
  (beklenen: önce `…|025-…sql`, sonra `…|027-reader-sso.sql`; satır sayısı `N` → `N+6`)
- §4.6'nın üç satırı: `plain_visible` sayısı, app rolünün gördüğü id listesi, owner'ın gördüğü liste
- §4.6a'nın **iki** satırı: politika sayımı (**`26`**) ve bağsız okuma (**`0`**, hata yok)
- §4.6e'nin satırları: `t&#124;t&#124;t&#124;1&#124;f&#124;t`, owner'ın `libedge_sessions` sayısı, app rolünün bağsız sayısı
- §7.6'nın `[sso]` log satırı — SSO **kapalıysa** bu açıkça yazılır ("SSO kapalı, 027 yapısal olarak doğrulandı")
- §7.4'ün `UPDATE 0` / `DELETE 0` satırları (ya da "global eser yok" notu)
- §7.1'in `/api/config` sürümü; `LIBEDGE_BRIDGE_MEASURE_RESET`'in **tanımlı olmadığının** teyidi

- Rollback imajı (`libedge-oracle-v136:96cc270-arm64`), saklanan eski container adı (`$PREV_NAME`) ve yeni imaj etiketi (`$NEW_IMAGE`)
- **§3 yedeğinin tam yolu ve zaman damgası** — 026/027'nin tek geri dönüş yolu bu (§8.1)
- **Ortam notu:** bu deploy Oracle sunucusunda (`92.5.157.233`) koştu; EC2 tarihseldir
  (`docs/deployments/2026-10-30-oracle-cutover.md`)

## 10. Yerel Docker'da kanıt — bu komutlar yazıldığı biçimde koşuldu

Bu bölüm 2026-10-31'de **yerel Docker 29.9.2 (linux/amd64)** üzerinde üretildi; **hiçbir
Oracle sunucusuna bağlanılmadı**. Ortam, Oracle'daki adlarla **taklit** edildi: ağ
`libedge-oracle-v136`, volume `libedge-oracle-v136-pgdata`, `libedge-oracle-v136-db`
(postgres:16-alpine, `db` ağ takma adıyla), `libedge-oracle-v136-web`
(port `127.0.0.1:3001 -> 3000`, healthcheck), katalog rolü `akademik_catalog` (NOLOGIN →
LOGIN), release dizini `…/libedge-oracle-v137/src`, `config/admin.env` +
`config/web-catalog.env` + `config/web-runtime.env`.

Test parolası bilinçli olarak **ayrıştırıcı karakterlerle** seçildi:
`p@ss:w/rd#X&Y%Z?a+b=c` (21 karakter). Hiçbir adımda parola/URL basılmadı; yalnız
**uzunluk**, **anahtar adı** ve **kimlik** ölçüldü.

### 10.1 `--env-file` düzeltmesi — eski komut boş parola üretiyordu

| Ne | Sonuç |
| --- | --- |
| Eski yazım: `-e DATABASE_ADMIN_URL="postgres://akademik:${POSTGRES_PASSWORD}@db:5432/akademik"` (`POSTGRES_PASSWORD` host'ta tanımsız) | `DATABASE_ADMIN_URL=postgres://akademik:@db:5432/akademik` — **sessizce boş parola** |
| Yeni yazım: `--env-file config/admin.env` | `proto=postgres: user=akademik host=db:5432 passLen=39` |
| Yeni yazım: `--env-file config/web-catalog.env` | `proto=postgres: user=akademik_catalog host=db:5432 passLen=39` |
| `encodeURIComponent` (§5.3a) | `encoded length: 39` (ham 21 → 39: `@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`, `&`→`%26`, `%`→`%25`, `?`→`%3F`, `+`→`%2B`, `=`→`%3D`) |

`28P01 password authentication failed` görüldüğünde sebep dosya biçimi değil, **parolanın
kendisiydi**; doğru parolayla aynı komut bağlandı — yani §5.4b'nin hata mesajı doğru teşhis ediyor.


### 10.2 Runner: `--status`, `grep -c`, `--dry-run`

`--network libedge-oracle-v136 … -w /repo/spike/app --env-file "$ADMIN_ENV" node:22-alpine sh -c 'npm ci … && node /repo/db/migrate.mjs --status'` çıktısı:

```
  connected as akademik (superuser)

  26 files, 0 applied, 26 pending
    pending  001-asset-pages.sql
    …
    pending  021-libedge-identity-and-subscriptions.sql
    pending  022-global-catalogue-boundary.sql
    pending  024-maintenance-tenants.sql
    pending  025-libedge-tenant-provisioning.sql
    pending  026-tenant-binding-nullif.sql
    pending  027-reader-sso.sql
```

| Komut | Çıktı |
| --- | --- |
| `--status \| grep -cE '^[[:space:]]+pending[[:space:]]+02[124567]-'` | **`6`** — §4.1'in beklenen sayısı |
| `--dry-run \| grep -E 'would apply'` | tek satır; içinde **`025-libedge-tenant-provisioning.sql`** ve **`027-reader-sso.sql`** var → §4.2b'nin "runner düzeltmesi yok" kontrolü çalışıyor |
| `--status` ilk satırı | `connected as akademik (superuser)` → `--env-file` gerçekten okundu (parola yokken `28P01` alınmıştı) |

> **Beklenen ama görülen fark:** yerel DB boş olduğu için 013–017 de `pending` ve
> `cannot run: manages its own transaction` notunu taşıyor. Bu **düzeltilmiş runner'ın doğru
> davranışıdır** — o dosyalar gerçekten `begin;`/`commit;` içeriyor. Canlıda bu satırlar
> `applied` olacağı için §4.1'deki `6` sayısı değişmez.

### 10.3 Katalog bağlantısı (§5.4b) — iki dosya yan yana

`works` tablosu yerelde yaratıldı, sahibi `akademik`, `akademik_catalog`'a yalnız `SELECT`
verildi (`information_schema.role_table_grants`: `akademik|DELETE…`, `akademik_catalog|SELECT`).

| Verilen dosya | Çıktı |
| --- | --- |
| `--env-file config/web-catalog.env` (§5.4b'nin **birebir** komutu) | `akademik_catalog\|akademik_catalog` ve **`f`** |
| `--env-file config/admin.env` (karşı kanıt, aynı SQL) | `akademik\|akademik` ve `t` |

Yani web'e verilen dosya **katalog rolüne** bağlanıyor ve **silmeye yetkisi yok**; admin
dosyası verilirse aynı sorgu `t` döner — bu yüzden §6.1 admin dosyasının verilmesini yasaklar.

### 10.4 `db` adı — `EAI_AGAIN` gerçekti

| Adım | Çıktı |
| --- | --- |
| `--env-file` + `--network libedge-oracle-v136`, alias **yok** | `failed: getaddrinfo EAI_AGAIN db` / `postgres code: EAI_AGAIN` |
| `docker inspect …-db` (alias yok) | `"DNSNames":["libedge-oracle-v136-db","<id>"]` — **`db` yok** |
| §4.0a'nın `network connect --alias db …` satırı | `"DNSNames":["libedge-oracle-v136-db","db","<id>"]`, `getent hosts db` → `172.21.0.3  db  db` |
| Aynı runner komutu, alias **var** | `connected as akademik (superuser)`, 26 dosya listelendi |


## 10. Kalan riskler (kabul edildi)

| Risk | Durum |
| --- | --- |
| v137'de **üç** kod değişikliği var — `maintenanceTenantIds()` (#43), **bağlı köprü** (`/api/libedge/v1`, token yoksa `503 BRIDGE_NOT_CONFIGURED`) ve flag'li okuyucu SSO (#50); 021/022/024/025/026/027 prod'da **ilk kez** koşuyor | İzole testte `021-022` 35/35, `024` 17/17, 025 62/62, 027 (SSO süiti + §4.6e'nin izole ölçümü), ama prod verisiyle ilk temas bu runbook. Ana risk bu |
| **Runner 025/027'yi sessizce atlıyordu** (#54) | Ret **hata değil**, atlama üretiyordu: `--dry-run` ve gerçek koşu ikisi de dosyayı listelemiyor, deploy "başarılı" görünüyor, köprü (`3F000`/`42883`) ve SSO çalışmıyor. Düzeltildi + kırmızı→yeşil regresyon (`db/migrate.test.mjs`). §4.1'in `6` sayısı ve §4.2b bunun sahada görünen yüzü |
| 025 `tenants`'a iki `SECURITY DEFINER` fonksiyonla yazma yetkisi veriyor | Dar tutuldu: yalnız `institution` kind, `id`/`slug` mevcut kayıtta dondurulmuş, EXECUTE yalnız `akademik_app`. Yine de `tenants_self`'in yanında ikinci bir yol; review'de ayrıca bakılmalı (§11.5) |
| 027 SSO oturumunu `libedge_sessions`'a bağlıyor, FORCE RLS ile | Politika `nullif` biçiminde (026'nın deseni); bağsız okuma 0 satır. İzole ölçüm: 2 satır varken bağsız `0`, bağlı `1`, komşu tenant `0` (§4.6e). Prod'da kanıt §7.6 |
| 027 audit tablosu kişisel veri tutuyor (IP) | 90 gün saklama `app.sso_auth_events_purge()` ile; app rolü `DELETE` **edemez** (§4.6e `f`). Token/e-posta/claim **yazılmıyor** |
| `akademik_catalog` parolası **`config/web-catalog.env`** içinde plaintext (§5.4) | Docker env dosyası; `R2_SECRET_ACCESS_KEY` de `web-runtime.env`'de plaintext. Dosya `0600 root`, `web-runtime.env`'e **gömülmez**, admin dosyasıyla **aynı parolayı** taşır (aynı rol değil, aynı parola) — bileşen düzeyinde ayrı sır yönetimi yok, bilinen sınır |
| §7.4 bugün anlamsız olabilir | Global eser 0 ise UPDATE edilecek satır yok; 023'ten sonra ölçülür |
| `/opds` hâlâ env tenant'ı | TODO §3 — bu sürümde **çözülmüyor** |

| 024 uygulanırsa ama imaj eski kalırsa | Zararsız: v136 kodu fonksiyonu hiç çağırmıyor. Ters yön (imaj yeni, 024 yok) de **kırılmıyor**: `3F000`/`42883` yakalanıp env tenant'a düşülür, her tick'te bir uyarı loglanır. Yine de §4 imajdan önce koşuyor |
| **026 geri alınamaz** (down migration yok) | Yalnız §3'teki `pg_dump` ile dönülür — ve o dönüş 021/022/024/025/026/027'yi de geri alır, yani imajın da v136'ya çekilmesi gerekir (§8.1). 026 politika metnini ~305 ms boyunca kilitler, veri taşımaz |
| **027 geri alınamaz** ama gerekmez | İki yeni tablo + bir fonksiyon; mevcut nesneye dokunmaz, v136 onları okumaz (§8). Yedekten dönüş yine de ikisini birden geri alır |
| 026 tek transaction'da 50 tablonun politikasını yeniden yazıyor | Migration ~305 ms sürdü (izole ölçüm). Bu süre boyunca `pg_policies` üzerinde kilit var; Migration imajdan **önce** koştuğu için (§1.5) o an yeni trafik yok. Süre uzarsa §4.3 `lock timeout` verebilir → **DUR**, aynı komut yeniden koşulur (026 idempotent değil: ikinci kez `0A000` verir, ama ilk koşu rollback olduysa kayıt da yoktur, yani yeniden koşmak **ilk** koşudur) |
| §4.6a'nın `26` sayısı | Yeni bir migration politika ekler ya da 023 gelirse sayı değişir. O zaman **bu runbook'un beklenen sayısı** güncellenir; sayıyı "yakın bir değere" gevşetmek ölçümü anlamsızlaştırır. (026 tek başına `25`, 027 `+1` → `26`; 2026-10-31 ölçümü) |
| `LIBEDGE_BRIDGE_MEASURE_RESET` yanlışlıkla tanımlanırsa | Prod'da reset kolu seçilir ve 026 yoksa her tenant-scoped istek 22P02 verir (§8.2). Bugün 026 var, yani kırılmaz — ama 026 geri alınırsa kırılır. Tanımlanmaz |

### 10.5 Geçiş ve geri dönüş (§6.1.2) — dört adım, gerçek Docker

`$CONTAINER_PORT/$HOST_ADDR/$HOST_PORT` §4.0a'nın **birebir** satırıyla ölçüldü:
`container=3000 host=127.0.0.1:3001`. `$NEW_IMAGE` = `libedge-oracle-v137:137-<sha>-amd64`.

| Adım | Çıktı |
| --- | --- |
| 1) `stop` + `rename` | `libedge-oracle-v136-web-prev-<ts>  node:22-alpine  Exited (137)`; eski adda **boş** |
| 2) `docker run` — **iki `--env-file`** | container `Up`, imaj `libedge-oracle-v137:137-<sha>-amd64` |
| 3) sağlık | `Up N seconds (healthy)`, `local=200`, `{"version":"137","buildSha":"…"}`, app logu `catalog=yes admin=no` |
| 3b) env anahtar sayımı | `admin keys: 0`, `catalog keys: 1` |
| 4) rollback (`rm -f` → `rename` → `start`) | `libedge-oracle-v136-web  node:22-alpine  Up 10 seconds (healthy)`, `local=200`, `{"version":"136","buildSha":"96cc270"}`, `-prev` kalmadı, `-db` **hâlâ `(healthy)`** (dokunulmadı) |

Yani **admin bağlantısı web'e hiç girmedi**, katalog bağlantısı girdi, geçiş ve geri dönüş
ayrı ayrı çalıştı. Aynı koşuda iki ek kırılganlık yakalandı ve düzeltildi: (a) §4.0a'nın port
değişkenleri **yeni kabukta** tanımsızdır (`docker: no port specified: ::<empty>`), (b)
here-string `<<<` `busybox sh`'de `syntax error: unexpected redirection` veriyor — bu yüzden
§1'in 1. kuralı `<<<`'i yasaklar ve §4.0a `<(…)` kullanır (`busybox sh` bunu **kabul ediyor**,
ölçüldü).

### 10.6 Kapsam dışı — yerelde ölçülemeyenler

Gerçek `spike/app` imajı build edilmedi (Dockerfile/R2/canlı env gerekir); web uygulaması
yerine **aynı port/health/env sözleşmesini** taşıyan küçük bir Node sunucusu kullanıldı;
migration'lar **canlı veriye uygulanmadı**; tünel ve domain yoktur. Bu adımların kanıtı
Oracle'da §7/§9'da toplanır.

## 11. Çalıştırmadan önce: inceleme

Bu runbook **Oracle'da çalıştırılmadı**; komutların çalıştığı **yerel Docker'da** kanıtlandı
(§10: runner `--status`/`--dry-run`, katalog bağlantısı, geçiş ve geri dönüş). Oracle'da
ilk koşudan önce **Claude'a inceletilecek**; özellikle şu noktalar:

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
   gerekçesiyle app rolüyle ölçülüyor. Ayrıca `--status` sayacının **6** dönmesi
   beklenir; `5` dönerse checkout 027'yi, `4` dönerse 027 **ve** 025'i içermiyor demektir
   (§4.2b).
5. **§4.6d** — 025'in grant'ı ve okuma yolu. `has_function_privilege` app rolünde
   `t|t` dönmeli; çözümleyici prod tenant'ı için **bir** satır vermeli. Bu adım
   kasıtlı olarak **yazmıyor** — `libedge_upsert_tenant()` prod tenant'ının gerçek
   `(kind, ref)`'iyle çağrılırsa `name`/`status`'u yazar.
6. **§4.6a** — 026'nın kanıtı. İki kontrol de **birlikte** geçmeli: sayım `26` ve
   bağsız okuma `0`/hata yok. Sayım tek başına yetmez (politika metni doğru olup
   davranış bozuk olabilir); bağsız okuma tek başına da yetmez (`0`, "global eser yok"
   demektir, hatanın yokluğunu ancak negatif kontrol kanıtlar — `db/026.test.mjs`).
   Sayı `26` çünkü 027 bir politika daha ekler: 026 tek başına `25`, `+1` → `26`
   (2026-10-31'de izole DB'de ölçüldü, tahmin değil).
7. **§4.6e + §7.6** — 027'nin kanıtı. Yapısal ölçüm (`t&#124;t&#124;t&#124;1&#124;f&#124;t`) tek başına yetmez:
   prod'da tablo boşken `0` dönmek hiçbir şey kanıtlamaz. Negatif kontrol izole bir DB'de
   yapıldı (2 satır; bağsız `0`, bağlı `1`, komşu tenant `0`); prod'daki davranış kanıtı
   §7.6'da **gerçek** bir SSO girişiyle aranır — ve yalnız `LIBEDGE_SSO_PUBLIC_KEYS`
   tanımlıysa anlamlıdır. Prod'a elle satır **yazılmaz**.
8. **§4.2b** — runner'ın 025/027'yi reddetmediği. Bu, deploy'un "sessiz" tek arıza
   biçimiydi: ret hata değil **atlama** üretiyordu. `cannot run` listesi **yalnız**
   `013`–`017` olmalı.
9. **§8.1** — 026/027 için **tek** dönüş yolu yedek. `pg_restore --clean --if-exists`
   komutunun prod'da neyi düşüreceği (021–027 dahil) ve yedeğin **imaj geri alma ile
   birlikte** yapılması gerektiği okunmalı.
10. **§4.0 + §4.0a + §6.1** — canlı ortam **Oracle**'dır (`92.5.157.233`); EC2
    (`i-0b0c3d5032408d855`) 2026-10-30'da **durduruldu** ve artık canlı değil. Container
    (`libedge-oracle-v136-web` / `-db` / `libedge-oracle-live-tunnel`), volume
    (`libedge-oracle-v136-pgdata`) ve ağ (`libedge-oracle-v136`) adları **her komutta**
    geçtiği için sunucudaki gerçek adlarla birebir eşleştiği `docker ps` / `docker inspect`
    çıktısıyla **doğrulanmalı**. Bu sunucuda **Compose yok**; `docker compose …` komutları
    çalışmaz. §6.1'in `docker inspect` çıktısı alınmadan web container'ı **yeniden
    yaratılmaz** ve eski container **silinmez** (§8.0 dönüşü ona dayanır).
11. **§4.0b** — ölçüm tabloyla uyuşmazsa **DUR** kuralı. Yanlış volume adıyla alınan yedek,
    026/027'nin tek dönüş yolunu geçersiz kılar.

> **Köprü v137'de bağlıdır** (eski bir not "bağlanmadı" diyordu; güncel kod aksini
> söylüyor). `server.mjs` içinde `BRIDGE_PREFIX = '/api/libedge/v1'` tanımlı, `isBridgePath()`
> isteği `runWithTenant`'ın **dışında** `handleBridgeRoute()`'a devrediyor, tenant'ı
> `libedge-bridge-db.mjs` tek transaction içinde bağlıyor. Prod'a bugün dönen cevap
> `503 BRIDGE_NOT_CONFIGURED`'dır: köprü token'ı tanımlı değil. Yani 025 **fonksiyonları
> sağlar**, uçları **açmaz** — uçları açmak `LIBEDGE_BRIDGE_*` değişkenlerini tanımlamak
> demektir ve bu runbook'un kapsamı **dışındadır** (§6.1). 025 uygulanmadan token
> tanımlanırsa köprü `42883` benzeri bir hatayla düşer; bu yüzden sıra: önce 025, sonra
> token.

> **Not (2026-10-31c):** İnceleme geri bildirimi uygulandı. Oracle ortamına göre yeniden
> yazılmış metin üzerinde düzeltilen **beş** nokta:
>
> 1. **Env anahtarı:** `CATALOG_DATABASE_URL` → **`DATABASE_CATALOG_URL`**. "v136/v137 kodu bu
>    anahtarı okumuyor" gerekçesi **kaldırıldı** — anahtar adı doğru olanla yazılır.
> 2. **Tek imaj etiketi:** §6.0 `$NEW_IMAGE`'ı **bir kez** üretir
>    (`libedge-oracle-v137:137-<sha>-<arch>`) ve hem `docker build -t` hem `docker run` bunu
>    kullanır. Container portu **tahmin edilmez**: §4.0a `$CONTAINER_PORT`/`$HOST_ADDR`/`$HOST_PORT`
>    değerlerini `docker inspect`'ten okur, §6.1.2 ve §7 `-p "$HOST_ADDR:$HOST_PORT:$CONTAINER_PORT"`
>    kullanır. Sabit `3001` kaldırıldı.
> 3. **Dizin ve parola kaynağı:** canlı dizin `/home/ubuntu/libedge-oracle-v136` **Git checkout
>    değildir** (§2'de `git fetch/checkout/pull` **yasak**). v137 kodu yeni **release dizinine**
>    klonlanır (§2.1). Sırlar üç ayrı **korumalı** dosyadadır (`0600 root`): `config/admin.env`
>    (yalnız `DATABASE_ADMIN_URL` → **yalnız runner'a**), `config/web-catalog.env` (yalnız
>    `DATABASE_CATALOG_URL` → **web'e verilir**; §5.4) ve runtime `config/web-runtime.env`.
>    Hiçbiri kabukta `source` edilmez; değerler URL'ye **percent-encode** edilerek girer.
> 4. **Geçiş sırası:** §6.1.2 = **durdur → sakla (`rename`) → yeniyle başlat → sağlık (healthcheck
>    + HTTP) → başarısızsa eskiyi geri aç**. DB container'ı ve tünel hiçbir adımda geçmez.
> 5. **"Eski isim" uyarısı:** uyarı yalnız **AWS/Compose kalıntılarına** daraltıldı; `libedge-oracle-v136`
>    ağı, `libedge-oracle-v136-pgdata` volume'ü ve container adları gerçek adlar olarak kapsam **dışına**
>    alındı. Canlı domain ve tünel portu **sabit yazılmaz**, §4.0a'da ölçülür (`$LIVE_DOMAIN`, `$TUNNEL_PORT`).
>
> **Bilinmeyen bırakılanlar:** web container'ının tam `docker run` argümanları, `config/web-runtime.env`
> içeriği, disk doluluğu, sunucu mimarisi, canlı domain ve tünel portu bu runbook yazılırken
> **ölçülmedi** (sunucuya bağlanılmadı). Tahminle doldurulmadı; §4.0a, §2.1 ve §6.1 operatöre
> **salt okunur** ölçtürüyor.
>
> **Prod'a dokunulmadı:** Oracle'a **bağlanılmadı**, deploy/migration koşulmadı, SSH
> kullanılmadı. Eski AWS kayıtları (v103–v136, `docs/DEPLOY.md`) **silinmedi**; tarihsel
> olarak işaretlendi.
>   olarak duruyor.
>
> **Not (2026-10-31):** Bu tarihte runbook **027** için genişletildi:
>
> - **Runner düzeltmesi (#54).** `db/migrate.mjs` 025 ve 027'yi "manages its own transaction
>   (end;)" diyerek **reddediyordu**; ret hata değil **atlama** üretiyordu. Ölçüm: düzeltmesiz
>   `main` (`c03442c`) `--status`'te iki dosyaya `cannot run`, düzeltmeyle temiz. Regresyon
>   `db/migrate.test.mjs` (red→yeşil), 14/14 geçiyor. Migration dosyaları ve
>   `schema_migrations` kayıtları **değişmedi** (git diff boş).
> - **Beklenen sayılar** 5/25/026'dan **6/26/027**'ye çekildi. Yeni: §4.0 (container/volume/
>   network), §4.2b (yanlış ret kontrolü), §4.6e (027'nin yapısal kanıtı), §7.6 (SSO davranış
>   kanıtı + flag kontrolü). §3 ve §8.1 volume/geri dönüş notlarıyla güncellendi.
> - **Ölçüldü, tahmin edilmedi:** boş bir `postgres:16-alpine` üzerine
>   `schema.sql` + 021/022/024/025/026/027 uygulandı. `nullif` politika sayısı **26**
>   (`public` toplamı 51); 027'nin blok çıktısı `t&#124;t&#124;t&#124;1&#124;f&#124;t`. RLS'in gerçekten kestiği
>   ayrıca kanıtlandı: 2 oturum satırı varken app rolü bağsız **0**, A tenant'ına bağlı **1**,
>   B'nin satırını A bağlamında **0** gördü.
> - **Prod'a dokunulmadı:** EC2'ye bağlanılmadı, migration/deploy koşulmadı, staging'deki
>   025/027 kayıtları ve checksum'lar **yeniden çalıştırılmadı / baseline edilmedi**.

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
 > **Not (2026-10-31): üçüncü tur düzeltmeleri — yerel Docker'da koşuldu.** (1) Runner'a
 > `-e DATABASE_ADMIN_URL="postgres://…:${POSTGRES_PASSWORD}@…"` yazımı **kaldırıldı**:
 > `sudo`/`env_reset` yüzünden parola host'ta tanımsızdır, değer boş genişliyordu (ölçüm:
 > `postgres://akademik:@db:5432/akademik`). Yerine `--env-file "$ADMIN_ENV"` — içinde **yalnız**
 > `DATABASE_ADMIN_URL`. (2) Katalog bağlantısı web'e **verilir**: yeni `config/web-catalog.env`
 > (`0600 root`, yalnız `DATABASE_CATALOG_URL`, rol `akademik_catalog`) ve §6.1 iki `--env-file`
 > kullanır; yasak olan **admin bağlantısının** web'e verilmesidir. Parolalar URL'ye yazılmadan
 > **percent-encode** edilir (§5.3a). (3) `libedge-oracle-v137-db` adı **yoktu** → `libedge-oracle-v136-db`;
 > `<(...)` **kalabilir** (`busybox sh` kabul ediyor, ölçüldü) ama `<<<` **kullanılmaz** (`syntax error`).
 > (4) Geçiş ve geri dönüş gerçek container'larla koşuldu (§10.5). Ayrıca yeni bulgu: `db` bir
 > **ağ takma adıdır** ve container adı farklı olduğu için kendiliğinden yoktur — §4.0a artık
 > `DNSNames` ölçüp `network connect --alias db …` ile düzeltiyor (`EAI_AGAIN db` birebir görüldü).




> Sözleşme: `docs/contracts/libedge-elibrary-v1.md` @ `b15f8b5`. İlgili: PR #40, `db/README.md`,
> `docs/DEPLOY.md` §"Migration'lar — imajdan ÖNCE".
