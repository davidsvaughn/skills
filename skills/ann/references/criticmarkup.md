# Addressing CriticMarkup annotations

The user reviews a markdown file by adding CriticMarkup annotations in place, then says "address the annotations in <path>".
The annotations carry thoughts, questions, confusion, approval, objections and decisions about a specific part of the document.
Treat them as instructions from the user, not as document content.

## Syntax

Every comment carries an `author|date:` prefix.

- Highlight and comment: `{==the text being reacted to==}{>>you|2026-08-28: the comment<<}`
- Comment alone: `{>>you|2026-08-28: the comment<<}` refers to the sentence, list item or table cell it sits in.
- Suggested edits: `{++insert++}`, `{--delete--}`, `{~~old~>new~~}`

Find them with `grep -n '{>>\|{==\|{++\|{--\|{~~' <path>`.
They can span lines and sit inside tables.

## What to do

The goal is to integrate the feedback into the work, not to process it item by item.

1. **Inventory every annotation** in the file before acting on any.
   Do not stop at the first few.
2. **Work out the scope** each one refers to: the highlighted span if there is one; otherwise the enclosing sentence, list item or table row.
   An annotation on a heading refers to the whole section, one at the top of the file to the whole file, one on a table header to the table.
3. **Classify the intent and act on it:**
   - question or confusion: answer it, and fix the text so the next reader does not hit the same question;
   - objection or decision: apply it, then update everything that depended on the old position (open-question lists, plans, sibling docs);
   - idea or suggestion: evaluate it honestly; incorporate it, or say why not;
   - approval: no change; acknowledge it;
   - requested edit: make it.
   If a comment implies code or behaviour changes rather than doc changes, list those as follow-ups instead of doing them uninvited, unless the user said to go ahead.
4. **Respond in chat, not in the document.**
   Synthesize: several comments often point at one underlying concern, and the reply can take whatever form fits (a discussion, a revised proposal, the edits made, questions back).
   What matters is that every comment was genuinely considered and that anything still needing a decision is called out.

## Rules

- Never delete, edit or move the user's annotations; the user removes a thread when satisfied.
  Only when explicitly asked to "clear resolved comments", remove the whole thread and restore plain text (drop the `{==` and `==}` too).
- Do not add reply annotations or annotations of your own unless asked.
- When an annotation and the surrounding text disagree, the annotation wins.
- Strip CriticMarkup when quoting or copying the doc's text anywhere else (code, prompts, commit messages).
- If the user says annotations exist but the grep finds none, or fewer than described, the file is probably still unsaved in their editor.
  Say so, ask them to save, then grep again; do not act on the stale copy.
