# gpt-auto-pay

Local checkout runner with a browser UI and CTF-pay direct-card helper.

## Requirements

- Windows with PowerShell
- Node.js 24 recommended
- Python 3.10+
- Chrome or Microsoft Edge
- Optional local HTTP proxy on `127.0.0.1:7890`

The repository does not bundle Python virtualenvs, browsers, Clash, or other system-level dependencies.

## Setup

```powershell
py -3 -m pip install -r requirements.txt
py -3 -m playwright install chromium
```

## Run The UI

```powershell
node checkout_ph_dry_run.mjs --ui --ui-port 8787
```

Open:

```text
http://127.0.0.1:8787/
```

By default the UI assumes a local proxy listener at `127.0.0.1:7890`. Disable it in the UI when running on a server or when no local proxy is needed. Optional checkout and direct-card outbound proxies can be entered in the UI as one proxy per line using `https://` or `socks5://` URLs.

## Checkout Template

No HAR import is required for normal use. The script contains an embedded checkout request template and uses it by default.

Use `--har` only when the embedded template needs to be replaced:

```powershell
node checkout_ph_dry_run.mjs --har data_new.har --ui --ui-port 8787
```

HAR files, capture data, logs, zip archives, tokens, and local runtime output are intentionally ignored by git.

## Tests

```powershell
node --test checkout_ph_dry_run.test.mjs
py -3 -m py_compile card-related/CTF-pay/card.py card-related/CTF-pay/card/_monolith.py
```
