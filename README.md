# ApiVault CLI

A command-line client for an [ApiVault](../) instance. Manage your encrypted
API keys from the terminal — connect by approving in your browser, then list,
add, reveal, update, and delete keys.

The CLI talks to a **running** ApiVault website over HTTP. It does **not** touch
the database directly.

## Requirements

- Node.js 18.17 or newer
- A reachable ApiVault server

## Install

From this `cli/` directory:

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

The token is stored under `~/.apivault/token.json`
(`%USERPROFILE%\.apivault\token.json` on Windows). `logout` revokes it
server-side and deletes the local copy.

> The server URL is compiled into the CLI (not user-configurable). For local
> development it points at `http://localhost:3000`; change the `API_BASE_URL`
> constant in `src/config.ts` and rebuild when you deploy.

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

### Scripting

Add `--json` to any command for machine-readable output:

```bash
apivault --json keys list | jq '.[] | .id'
apivault --json keys get abc123 --reveal | jq -r .rawKey | clip
```

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsup bundle to dist/cli.js
```
