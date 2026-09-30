# skills

Agent skills in the [Agent Skills](https://agentskills.io/specification) format, one directory per skill under `skills/`.
Written for [Claude Code](https://code.claude.com/docs/en/skills); all but `whoami` also run in other harnesses that read the format (Oh My Pi, pi, Codex, OpenCode).
Reference notes that are not skills live on the [`notes`](https://github.com/davidsvaughn/skills/tree/notes) branch.

| Skill | Invoke | What it does | Needs |
|---|---|---|---|
| [ann](skills/ann) | `/ann [file \| question]` | Opens a markdown file in the browser; you select text and comment, and each comment lands in the `.md` file as CriticMarkup for Claude to address. | Node 20+, `npm ci` once in the skill directory |
| [draft](skills/draft) | `/draft [question]` | Saves Claude's previous response (or an answer) to `.notes/drafts/` so you can annotate it with CriticMarkup in your editor. | nothing |
| [chat2md](skills/chat2md) | a pasted share link | Converts a shared ChatGPT or claude.ai conversation into a complete markdown transcript, and checks that every message made it into the file. | Python 3; `playwright-cli` for some claude.ai links |
| [handoff](skills/handoff) | `/handoff` | Writes the next numbered `HANDOFF-NNN.md`, a complete current-state snapshot for the next agent or session; earlier handoffs are never overwritten. | nothing |
| [whoami](skills/whoami) | `/whoami` | Prints this session's messaging address for `SendMessage`, the sessions it can reach, and live sessions under other config dirs. | Claude Code only; bash, jq |

`ann` and `draft` are two ways into the same review loop: after annotating, tell Claude "address the annotations in <path>", and it follows the protocol in each skill's `references/criticmarkup.md`.
The two copies of that file are identical; change both together.

## Portability

The four portable skills keep to what every harness provides: paths relative to the skill's directory, arguments read from wherever the harness appends them, and no tool allow-lists.
Claude Code fills in a timestamp and session id through its `` !`command` `` and `${CLAUDE_SESSION_ID}` substitutions; each skill says what to do when those lines arrive unfilled (run `date`, leave the session id empty).
In pi and Oh My Pi, invoke them as `/skill:<name>`.
`whoami` reads Claude Code's session registry, so it has no meaning elsewhere; do not install it for other agents.

## Install

With the [skills CLI](https://github.com/vercel-labs/skills), which copies the skills you pick into the agents you pick:

```bash
npx skills@latest add davidsvaughn/skills
```

One skill, without prompts (the form an agent should use):

```bash
npx -y skills@latest add davidsvaughn/skills --skill handoff --agent claude-code --global -y
```

`--list` shows what is available without installing; drop `--global` to install into the current project only; `--agent` also takes `codex`, `opencode` and others.

Or clone the repo and symlink, which keeps the skills updatable with `git pull`:

```bash
git clone https://github.com/davidsvaughn/skills.git
cd skills && scripts/link-skills.sh
```

The script links every skill into `~/.claude/skills` (Claude Code) and the portable ones into `~/.agents/skills` (Oh My Pi, pi, Codex, OpenCode); `--dry-run` shows what it would do.

After installing `ann`, run `npm ci` once in its skill directory.
`ann` and `draft` write to `.notes/drafts/`; add `.notes/` to your global gitignore so those files never get committed.

## Contributing

[AGENTS.md](AGENTS.md) has the repo's rules, for people and for coding agents; `scripts/check.sh` verifies the ones that can be checked mechanically.

## License

[MIT](LICENSE)

## See also

- [playwright-skill](https://github.com/davidsvaughn/playwright-skill): house rules for driving a browser with `playwright-cli` (session names for parallel agents, saved logins, debugging through console and network output).
