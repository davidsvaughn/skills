#!/usr/bin/env bash
# Maintainer tool, not the installer for users (see README "Install").
#
# Symlinks every skill in this repo into the local harness skill directories:
#   ~/.claude/skills   Claude Code: all skills
#   ~/.agents/skills   Oh My Pi, pi, Codex, OpenCode: all but the Claude Code-only ones
# Each entry is a symlink into this working tree, so edits and `git pull` are live at once.
# Re-run after adding, removing or renaming a skill. Stale links to removed skills are reported,
# not deleted.
#
# Usage: scripts/link-skills.sh [--dry-run]
# Override the destinations with CLAUDE_SKILLS_DIR and AGENTS_SKILLS_DIR.
set -euo pipefail

# Skills that only mean something inside Claude Code; never linked into ~/.agents/skills.
CLAUDE_ONLY=(whoami)

DRY=0
[[ ${1:-} == --dry-run ]] && DRY=1

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
AGENTS_DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"

is_claude_only() {
  local n
  for n in "${CLAUDE_ONLY[@]}"; do [[ $n == "$1" ]] && return 0; done
  return 1
}

link_one() { # name src dest
  local name=$1 src=$2 dest=$3 target="$3/$1"
  if [[ -e $target && ! -L $target ]]; then
    echo "SKIP    $target exists and is not a symlink; move it away first"
    return
  fi
  if [[ -L $target && "$(readlink "$target")" == "$src" ]]; then
    echo "ok      $target"
    return
  fi
  if (( DRY )); then
    echo "would   $target -> $src"
  else
    ln -sfn "$src" "$target"
    echo "linked  $target -> $src"
  fi
}

for dest in "$CLAUDE_DEST" "$AGENTS_DEST"; do
  # A destination that resolves into this repo would make the links land in skills/ itself.
  if [[ -e $dest ]]; then
    resolved="$(cd "$dest" && pwd -P)"
    case "$resolved" in
      "$REPO" | "$REPO"/*) echo "error: $dest resolves into this repo ($resolved)" >&2; exit 1 ;;
    esac
  elif (( ! DRY )); then
    mkdir -p "$dest"
  fi
done

for skill_md in "$REPO"/skills/*/SKILL.md; do
  src="$(dirname "$skill_md")"
  name="$(basename "$src")"
  link_one "$name" "$src" "$CLAUDE_DEST"
  if is_claude_only "$name"; then
    echo "        ($name is Claude Code-only: not linked into $AGENTS_DEST)"
  else
    link_one "$name" "$src" "$AGENTS_DEST"
  fi
  if [[ -f $src/package.json && ! -d $src/node_modules ]]; then
    echo "note    $name needs its dependencies: (cd $src && npm ci)"
  fi
done

# Links that point into this repo's skills/ but whose skill is gone.
for dest in "$CLAUDE_DEST" "$AGENTS_DEST"; do
  [[ -d $dest ]] || continue
  for link in "$dest"/*; do
    [[ -L $link ]] || continue
    to="$(readlink "$link")"
    [[ $to == "$REPO"/skills/* && ! -e $link ]] && echo "stale   $link -> $to (remove it by hand)"
  done
done
exit 0
