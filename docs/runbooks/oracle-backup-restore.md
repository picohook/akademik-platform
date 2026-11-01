# Oracle production — otomatik yedek ve geri yükleme

Durum (2026-11-01): script'ler ve systemd birimleri **hazır, sunucuya kurulmadı**. Yerelde
sahte bir Postgres fixture'ına karşı uçtan uca denendi (yedek → age şifreleme → ayrı
Postgres'e restore; yanlış anahtar ve eksik veri doğru reddedildi). **Gerçek production
yedeği henüz alınmadı ve gerçek bir production yedeği henüz restore edilmedi**; kurulumdan
sonra §4'teki prova yapılana kadar yedek "doğrulanmış" sayılmaz.

Ortam değerleri: `docs/deployments/2026-11-01-libread-production.md`.

## 1. Ne yedeklenir, ne yedeklenmez

| Yedeklenir | Not |
| --- | --- |
| `akademik` DB (`pg_dump -Fc`) | Web durmadan, tutarlı anlık görüntü (MVCC) |
| Roller (`pg_dumpall --roles-only`) | Parola hash'i içerir |
| `data/uploads`, `data/ocr`, `seed` | `seed/sample.pdf` zorunludur (yoksa yedek başarısız olur). Dosyalar DB'den önce alınır ama bu **tutarlılık garantisi vermez** (§1 sınırı) |
| Üç env dosyasının dizinleri (`config/`, v137 `config/`, `releases/*/config`) | **Sır içerir** (token, private key) — yalnız şifreli arşivde |

Yedeklenmez: kitap içeriğinin kendisi (reader R2 `libedge-content` / `libedge`; R2 tek
başına DB yedeği değildir ve DB yedeği R2 içeriğini kapsamaz), Docker imajları, Research/D-022.
Her gece kitapları Oracle'a yeniden indiren bir iş yoktur.

Web durdurulmaz. **Tutarlılık sınırı:** DB dump tutarlı bir anlık görüntüdür, ama dosyalar web çalışırken tar'lanır; yedek sırasındaki eşzamanlı yükleme/silme dosya ile DB satırını uyumsuz bırakabilir (satırsız dosya, dosyası silinmiş satır, yarım dosya). Tam tutarlılık iddia edilmez; fixture testi production tutarlılığının kanıtı değildir. Yedek sırasında yazılan bir kayıt sonraki arşive girer; en kötü durumda
bir önceki günün yazmaları kaybolur (RPO ≈ 24 saat). Daha sıkısı gerekirse WAL arşivi ayrı bir iştir.

## 2. Tasarım kararları

- **Şifreleme: `age` + public key.** Sunucuda yalnız *public* anahtar durur. Private anahtar
  sunucuda ve yedeğin yanında **saklanmaz**; PC'de ve parola yöneticisinde ayrıca tutulur.
  Anahtar kaybedilirse yedekler okunamaz — bir kopyasını ayrı yerde sakla.
- **Aktarım doğrulaması:** yükleme sonrası boyut karşılaştırılır, ardından nesne R2'den geri indirilip SHA-256 yerel değerle eşleştirilir.
- **Sunucu dışı kopya: R2, ayrı bucket.** Yalnız bu bucket'a yazabilen bir API token'ı.
  7 günlük saklama yedek bucket'ında **lifecycle kuralı** ile yapılır. Object Read & Write
  yetkisi ve lifecycle kuralı silmeye veya üzerine yazmaya karşı koruma **kanıtlamaz**:
  sunucu ele geçirilirse token ile yedeklerin silinebileceği/bozulabileceği varsayılmalı.
  Böyle bir koruma (bucket kilidi, ayrı hesap vb.) kurulmadı.
- **Yerel saklama:** son 7 arşiv (`KEEP_LOCAL`). Hata varsa hiçbir şey silinmez.
- **Zamanlama: yalnız systemd timer.** Cron **kurulmaz**; ikisi birlikte çift yedek alır.
- **Hata görünürlüğü:** script `set -euo pipefail` ile ilk hatada **sıfırdan farklı kodla**
  çıkar; mesajlar journal'a gider; başarıda `$BACKUP_DIR/last-success` yazılır.
  Dış alarm yoktur — günlük bir kez §5'teki komutla bakılır (ya da sonradan bir uptime/cron
  izleyici eklenir; kapsam dışı bırakıldı).

## 3. Kurulum (sunucuda; her adım kullanıcı onayıyla)

