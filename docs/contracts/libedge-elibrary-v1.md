# LibEdge ↔ E-Kütüphane entegrasyon sözleşmesi — v1

Durum: **v1 — onaya sunuldu.** Tarih: 2026-10-28. Yazan: Claude. Onay: Altan (bekleniyor). İnceleme: ChatGPT (teknik içerik uygun bulundu, 4 tur).
Konum: `picohook/akademik-platform` → `docs/contracts/libedge-elibrary-v1.md`. `libedge-website` bu dosyaya bağlantı verir, kopyalamaz. Uygulama PR'ları bu dosyanın **commit SHA'sını** referans alır.
Değişiklik geçmişi: **Ek A** (v0.1→v0.2), **Ek B** (v0.2→v0.3), **Ek C** (v0.3→v0.4), **Ek D** (v0.4→v1).

> **Onaylanmamış kalanlar:** §1'deki iki hizmet politikası (12 saat SSO oturumu, 72 saat lease) ve §4.4'teki global eser listesi Altan'ın ayrı kararıdır; bu belgenin onayı onları otomatik onaylamaz. Liste kesinleşmeden migration 022'nin veri taşıma kısmı çalıştırılmaz. Bu belge bir sözleşmedir; çalışan kod veya canlıya geçiş onayı değildir.

Bu belge iki sistemin sınırını tanımlar. Bir geliştirici veya AI, sohbet geçmişi olmadan kendi tarafını bu belgeyle yazabilmelidir. Uygulama v1 onayına kadar §9'daki mock yanıtlara karşı yazılır.

---

## 0. Sistemler ve sahiplik

| Sistem | Repo | Çalışma yeri | Doğruluk kaynağı olduğu konu |
|---|---|---|---|
| **LibEdge** | `picohook/libedge-website` | Cloudflare Workers + D1 | Kim kimdir; üyelik; abonelik |
| **Okuyucu** | `picohook/akademik-platform` | AWS EC2 (Cloudflare Tunnel arkasında), Docker, PostgreSQL 16 + RLS | Katalog dosyaları; türetilmiş erişim; not/ilerleme |

Okuyucu kimlik, üyelik ve aboneliği üretmez, yalnız uygular. LibEdge okuma verisi tutmaz.

## 1. Temel kararlar

| # | Karar |
|---|---|
| K1 | Tek giriş: okuyucudan başlatılan, tarayıcıya bağlı (`state`), LibEdge'in imzaladığı kısa ömürlü handoff token (Ed25519). Ortak `.libedge.com` cookie yok. |
| K2 | Kimlik = LibEdge kullanıcı ID'si. Okuyucu bu ID için **kalıcı hesap durumu** tutar (§3.1). |
| K3 | Kurum → bir tenant. Bireysel müşteriler → tek `individual` tenant, kullanıcı bazlı grant. Personel → `staff` tenant. |
| K4 | Katalog içeriği ya global (`tenant_id IS NULL`) ya kurum içi. Globale alma: ilk taşıma onaylı listeyle migration; sonrası köprüdeki yetkili **"ortak katalogda yayımla"** işlemi (§5.6). Yanlış yayımlanan eser için ayrı **"yayından kaldır"** durumu, bütün okuma yollarında geçerli (§5.6). |
| K5 | Eşitleme: abonelik başına istenen durum + eşitleme kaydı + revision; abonelik kilidi; **sahip değişmez** (§5.4). |
| K6 | Erişim açma fail-closed. Erişim kapatmanın **sunucudaki yeni erişimler** için üst gecikme sınırı var (§6.3); çevrimdışı kopyalar geri alınmaz. |
| K7 | v1 kapsamı: koleksiyon ve tek eser. Yayıncı/konu kapsamı ve kurum içi kişiye özel atama v1 dışı. |

**Hizmet politikaları** (teknik zorunluluk değil; Altan onaylar; okuyucuda env ile ayarlanır):

| Politika | Değer (öneri) | Env |
|---|---|---|
| SSO oturumunun mutlak ömrü | 12 saat | `LIBEDGE_SSO_SESSION_HOURS` |
| Abonelik lease üst sınırı | 72 saat | `LIBEDGE_LEASE_MAX_HOURS` |

---

## 2. Kimlik ve tek giriş

### 2.1 Akış

1. Kullanıcı `https://elibrary.libedge.com/auth/libedge/start?ctx=<ipucu>` adresine gelir (doğrudan ya da libedge.com bağlantısıyla).
2. Okuyucu 256 bit rastgele `state` üretir ve cookie'ye yazar:
   `__Host-sso_state=<state>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300` — **`Domain` özniteliği yok** (`__Host-` öneki bunu zorunlu kılar).
   Ardından tarayıcıyı `https://libedge.com/elibrary/handoff?state_hash=<base64url(SHA-256(state))>&ctx=<ipucu>` adresine yönlendirir.
3. LibEdge'de oturum yoksa kullanıcı giriş yapar. Worker erişim bağlamlarını belirler (§2.4), gerekirse seçtirir, token üretir (`nonce` = gelen `state_hash`).
4. LibEdge tarayıcıyı `https://elibrary.libedge.com/auth/libedge/callback` adresine **POST form** (alan `token`) ile gönderir. Token URL'ye, loga, Referer'a girmez.
5. Okuyucu doğrular (§2.3). Başarıda `__Host-sso_state` silinir, okuyucu oturumu açılır.

### 2.2 Token

JWS compact, `alg: EdDSA`, başlıkta `kid` zorunlu.

| Claim | Tür | Zorunlu | Anlam |
|---|---|---|---|
| `iss` | string | ✓ | `https://libedge.com` |
| `aud` | string | ✓ | `https://elibrary.libedge.com` |
| `sub` | string | ✓ | LibEdge kullanıcı ID'si |
| `ctx` | string | ✓ | `institution` \| `individual` \| `staff` |
| `inst` | string | `ctx=institution` ise ✓, aksi halde **yok** | LibEdge kurum ID'si |
| `role` | string | ✓ | o bağlamdaki okuyucu rolü (§3.4) |
| `email` | string | ✓ | gösterim |
| `name`, `lang` | string | – | gösterim |
| `nonce` | string | ✓ | §2.1'deki `state_hash` |
| `iat`, `exp` | **tam sayı** (saniye) | ✓ | `exp > iat` ve `exp − iat ≤ 60` |
| `jti` | string | ✓ | rastgele ≥128 bit |

### 2.3 Doğrulama (sırayla; biri başarısızsa dur)

