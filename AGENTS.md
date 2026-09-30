# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this repo is

A public collection of agent skills in the [Agent Skills](https://agentskills.io/specification) format.
The `main` branch holds only skills, one directory per skill under `skills/`.
The `notes` branch holds reference notes that are not skills; do not merge it into `main`.

```
skills/<name>/SKILL.md      required: frontmatter (name, description) and instructions
skills/<name>/scripts/      optional: code the skill runs
skills/<name>/references/   optional: docs the skill reads on demand
scripts/link-skills.sh      maintainer tool: symlink the skills into the local harness directories
scripts/check.sh            run before every commit
```

On the maintainer's machine the installed skills are symlinks into this working tree, so an edit here is live at once.
Commit and push a change once it is verified; do not leave a half-edited skill in the tree.

## Rules

1. **This repo is public.**
   Nothing from an employer, a client, or anyone's private data goes in: no internal hostnames, project ids, repo paths, ticket ids, people's names, account or resource ids, share-link ids, or absolute home paths.
   When a skill's notes need evidence, record the structure of what was seen, not its content.
2. **Portable skills stay harness-neutral.**
   `ann`, `chat2md`, `draft` and `handoff` run in Claude Code, Oh My Pi, pi, Codex and OpenCode.
   In those skills:
   - refer to bundled files by paths relative to the skill's directory (`scripts/x.py`, `references/y.md`), never `${CLAUDE_SKILL_DIR}`;
   - do not use `$ARGUMENTS`; say "the text the user typed after the skill name", which every harness appends after the instructions;
   - Claude Code's `` !`command` `` injection and `${CLAUDE_SESSION_ID}` may be used only with a fallback line that says what to do when they arrive unfilled;
   - do not rely on `allowed-tools`; `disable-model-invocation` is fine.
3. **`whoami` is Claude Code-only.**
   It reads Claude Code's session registry, so it may use Claude-specific substitutions, and it is never linked into `~/.agents/skills`.
   A new harness-specific skill goes in the `CLAUDE_ONLY` list in `scripts/link-skills.sh` and is marked as such in the README table.
4. **The two `references/criticmarkup.md` files are one document.**
   `skills/ann/references/criticmarkup.md` and `skills/draft/references/criticmarkup.md` must stay byte-identical, because each skill has to work when installed alone.
   Change both together.
5. **Every skill has a row in the README table**, with how to invoke it, what it does and what it needs.
6. **Prose style:** one sentence per line in Markdown files, and a plain dash `-` rather than an em dash.

## Adding or changing a skill

1. Create `skills/<name>/SKILL.md`; the directory name and the `name` field match, in kebab-case.
   The `description` says what the skill does and when to use it, since it is the only part an agent sees before loading the skill.
2. Keep to rule 2 unless the skill cannot mean anything outside one harness.
3. Add or update its row in `README.md`.
4. Run `scripts/check.sh`.
5. Test the skill for real in at least one harness before committing; for a portable skill, prefer one run in Claude Code and one in another harness (for example `omp -p "/skill:<name> ..."` in a scratch repository).
6. Run `scripts/link-skills.sh` if a skill was added, removed or renamed.

## Validation

```bash
scripts/check.sh
```

It checks the rules above that can be checked mechanically (frontmatter, portability tokens, the two protocol copies, absolute home paths, README rows), runs the `ann` unit tests when its dependencies are installed (`npm ci` in `skills/ann`), and confirms that the `skills` CLI discovers every skill.
A passing check does not replace step 5.

## Installing from this repo (for an agent asked to do so)

Non-interactive, one skill, into the current project:

```bash
npx -y skills@latest add davidsvaughn/skills --skill <name> --agent <agent> -y
```

Add `--global` for a user-level install; `--list` shows the available skills without installing.
`<agent>` is for example `claude-code`, `codex` or `opencode`.
After installing `ann`, run `npm ci` once in the installed skill directory.
Do not install `whoami` for any agent other than Claude Code.