SSH (kullanıcının bilgisayarında):

```powershell
ssh -i "$env:USERPROFILE\Downloads\ssh-key-2026-10-29.key" ubuntu@92.5.157.233
```

### 3.0 Salt okunur ön ölçüm — önce bunlar

```bash
sudo -n true && echo "sudo -n ok"                  # mevcut düzen: sudo -n docker; kullanıcı/grup değiştirilmez
sudo -n docker inspect -f '{{.State.Running}} {{.Config.Image}}' libedge-oracle-v136-db
sudo -n docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc \
  "select count(*), max(filename) from schema_migrations"      # beklenen: 27|027-reader-sso.sql
sudo -n docker exec libedge-oracle-v136-db psql -U akademik -d akademik -Atc \
  "select rolname, rolsuper from pg_roles where rolname='akademik'"   # roles dump superuser ister
df -h /home/ubuntu; du -sh /home/ubuntu/libedge-oracle-v136/data/uploads /home/ubuntu/libedge-oracle-v136/data/ocr
ls -ld /home/ubuntu/libedge-oracle-v137/config/production-integration
which age rclone
```

Bunlar doğrulanmadan kuruluma geçme. Özellikle: `docker exec ... psql -U akademik` parolasız
(yerel socket) çalışmalı — çalışmazsa **parolayı döndürme**; durup sonucu bildir.
`rolsuper` `f` ise `pg_dumpall --roles-only` başarısız olur; o durumda env'e
`BACKUP_ROLES_FLAGS=--no-role-passwords` konur (roller parolasız yedeklenir; parolalar
zaten korumalı config dosyalarında).

### 3.1 Araçlar ve anahtar

```bash
sudo apt-get install -y age rclone
```

Anahtar çifti **PC'de** üretilir (sunucuda değil):

```bash
age-keygen -o libread-backup.key        # çıktıdaki "Public key: age1..." değerini not et
# private key yalnız PC'de ve parola yöneticisinde; sunucuya, repoya veya yedeğin yanına konmaz
```

`libread-backup.key` dosyasını sunucuya kopyalama; parola yöneticisine ve çevrimdışı bir
yere koy.

### 3.2 R2 bucket ve token (Cloudflare panelinde, kullanıcı yapar)

