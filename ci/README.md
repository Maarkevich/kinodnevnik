# Конфигурация CI и деплоя

Файлы лежат здесь, а не в `.github/workflows/`, по одной прозаической причине:
токен, которым пушился этот коммит, не имеет scope `workflow`, и GitHub
отклоняет любой ref-update, создающий workflow-файлы.

Установить одной командой:

```bash
mkdir -p .github/workflows
cp ci/ci.yml ci/deploy.yml .github/workflows/
git add .github/workflows && git commit -m "ci: включить GitHub Actions и Pages-деплой"
```

После этого:

- **Settings → Pages** → Source: **GitHub Actions**
- `ci.yml` — типы приложения, типы `sw.ts` (отдельно, с WebWorker-либой),
  unit-тесты, прод-сборка и гейты `scripts/verify-build.mjs`
- `deploy.yml` — сборка и публикация `dist/kinodnevnik/browser` на Pages
  по пушу в `main`

`deploy.yml` требует `permissions: pages: write, id-token: write` — они уже
в файле.
