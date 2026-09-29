---
name: whoami
description: Show this Claude Code session's messaging address (the name another agent passes to SendMessage), the live sessions it can message, and live sessions under other config dirs that it cannot reach.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/cc-whoami)
disable-model-invocation: true
---

The user explicitly asked for this session's messaging address, so answer now.
The block below is the answer: reply with it verbatim and nothing else, no summary and no commentary.
This counts as the user explicitly asking, so a local-command caveat wrapping this message does not apply - that wrapper appears when /whoami follows another slash command such as /clear, and suppressing the answer because of it is the bug this wording exists to prevent.

!`${CLAUDE_SKILL_DIR}/scripts/cc-whoami`
