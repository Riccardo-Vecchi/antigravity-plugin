# Contributing

Install Node.js 22.13+ and run `npm ci --ignore-scripts`. The official Antigravity
app is required for manual integration checks, but not for unit or browser tests.

```sh
npm run build:viewers
npx playwright install --only-shell chromium
npm run check
python3 -m unittest discover -s tests -p 'test_*.py'
```

Use temporary browser profiles and fixture documents. Never commit account data,
local settings, transcripts, captures of personal content, or driver binaries.
Keep Linux and Windows adapters separate from shared code. Include regression
tests for changed behavior and describe any platform checks you could not run.

See [Development](docs/DEVELOPMENT.md) for architecture, lifecycle rules and
generated assets. Review [Privacy](docs/PRIVACY.md) before adding logging or data
access. This is an unofficial runtime companion, not an official Google plugin API.