1. Başlık: `alg == "EdDSA"`, `kid` `LIBEDGE_SSO_PUBLIC_KEYS` içinde (en fazla 2 anahtar — döndürme). İmza doğru.
2. `iss`, `aud` birebir. Tabloda olmayan claim türü (ör. `exp` string) → ret.
3. `iat`, `exp` tam sayı; `exp > iat`; `exp − iat ≤ 60`; `iat ≤ now + 30`; `now ≤ exp + 30` (saat kayması toleransı 30 sn).
4. `nonce == base64url(SHA-256(__Host-sso_state))`.
5. **Kimlik kilidi:** `pg_advisory_xact_lock(hashtext('libedge-user:' || sub))` (§2.6).
6. Hesap durumu (§3.1): `libedge_accounts.status == 'disabled'` → ret (kullanıcı satırı hiç oluşmamış olsa bile).
7. Bağlam → tenant (§3.2); yoksa veya `status != 'active'` → ret. SSO tenant oluşturmaz.
8. Üyelik durumu: `libedge_memberships (tenant, sub)` `revoked` ise → ret (kullanıcı satırı olmasa bile).
9. `jti`: `insert into sso_consumed_jti (jti, expires_at) values ($1, to_timestamp(exp) + interval '30 seconds')`; birincil anahtar çakışması → ret.
10. Kullanıcı satırı (§3.3): yoksa oluştur; `disabled` ise ret.
11. Oturum aç (mutlak bitiş = şimdi + `LIBEDGE_SSO_SESSION_HOURS`).

Adım 5–11 **tek transaction**. Ret: kullanıcıya genel mesaj + "LibEdge'e dön". Sebep yalnız log ve audit'te (`sso.reject`, `reason`).

### 2.4 Bağlamlar

v1'de okuyucu oturumu tek bağlamlıdır; LibEdge seçtirir. Okuyucu başlıkta bağlamı gösterir ve **notların ve ilerlemenin bağlama göre ayrı tutulduğunu** açıkça yazar. "Bağlam değiştir" → `/auth/libedge/start`.

### 2.5 Oturum ömrü ve iptal

- SSO oturumu `LIBEDGE_SSO_SESSION_HOURS` sonunda biter; okuyucu kullanıcıyı `/auth/libedge/start`'a gönderir. LibEdge o anki üyelik ve aboneliği yeniden değerlendirir.
- **Tenant üyeliği:** `PUT /tenants/{kind}/{ref}/memberships/{uid}` gövde `{"revision": N, "status": "active" | "revoked"}`. `revoked` → `libedge_memberships` satırı yazılır (kullanıcı satırı yoksa da); kullanıcı satırı varsa o tenant'taki oturumları düşer. Diğer bağlamlar etkilenmez.
- **Hesap:** `PUT /accounts/{uid}` gövde `{"revision": N, "status": "active" | "disabled"}`. `disabled` → `libedge_accounts` yazılır (kullanıcı satırı hiç olmasa da); var olan tüm kullanıcı satırlarının oturumları düşer.
- Her iki işlem de **revision'lıdır** (abonelikteki kuralla aynı, §5.4 adım 4): büyük revision uygulanır; aynı revision + aynı durum → replay; aynı revision + farklı durum → `409 REVISION_CONFLICT`; küçük revision → `409 STALE_REVISION`. Böylece gecikmiş bir `active` (yeniden açma), daha yeni bir `revoked`/`disabled`'ı geri alamaz. LibEdge revision'ı hesap ve üyelik satırında tutar, her değişiklikte artırır.
- Yeniden açma yeni oturum açmaz; kullanıcı yeniden SSO yapar.
- Parola ile giriş yalnız `staff` tenant'ındaki acil durum yerel admin içindir.

### 2.6 SSO ile iptalin eşzamanlılığı

