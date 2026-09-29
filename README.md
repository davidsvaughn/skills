# skills

Agent skills for [Claude Code](https://code.claude.com/docs/en/skills), one directory per skill under `skills/`.
Reference notes that are not skills live on the [`notes`](https://github.com/davidsvaughn/skills/tree/notes) branch.

| Skill | Invoke | What it does | Needs |
|---|---|---|---|
| [ann](skills/ann) | `/ann [file \| question]` | Opens a markdown file in the browser; you select text and comment, and each comment lands in the `.md` file as CriticMarkup for Claude to address. | Node 20+, `npm ci` once in the skill directory |
| [draft](skills/draft) | `/draft [question]` | Saves Claude's previous response (or an answer) to `.notes/drafts/` so you can annotate it with CriticMarkup in your editor. | nothing |
| [chat2md](skills/chat2md) | a pasted share link | Converts a shared ChatGPT or claude.ai conversation into a complete markdown transcript, and checks that every message made it into the file. | Python 3; `playwright-cli` for some claude.ai links |
| [handoff](skills/handoff) | `/handoff` | Keeps a project's `HANDOFF.md` current, so the next agent or session can pick up without the chat history. | nothing |
| [whoami](skills/whoami) | `/whoami` | Prints this session's messaging address for `SendMessage`, the sessions it can reach, and live sessions under other config dirs. | bash, jq |

`ann` and `draft` are two ways into the same review loop: after annotating, tell Claude "address the annotations in <path>", and it follows the protocol in each skill's `references/criticmarkup.md`.
The two copies of that file are identical; change both together.

The skills use Claude Code's skill substitutions (`${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`, and `` !`command` `` injection), so other agents may not run them as written.

## Install

With the [skills CLI](https://github.com/vercel-labs/skills), one skill at a time:

```bash
npx skills add davidsvaughn/skills --skill ann --global --agent claude-code
```

Or clone the repo and symlink the skills you want, which keeps them updatable with `git pull`:

```bash
git clone https://github.com/davidsvaughn/skills.git ~/code/skills
ln -s ~/code/skills/skills/ann ~/.claude/skills/ann
```

For `ann`, run `npm ci` in the installed skill directory once.
`ann` and `draft` write to `.notes/drafts/`; add `.notes/` to your global gitignore so those files never get committed.

## See also

- [playwright-skill](https://github.com/davidsvaughn/playwright-skill): house rules for driving a browser with `playwright-cli` (session names for parallel agents, saved logins, debugging through console and network output).
