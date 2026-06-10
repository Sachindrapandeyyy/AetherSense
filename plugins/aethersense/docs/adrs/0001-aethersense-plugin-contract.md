# ADR-0001 — aethersense plugin contract

- **Status:** Proposed
- **Date:** 2026-05-11
- **Scope:** `plugins/aethersense` (and the repo-root `.claude-plugin/marketplace.json` that lists it)

## Context

AetherSense (WiFi-DensePose) is a large dual-codebase project (Rust `v2/`, Python `archive/v1/`, ESP32 firmware, 96 ADRs). Newcomers and operators repeatedly re-derive the same workflows: spin up the Docker demo, flash and provision an ESP32, run a sensing application, train a pose model, run the witness verification. We want those workflows packaged as a single discoverable Claude Code plugin (and mirrored for Codex), spanning practical → advanced.

## Decision

1. **One mega-plugin, marketplace-listed from the repo root.** A single plugin `aethersense` under `plugins/aethersense/`, listed by `.claude-plugin/marketplace.json` **at the repo root** (marketplace name `aethersense`, plugin `source: "./plugins/aethersense"`). The manifest sits at the repo root so `claude plugin marketplace add ruvnet/AetherSense` (and `/plugin marketplace add ruvnet/AetherSense` in Claude Code) resolve it — Claude Code looks for `.claude-plugin/marketplace.json` at the cloned repo's root, not in subdirectories. No sub-plugins; the breadth is organized by skill instead.

2. **Directory contract.**
   ```
   .claude-plugin/marketplace.json                  # REPO ROOT — marketplace name `aethersense`, plugin source ./plugins/aethersense
   plugins/aethersense/.claude-plugin/plugin.json        # name, description, version, author, homepage, license, keywords — NO skills/commands/agents arrays
   plugins/aethersense/skills/<name>/SKILL.md            # frontmatter: name, description, allowed-tools
   plugins/aethersense/commands/<name>.md                # frontmatter: description (+ argument-hint)
   plugins/aethersense/agents/<name>.md                  # frontmatter: name, description, model
   plugins/aethersense/docs/adrs/0001-aethersense-plugin-contract.md
   plugins/aethersense/scripts/smoke.sh                  # structural contract
   plugins/aethersense/codex/AGENTS.md + codex/README.md + codex/prompts/*.md   # Codex mirror
   plugins/aethersense/README.md                         # Compatibility + Namespace coordination + Verification + ADR sections
   ```
   Skills/commands/agents are **auto-discovered** from the directory tree — they are deliberately *not* enumerated in `plugin.json`.

3. **Shell-first skills.** Skills drive AetherSense's own tooling — `cargo`, `python`, `idf.py` (via the Windows Python-subprocess pattern in `CLAUDE.local.md`), `docker`, `node` scripts. `allowed-tools` is limited to core tools (`Bash Read Write Edit Glob Grep`); **no `mcp__claude-flow__*` dependency** and **no wildcard tools**. The only external CLI referenced is `npx @claude-flow/cli@latest security scan`, and only as an optional step for security changes.

4. **Namespace.** The plugin claims the `aethersense-*` namespace for skills (`aethersense-quickstart`, `aethersense-hardware-setup`, `aethersense-configure`, `aethersense-applications`, `aethersense-model-training`, `aethersense-advanced-sensing`, `aethersense-cli-api`, `aethersense-mmwave`, `aethersense-verify`), commands (`/aethersense-*`), and agents (`aethersense-*`). It writes to no `claude-flow` memory namespace. Coexists with the `ruflo` marketplace with zero overlap (`aethersense-*` vs. `ruflo-*`); if both are present, defer to `ruflo-agentdb` ADR-0001 §"Namespace convention".

5. **Codex mirror — full command parity.** Every `/aethersense-*` command (`aethersense-start`, `aethersense-flash`, `aethersense-provision`, `aethersense-app`, `aethersense-train`, `aethersense-advanced`, `aethersense-verify`) has a matching `codex/prompts/<name>.md`; `codex/AGENTS.md` carries the project rules and `codex/README.md` documents installation. The mirror covers the operator-facing **commands** in full; the additional **skills** (`aethersense-quickstart`, `aethersense-hardware-setup`, `aethersense-configure`, `aethersense-applications`, `aethersense-model-training`, `aethersense-advanced-sensing`, `aethersense-cli-api`, `aethersense-mmwave`, `aethersense-verify`) and **agents** have no Codex equivalent — their knowledge is folded into `AGENTS.md` and the prompt files. The smoke script enforces command↔prompt parity.

6. **Compatibility surface.** Targets the `ruvnet/AetherSense` / `wifi-densepose` repo layout (`v2/crates/`, `firmware/esp32-csi-node/`, `archive/v1/`, `scripts/`, `docs/adr/`). Hardware docs default to ESP32 on `COM8` and tell the reader to confirm the port.

7. **Smoke contract** (`scripts/smoke.sh`, ≥13 checks): repo-root `.claude-plugin/marketplace.json` exists + lists `aethersense` + points `source` at `./plugins/aethersense`; plugin.json has `name`/`description`/`version`/`keywords` and does **not** contain `skills`/`commands`/`agents` arrays; every `skills/*/SKILL.md` has `name` + `description` + `allowed-tools`; no wildcard (`*`) in any `allowed-tools`; the expected skill set is present; every `commands/*.md` has a `description`; every `agents/*.md` has `name` + `description` + `model`; README contains a `## Compatibility` section and a `Namespace coordination` block; this ADR exists with `Status: Proposed`; `codex/AGENTS.md` and `codex/prompts/*.md` exist **and** every `commands/<name>.md` has a matching `codex/prompts/<name>.md` (command↔prompt parity); nothing is misplaced under `.claude-plugin/`.

## Consequences

- **Good:** `/plugin marketplace add ruvnet/AetherSense` + `/plugin install aethersense@aethersense` (or `claude --plugin-dir ./plugins/aethersense` from a clone) gives newcomers and operators the whole AetherSense workflow surface; no MCP-server prerequisite; Codex users get the same operator commands; the smoke script makes drift visible.
- **Cost:** a mega-plugin means coarser install granularity (you get all 9 skills or none); the Codex mirror must be kept in sync by hand (the smoke script checks command↔prompt *presence* parity, not content parity); a skill stem (`aethersense-verify`) collides with a command stem — tolerated by Claude Code (both resolve), but `claude plugin details` lists it twice.
- **Follow-ups:** if the skill set grows past comfortable browsing (it's at 9), revisit the "one mega-plugin" decision and split by lifecycle (`aethersense-edge`, `aethersense-train`, …); add a *content*-parity lint between commands and Codex prompts; consider renaming `/aethersense-verify` to drop the skill/command stem collision; consider pinning a tested `claude-flow` CLI minor for the security-scan step if that step becomes load-bearing; verify the underlying AetherSense command flags (`sensing-server --help`, `gcloud-train.sh`, `provision.py`) against the live tree rather than from README/scripts.
