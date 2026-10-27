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
git checkout main
git pull --ff-only
git checkout -b <tür>/<kısa-ad>   # feat/, fix/, docs/, db/, test/
```

## Her işin sonunda

- Commit edilmemiş değişiklik bırakılmaz: `git status --short` boş.
- Push edilmemiş branch bırakılmaz: `git log --branches --not --remotes --oneline` boş.
- Stash bırakılmaz: `git stash list` boş.
- Kopyanın içine repo dışı çalışma klasörü (`*-fix/`, `hold/`, yedek kopya) bırakılmaz.

## PR kuralları

- Kimse `main`'e doğrudan commit veya push etmez. Her değişiklik PR ile girer; merge'ü Altan yapar.
- Bir PR tek iş taşır. Kod + migration + doküman aynı amaca hizmet ediyorsa birlikte olabilir.
- PR açıklaması: ne değişti, neden, hangi testler hangi sonuçla koştu, deploy etkisi.
- **Bağımlı PR'lar:** ilk PR `--delete-branch` olmadan merge edilir; ikinci PR merge edildikten sonra branch silinir. (Base branch silinince GitHub bağımlı PR'ı kapatır — #20 böyle kapandı.)
- Review tek kişide: aynı PR'ı iki AI paralel incelemez.

## Test kuralları

- `server.mjs`'e dokunan her PR'da şunlar birleşik kodda koşulur ve sonuç PR'a yazılır: `npm run test:security`, `npm run test:social-drm`, `npm run test:tenant-access`, `node --test test/*.test.mjs`.
- İzole sunucu testlerinin kopyalama listesi `test/helpers/server-files.mjs`'ten türetilir; elle liste yazılmaz.
- "Test geçti" denmeden önce test, hatayı yakaladığı bir negatif kontrolle gösterilir (geçici olarak boz → düşsün → geri al).

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