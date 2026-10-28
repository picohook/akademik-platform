# Çalışma düzeni — birden fazla AI ve iki çalışma kopyası

Bu repo üzerinde birden fazla AI oturumu çalışıyor. Altan karar verir ve merge eder; AI'lar branch + PR ile çalışır. Bu kurallar iki kopyanın birbirini bozmasını önlemek içindir.

## Çalışma kopyaları

| Kopya | Sahibi |
| --- | --- |
| `C:\Users\OWNER\Documents\GitHub\libedge-website\dist\akademik-platform` | Ana AI oturumu (doküman, migration, deploy kayıtları) |
| `C:\Users\OWNER\Documents\deepseek-harness\default-workspace\akademik-platform` | DeepSeek Harness |
| EC2 `/var/www/akademik-platform` | Sunucu — yalnız `git pull --ff-only`, asla commit/push |

Bir AI başka bir AI'ın kopyasında çalışmaz. Kısa iş (README, tek dosya) gerekiyorsa o an boşta olan kopya kullanılır; meşgul kopyada branch değiştirilmez.

## Her işin başında

```bash
git status --short          # boş olmalı; değilse dur ve sor
git fetch origin
git checkout -b <tür>/<kısa-ad> origin/main   # feat/, fix/, docs/, db/, test/
```

Branch **güncel `origin/main`'den** açılır; yerel `main`'in geride kalması PR'ı
main'in işini geri alıyormuş gibi gösterir (bkz. PR kuralları — üç noktalı diff).

## Her işin sonunda

- Commit edilmemiş değişiklik bırakılmaz: `git status --short` boş.
- Push edilmemiş branch bırakılmaz: `git log --branches --not --remotes --oneline` boş.
- Stash bırakılmaz: `git stash list` boş.
- Kopyanın içine repo dışı çalışma klasörü (`*-fix/`, `hold/`, yedek kopya) bırakılmaz.

## PR kuralları

- Kimse `main`'e doğrudan commit veya push etmez. Her değişiklik PR ile girer; merge'ü Altan yapar.
- Bir PR tek iş taşır. Kod + migration + doküman aynı amaca hizmet ediyorsa birlikte olabilir.
- PR açıklaması: ne değişti, neden, hangi testler hangi sonuçla koştu, deploy etkisi.
- **Üst üste (stacked) PR yok.** Her PR güncel `origin/main`'den açılır:
  `git fetch origin && git checkout -b <tür>/<kısa-ad> origin/main`. Bir PR diğerine
  bağımlıysa, ilki merge edilene kadar ikincisi **açılmaz** ya da **draft** kalır.
  Böylece her PR tek başına incelenebilir, tek başına merge edilebilir ve base branch
  silindiğinde hiçbir PR kapanmaz.
- **PR içeriği üç noktalı diff ile kontrol edilir:** `git diff origin/main...HEAD --stat`.
  İki noktalı (`git diff origin/main HEAD`) diff **yanıltıcıdır**: branch'e main'den
  merge edilmemişse, main'de zaten olan değişiklikleri bu PR yapmış gibi gösterir ve
  PR'ın onları geri aldığını gizler.
  > Bu kural ölçülerek konuldu (2026-10-28): `feat/migrations-021-022` branch'i #38'in
  > öncesinden dallanmıştı. `git merge-tree origin/main HEAD` **temizdi** — metinsel
  > çakışma yoktu — ama PR diff'i #38'in 66 satırlık testini silinmiş gösteriyordu.
  > Merge edilseydi #38 sessizce geri giderdi. Çakışmasızlık, güncellik demek değildir.
  > Bu yüzden merge/push öncesi `git merge-base --is-ancestor origin/main HEAD`
  > **0** dönmelidir.
- **Bağımlı PR'lar:** ilk PR `--delete-branch` olmadan merge edilir; ikinci PR merge edildikten sonra branch silinir. (Base branch silinince GitHub bağımlı PR'ı kapatır — #20 böyle kapandı.)
- Review tek kişide: aynı PR'ı iki AI paralel incelemez.
- Her PR açıklamasında sözleşme referansı: `docs/contracts/libedge-elibrary-v1.md`, commit `b15f8b5`.

## Test kuralları

- `server.mjs`'e dokunan her PR'da şunlar birleşik kodda koşulur ve sonuç PR'a yazılır: `npm run test:security`, `npm run test:social-drm`, `npm run test:tenant-access`, `node --test test/*.test.mjs`.
- İzole sunucu testlerinin kopyalama listesi `test/helpers/server-files.mjs`'ten türetilir; elle liste yazılmaz.
- "Test geçti" denmeden önce test, hatayı yakaladığı bir negatif kontrolle gösterilir (geçici olarak boz → düşsün → geri al).
- **Güvenlik ve migration PR'larında saldırılar negatif kontrol olarak koşulur.** Testin
  varlığı yetmez: korumanın kaldırıldığı bir mutasyonla **her saldırı kendi hata
  mesajıyla** düşmelidir. Mutasyon satır bazlı ve girintiye bağımsız olmalı; regex ile
  yapılan sessiz başarısız mutasyon "geçti" sonucu üretir.
  > Ölçülerek konuldu (2026-10-28, PR #40): dört RLS saldırısının her biri ayrı bir
  > mutasyonla düşürüldü. `FOR ALL using (true)` geri konduğunda süit önce **okuma**
  > assertion'ında düştüğü için UPDATE/DELETE saldırılarını maskeliyordu — bu yüzden
  > her delik **tek politikayla** ayrı ayrı bozulur.
- Kısıtlayıcı politikanın gizlediği satır **hata değil 0 satır** üretir: saldırı
  testleri hata beklemek yerine `rowCount`/dönen satır sayısını ölçer. `42501`
  bekleyen bir test, sızıntıyı "geçti" sayardı.

## Migration kuralları

- Migration'lar yalnız `db/migrate.mjs` ile uygulanır (`db/README.md`). Elle `psql -f` yok.
- Migration dosyasında `begin`/`commit` ve psql meta-komutu (`\set` vb.) olmaz; dosya idempotent veya koşullu yazılır.

## Deploy kuralları

- Deploy prosedürü yalnız `docs/DEPLOY.md`. Ezberden deploy yapılmaz.
- Önce yedek (`pg_dump`), sonra migration'lar, sonra image; image adı `.env.r2` → `LIBEDGE_IMAGE`.
- `sudo` ortam değişkenlerini siler: `LIBEDGE_IMAGE=... sudo docker compose` çalışmaz.
- Her deploy `docs/deployments/<tarih>-v<NNN>.md` ile kaydedilir; değerler gerçek sunucu çıktısından yazılır, tahmin edilmez.

## Açık işler

`docs/TODO.md`. Bir madde bitince oradan çıkarılır.