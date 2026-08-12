# ApiVault CLI

A command-line client for an ApiVault instance. Manage your encrypted
API keys from the terminal — connect by approving in your browser, then list,
add, reveal, update, and delete keys, or inject secrets into a local process.

The CLI talks to a **running** ApiVault website over HTTP. It does **not** touch
the database directly.

## Requirements

- Node.js 18.17 or newer
- A reachable ApiVault server

## Install

From this directory:

```bash
npm install
npm run build          # outputs dist/cli.js
npm install -g .       # exposes the global `apivault` command
```

For development without a global install:

```bash
npm run dev -- keys list        # runs via tsx, no build step
```

## Connect (sign in)

Sign-in happens in your browser, not the terminal:

```bash
apivault login
```

This opens your browser to an **Approve / Refuse** page.

- **If you're already signed into ApiVault** in that browser, you'll see the
  connect prompt immediately — choose **Approve** to issue a token to this CLI.
- **If you're not signed in**, you'll be redirected to log in first, then sent
  back to the approve page automatically.

The CLI waits in the terminal (press **Ctrl+C** to cancel). Once you Approve, it
saves a personal API token and is signed in for all later commands. Override the
wait with `--timeout <seconds>` (default 300).

```bash
apivault whoami      # confirm you're connected
apivault logout      # revoke this device's token
```

Local data is stored under `~/.apivault/` (`%USERPROFILE%\.apivault\` on Windows):

| File | Purpose |
|------|---------|
| `token.json` | Auth token from `login` (removed by `logout`) |
| `config.json` | CLI defaults for `run` and optional stored vault key |

> The server URL is compiled into the CLI (not user-configurable). The default
> points at the production instance; change the `API_BASE_URL` constant in
> `src/config.ts` and rebuild for local development.

## Manage keys

```bash
apivault keys list                 # all keys, masked
apivault keys add                  # interactive: name, service, env, value, notes
apivault keys get <id>             # show one key (masked)
apivault keys get <id> --reveal    # decrypt and print the raw value
apivault keys update <id>          # interactive edit
apivault keys delete <id>          # confirm, then delete
apivault keys delete <id> -f       # skip the confirmation prompt
```

`keys add` can also be fully non-interactive for scripting:

```bash
apivault keys add \
  --name STRIPE_SECRET \
  --service Stripe \
  --environment Production \
  --key "sk_live_..." \
  --notes "Billing API"
```

### Custom encryption key

If you've set a **custom vault key** on the website (Settings → Encryption Key),
revealing a raw value requires that passphrase. The CLI resolves it in this order:

1. `--key` flag
2. `APIVAULT_KEY` environment variable
3. Config value `vaultKey` (see [Local config](#local-config) below)
4. Interactive hidden prompt (when the server requires it)

```bash
apivault keys get <id> --reveal --key "your passphrase"
# or:
APIVAULT_KEY="your passphrase" apivault keys get <id> --reveal
# or:
apivault config set vaultKey          # store locally (prompts hidden)
apivault keys get <id> --reveal       # uses stored key
# or just: apivault keys get <id> --reveal   (you'll be prompted)
```

Accounts using the **default** encryption need no passphrase — `--reveal` works
with just the connected token. You can't reveal a custom-mode key without the
passphrase; if you've forgotten it, the stored keys cannot be recovered (only
reset by deleting them on the website).

## Run with secrets

Load all keys for an environment, decrypt them, inject each key **name** as an
environment variable, and spawn a child command:

```bash
apivault run --env Production -- npm start
apivault run --env Staging -- node server.js
```

Each stored key's `name` becomes the env var name (e.g. a key named
`STRIPE_SECRET` is available as `$STRIPE_SECRET` / `%STRIPE_SECRET%` in the
child process).

**Environment** resolves in order: `--env` flag → config `run.env` → error.

**Command** resolves in order: arguments after `--` → config `run.command` → error.

Set defaults once so you can run without repeating flags:

```bash
apivault config set run.env Production
apivault config set run.command "npm start"
apivault run                          # uses both defaults
```

For custom-mode accounts, pass `--key` or rely on the same vault-key resolution
as `keys get --reveal` (`APIVAULT_KEY`, config `vaultKey`, or prompt).

If no keys match the environment, the command still runs but no secrets are
injected (a warning is printed).

## Local config

Manage CLI defaults stored in `~/.apivault/config.json`:

```bash
apivault config list                  # all values (vaultKey is masked)
apivault config get run.command       # print one value
apivault config set run.env Production
apivault config set run.command "npm start"
apivault config set vaultKey          # prompts hidden (avoids shell history)
apivault config delete run.env
```

Known keys: `run.command`, `run.env`, `vaultKey`. Explicit flags always override
config values.

> The vault key is stored in **plaintext** in `config.json` — the same posture
> as the auth token in `token.json`. On Unix the file is written with mode
> `0600` (owner-only). Skip `config set vaultKey` if you prefer to pass
> `--key` / `APIVAULT_KEY` / the interactive prompt instead.

### Scripting

Add `--json` to any command for machine-readable output:

```bash
apivault --json keys list | jq '.[] | .id'
apivault --json keys get abc123 --reveal | jq -r .rawKey | clip
apivault --json config list
```

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsup bundle to dist/cli.js
```
