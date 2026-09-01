<p align="center">
  <a href="https://apivault.tech">
    <img src="https://apivault.tech/apivault-cli.png" width="360" alt="ApiVault Logo" style="max-width: 100%;">
  </a>
</p>

<p align="center">
  The official command-line interface for <strong><a href="https://apivault.tech">ApiVault</a></strong> — manage encrypted API keys, inject secrets into local processes, and sync environment variables from your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/apivault"><img src="https://img.shields.io/npm/v/apivault.svg?style=flat-square&color=6366f1" alt="npm version"></a>
  <a href="https://github.com/TLB-STATION/apivault/blob/main/LICENSE"><img src="https://img.shields.io/github/license/TLB-STATION/apivault.svg?style=flat-square&color=10b981" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/apivault.svg?style=flat-square&color=8b5cf6" alt="node version"></a>
</p>

---

### Requirements
- **Node.js**: `18.17.0` or higher

---

## Installation

npm Package Manager

```bash
npm install -g apivault
```

Or run on-demand without a global install:

```bash
npx apivault <command>
```

<details>
<summary>Other package managers</summary>

```bash
pnpm add -g apivault
yarn global add apivault
bun install -g apivault
```

</details>

<details>
<summary>Standalone installer scripts (no npm required)</summary>

**macOS / Linux:**
```bash
curl -fsSL https://apivault.tech/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://apivault.tech/install.ps1 | iex
```

Installs into `~/.local/share/apivault` and links `~/.local/bin/apivault` — no root/sudo required.

</details>

---

## Command Reference

| Command | Description |
| :--- | :--- |
| `apivault login` | Authenticate via browser approval |
| `apivault logout` | Revoke session and clear stored token |
| `apivault whoami` | Show the connected user |
| `apivault link <id>` | Link current directory to an ApiVault project (`.apivault.json`) |
| `apivault unlink` | Remove local project binding (`.apivault.json`) |
| `apivault keys list` | List all vault keys (masked) |
| `apivault keys add` | Add a new secret (interactive or flags) |
| `apivault keys get <id>` | View key details; add `--reveal` to decrypt |
| `apivault keys update <id>` | Edit a stored key |
| `apivault keys delete <id>` | Delete a key (`-f` to skip prompt) |
| `apivault projects list` | List all available projects |
| `apivault projects use <id>` | Set active project locally (`.apivault.json`, or `--global`) |
| `apivault projects current` | Display currently active project and its source |
| `apivault run` | Inject secrets into a child process |
| `apivault env export` | Write secrets to a `.env` file |
| `apivault env restore` | Restore `.env` files hidden by `run` |
| `apivault config list\|get\|set\|delete` | Manage local & global CLI defaults (`-l` / `-g`) |

**Global flags:** `--json` (machine-readable output), `--timeout <seconds>` (browser approval wait, default 300), `-p, --project <id>` (explicit project override).

---

## Authentication

```bash
apivault login
```

1. Opens your default browser to an **Approve / Refuse** prompt on ApiVault.
2. If you're not already signed in, you'll be redirected to log in first.
3. The CLI waits in the terminal until approval is detected (override with `--timeout <seconds>`), then saves an API token under `~/.apivault/token.json`.

```bash
apivault whoami                    # check connection status
apivault logout                    # revoke this device's token
```

---

## Managing Projects & Local Directory Bindings

```bash
apivault projects list             # list all available projects
apivault projects use <id>         # bind current directory to a project (.apivault.json)
apivault link <id>                 # shortcut to bind current directory
apivault projects current          # check active project and resolution source
apivault unlink                    # remove local project binding
```

For commands that require a project context, the CLI resolves the active project in this order:
1. `--project <id>` or `-p <id>` flag (available on all commands)
2. `APIVAULT_PROJECT` environment variable
3. Local directory configuration (`.apivault.json`, `.apivaultrc`, `apivault.json`)
4. Global default project (`apivault projects use <id> --global` or `~/.apivault/config.json`)


---

## Managing API Keys

```bash
apivault keys list                 # list stored keys (masked)
apivault keys add                  # interactive wizard
apivault keys get <id>             # show key metadata
apivault keys get <id> --reveal    # decrypt and display raw value
apivault keys update <id>          # edit key attributes
apivault keys delete <id>          # confirm, then delete
apivault keys delete <id> -f       # skip confirmation
```

For automation, pass all values as flags:

```bash
apivault keys add \
  --name STRIPE_SECRET \
  --service Stripe \
  --environment Production \
  --key "sk_live_51M..." \
  --notes "Production payment gateway"
```

### Custom Encryption Vault Key

Accounts with a **custom vault key** (Settings → Encryption Key) need the vault key for encrypt/decrypt operations. The CLI resolves it in order:

1. `--vault-key "<vault-key>"` flag
2. `APIVAULT_KEY` environment variable
3. Stored config value (`apivault config set vaultKey`)
4. Interactive hidden prompt (fallback)

Accounts using default encryption need no vault key.

---

## Injecting Secrets (`apivault run`)

Decrypt all keys for an environment and inject them as environment variables into a child process — **no `.env` files written to disk**.

```bash
# Inject Production secrets into npm start
apivault run --env Production -- npm start

# Inject Staging secrets into Python / Node
apivault run --env Staging -- python main.py
```

| Flag | Description |
| :--- | :--- |
| `--env <name>` | Vault environment to pull secrets from |
| `--vault-key <vault-key>` | Custom encryption vault key |

During execution, existing local `.env` files are temporarily renamed to `*.apivault-run-hidden` to prevent framework conflicts, and automatically restored on exit. If restoration fails (e.g. process killed), run `apivault env restore`.

Save defaults to skip flags:

```bash
apivault config set run.env Production
apivault config set run.command "npm run dev"
apivault run                               # uses saved defaults
```

---

## Dotenv Management (`apivault env`)

Export decrypted secrets to local `.env` files for frameworks that require them (Next.js, Vite, Docker Compose, etc.):

```bash
apivault env export --env Production               # write to .env (merge)
apivault env export --env Staging -o .env.local     # custom output path
apivault env export --env Production --force        # overwrite instead of merge
```

| Flag | Description |
| :--- | :--- |
| `--env <name>` | Vault environment to export |
| `-o, --output <path>` | Target file (default: `.env`) |
| `-f, --force` | Replace file entirely instead of merging |
| `--vault-key <vault-key>` | Custom encryption vault key |

Restore hidden dotenv backups:

```bash
apivault env restore                        # current directory
apivault env restore -C /path/to/project    # specify project directory
```

---

## Local & Global Configuration
 
Manage CLI defaults stored per-project in `.apivault.json` or globally in `~/.apivault/config.json`:
 
```bash
apivault config list                       # view active merged config (shows local vs global)
apivault config list --local               # view only local project config
apivault config list --global              # view only global user config
apivault config get run.command            # read a resolved value
apivault config set --local run.env Dev    # set local project default environment
apivault config set --local run.command "npm run dev"
apivault config set --global run.env Prod  # set global default environment
apivault config set vaultKey               # save vault key (hidden input)
apivault config delete --local run.env     # remove a local value
```

Known keys: `project`, `run.command`, `run.env`, `vaultKey`. Explicit flags and local configs always take precedence.


---

## JSON Output

Pass `--json` to any command for structured output suitable for `jq` or scripts:

```bash
apivault --json keys list | jq '.[] | {id: .id, name: .name}'
apivault --json keys get <id> --reveal | jq -r .rawKey | clip
```

---

## Security

| Layer | Detail |
| :--- | :--- |
| **Transport** | HTTPS with token-header authentication |
| **Local storage** | `~/.apivault/token.json` and `config.json` written with `0600` permissions (Unix) |
| **Process isolation** | Secrets exist only in child-process memory during `apivault run` — nothing written to disk |

---

## 🤖 AI Agent Skill

If you use AI coding assistants (Cursor, Claude Desktop, Claude Code, Windsurf, Antigravity), install the official [ApiVault Skill](https://github.com/TLB-STATION/apivault-skill) into your workspace:

```bash
git clone https://github.com/TLB-STATION/apivault-skill.git .agents/skills/apivault
```

This equips your AI agents with native runbooks, MCP configuration templates, and automated workflows to manage credentials without leaking secrets.

---

## Documentation & Links

- **Website**: [apivault.tech](https://apivault.tech)
- **CLI Docs**: [apivault.tech/docs/cli](https://apivault.tech/docs/cli)
- **AI Agent Skill**: [github.com/TLB-STATION/apivault-skill](https://github.com/TLB-STATION/apivault-skill)
- **Issues**: [GitHub Issues](https://github.com/TLB-STATION/apivault/issues)

## License

[MIT](LICENSE)