Aynı LibEdge kullanıcısı için SSO doğrulaması (§2.3), ön provizyon (§3.3), hesap/üyelik değişikliği (§2.5) ve kullanıcı-öznesi abonelik eşitlemesi (§5.4) **aynı kimlik kilidini** alır: `pg_advisory_xact_lock(hashtext('libedge-user:' || libedge_user_id))`. Sonuçlar:
- SSO iptalden önce kilidi aldıysa oturum açılır; iptal ardından kilidi alır ve o kullanıcının tüm ilgili oturumlarını düşürür (`session_version++`).
- İptal önce aldıysa SSO kilidi bekler, ardından `disabled`/`revoked` görür ve reddeder.
- Her iki sırada da iptal tamamlandıktan sonra **kullanılabilir oturum kalmaz** (kabul testi §11 #17).

---

## 3. Provizyon

### 3.1 Okuyucuda yeni kolon ve tablolar (migration 021)

```sql
-- hesap ve üyelik durumu: kullanıcı satırından bağımsız, LibEdge ID'sine bağlı
create table libedge_accounts (
  libedge_user_id text primary key,
  status text not null default 'active' check (status in ('active','disabled')),
  revision bigint not null,
  changed_at timestamptz not null default now()
);
create table libedge_memberships (
  tenant_id uuid not null references tenants(id),
  libedge_user_id text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  revision bigint not null,
  changed_at timestamptz not null default now(),
  primary key (tenant_id, libedge_user_id)
);
-- köprü idempotency kaydı (POST uçları; 24 saat saklanır)
create table bridge_idempotency (
  idem_key text primary key,
  endpoint text not null,
  request_sha256 text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table tenants add column libedge_kind text check (libedge_kind in ('institution','individual','staff'));
alter table tenants add column libedge_ref text;
create unique index tenants_libedge on tenants (libedge_kind, libedge_ref) where libedge_kind is not null;

alter table users add column libedge_user_id text;
alter table users add column status text not null default 'active' check (status in ('active','disabled'));
create unique index users_libedge on users (tenant_id, libedge_user_id) where libedge_user_id is not null;

create table libedge_subscription_sync (
  source_id        text primary key,             -- 'institution:123' | 'individual:456'
  tenant_id        uuid not null references tenants(id),
  subject_type     text not null check (subject_type in ('tenant','user')),
  subject_user_id  text,                          -- subject_type='user' ise LibEdge kullanıcı ID'si
  revision         bigint not null,
  payload_sha256   text not null,
  status           text not null check (status in ('active','suspended','cancelled')),
  lease_until      timestamptz,                  -- yalnız status='active' iken dolu (aşağıdaki check)
  applied_at       timestamptz not null default now(),
  request_summary  jsonb not null,
  check ((status = 'active') = (lease_until is not null))
);
alter table grants add column subscription_source_id text references libedge_subscription_sync(source_id);

create table sso_consumed_jti (jti text primary key, expires_at timestamptz not null);
```

`tenant_id`, `subject_type`, `subject_user_id` ilk kayıtta yazılır ve **bir daha değişmez** (§5.4). RLS ve rol yetkileri migration PR'ında; bu sözleşme alanları ve anlamlarını bağlar.

### 3.2 Tenant

| Bağlam | Okuyucu tenant'ı | Oluşturan |
|---|---|---|
| `institution`, `inst=42` | `libedge_kind='institution'`, `libedge_ref='42'` | köprü `PUT /tenants/institution/42` |
| `individual` | tek satır `libedge_kind='individual'`, `libedge_ref='b2c'` | migration |
| `staff` | mevcut `5799f2a5-…` → `libedge_kind='staff'`, `libedge_ref='libedge'` | migration |

`ctx=staff` token'ını LibEdge yalnız doğrulanmış personel yetkisine (bugün `super_admin`) verir.

### 3.3 Kullanıcı

- JIT: §2.3'teki **tüm kimlik, hesap, tenant ve üyelik kontrolleri** başarıyla tamamlanırsa ve `(tenant, libedge_user_id)` yoksa oluşturulur. `email`, `display_name` her girişte güncellenir.
- Ön provizyon (`PUT /tenants/{kind}/{ref}/users/{uid}`, gövde `{email, name}`) kimlik kilidiyle (§2.6) **aynı kontrolleri** yapar: hesap `disabled` veya üyelik `revoked` ise `409 ACCOUNT_DISABLED` / `409 MEMBERSHIP_REVOKED`, satır oluşmaz.
- `individual` tenant'ında erişim açan kullanıcı-grant'i (§5.4) kullanıcı satırını gerektirir. Abonelik eşitlemesi **kullanıcı oluşturmaz**: satır yoksa `404 USER_NOT_FOUND` döner. LibEdge sırayla önce ön provizyonu, sonra eşitlemeyi çağırır ve `USER_NOT_FOUND`'da bu sırayı tekrar dener.

### 3.4 Rol — bağlama göre

| Bağlam | Okuyucu rolü (v1) |
|---|---|
| `staff` | `admin` |
| `institution` | `reader` (kurum admini dahil; içerik yükleme ayrıca tasarlanacak) |
| `individual` | `reader` |

Okuyucu token'daki `role`'ü bu tabloyla doğrular; uymayan kombinasyon → ret.

---

## 4. İçerik görünürlüğü ve yetki

### 4.1 Model

RLS okumada `works`, `editions`, `assets`, `asset_pages`, `collections` için `tenant_id IS NULL OR tenant_id = app.tenant_id` uygular.

| İçerik | `tenant_id` | Satırı görür | Okur (grant) | Yazar |
|---|---|---|---|---|
| Global katalog | NULL | tüm tenant'lar | grant'i olan | köprü catalog yolu (§4.3) |
| Kurum içi | kurum | o kurum | o kurumun grant'i | v1'de kapalı (§3.4) |
| Global koleksiyon | NULL | tüm tenant'lar | koleksiyon grant'i olan | köprü catalog yolu |

**Görünürlük ≠ erişim.** Global içerik eklemek hiçbir kuruma erişim açmaz.

### 4.2 Erişim kuralları

- Erişim = kullanıcıya uygulanan **tüm etkin grant'lerin birleşimi**. Bir grant'in iptali, aynı eseri kapsayan diğer grant'i etkilemez.
- Koleksiyon grant'i **dinamik**: koleksiyona sonradan eklenen eser ek işlem olmadan erişime girer; çıkarılan çıkar.
- Bir grant **etkin**dir ⇔ `status='active'` ∧ `valid_from ≤ now` ∧ (`valid_to` boş ∨ `now < valid_to`) ∧ (abonelikten geliyorsa `now < libedge_subscription_sync.lease_until` ve sync `status='active'`).
- Bir eser **okunabilir**dir ⇔ en az bir etkin grant onu kapsıyor ∧ eser **yayından kaldırılmamış** (`works.withdrawn_at IS NULL`). Yayından kaldırma her grant'i (koleksiyon, tek eser, staff `all`) geçersiz kılar.
- Bu tanım **tek bir yerde** (okuyucudaki `activeGrants`) uygulanır ve **bütün erişim yolları** onu kullanır: katalog listesi, arama, eser ayrıntısı, dosya/Range okuma, indirme bileti verme **ve** kullanma, OPDS, OCR, kullanım raporu. Yeni bir erişim yolu bu fonksiyonu atlayamaz.
- Kullanıcı verisi (not, vurgu, ilerleme, indirme bileti, oturum) tenant **ve kullanıcı** kapsamındadır. Özellikle `individual` tenant'ında tüm bireysel müşteriler aynı tenant'ta olduğu için her okuma/yazma `user_id` ile sınırlanır; kabul testi §11 #13 bunu doğrular. Kullanıcı düzeyinde RLS (`app.user_id`) eklenmesi migration PR'ında **önerilir**; eklenmezse koruma uygulama katmanındadır ve test zorunludur.

### 4.3 Global yazma yetkisi

İki katman, ikisi de v1'de zorunlu:

1. **Uygulama katmanı:** köprüde iki ayrı token — `entitlements` ve `catalog`. Global yazan uçlar yalnız `catalog` token'ıyla. LibEdge, `catalog` token'ını yalnız personel işlemlerini çalıştıran Worker yolunda tutar ve çağırmadan önce aktörün `super_admin` olduğunu doğrular. Okuyucu aktörü audit'e yazar.
2. **Veritabanı katmanı:** ayrı, dar yetkili rol **`akademik_catalog`** (NOSUPERUSER, NOBYPASSRLS, kendi parolası, ayrı bağlantı havuzu). Yetkileri:
   - `tenant_id IS NULL` satırlarına insert/update/delete — yazma politikaları yalnız `current_user = 'akademik_catalog'` iken izin verir; `akademik_app` global satıra **yazamaz** (yalnız okur).
   - Tenant'a ait (staff dahil) satırlara **genel yazma yetkisi yok**. Yayımlama (§5.6) yalnız `catalog_publish_work(work_id uuid)` fonksiyonuyla yapılır: `SECURITY DEFINER`, `search_path` sabit, sahibi tablo sahibi, `EXECUTE` yalnız `akademik_catalog`'a. Fonksiyon eserin `staff` tenant'ında olduğunu doğrular ve yalnız o eserin `works`, `editions`, `assets`, `asset_pages` satırlarını `tenant_id = NULL` yapar; başka hiçbir şey yapmaz.
   - Yayından kaldırma/geri koyma (§5.6) yalnız global eserin `withdrawn_at` alanını değiştirir.
   Köprünün catalog yolu bu rolle bağlanır.

Bu ayrım uygulama hatalarına karşı veritabanı garantisi verir: normal uygulama yolundaki bir hata global katalogu değiştiremez. Aynı süreç iki kimlik bilgisini de tuttuğu için **sürecin ele geçirilmesine** karşı garanti değildir; bu sınır bilerek kabul edilmiştir.

Bugünkü durum (ölçüldü): RLS politikaları yalnız `using` içeriyor, yazma aynı koşula düşüyor; herhangi bir tenant bağlamı teoride global satır ekleyebilir. Uygulama kodu bunu bugün engelliyor (`updateBook` yazmaları `tenant_id = $tenant` koşulu taşıyor). `collection_items` tablosunda `tenant_id` ve RLS yok. İkisi de migration 022 ile kapanır.

### 4.4 İlk taşıma

Toplu varsayım yok. Altan global olacak eserlerin **listesini** (eser ID + başlık) onaylar; migration 022 yalnız o listeyi (works, editions, assets, asset_pages, ilgili koleksiyon ve öğeleri) `tenant_id = NULL`'a taşır. Notlar/ilerleme/oturumlar taşınmaz. Sonraki eserler için §5.6.

Migration 022 ayrıca `works` tablosuna `withdrawn_at timestamptz` ve `withdrawn_reason text` ekler (§5.6).

---

## 5. Köprü API'si — `/api/libedge/v1`

Kaynak taslak `origin/feat/elibrary-admin` (`17ef5eb`) olduğu gibi alınmaz; #21 tenant bağlamı üzerine yeniden yazılır, `grant-policy.mjs` atılır.

### 5.1 Genel kurallar

- `Authorization: Bearer <token>` — `entitlements` veya `catalog` (her biri için en fazla 2 geçerli değer). Yanlış tür → `403 TOKEN_SCOPE`.
- `X-LibEdge-Actor`: `user:<id>` veya `system:<job>`; health dışında zorunlu.
- `X-Request-Id`: LibEdge üretir; okuyucu loga ve yanıta yazar.
- Tenant yolda; başlıktan veya env'den varsayılan yok.
- `application/json; charset=utf-8`. Bilinmeyen alan → `400 INVALID_BODY`.
- Zaman ISO 8601 UTC (`Z`). ID'ler metin.
- Sayfalama: `?limit=` (1–100, varsayılan 50) + `?cursor=` (opak). Yanıt `{ "items": [...], "next_cursor": "…" | null }`.

### 5.2 Hata biçimi ve kodlar

```json
{ "error": "OWNER_MISMATCH", "detail": "source_id is bound to another tenant", "request_id": "…" }
```

| HTTP | `error` | Anlam |
|---|---|---|
| 400 | `INVALID_BODY` | şema dışı gövde, bilinmeyen/eksik alan |
| 401 | `UNAUTHORIZED` | token yok/yanlış |
| 403 | `TOKEN_SCOPE`, `ACTOR_REQUIRED` | |
| 404 | `TENANT_NOT_FOUND`, `USER_NOT_FOUND`, `WORK_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND` | |
| 409 | `REVISION_CONFLICT` | aynı revision, farklı içerik |
| 409 | `STALE_REVISION` | revision uygulanmış olandan küçük |
| 409 | `OWNER_MISMATCH` | `source_id` başka tenant/özneye bağlı |
| 409 | `TENANT_INACTIVE` | aktif olmayan tenant'a erişim açan istek |
| 409 | `ACCOUNT_DISABLED`, `MEMBERSHIP_REVOKED` | provizyon/kullanıcı-grant'i engellendi |
| 409 | `ALREADY_GLOBAL`, `NOT_IN_STAFF_TENANT` | yayımlama (§5.6) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | aynı `Idempotency-Key` farklı istek gövdesiyle |
| 422 | `UNKNOWN_SCOPE` | scope'taki eser/koleksiyon global katalogda yok |
| 422 | `SUBJECT_NOT_ALLOWED` | tenant türüyle uyumsuz özne |
| 422 | `LEASE_TOO_LONG` | `lease_until` > şimdi + `LIBEDGE_LEASE_MAX_HOURS` + 5 dk |
| 503 | `BRIDGE_NOT_CONFIGURED`, `DATABASE_UNAVAILABLE` | |

### 5.3 Uçlar

| Token | Yöntem ve yol | Amaç |
|---|---|---|
| — | `GET /health` | DB'ye gerçek sorgu; sürüm |
| entitlements | `PUT /tenants/{kind}/{ref}` | tenant oluştur/güncelle `{name, slug, status}` |
| entitlements | `GET /tenants/{kind}/{ref}` | tenant durumu |
| entitlements | `PUT /tenants/{kind}/{ref}/users/{uid}` | kullanıcı ön provizyonu `{email, name}` |
| entitlements | `PUT /tenants/{kind}/{ref}/memberships/{uid}` | tenant üyeliği `{revision, status}` (§2.5) |
| entitlements | `PUT /accounts/{uid}` | hesap `{revision, status}` (§2.5) |
| entitlements | `PUT /subscriptions/{source_id}` | erişim eşitlemesi (§5.4) |
| entitlements | `GET /subscriptions/{source_id}` | uygulanmış durum |
| entitlements | `GET /catalog`, `GET /catalog/works/{id}` | global katalog (§5.5) |
| entitlements | `GET /collections`, `GET /collections/{id}/works` | global koleksiyonlar |
| entitlements | `GET /tenants/{kind}/{ref}/usage?from=&to=` | kullanım özeti |
| catalog | `POST /catalog/works/{id}/publish` | staff tenant'ındaki eseri globale al (§5.6) |
| catalog | `PUT /catalog/works/{id}/availability` | yayından kaldır / geri koy `{"withdrawn": true\|false, "reason"}` (§5.6) |
| catalog | `PATCH /catalog/works/{id}` | global eser metadata |
| catalog | `POST /collections` | koleksiyon oluştur (`Idempotency-Key` zorunlu) |
| catalog | `PATCH /collections/{id}` | koleksiyon güncelle |
| catalog | `PUT /collections/{id}/works/{work_id}` | koleksiyona ekle (idempotent) |
| catalog | `DELETE /collections/{id}/works/{work_id}` | koleksiyondan çıkar (idempotent) |

### 5.4 Erişim eşitlemesi

`PUT /subscriptions/{source_id}`, `source_id` = `institution:<id>` veya `individual:<id>`.

İstek:

```json
{
  "revision": 7,
  "tenant": { "kind": "institution", "ref": "42" },
  "subject": { "type": "tenant" },
  "status": "active",
  "valid_from": "2026-11-01T00:00:00Z",
  "valid_to": "2027-10-31T23:59:59Z",
  "lease_until": "2026-11-04T00:00:00Z",
  "scopes": [
    { "type": "collection", "id": "74149e93-39dd-50ba-b120-a75415d9b0ca" },
    { "type": "title", "id": "f4797188-83fd-5737-8185-fb957cfaf77c" }
  ]
}
```

Bireysel: `"tenant": {"kind": "individual", "ref": "b2c"}`, `"subject": {"type": "user", "libedge_user_id": "456"}`.

Erişim kapatan istek (ör. silinmiş aboneliğin tombstone'undan):

```json
{
  "revision": 9,
  "tenant": { "kind": "institution", "ref": "42" },
  "subject": { "type": "tenant" },
  "status": "cancelled"
}
```

Zorunlu alanlar duruma göre:

| Alan | `status = active` | `status = suspended \| cancelled` |
|---|---|---|
| `revision`, `tenant`, `subject`, `status` | zorunlu | zorunlu |
| `valid_from`, `valid_to`, `lease_until`, `scopes` | zorunlu (`valid_to` boş olabilir, `scopes` boş liste olabilir) | **gönderilmez**; gelirse yok sayılır, doğrulanmaz |

Kurallar (yalnız `active`):
- `institution` tenant'ında yalnız `subject.type = "tenant"`; `individual` tenant'ında yalnız `"user"`. Aksi → `422 SUBJECT_NOT_ALLOWED`. (Bu tür kontrolü kapatan isteklerde de yapılır; yalnız biçim kontrolüdür, erişim kapatmayı başka bir sebeple engellemez.)
- `scopes[].type`: `collection` \| `title`. Boş liste geçerli (hiç erişim).
- `seat_limit` v1'de yok. Kullanıcı başına 3 eşzamanlı oturum kuralı ayrıdır.
- `lease_until`: `now < lease_until ≤ now + LIBEDGE_LEASE_MAX_HOURS + 5 dk`, aksi → `422 LEASE_TOO_LONG`.

Kapatan istekte tarih, lease ve scope kontrolleri **uygulanmaz**. `payload_sha256` her iki durumda da normalize edilmiş gövdeden (kapatan istekte yalnız dört zorunlu alan) hesaplanır.

İşlem — tek transaction:

1. `pg_advisory_xact_lock(hashtext('libedge-sub:' || source_id))`.
2. Normalize et (scope'lar sıralı, sabit alan sırası; **`lease_until` hariç**) → `payload_sha256`.
3. **Sahip kontrolü:** kayıt varsa `tenant`, `subject.type`, `subject.libedge_user_id` kayıttakiyle birebir olmalı; değilse `409 OWNER_MISMATCH`, değişiklik yok. Sahip değişikliği = eski `source_id`'yi `cancelled` + yeni `source_id`.
4. Revision kararı:

| Durum | Sonuç | Lease |
|---|---|---|
| kayıt yok | uygula, `201` | yaz |
| `revision > kayıtlı` | uygula, `200` | yaz |
| `revision == kayıtlı`, özet aynı | değişiklik yok, `200`, `"replayed": true` | `active` ise `lease_until = max(kayıtlı, gelen)` — **geri çekilmez**; kapatan istekte lease yok |
| `revision == kayıtlı`, özet farklı | `409 REVISION_CONFLICT` | değişmez |
| `revision < kayıtlı` | `409 STALE_REVISION` (+ `applied_revision`) | **değişmez** |

5. Uygula — iki ayrı yol:
   - **Erişim açan istek** (`status = active`): tenant aktif değilse `409 TENANT_INACTIVE`; `user` öznesinde kimlik kilidi (§2.6) alınır, kullanıcı satırı yoksa `404 USER_NOT_FOUND`, hesap/üyelik kapalıysa `409 ACCOUNT_DISABLED` / `MEMBERSHIP_REVOKED`; scope'lardan biri global katalogda yoksa `422 UNKNOWN_SCOPE`. Hepsi geçerse her scope için grant oluştur/güncelle (`subscription_source_id`, `source='subscription'`, `valid_from`, `valid_to`), istenende olmayanları `revoked`.
   - **Erişim kapatan istek** (`status = suspended | cancelled`): **hiçbir doğrulama erişim kapatmayı engellemez** — tenant aktif olmayabilir, kullanıcı kapalı ya da hiç oluşmamış olabilir, eski scope'lar artık katalogda olmayabilir. `scopes` yok sayılır; bu `source_id`'ye bağlı tüm grant'ler `suspended` → `pending`, `cancelled` → `revoked`. Kayıt yoksa (ilk istek iptal/askı) sync kaydı yine yazılır — `tenant_id` (tenant çözülemiyorsa istek `404 TENANT_NOT_FOUND`; bu durumda okuyucuda kapatılacak bir erişim de yoktur ve LibEdge işi `synced` sayar), `subject_type`, `subject_user_id`, `revision`, `payload_sha256`, `status`, `lease_until = NULL`, `request_summary` — ve grant oluşmaz. Böylece sahip bağlanır ve sonraki daha küçük revision'lı bir `active` reddedilir. Kayıt varsa sahip kontrolü (adım 3) geçerlidir. Bir `active` kayıt kapatılırken `lease_until` `NULL` yapılır; yeniden `active` olduğunda istekteki değer yazılır.
   Silme yok.
6. Sync kaydını yaz; `grant_audit`'e önce/sonra.

Yanıt (`200`/`201`):

```json
{
  "source_id": "institution:123",
  "applied_revision": 7,
  "replayed": false,
  "status": "active",
  "lease_until": "2026-11-04T00:00:00Z",
  "grants": [
    { "id": "…", "scope_type": "collection", "scope_id": "74149e93-…", "status": "active",
      "valid_from": "2026-11-01T00:00:00Z", "valid_to": "2027-10-31T23:59:59Z" }
  ],
  "request_id": "…"
}
```

LibEdge, bir aboneliği yalnız `applied_revision == güncel revision` iken `synced` sayar.

Durum geçişleri:

| LibEdge olayı | Gönderilen | Okuyucu |
|---|---|---|
| Oluştu / içerik değişti | yeni revision, tam scope listesi | ekle/güncelle/revoke |
| Süre değişti | yeni revision | grant'leri güncelle |
| Askıya alındı | `suspended` | grant'ler `pending` |
| İptal | `cancelled` | `revoked` |
| İptal geri alındı | yeni revision, `active` | aynı satırlar `active` |
| Silindi | `cancelled` (outbox, §6.2) | `revoked` |
| Sahip değişti | eski `cancelled` + yeni `source_id` | |

### 5.5 Katalog arama ve yanıt

`GET /catalog`

| Parametre | Anlam |
|---|---|
| `q` | başlık, alt başlık, yazar (`works.metadata.authors`), ISBN (`editions.isbn13`, tire ve boşluk yok sayılır), DOI (`editions.doi`) içinde arar; diakritik duyarsız |
| `language` | `tr` \| `en` \| … |
| `format` | `pdf` \| `epub` |
| `collection` | koleksiyon ID'si |
| `publisher` | tam eşleşme (büyük/küçük harf duyarsız) |
| `year_from`, `year_to` | yayın yılı aralığı |
| `limit`, `cursor` | sayfalama |

Sıralama: `q` varsa ilgililik, yoksa başlık. Yalnız global eserler döner.

Örnek (alan biçimini gösterir; değerler temsilîdir, veritabanından alınmamıştır):

```json
{
  "items": [
    {
      "work_id": "…",
      "title": "Dive into Deep Learning",
      "subtitle": null,
      "authors": ["Aston Zhang", "Zachary C. Lipton", "Mu Li", "Alexander J. Smola"],
      "language": "en",
      "subjects": ["machine learning"],
      "variant_group": "d2l",
      "cover_url": null,
      "collections": ["74149e93-…"],
      "editions": [
        {
          "edition_id": "…", "publisher": "Cambridge University Press", "publication_year": 2023,
          "edition": null, "isbn13": "9781009389433", "doi": null,
          "assets": [ { "asset_id": "…", "format": "pdf", "page_count": 574 } ]
        }
      ]
    }
  ],
  "next_cursor": null
}
```

`GET /collections` → `{ "items": [ { "id", "title", "slug", "description", "work_count" } ], "next_cursor" }`.

Koleksiyon yazma:

| İstek | Gövde | Yanıt |
|---|---|---|
| `POST /collections` (+ `Idempotency-Key`) | `{ "title", "slug", "description" }` | `201` `{ "id", "title", "slug", "description", "work_count": 0 }`; aynı anahtarla tekrar → aynı yanıt `200` |
| `PATCH /collections/{id}` | `title` / `description` (en az biri) | `200` koleksiyon nesnesi |
| `PUT /collections/{id}/works/{work_id}` | `{ "position": 3 }` (opsiyonel) | `200` `{ "collection_id", "work_id", "position", "added": true|false }` |
| `DELETE /collections/{id}/works/{work_id}` | — | `200` `{ "collection_id", "work_id", "removed": true|false }` |

Yalnız global eser global koleksiyona eklenebilir; aksi → `422 UNKNOWN_SCOPE`.

### 5.6 Ortak katalogda yayımla

**Yayımla** — `POST /catalog/works/{id}/publish` (catalog token, `Idempotency-Key` zorunlu).
- `akademik_catalog` rolüyle `catalog_publish_work(id)` çağrılır (§4.3). Eserin `works`, `editions`, `assets`, `asset_pages` satırları `tenant_id = NULL`. Not/ilerleme taşınmaz. Yanıt `200` + §5.5 eser nesnesi.
- Idempotency (`bridge_idempotency`): aynı anahtar + aynı istek → **önceki yanıt aynen** döner (eser artık global olsa da `ALREADY_GLOBAL` dönmez); aynı anahtar + farklı istek → `409 IDEMPOTENCY_KEY_REUSED`; **yeni** anahtarla zaten global eser → `409 ALREADY_GLOBAL`; staff tenant'ında olmayan eser → `409 NOT_IN_STAFF_TENANT`. Anahtar 24 saat saklanır. Bu kural tüm `POST` uçları için geçerlidir.
- Globalden staff tenant'ına geri taşıma v1'de yok.

**Yayından kaldır / geri koy** — `PUT /catalog/works/{id}/availability` `{"withdrawn": true, "reason": "yanlış yayımlama"}` (catalog token, idempotent).
- `works.withdrawn_at = now()` (veya `NULL`), `withdrawn_reason`. Audit'e aktör ile.
- Yayından kaldırılan eser **bütün okuma yollarında** okunamaz (§4.2): katalog, arama, eser ayrıntısı, dosya/Range, indirme bileti verme ve kullanma, OPDS, OCR. Bu, onu kapsayan **tek eser grant'leri dahil** her grant'i geçersiz kılar; grant satırları değişmez, geri koyunca erişim kendiliğinden döner.
- **Koleksiyondan çıkarma ayrı işlemdir:** yalnız koleksiyon grant'i üzerinden gelen erişimi etkiler; tek eser grant'i erişim vermeye devam eder. Yanlış yayımlanan bir eseri acil kapatmanın yolu koleksiyondan çıkarmak değil, yayından kaldırmaktır.
- Daha önce indirilmiş/çevrimdışı kopyalar geri alınmaz (K6).

İş akışı: personel eseri okuyucunun mevcut yükleme/içe aktarma yoluyla `staff` tenant'ına yükler (v134'ten beri EPUB'lar filigran ön kontrolünden geçer) → LibEdge Admin'den "Ortak katalogda yayımla" → koleksiyona ekle.

---

## 6. Eşitleme, hata ve iptal

### 6.1 Erişim açma — fail-closed
Bilinmeyen tenant/scope, şema dışı gövde, revision çakışması, sahip uyuşmazlığı, aktif olmayan tenant, kapalı hesap/üyelik → yazma yok, açık hata kodu.

### 6.2 LibEdge: kalıcı eşitleme işi (outbox)
- Abonelik her değiştiğinde (oluşturma, düzenleme, iptal, **silme**) aynı D1 batch'inde: abonelikte `elibrary_revision += 1` ve `elibrary_sync_jobs` satırı (`source_id`, `status=pending`, `attempts`, `next_attempt_at`, `last_error`).
- **Tutarlı kaynak kuralı:** gönderilecek **revision, sahip (tenant + özne) ve içerik aynı tutarlı kayıttan, tek okumayla** alınır — aboneliğin güncel satırından. İş satırındaki eski bir revision hiçbir zaman güncel içerikle birlikte gönderilmez. Aynı `source_id` için bekleyen birden fazla iş **tek işte birleşir**: işleyici her zaman güncel revision'ı gönderir, eski işler bununla kapanır.
- **Fiziksel silme:** abonelik satırı silinirken aynı batch'te `elibrary_subscription_tombstones` satırı yazılır: `source_id`, `last_revision` (silmeyle artırılmış), sahip (tenant kind/ref, özne), `status = cancelled`. İşleyici silinmiş abonelik için gövdeyi bu satırdan üretir. Tombstone kalıcıdır (en az okuyucudaki sync kaydı kadar).
- **Geri alma:** silinmiş ya da iptal edilmiş bir abonelik geri getirilirse yeni revision, kayıtlı son revision'dan (abonelik veya tombstone) **büyük** olmalıdır; aynı `source_id` ve aynı sahip kullanılır.
- Hesap ve üyelik değişiklikleri (§2.5) aynı outbox ve aynı tutarlı kaynak kuralıyla gönderilir.
- Yanıta göre: `applied_revision == revision` → `synced`; `STALE_REVISION` → iş kapanır; `REVISION_CONFLICT` / `OWNER_MISMATCH` → `failed`, insan müdahalesi; ağ/5xx → üstel bekleme.
- Admin abonelik formu ve listesi durumu gösterir: "E-Kütüphane'ye işlendi (rev 7)" / "Bekliyor" / "İşlenemedi: <kod> — Yeniden dene". İşlenmemiş erişim Admin'de verilmiş gibi gösterilmez.

### 6.3 Erişim kapatma — üst gecikme sınırları

Bu sınırlar **sunucudan yapılacak yeni erişimler** içindir (katalog, okuma, arama, indirme bileti, OPDS). Daha önce indirilmiş dosyalar ve tarayıcıdaki çevrimdışı kopyalar **geri alınmaz**; filigran ve audit kaydı bu kopyaların izini sağlar.

| Olay | Kapanma garantisi | Mekanizma |
|---|---|---|
| Üyelik bitti / hesap kapandı | ≤ `LIBEDGE_SSO_SESSION_HOURS` | oturum ömrü; yeni handoff verilmez; köprü ulaşırsa anında |
| Abonelik iptal / askı / içerik çıkarma | ≤ `lease_until` | etkin grant tanımı (§4.2) |

Lease yenileme:
- LibEdge mutabakat işi her **aktif** aboneliği günde en az bir kez, **güncel durumdan üretilmiş** gövde ve güncel revision ile gönderir.
- Okuyucu: aynı revision + aynı özet → replay, lease **yalnız ileri** alınır; eski revision lease'i **yenileyemez**; üst sınırı aşan lease reddedilir.
- Bedel: LibEdge eşitlemesi `LIBEDGE_LEASE_MAX_HOURS`'tan uzun durursa abonelik erişimleri kapanır. İzleme zorunlu: `lease_until`'e 24 saatten az kalan aktif abonelik sayısı > 0 → alarm.
- `staff` tenant'ının `all` grant'i (020) abonelikten gelmez, lease'e tabi değildir.

### 6.4 Kurum silme
Önce tüm abonelikler `cancelled`, sonra `PUT /tenants/institution/{id} {"status":"inactive"}`. Okuyucu tenant'ı ve okuma verisini silmez; saklama süresi KVKK kararıdır (§10).

---

## 7. Güvenlik ön koşulları

1. **Trafik yolu — ölçüldü (2026-10-28, Claude oturumunda Altan'ın sunucu ve Cloudflare paneli çıktılarıyla; bağımsız inceleme bu ölçümü ayrıca doğrulamadı):** `cloudflared` aktif (Zero Trust tünel `libedge-elibrary`, token tabanlı); dış trafik tünelden `127.0.0.1:3001`'e. Host nginx kullanılmıyordu (`proxy_pass http://localhost:3000`, servis yok, dışarıdan 502) → kapatıldı. AWS güvenlik grubunda 80/443 gelen kuralları kaldırıldı; yalnız SSH 22 açık. Origin'de ek TLS gerekmiyor; Cloudflare↔EC2 trafiği tünelde şifreli.
2. TODO §3 bitmeli: `download-tickets` ve `/opds` oturum tenant'ı; zamanlayıcılar tüm tenant'lar; ayrıca `server.mjs` yazar güncellemesi (`updateBook`, `metadata.authors`) hâlâ env `TENANT_ID` kullanıyor — oturum tenant'ına çevrilmeli.
3. Anahtarlar: SSO özel anahtarı yalnız Worker secret; açık anahtarlar okuyucu env; `entitlements` ve `catalog` token'ları ve `akademik_catalog` parolası secret. Git'e veya tarayıcıya asla.
4. Hız sınırı: `/auth/libedge/*` IP başına; köprü toplamda.
5. Audit: `sso.login`, `sso.reject` (+sebep), her köprü yazması (aktör, request_id, önce/sonra).

## 8. Sıra ve sahiplik

| # | İş | Repo | Sahip | Bağımlı |
|---|---|---|---|---|
| 1 | Sözleşme v1 onayı | — | Altan (ChatGPT inceleme) | — |
| 2 | ~~Trafik yolu ölçümü~~ — yapıldı (§7.1) | altyapı | — | — |
| 3 | TODO §3 (+ `updateBook` authors) | akademik-platform | Cline | — |
| 4 | Global olacak eser listesi (§4.4) | — | Altan | — |
| 5 | Migration 021 + 022 (`akademik_catalog` rolü, yazma politikaları, `collection_items` tenant) | akademik-platform | Cline | 1, 4 |
| 6 | Köprü v1 | akademik-platform | Cline | 3, 5 |
| 7 | SSO (`/auth/libedge/*`) | akademik-platform | Cline | 5 |
| 8 | Abonelik formu içerik seçicisi + eşitleme durumu + outbox | libedge-website | Harness | 1 (mock), 6 |
| 9 | Handoff ucu + bağlam seçimi | libedge-website | Harness | 1, 7 |
| 10 | Kabul testi (§11) | ikisi | Altan | hepsi |

Harness köprü çağrılarını tek modülde (`bridge-client`) toplar ve §5 yanıtlarına karşı mock döner.

## 9. Mock sözleşmesi
§5.2 hata biçimi, §5.4 ve §5.5 istek/yanıtları v1'e kadar mock kaynağıdır. Alan adları ve türler birebir; ek alan yok. Belge değişirse mock aynı PR'da güncellenir.

## 10. Açık kararlar (Altan)

| # | Konu | Öneri |
|---|---|---|
| 1 | Tek bağlamlı oturum | kabul |
| 2 | `ctx=staff`, yalnız `super_admin` | kabul |
| 3 | Kurum admininin okuyucu rolü | `reader` |
| 4 | Koltuk sınırı | v1'de yok |
| 5 | Lease üst sınırı (hizmet politikası) | 72 saat + alarm |
| 6 | SSO oturum ömrü (hizmet politikası) | 12 saat |
| 7 | İlk taşımada global olacak eser listesi | Altan belirler |
| 8 | Kullanıcı düzeyinde RLS (`individual` tenant) | önerilir; eklenmezse test zorunlu |
| 9 | Kurum silinince okuma verisi saklama süresi | hukuki görüşe göre |

## 11. Kabul testi senaryoları (asgari)
1. Kurum A'ya koleksiyon aboneliği → A kullanıcısı okur; B kullanıcısı göremez/okuyamaz.
2. Koleksiyona eser eklenir → A'da ek işlem olmadan görünür.
3. Aynı eser hem koleksiyon hem tek eser grant'inde; tek eser grant'i iptal → erişim sürer.
4. Bireysel abonelik + aynı kişi kurum üyesi → iki bağlam ayrı; kurum üyeliği `revoke` → bireysel sürer.
5. Aynı revision iki kez → `replayed`; aynı revision farklı içerik → `409 REVISION_CONFLICT`.
6. İki eşzamanlı PUT → sırayla; sonuç tutarlı.
7. `source_id` başka tenant/özneyle → `409 OWNER_MISMATCH`.
8. Köprü kapalıyken iptal → işleyici açılınca uygulanır; açılmazsa `lease_until`'de kapanır.
9. Eski revision ile gelen istek lease'i uzatmaz; replay lease'i geri çekmez; üst sınırı aşan lease → 422.
10. Lease dolmuş abonelikte: katalog, dosya Range, arama, indirme bileti **verme ve kullanma**, OPDS — hepsi reddeder.
11. Abonelik silinir → iptal outbox'tan, güncel durumdan üretilmiş gövdeyle gider.
12. Kapatılmış hesap, daha önce üretilmiş token'la **yeni bir bağlamda** → ret, kullanıcı satırı oluşmaz.
13. **İki B2C kullanıcısı** (aynı `individual` tenant) birbirinin notunu, vurgusunu, ilerlemesini, indirme biletini, oturumunu ve kullanım kaydını **okuyamaz ve değiştiremez**.
14. Başkasının token'ıyla callback (`state` uyuşmaz) → ret. Aynı token iki kez → ikincisi ret. `exp − iat > 60` veya `exp` string → ret.
15. `individual` + `admin` rolü → ret.
16. `akademik_app` rolüyle global satıra yazma → veritabanı reddeder; `akademik_catalog` ile staff satırına doğrudan yazma → reddeder (yalnız `catalog_publish_work`).
17. **Eşzamanlı SSO + hesap kapatma / üyelik iptali** (her iki sıra): iptal tamamlandıktan sonra kullanılabilir oturum kalmaz.
18. Gecikmiş `active` (rev 4), daha yeni `disabled`/`revoked` (rev 5) uygulandıktan sonra gelir → `409 STALE_REVISION`, hesap kapalı kalır.
19. Abonelik eşitlemesi, kullanıcı satırı yokken erişim açmak ister → `404 USER_NOT_FOUND`, kullanıcı oluşmaz; ön provizyon sonrası tekrar → başarılı.
20. İptal (`cancelled`), kullanıcı kapalıyken / tenant pasifken / scope katalogdan silinmişken → başarılı, grant'ler `revoked`. Gövdede yalnız `revision`, `tenant`, `subject`, `status` var (tarih/lease/scope yok) → kabul edilir.
25. İlk istek `cancelled` (hiç `active` olmamış abonelik) → sync kaydı `lease_until = NULL` ile yazılır, grant oluşmaz; sonra daha küçük revision'lı `active` → `409 STALE_REVISION`.
21. Abonelik rev 7 için iş oluştu, işleyici çalışmadan rev 8 oldu → gönderilen istek rev 8 + rev 8 içeriği; rev 7 + rev 8 içeriği **hiç** gönderilmez.
22. Silinen abonelik → tombstone'dan `cancelled`; geri alma → tombstone revision'ından büyük revision.
23. Yayından kaldırılan eser: tek eser grant'i olan kullanıcı dahil, katalog/dosya/arama/indirme bileti/OPDS'te okunamaz; geri koyunca erişim döner. Koleksiyondan çıkarma ise tek eser grant'ini etkilemez.
24. `publish` aynı anahtarla tekrar → önceki yanıt; aynı anahtar farklı gövde → `409 IDEMPOTENCY_KEY_REUSED`; yeni anahtarla zaten global → `409 ALREADY_GLOBAL`.

---

## Ek A — v0.1 → v0.2
Kurum üyeliği/hesap iptali ayrıldı; `source_id` türle önekli; abonelik eşitleme kaydı; abonelik kilidi ve replay/409; açma fail-closed, kapatma üst sınırlı; D1 outbox; 13 eser toplu değil listeyle; `catalog` token; koleksiyon yazma uçları; v1 kapsamı koleksiyon + tek eser; SSO okuyucudan başlar (`state`, `nonce`, POST); `jti` toleransla; rol bağlama göre; trafik yolu "ölçülecek"; hata kodları, sayfalama, JSON örnekleri.

## Ek B — v0.2 → v0.3 (ChatGPT ikinci inceleme)

| Konu | v0.3 |
|---|---|
| Kapatılmış hesap yeni bağlamda JIT ile kullanıcı oluşturabiliyordu | `libedge_accounts` ve `libedge_memberships`: kullanıcı satırından bağımsız; SSO ve ön provizyon kontrol eder; yeniden açma uçları (§2.5, §3.1, §3.3) |
| Abonelik sahibi değişebiliyordu | `tenant`/özne ilk kayıtta sabit; aksi `409 OWNER_MISMATCH`; sahip değişikliği = iptal + yeni `source_id` (§5.4) |
| Lease kuralları gevşek | Üst sınır (`422 LEASE_TOO_LONG`); replay geri çekmez; eski revision yenileyemez; yenileme güncel durumdan; tüm erişim yollarında tek `activeGrants` (§4.2, §5.4, §6.3) |
| Çevrimdışı kopyalar | Kapanma garantisi yalnız sunucudaki yeni erişimler için; indirilmiş/çevrimdışı kopya geri alınmaz (K6, §6.3) |
| `app.catalog_write` bayrağı DB garantisi değildi | Ayrı `akademik_catalog` rolü + rol bazlı yazma politikası; süreç ele geçirilmesine karşı garanti olmadığı açıkça yazıldı (§4.3) |
| B2C aynı tenant içi ayrım | Kullanıcı düzeyi kapsam zorunlu; kabul testi #13; kullanıcı düzeyinde RLS önerisi (§4.2, §10) |
| Arama alanları eksikti | Başlık/yazar/ISBN/DOI araması, filtreler, tam yanıt; koleksiyon yazma istek/yanıtları (§5.5) |
| Her yeni eser için migration | `POST /catalog/works/{id}/publish` (§5.6) |
| SSO claim türleri | `iat`/`exp` tam sayı, `exp > iat`, `exp − iat ≤ 60`; `__Host-` cookie `Path=/`, `Domain` yok (§2.1–2.3) |
| 12/72 saat | Hizmet politikası, env ile ayarlanır (§1) |
| Trafik yolu | Ölçüldü: Cloudflare Tunnel; nginx kapatıldı; 80/443 kapandı (§7.1) |
| Yeni bulgu | `updateBook` yazar güncellemesi env `TENANT_ID` kullanıyor → TODO §3 (§7.2) |

## Ek C — v0.3 → v0.4 (ChatGPT üçüncü inceleme)

| Konu | v0.4 |
|---|---|
| B2C eşitlemesi kullanıcıyı `email`/`name` olmadan oluşturacaktı | Eşitleme kullanıcı oluşturmaz → `404 USER_NOT_FOUND`; LibEdge önce ön provizyon, sonra eşitleme (§3.3, §5.4) |
| Outbox güncel içeriği eski revision ile gönderebilirdi | Revision + sahip + içerik tek tutarlı okumadan; bekleyen işler birleşir; silmede tombstone; geri alma daha büyük revision (§6.2) |
| Hesap/üyelik işlemlerinde sıra yoktu | `PUT /accounts/{uid}` ve `PUT …/memberships/{uid}` revision'lı; gecikmiş `active` yeni iptali geri açamaz (§2.5) |
| SSO ile iptal yarışı | Ortak kimlik kilidi (`libedge-user:<id>`); her iki sırada iptal sonrası oturum kalmaz (§2.3, §2.6) |
| `akademik_catalog` staff satırını nasıl globale alacak belirsizdi | Yalnız `catalog_publish_work` `SECURITY DEFINER` fonksiyonu; staff satırlarına genel yazma yok (§4.3) |
| "Koleksiyondan çıkarınca hiçbir grant'te kalmaz" yanlıştı | Ayrı **yayından kaldır** durumu (`withdrawn_at`), tüm okuma yollarında ve tüm grant'lerde geçerli; koleksiyondan çıkarma ayrı işlem (§4.2, §5.6) |
| İptal doğrulamalar yüzünden engellenebilirdi | Erişim kapatan istekler tenant/kullanıcı/scope doğrulamasından muaf (§5.4) |
| `publish` tekrarı `ALREADY_GLOBAL` ile çelişiyordu | `bridge_idempotency`: aynı anahtar = önceki yanıt; farklı gövde = `IDEMPOTENCY_KEY_REUSED` (§5.6) |
| §7.1 ölçüm kaynağı | Claude/Altan ölçümü olarak işaretlendi; bağımsız doğrulanmadı |
| Kabul testleri | #17–#24 eklendi |

## Ek D — v0.4 → v1 (ChatGPT dördüncü inceleme)

| Konu | v1 |
|---|---|
| Kapatan istek de `lease_until` ve tarihleri zorunlu tutuyordu; tombstone'da tarih yok | Duruma göre zorunlu alan tablosu: kapatan istekte yalnız `revision`, `tenant`, `subject`, `status`; tarih/lease/scope kontrolü yok (§5.4) |
| İlk istek iptal olduğunda sync kaydı tablo kısıtıyla uyumsuzdu | `lease_until` yalnız `active`'de dolu (`check`); ilk iptal kaydı sahibi bağlar, grant oluşmaz (§3.1, §5.4) |
| JIT açıklamasında eski adım numaraları | "§2.3'teki tüm kimlik, hesap, tenant ve üyelik kontrolleri" (§3.3) |
| Onay kapsamı | Hizmet politikaları ve global eser listesi bu belgenin onayıyla onaylanmış sayılmaz (başlık notu) |
| Kabul testleri | #20 genişletildi, #25 eklendi |
