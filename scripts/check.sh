#!/usr/bin/env bash
# Checks the repo rules in AGENTS.md that can be checked mechanically. Run before every commit.
# Prints one line per check; exits non-zero if any check fails.
#
# What it cannot see: whether a skill's instructions actually work in a harness, and private
# details other than absolute home paths. Read the diff and test the skill for real as well.
#
# Usage: scripts/check.sh [--offline]   (--offline skips the `skills` CLI discovery check)
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$REPO"

# Keep in step with AGENTS.md rule 3 and CLAUDE_ONLY in scripts/link-skills.sh.
CLAUDE_ONLY=(whoami)
OFFLINE=0
[[ ${1:-} == --offline ]] && OFFLINE=1

fails=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; [[ -n ${2:-} ]] && printf '%s\n' "$2" | sed 's/^/        /'; fails=$((fails + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

is_claude_only() {
  local n
  for n in "${CLAUDE_ONLY[@]}"; do [[ $n == "$1" ]] && return 0; done
  return 1
}

# Files under skills/ that git would publish (tracked or not yet ignored).
published() { git ls-files --cached --others --exclude-standard -- "$@"; }

skills=()
for f in skills/*/SKILL.md; do skills+=("$(basename "$(dirname "$f")")"); done
(( ${#skills[@]} )) || { fail "no skills found under skills/"; exit 1; }

for s in "${skills[@]}"; do
  f="skills/$s/SKILL.md"

  # Frontmatter: first line ---, a name equal to the directory, a non-empty description.
  name="$(awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^name:/{sub(/^name:[ \t]*/,""); print; exit}' "$f")"
  desc="$(awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^description:/{sub(/^description:[ \t]*/,""); print; exit}' "$f")"
  if [[ $name == "$s" && -n $desc ]]; then pass "$s: frontmatter (name matches directory, description present)"
  else fail "$s: frontmatter" "name='$name' (want '$s'), description $([[ -n $desc ]] && echo present || echo MISSING)"; fi

  # README row that links the skill.
  if grep -q "\](skills/$s)" README.md; then pass "$s: README row"
  else fail "$s: README row" "no link to skills/$s in README.md"; fi

  # Portable skills: no Claude-only path or argument substitutions, and no allowed-tools.
  if is_claude_only "$s"; then
    skip "$s: portability tokens (Claude Code-only skill)"
  else
    hits="$(grep -n -F -e '${CLAUDE_SKILL_DIR}' -e '$ARGUMENTS' "$f"; grep -n '^allowed-tools:' "$f")"
    if [[ -z $hits ]]; then pass "$s: portability tokens"
    else fail "$s: portability tokens (AGENTS.md rule 2)" "$hits"; fi
  fi
done

# The two CriticMarkup protocol copies are one document.
a=skills/ann/references/criticmarkup.md; b=skills/draft/references/criticmarkup.md
if cmp -s "$a" "$b"; then pass "criticmarkup.md copies identical"
else fail "criticmarkup.md copies differ" "$(diff "$a" "$b" | head -10)"; fi

# Absolute home paths in anything that would be published.
hits="$(published skills README.md AGENTS.md scripts | xargs -r grep -n -I -E '/(home|Users)/[A-Za-z0-9._-]+/' 2>/dev/null)"
if [[ -z $hits ]]; then pass "no absolute home paths"
else fail "absolute home paths (AGENTS.md rule 1)" "$hits"; fi

# Shell scripts parse.
bad=""
while IFS= read -r f; do
  [[ -f $f ]] || continue
  head -1 "$f" | grep -q -E '^#!.*\b(ba)?sh\b' || continue
  bash -n "$f" 2>/dev/null || bad+="$f"$'\n'
done < <(published skills scripts)
if [[ -z $bad ]]; then pass "shell scripts parse"
else fail "shell scripts do not parse" "$bad"; fi

# Python scripts compile.
bad=""
while IFS= read -r f; do
  [[ $f == *.py && -f $f ]] || continue
  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$f" 2>/dev/null || bad+="$f"$'\n'
done < <(published skills)
if [[ -z $bad ]]; then pass "python scripts parse"
else fail "python scripts do not parse" "$bad"; fi

# ann unit tests.
if [[ -d skills/ann/node_modules ]]; then
  out="$(cd skills/ann && node --test test/*.test.mjs 2>&1)"
  if [[ $? -eq 0 ]]; then pass "ann unit tests ($(grep -E '^. pass ' <<<"$out" | awk '{print $3}') passed)"
  else fail "ann unit tests" "$(tail -15 <<<"$out")"; fi
else
  skip "ann unit tests (run: cd skills/ann && npm ci)"
fi

# The skills CLI discovers every skill.
if (( OFFLINE )); then
  skip "skills CLI discovery (--offline)"
else
  out="$(npx -y skills@latest add . --list </dev/null 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g')"
  missing=""
  for s in "${skills[@]}"; do grep -q -E "^│ +$s *\$" <<<"$out" || missing+="$s "; done
  if [[ -z $missing ]]; then pass "skills CLI discovers all ${#skills[@]} skills"
  else fail "skills CLI discovery" "not listed: $missing"; fi
fi

echo
if (( fails )); then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
