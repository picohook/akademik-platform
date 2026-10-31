# 2026-10-30 — Oracle canlıya alma devri (v136)

> **Bu kayıt, canlı ortamın hangisi olduğunun tek dayanağıdır.** Öncesindeki tüm
> kayıtlar (v103–v136, `docs/deployments/2026-10-28-v136.md` dahil) **AWS EC2**
> kurulumuna aittir ve **tarihsel**dir. Silinmediler; ama canlı ortamın güncel kanıtı
> olarak **kullanılmazlar**.

## 1. Sonuç

| Kontrol | Sonuç | Tarih |
| --- | --- | --- |
| V136 CUTOVER | **PASS** | 2026-10-30 |
| FINAL PARITY | **PASS** | 2026-10-30 |
| PUBLIC HEALTH | **PASS** | 2026-10-30 |
| Tarayıcı kontrolü | **Başarılı** | 2026-10-30 |
| AWS EC2 `i-0b0c3d5032408d855` | **Durduruldu** (stopped) | 2026-10-30 |

EC2 durduruldu; trafik artık Oracle sunucusundan Cloudflare Tunnel ile servis edilir.

## 2. Canlı Oracle ortamı

| Öğe | Değer |
| --- | --- |
| Host | `92.5.157.233` |
| Dizin | `/home/ubuntu/libedge-oracle-v136` |
| Web | `libedge-oracle-v136-web` |
| DB | `libedge-oracle-v136-db` |
| DB adı / sahibi | `akademik` / `akademik` |
| Ağ | `libedge-oracle-v136` |
| DB volume | `libedge-oracle-v136-pgdata` |
| Canlı imaj | `libedge-oracle-v136:96cc270-arm64` |
| Tunnel container | `libedge-oracle-live-tunnel` |
| Tünel host portu | **canlı ortamda ölçülür** — kayıtta sabit yazılmaz (runbook §4.0a `$TUNNEL_PORT`) |
| Canlı domain | **bu kayıtta sabitlenmedi** — runbook §4.0a `$LIVE_DOMAIN` ile ölçülür |
| Çalıştırma | `docker run` — **Compose kullanılmıyor** |
| Runtime env | `/home/ubuntu/libedge-oracle-v136/config/web-runtime.env` |

Bu değerler **ortam devri sırasında doğrulandı**. Her deploy'dan önce yine de salt okunur
`docker inspect` ile teyit edilir: `docs/runbooks/v137-deploy.md` §4.0a + §4.0b.

## 3. AWS'ten devralınanların karşılığı

| AWS (tarihsel) | Oracle (canlı) |
| --- | --- |
| `54.87.37.7`, `elibrary.libedge.com` (EC2) | `92.5.157.233` |
| `/home/ubuntu/akademik-platform` | `/home/ubuntu/libedge-oracle-v136` |
| `akademik-platform-prod-web-1` (`libedge-v136`) | `libedge-oracle-v136-web` (`libedge-oracle-v136:96cc270-arm64`) |
| `akademik-platform-prod-db-1` (`postgres:16-alpine`) | `libedge-oracle-v136-db` |
| `akademik-platform-prod_default` | `libedge-oracle-v136` |
| `akademik-platform-prod_pgdata` | `libedge-oracle-v136-pgdata` |
| `cloudflared` host servisi (`libedge-elibrary`) | `libedge-oracle-live-tunnel` container'ı |
| Compose (`docker-compose.prod.yml` + `docker-compose.libedge.yml`) | **Compose yok** — `docker run` |
| `.env.production` + `.env.r2` (repo kökü) | `config/web-runtime.env` (`--env-file`) |
| Sırların dağılımı (v137 runbook) | `config/admin.env` → yalnız `DATABASE_ADMIN_URL`, **yalnız migration runner'a**; `config/web-catalog.env` → yalnız `DATABASE_CATALOG_URL` (`akademik_catalog` rolü), **web container'ına**; ikisi de `0600 root`. Web'e **admin bağlantısı verilmez** (runbook §5.3/§5.4) |

## 4. Değişmeyenler

- Veritabanı adı ve sahibi: `akademik` / `akademik`; app rolü `akademik_app`.
- Migration geçmişi `schema_migrations` ile yönetilir; devir sırasında şema **001–020**
  düzeyinde (v137 runbook'u 021–027'yi bu ortamda uygulamak için yazıldı).
- Giriş noktası hâlâ Cloudflare Tunnel üzerinden; host'ta 80/443 dinleyen bir web sunucusu
  yok. Tünelin host portu ve canlı domain **bu kayıtta sabitlenmedi**: runbook §4.0a ölçer.

## 5. Doğrulanmayanlar (bilinçli olarak boş)

Aşağıdakiler bu kayıt yazılırken **ölçülmedi**; tahminle doldurulmadı:

- Web container'ının tam `docker run` argümanları (`--network`, `--restart`, port, mount,
  env-file). Ölçüm komutu: `docs/runbooks/v137-deploy.md` §6.1.
- `config/web-runtime.env` içeriği (yalnız dosyanın **yolu** biliniyor).
- Sunucu mimarisi (`uname -m`) ve disk doluluğu.
- Canlı domain adı ve tünelin host portu (runbook §4.0a'da `$LIVE_DOMAIN` / `$TUNNEL_PORT`).
- v137'nin build/run imaj etiketi ve release dizini (`$NEW_IMAGE`, §2.1) — deploy anında ölçülür.
- `libedge-oracle-v136-db`'nin `libedge-oracle-v136` ağında **`db` takma adı** taşıyıp
  taşımadığı — `@db:5432` bu ada bağlıdır; runbook §4.0a ölçer, yoksa takma adı ekler. (Yerelde
  takma ad yoktu ve runner `EAI_AGAIN db` verdi; runbook §10.4.)
- EC2 instance'ının kalıcı olarak mı yoksa geçici olarak mı durdurulduğu (silinmedi).

## 6. Yerel Docker kanıtı (2026-10-31)

Runbook'un düzeltilen komutları **Oracle'a bağlanmadan**, yerel Docker'da (29.9.2,
linux/amd64) aynı adlarla taklit edilerek koşuldu; ayrıntı ve çıktılar
`docs/runbooks/v137-deploy.md` **§10**. Kapsanan: `--env-file` ile runner `--status`
(6 pending) ve `--dry-run` (025 + 027 listede), web'in `akademik_catalog` rolüyle bağlanması
ve silmeye yetkisinin olmaması (`f`), admin bağlantısının web'e **girmediği**
(`admin keys: 0`), geçiş (`stop` → `rename` → `run` → health) ve geri dönüş (136,
`(healthy)`, db dokunulmadı). §5'teki ölçülmemiş maddeler boş bırakıldı: canlı domain,
tünel portu, gerçek `spike/app` imajı, prod verisi.
