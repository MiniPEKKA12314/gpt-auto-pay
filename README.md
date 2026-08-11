# gpt-auto-pay

ChatGPT recharge automation platform with a public redeem page, an admin console, checkout-link creation, card pool management, billing profiles, proxy pools, queue processing, and the legacy CTF-pay direct-card runner.

## Requirements

- Node.js 24 recommended
- Python 3.10+
- Playwright Chromium for browser based payment flows
- Chrome or Chromium on servers that run headed browser flows through Xvfb
- Optional local proxy such as Clash on `127.0.0.1:7890`

The repository does not bundle Python virtualenvs, browsers, Clash, Xvfb, Nginx, certificates, or other system-level dependencies.

## Setup

```powershell
py -3 -m pip install -r requirements.txt
py -3 -m playwright install chromium
```

On Ubuntu, use the matching `python3` commands and install the system packages required by Chromium/Xvfb.

## Platform UI

Start the platform server:

```powershell
node platform_dev_server.mjs
```

Default local URLs:

```text
Public redeem page: http://127.0.0.1:8877/
Admin console:       http://127.0.0.1:8877/admin
Health check:        http://127.0.0.1:8877/health
```

Important environment variables:

```text
HOST=127.0.0.1
PORT=8877
PLATFORM_DB_PATH=output/platform-dev.db
PLATFORM_ADMIN_PASSWORD=change-this-password
PLATFORM_ADMIN_TOKEN=change-this-token
PLATFORM_AUTO_WORKER=1
PLATFORM_QUEUE_INTERVAL_MS=1000
PLATFORM_SEED_DEV_CODES=0
APP_SECRET_KEY=change-this-long-secret
```

The platform stores runtime state in SQLite. Keep `PLATFORM_DB_PATH` outside git-tracked files in production.
Set `PLATFORM_SEED_DEV_CODES=0` for public deployments so the local demo redeem codes are not created.

## Production Domains

The intended production split is:

```text
https://redeem.ayuekp.store/     -> public redeem page
https://minipekka.ayuekp.store/  -> admin console
```

Both domains can reverse proxy to the same local Node service on `127.0.0.1:8877`. The admin domain should serve `/admin` at its root and pass `/api/admin/*` to the backend.

## Legacy Checkout Tool

The original checkout/debug UI is still available:

```powershell
node checkout_ph_dry_run.mjs --ui --ui-port 8787
```

Open:

```text
http://127.0.0.1:8787/
```

By default the UI assumes a local proxy listener at `127.0.0.1:7890`. Disable it in the UI when running on a server or when no local proxy is needed. Optional checkout and direct-card outbound proxies can be entered as one proxy per line using `https://` or `socks5://` URLs.

## Checkout Template

No HAR import is required for normal use. The script contains an embedded checkout request template and uses it by default.

Use `--har` only when the embedded template needs to be replaced:

```powershell
node checkout_ph_dry_run.mjs --har data_new.har --ui --ui-port 8787
```

HAR files, capture data, logs, zip archives, tokens, local databases, and runtime output are intentionally ignored by git.

## Tests

```powershell
node --test checkout_ph_dry_run.test.mjs
node --test test/platform/*.mjs
py -3 -m py_compile card-related/CTF-pay/card.py card-related/CTF-pay/card/_monolith.py
```
