// CriticMarkup scanning, thread grouping and masking.
//
// The file on disk is the only store: every annotation is CriticMarkup text inside the markdown source.
// Offsets are JavaScript string indices into the source, the same unit mdast positions use.

// Stand-in for hidden characters in the masked copy: one UTF-16 unit, never markdown syntax, and Unicode
// punctuation (Po), so emphasis flanking treats it as it treats the real `{`, `=` and `}` it replaces.
export const MASK = '\u2E30'

const OPENERS = [
  {open: '{==', close: '==}', kind: 'highlight'},
  {open: '{>>', close: '<<}', kind: 'comment'},
  {open: '{++', close: '++}', kind: 'insert'},
  {open: '{--', close: '--}', kind: 'delete'},
  {open: '{~~', close: '~~}', kind: 'subst'},
]

// Comment bodies written by this tool and by the VS Code md-comments extension look like
// "author|2026-09-25: text". Bodies without that prefix are kept whole as text.
const COMMENT_PREFIX = /^([^|\n{}<>]+)\|([^:\n{}<>]+):[ \t]?([\s\S]*)$/

export function parseCommentBody(body) {
  const m = COMMENT_PREFIX.exec(body)
  if (!m) return {author: null, date: null, text: body}
  return {author: m[1].trim(), date: m[2].trim(), text: m[3]}
}

export function formatComment(author, date, text) {
  return `{>>${author}|${date}: ${text}<<}`
}

// Next `token` at or after `from` that is not inside an excluded range.
function findOutside(source, token, from, excluded) {
  for (;;) {
    const k = source.indexOf(token, from)
    if (k === -1) return -1
    const ex = excluded.find(([s, e]) => s <= k && k < e)
    if (!ex) return k
    from = ex[1]
  }
}

// Find every CriticMarkup construct outside the excluded ranges (code blocks, front matter).
// `excluded` is a sorted array of [start, end) pairs. A construct whose opener lies in an excluded range is
// literal text. A highlight, insertion or deletion may contain a whole code block (its markers sit on the lines
// around it); a comment or substitution may not run into one.
export function scan(source, excluded = []) {
  const out = []
  let ex = 0
  let i = 0
  while (i < source.length) {
    while (ex < excluded.length && excluded[ex][1] <= i) ex++
    if (ex < excluded.length && excluded[ex][0] <= i) {
      i = excluded[ex][1]
      continue
    }
    const limit = ex < excluded.length ? excluded[ex][0] : source.length
    if (source[i] !== '{') {
      i++
      continue
    }
    const op = OPENERS.find((o) => source.startsWith(o.open, i))
    if (!op) {
      i++
      continue
    }
    const spans = op.kind === 'highlight' || op.kind === 'insert' || op.kind === 'delete'
    const closeAt = spans ? findOutside(source, op.close, i + 3, excluded) : source.indexOf(op.close, i + 3)
    if (closeAt === -1 || (!spans && closeAt + 3 > limit)) {
      i++
      continue
    }
    const c = {kind: op.kind, start: i, end: closeAt + 3, open: [i, i + 3], close: [closeAt, closeAt + 3]}
    if (op.kind === 'subst') {
      const mid = source.indexOf('~>', i + 3)
      if (mid === -1 || mid >= closeAt) {
        i++
        continue
      }
      c.mid = [mid, mid + 2]
      c.old = [i + 3, mid]
      c.new = [mid + 2, closeAt]
    } else if (op.kind === 'comment') {
      c.body = source.slice(i + 3, closeAt)
      Object.assign(c, parseCommentBody(c.body))
    } else {
      c.content = [i + 3, closeAt]
    }
    out.push(c)
    i = c.end
  }
  return out
}

// Group constructs into threads: an anchor (highlight, insert, delete, substitution) followed directly by
// zero or more comments, or a run of adjacent comments with no anchor (a point comment).
export function threads(constructs) {
  const out = []
  let cur = null
  for (const c of constructs) {
    if (c.kind === 'comment') {
      if (cur && cur.end === c.start) {
        cur.comments.push(c)
        cur.end = c.end
        continue
      }
      cur = {anchor: null, comments: [c], start: c.start, end: c.end}
      out.push(cur)
      continue
    }
    cur = {anchor: c, comments: [], start: c.start, end: c.end}
    out.push(cur)
  }
  out.forEach((t, n) => {
    t.id = n
    t.kind = t.anchor ? t.anchor.kind : 'point'
  })
  return out
}

// Ranges the reader never sees: the markers of every construct and the whole of every comment.
export function hiddenRanges(constructs) {
  const out = []
  for (const c of constructs) {
    if (c.kind === 'comment') out.push([c.start, c.end])
    else {
      out.push(c.open, c.close)
      if (c.mid) out.push(c.mid)
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

// Same-length copy of the source with hidden characters replaced by MASK, so the markdown parser neither
// sees CriticMarkup syntax (`~~` would otherwise open a strikethrough) nor parses comment bodies (a `|` in the
// author|date prefix would otherwise split a table cell), while every offset stays valid.
export function mask(source, constructs) {
  const chars = source.split('')
  for (const [s, e] of hiddenRanges(constructs)) for (let k = s; k < e; k++) chars[k] = MASK
  return chars.join('')
}

// Copy of the source with the `|` characters inside comments replaced by spaces. The author|date prefix puts a
// pipe in every comment, which splits a table cell for a renderer that does not know CriticMarkup; that is how
// annotated tables look outside this viewer already, so the block-structure check must not count it.
export function neutralizeCommentPipes(source, constructs) {
  const chars = source.split('')
  for (const c of constructs) if (c.kind === 'comment') for (let k = c.start; k < c.end; k++) if (chars[k] === '|') chars[k] = ' '
  return chars.join('')
}

export function lineOf(source, offset) {
  let line = 1
  for (let k = 0; k < offset && k < source.length; k++) if (source.charCodeAt(k) === 10) line++
  return line
}
