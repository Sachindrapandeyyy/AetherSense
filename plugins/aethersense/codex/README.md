# AetherSense prompts for Codex (OpenAI CLI)

This directory mirrors the Claude Code `aethersense` plugin's operator commands as Codex prompts, plus an `AGENTS.md` carrying the AetherSense project rules.

## Contents

| File | Purpose |
|------|---------|
| `AGENTS.md` | Project rules — repo layout, hard rules, build/test, ESP32 firmware on Windows, witness verification |
| `prompts/aethersense-start.md` | Onboarding — Docker demo / repo build / live ESP32 |
| `prompts/aethersense-flash.md` | Build + flash ESP32 firmware (8MB / 4MB) |
| `prompts/aethersense-provision.md` | Provision WiFi creds + sink IP + channel/MAC overrides |
| `prompts/aethersense-app.md` | Run a sensing application (presence / vitals / pose / sleep / MAT / point cloud) |
| `prompts/aethersense-train.md` | Train / evaluate / publish a model (incl. GPU on GCloud) |
| `prompts/aethersense-advanced.md` | Multistatic / tomography / cross-viewpoint / field-model / mesh-security |
| `prompts/aethersense-verify.md` | Run the trust pipeline + pre-merge checklist |

Prompt parity with the Claude Code plugin is enforced by `plugins/aethersense/scripts/smoke.sh` (every `commands/<name>.md` must have a matching `codex/prompts/<name>.md`).

## Install

**Per-user prompts** — copy the prompt files into Codex's prompt directory:

```bash
mkdir -p ~/.codex/prompts
cp plugins/aethersense/codex/prompts/*.md ~/.codex/prompts/
# now in the codex TUI:  /aethersense-start   /aethersense-flash   /aethersense-app   /aethersense-train   /aethersense-verify   /aethersense-advanced
```

**Project rules** — point Codex at the `AGENTS.md`. Codex auto-discovers an `AGENTS.md` at the repo root and in the working directory; either symlink it or copy it:

```bash
ln -s plugins/aethersense/codex/AGENTS.md AGENTS.md          # repo root (if you don't already have one)
# — or, if a root AGENTS.md exists, append the relevant sections from plugins/aethersense/codex/AGENTS.md
```

**Config (optional)** — to keep prompts in-repo instead of `~/.codex/prompts`, add to `~/.codex/config.toml`:

```toml
# Codex reads prompts from ~/.codex/prompts by default; symlinking keeps them versioned with the repo:
#   ln -s "$PWD/plugins/aethersense/codex/prompts" ~/.codex/prompts/aethersense   (then prompts appear as /aethersense/aethersense-start, etc.)
```

## Notes

- The Codex mirror is the **operator-facing subset** — the seven `/aethersense-*` commands. The Claude Code plugin additionally ships skills (`aethersense-quickstart`, `aethersense-hardware-setup`, `aethersense-configure`, `aethersense-applications`, `aethersense-model-training`, `aethersense-advanced-sensing`, `aethersense-cli-api`, `aethersense-mmwave`, `aethersense-verify`) and agents (`aethersense-onboarding-guide`, `aethersense-config-engineer`, `aethersense-training-engineer`) that have no Codex equivalent — their content is folded into `AGENTS.md` and the prompt files.
- On Windows, ESP-IDF firmware builds go through the Python-subprocess pattern documented in `CLAUDE.local.md` (Git Bash / MSYS2 is not supported by ESP-IDF v5.4). Default ESP32 serial port: **COM8**.