1. Yeni bucket, örn. `libedge-backups` (reader içerik bucket'ı `libedge-content` **değil**).
2. Yalnız bu **yedek bucket'ına** (ve yalnız `oracle/` önekine) lifecycle: *Delete objects* after **7 days**. Reader içerik bucket'ına (`libedge-content`) lifecycle kuralı UYGULANMAZ.
3. API token: *Object Read & Write*, yalnız bu bucket. (Restore'u PC'den yapacağın için
   okuma da gerekir.)

### 3.3 Yapılandırma dosyası (sır — sohbete yapıştırma)

```bash
sudo -u ubuntu mkdir -p -m 700 /home/ubuntu/libedge-oracle-v137/config/backup
sudo -u ubuntu install -m 600 /dev/null /home/ubuntu/libedge-oracle-v137/config/backup/backup.env
nano /home/ubuntu/libedge-oracle-v137/config/backup/backup.env
```

İçerik (düz `KEY=value`, tırnak yok, shell ile `source` edilmez):

```text
BACKUP_AGE_RECIPIENT=age1...genel-anahtar...
BACKUP_RCLONE_REMOTE=r2backup:libedge-backups/oracle
RCLONE_CONFIG_R2BACKUP_TYPE=s3
RCLONE_CONFIG_R2BACKUP_PROVIDER=Cloudflare
RCLONE_CONFIG_R2BACKUP_ACCESS_KEY_ID=...
RCLONE_CONFIG_R2BACKUP_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_R2BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2BACKUP_ACL=private
RCLONE_CONFIG_R2BACKUP_NO_CHECK_BUCKET=true
```

`NO_CHECK_BUCKET` gerekir: bucket kapsamlı token bucket oluşturamaz, rclone ise yüklemeden
önce bunu dener ve `403 AccessDenied` alır (2026-11-01'de sunucuda ölçüldü). Config dizinlerinde
`root` sahipli `0600` dosyalar var (`web-release.env`, `admin.env`); script bunları
`sudo -n tar` ile okur, izinler değiştirilmez.

(`BACKUP_ROLES_FLAGS`, `KEEP_LOCAL`, `DB_CONTAINER` vb. gerekirse eklenir; varsayılanlar
script başındadır.)

### 3.4 Script ve birimler

Repo checkout'u sunucuda yok; dosyalar kopyalanır (PC'den):

```powershell
scp -i "$env:USERPROFILE\Downloads\ssh-key-2026-10-29.key" scripts\backup-oracle.sh infra\systemd\libread-backup.service infra\systemd\libread-backup.timer ubuntu@92.5.157.233:/tmp/
```

```bash
sudo install -d /usr/local/lib/libread-backup
sudo install -m 755 /tmp/backup-oracle.sh /usr/local/lib/libread-backup/backup-oracle.sh
sudo install -m 644 /tmp/libread-backup.service /tmp/libread-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### 3.5 İlk çalıştırma elle, sonra timer

```bash
sudo systemctl start libread-backup.service       # oneshot; bitene kadar bekler
systemctl status libread-backup.service --no-pager
journalctl -u libread-backup.service -n 40 --no-pager
ls -lh /home/ubuntu/libedge-backups/               # arşiv + .sha256 + last-success
```

Başarılıysa ve §4 restore provası geçtiyse:

```bash
sudo systemctl enable --now libread-backup.timer
systemctl list-timers libread-backup.timer --no-pager
```

Çalıştırmak canlı web'i durdurmaz ve DB'ye yalnız okuma yapar; ama disk ve I/O kullanır
(`Nice`/`IOSchedulingClass=idle`).

## 4. Restore provası — production'a dokunmadan

Prova PC'de yapılır (docker + age gerekir; `scripts/restore-test-oracle.sh` kendi Postgres
container'ını ve ağını açar, port yayınlamaz, production volume'ü bağlamaz, bitince siler).

1. Arşivi R2'den indir (PC'de rclone/`aws s3 cp` ile) — bu adım sunucu dışı kopyanın
   gerçekten okunabildiğini de kanıtlar. `.sha256` dosyasını yanına koy.
2. Çalıştır:

```bash
scripts/restore-test-oracle.sh libread-oracle-<damga>.tar.gz.age /güvenli/yol/libread-backup.key
```

Betik: sha256 → çözme → manifest → throwaway Postgres → roller → `pg_restore --exit-on-error`
→ kontroller (registry **27** / `027-reader-sso.sql`, 12 global eser, OA koleksiyonunda
12 üye, individual grant `collection`, individual için `all` grant yok, uygulama
rollerinde superuser/BYPASSRLS yok, arşivde zorunlu `seed/sample.pdf` ve üç env dosyası; boş `uploads/` tek başına hata sayılmaz, kitaplar R2'de olabilir). Son satır
`RESULT: PASS` olmalı; aksi halde çıkış kodu 1.

Kayıt: tarih, arşiv adı, boyut ve `RESULT` satırını `docs/deployments/2026-11-01-libread-production.md`
§5'e ekle. **Bu kayıt yapılana kadar yedek doğrulanmış sayılmaz.**

## 5. Günlük bakım

```bash
cat /home/ubuntu/libedge-backups/last-success     # 36 saatten eskiyse sorun var
systemctl status libread-backup.service libread-backup.timer --no-pager
```

Ayda bir restore provasını tekrarla; env dosyası, anahtar veya R2 token'ı değişince hemen.

## 6. Gerçek bir felaketten geri yükleme (özet)

Yeni bir DB container'ı + roller (`roles.sql`) + `pg_restore` + uploads/ocr + config
dosyalarını, **gerçek yeniden kurulum kararı verildikten sonra**, restore provasının
adımlarıyla aynı sırada yap; env dosyalarındaki üç dosya birlikte geri konur
(`docs/deployments/2026-11-01-libread-production.md` §2.1). Mevcut canlı DB'nin üzerine
yazma; ayrı container/dizine kur, doğrula, sonra geçişi planla. Parola döndürme veya
DB ağında `disconnect`/`connect` yapma.

## 7. Bilinen sınırlar

- Henüz gerçek production yedeği alınmadı; §3.0 varsayımları (parolasız socket, `rolsuper`,
  `sudo -n docker`) sunucuda doğrulanmadı.
- Dış başarısızlık alarmı yok (yalnız journal + `last-success`).
- Yedek uploads/ocr'ı çalışırken tar'ladığı için o anda yazılan tek bir dosya yarım
  olabilir; R2 asıl içerik kaynağıdır ve bir sonraki gün tam kopya alınır.
- RPO ≈ 24 saat.
