// Edits to the markdown source: add a comment on a selection, reply, edit, delete, resolve.
//
// Every edit is checked before it is returned. The document must look the same as before once the
// annotations are hidden (same visible text, same inline and block structure), and the new annotation must be
// found where it was put. An edit that fails the check is refused, never written.

import {analyze, parse, visit, pos} from './render.mjs'
import {MASK, formatComment, hiddenRanges, neutralizeCommentPipes} from './criticmarkup.mjs'

export class EditError extends Error {}

// Inline nodes that cannot hold a marker inside them (the marker would be literal text there).
const INLINE_UNITS = new Set(['inlineCode', 'image', 'imageReference', 'footnoteReference', 'html', 'break'])
// Inline nodes a highlight may sit inside, but may not half-cover.
const INLINE_CONTAINERS = new Set(['emphasis', 'strong', 'delete', 'link', 'linkReference'])
const WORD = /[\p{L}\p{N}_]/u
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

export function today() {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

export function cleanAuthor(name) {
  const a = String(name ?? '').replace(/[|:{}<>\n\r]/g, '').trim()
  return a || 'you'
}

function cleanText(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!t) throw new EditError('The comment is empty.')
  if (t.includes('<<}')) throw new EditError('A comment cannot contain "<<}": it would end the CriticMarkup comment early.')
  return t
}

const nl = (source) => (source.includes('\r\n') ? '\r\n' : '\n')
const lineStart = (src, off) => (off > 0 ? src.lastIndexOf('\n', off - 1) + 1 : 0)

function isFenced(source, node) {
  if (node.type !== 'code') return false
  const [s] = pos(node)
  return /^[ \t]*(```|~~~)/.test(source.slice(s, s + 40))
}

// ---------------------------------------------------------------------------------------------------------
// The check.

function maskOnly(node) {
  let only = true
  visit(node, (n) => {
    if (n === node) return
    if (n.type === 'text') {
      if (n.value.replaceAll(MASK, '').trim()) only = false
    } else if (n.type !== 'break') only = false
  })
  return only
}

function structure(an) {
  const parts = []
  const rec = (node, d) => {
    if (node.type === 'text') return
    if (node.type === 'paragraph' && maskOnly(node)) return
    // A bare URL (GFM literal autolink) runs on into markup placed right after it, in any renderer; the text is
    // unchanged, so only whether it is a link differs. Leave literal autolinks out of the comparison.
    if (node.type === 'link' && !'[<'.includes(an.masked[pos(node)[0]])) {
      for (const c of node.children || []) rec(c, d)
      return
    }
    let tag = node.type
    if (node.type === 'heading') tag += node.depth
    if (node.type === 'list') tag += node.ordered ? 'o' : 'u'
    if (node.type === 'link' || node.type === 'image') tag += ' ' + node.url
    parts.push('.'.repeat(d) + tag)
    for (const c of node.children || []) rec(c, d + 1)
  }
  rec(an.tree, 0)
  return parts.join('\n')
}

function visibleText(an) {
  const out = []
  visit(an.tree, (n) => {
    if (n.type === 'text' || n.type === 'inlineCode' || n.type === 'code' || n.type === 'html') out.push(n.value.replaceAll(MASK, ''))
  })
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

// Block structure as a renderer that knows nothing about CriticMarkup sees it (the raw parse): catches a comment
// whose text would split a table row or a paragraph there.
function rawBlocks(an) {
  const hidden = hiddenRanges(an.constructs)
  const covered = (node) => {
    const [s, e] = pos(node)
    let h = 0
    for (let x = s; x < e; x++) {
      while (h < hidden.length && hidden[h][1] <= x) h++
      const inHidden = h < hidden.length && hidden[h][0] <= x
      if (!inHidden && !/\s/.test(an.source[x])) return false
    }
    return true
  }
  const parts = []
  const rec = (node, parent, d) => {
    const block =
      BLOCK_PARENTS.has(node.type) ||
      ['paragraph', 'heading', 'thematicBreak', 'list', 'table', 'tableRow', 'tableCell', 'code', 'yaml', 'toml', 'definition'].includes(node.type) ||
      (node.type === 'html' && parent && BLOCK_PARENTS.has(parent.type))
    if (!block) return
    if (node.type === 'paragraph' && covered(node)) return
    parts.push('.'.repeat(d) + node.type)
    for (const c of node.children || []) rec(c, node, d + 1)
  }
  rec(parse(neutralizeCommentPipes(an.source, an.constructs)), null, 0)
  return parts.join('\n')
}

// The three views of a version are computed once per analysis (analyze() memoizes the current version, so
// the "before" side of every check is already in hand).
const cached = (an, key, fn) => (an.cache ??= {})[key] ?? (an.cache[key] = fn(an))

function check(before, after, expect) {
  const why = []
  if (cached(before, 'structure', structure) !== cached(after, 'structure', structure)) why.push('structure')
  if (cached(before, 'visibleText', visibleText) !== cached(after, 'visibleText', visibleText)) why.push('visible text')
  if (cached(before, 'rawBlocks', rawBlocks) !== cached(after, 'rawBlocks', rawBlocks)) why.push('block structure in other markdown viewers')
  if (expect && !expect(after)) why.push('annotation not found after the edit')
  return why
}

function finish(before, source, expect, summary, failHint) {
  const after = analyze(source)
  const why = check(before, after, expect)
  if (why.length) {
    const err = new EditError(failHint || "This edit would change how the document renders, so it wasn't saved.")
    err.detail = why.join(', ')
    throw err
  }
  return {source, summary}
}

// ---------------------------------------------------------------------------------------------------------
// Placing a new highlight.

function threadAt(an, start) {
  const t = an.threads.find((x) => x.start === start)
  if (!t) throw new EditError('That annotation is no longer in the file.')
  return t
}

function commentAt(an, start) {
  for (const t of an.threads) {
    const c = t.comments.find((x) => x.start === start)
    if (c) return {thread: t, comment: c}
  }
  throw new EditError('That comment is no longer in the file.')
}

function snap(an, start, end) {
  let changed = true
  let guard = 0
  while (changed && guard++ < 50) {
    changed = false
    visit(an.tree, (node, parent) => {
      if (!node.position || node.type === 'root') return
      const [s, e] = pos(node)
      const blockUnit = node.type === 'code' || (node.type === 'html' && parent && BLOCK_PARENTS.has(parent.type))
      // A bare URL (GFM literal autolink) is covered whole: a marker inside it would split the link elsewhere.
      const bareUrl = node.type === 'link' && !'[<'.includes(an.masked[s])
      const unit = blockUnit || INLINE_UNITS.has(node.type) || bareUrl
      if (!unit && !INLINE_CONTAINERS.has(node.type)) return
      const startIn = s < start && start < e
      const endIn = s < end && end < e
      if (unit || startIn !== endIn) {
        if (startIn) {
          start = s
          changed = true
        }
        if (endIn) {
          end = e
          changed = true
        }
      }
    })
  }
  let wrapStart = null
  let wrapEnd = null
  visit(an.tree, (node, parent) => {
    const blockUnit = node.type === 'code' || (node.type === 'html' && parent && BLOCK_PARENTS.has(parent.type))
    if (!blockUnit || !node.position) return
    const [s, e] = pos(node)
    if (s === start) wrapStart = node
    if (e === end) wrapEnd = node
  })
  return {start, end, wrapStart, wrapEnd}
}

export function addComment(source, {start, end, text, author, date}) {
  const t = cleanText(text)
  author = cleanAuthor(author)
  date = date || today()
  const an = analyze(source)
  start = Math.max(0, Math.min(source.length, start | 0))
  end = Math.max(start, Math.min(source.length, end | 0))
  while (start < end && /\s/.test(source[start])) start++
  while (end > start && /\s/.test(source[end - 1])) end--
  if (start === end) throw new EditError('Select some text first.')
  // A selection that starts or ends inside a word covers the whole word.
  while (start > 0 && WORD.test(source[start - 1]) && WORD.test(source[start])) start--
  while (end < source.length && WORD.test(source[end - 1]) && WORD.test(source[end])) end++

  // Inside an existing highlight (or suggestion): this is a reply to that thread.
  for (const th of an.threads) {
    const a = th.anchor
    if (!a) continue
    const [cs, ce] = a.kind === 'subst' ? [a.old[0], a.new[1]] : a.content
    if (start >= cs && end <= ce) return reply(source, {thread: th.start, text: t, author, date})
  }
  const overlaps = (s, e) => an.threads.some((th) => s < th.end && e > th.start)
  const OVERLAP =
    'The selection overlaps an existing annotation. Select text outside it, or reply to that annotation instead.'
  if (overlaps(start, end)) throw new EditError(OVERLAP)

  const sn = snap(an, start, end)
  if (overlaps(sn.start, sn.end)) throw new EditError(OVERLAP)
  const eol = nl(source)
  const comment = formatComment(author, date, t)

  let openAt = sn.start
  let openText = '{=='
  if (sn.wrapStart) {
    if (!isFenced(source, sn.wrapStart))
      throw new EditError('Comments can cover fenced code blocks but not indented code or raw HTML. Select the text around it.')
    const ls = lineStart(source, sn.start)
    const prefix = source.slice(ls, sn.start)
    if (!/^[ \t>]*$/.test(prefix))
      throw new EditError("This code block starts a list item, so a comment can't wrap it. Select the text around it.")
    openAt = ls
    openText = prefix + '{==' + eol
  }
  let closeText = '==}' + comment
  if (sn.wrapEnd) {
    if (!isFenced(source, sn.wrapEnd))
      throw new EditError('Comments can cover fenced code blocks but not indented code or raw HTML. Select the text around it.')
    const lastLine = source.slice(lineStart(source, sn.end), sn.end)
    const prefix = /^[ \t>]*/.exec(lastLine)[0]
    closeText = eol + prefix + '==}' + comment
  }
  const out = source.slice(0, openAt) + openText + source.slice(openAt, sn.end) + closeText + source.slice(sn.end)
  const newOpen = openAt + openText.length - 3 - (sn.wrapStart ? eol.length : 0)
  const commentStart = sn.end + openText.length + closeText.length - comment.length
  const expect = (after) =>
    after.threads.some(
      (th) =>
        th.anchor?.kind === 'highlight' &&
        th.anchor.start === newOpen &&
        th.comments.length === 1 &&
        th.comments[0].start === commentStart &&
        th.comments[0].text === t,
    )
  return finish(an, out, expect, `comment on ${JSON.stringify(source.slice(sn.start, sn.end))}`,
    t.includes('\n')
      ? "This comment can't be saved with a line break here (inside a table, a comment must stay on one line). Remove the line break, or comment on text outside the table."
      : "A comment can't be placed on this selection without changing how the document renders. Try a smaller selection, for example within one paragraph or table cell.")
}

// A comment about the whole document: its own paragraph above the first block (after any front matter).
export function addGeneral(source, {text, author, date}) {
  const t = cleanText(text)
  author = cleanAuthor(author)
  date = date || today()
  const an = analyze(source)
  const first = an.tree.children.find((c) => c.type !== 'yaml' && c.type !== 'toml')
  const eol = nl(source)
  const comment = formatComment(author, date, t)
  let at
  let ins
  if (first) {
    at = lineStart(source, pos(first)[0])
    ins = comment + eol + eol
  } else {
    at = source.length
    ins = (source.length && !source.endsWith('\n') ? eol + eol : source.length ? eol : '') + comment + eol
  }
  const out = source.slice(0, at) + ins + source.slice(at)
  const cstart = at + ins.indexOf('{>>')
  const expect = (after) => after.constructs.some((c) => c.kind === 'comment' && c.start === cstart && c.text === t)
  return finish(an, out, expect, 'general comment')
}

export function reply(source, {thread, text, author, date}) {
  const t = cleanText(text)
  author = cleanAuthor(author)
  date = date || today()
  const an = analyze(source)
  const th = threadAt(an, thread)
  const comment = formatComment(author, date, t)
  const out = source.slice(0, th.end) + comment + source.slice(th.end)
  const expect = (after) =>
    after.threads.some((x) => x.start === th.start && x.comments.length === th.comments.length + 1 && x.comments.at(-1).text === t)
  return finish(an, out, expect, `reply at line ${lineStartNo(source, th.start)}`,
    "This reply can't be saved without changing how the document renders (inside a table, a comment must stay on one line and can't contain |).")
}

export function editComment(source, {comment, text}) {
  const t = cleanText(text)
  const an = analyze(source)
  const {thread, comment: c} = commentAt(an, comment)
  const markup = c.author ? formatComment(c.author, c.date, t) : `{>>${t}<<}`
  const out = source.slice(0, c.start) + markup + source.slice(c.end)
  const expect = (after) =>
    after.threads.some((x) => x.start === thread.start && x.comments.some((y) => y.start === c.start && y.text === t))
  return finish(an, out, expect, `edit comment at line ${lineStartNo(source, c.start)}`,
    "This edit can't be saved without changing how the document renders (inside a table, a comment must stay on one line and can't contain |).")
}

// Remove ranges, and when a comment stood alone on its line, the line itself (and the blank line it leaves).
function removeRanges(source, ranges, loneLine) {
  const rs = [...ranges].sort((a, b) => b[0] - a[0])
  let out = source
  for (const [s, e] of rs) out = out.slice(0, s) + out.slice(e)
  if (loneLine) {
    const [s] = [...ranges].sort((a, b) => a[0] - b[0])[0]
    const ls = lineStart(out, s)
    const le = out.indexOf('\n', s)
    if (out.slice(ls, le === -1 ? out.length : le).trim() === '') {
      let cut = le === -1 ? out.length : le + 1
      const prevBlank = ls === 0 || /\n\s*\n$/.test(out.slice(0, ls)) || /^\n$/.test(out.slice(0, ls))
      const next = /^[ \t]*\r?\n/.exec(out.slice(cut))
      if (next && prevBlank) cut += next[0].length
      out = out.slice(0, ls) + out.slice(cut)
    }
  }
  return out
}

// The ranges that remove a highlight's markers. When a marker sits on a line of its own (a highlight wrapped
// around a fenced code block), the line break that put it there goes too.
function markerRanges(source, anchor) {
  let [o0, o1] = anchor.open
  let [c0, c1] = anchor.close
  const after = /^\r?\n/.exec(source.slice(o1))
  if (after && /^[ \t>]*$/.test(source.slice(lineStart(source, o0), o0))) {
    o0 = lineStart(source, o0)
    o1 += after[0].length
  }
  const before = /\r?\n[ \t>]*$/.exec(source.slice(0, c0))
  if (before && c0 - before[0].length >= o1) c0 -= before[0].length
  return [[o0, o1], [c0, c1]]
}

function ownLine(source, th) {
  const ls = lineStart(source, th.start)
  const le = source.indexOf('\n', th.end)
  return source.slice(ls, th.start).trim() === '' && source.slice(th.end, le === -1 ? source.length : le).trim() === ''
}

export function deleteComment(source, {comment}) {
  const an = analyze(source)
  const {thread, comment: c} = commentAt(an, comment)
  const ranges = [[c.start, c.end]]
  const last = thread.comments.length === 1
  if (last && thread.anchor?.kind === 'highlight') ranges.push(...markerRanges(source, thread.anchor))
  const lone = last && !thread.anchor && ownLine(source, thread)
  const out = removeRanges(source, ranges, lone)
  return finish(an, out, null, `delete comment at line ${lineStartNo(source, c.start)}`)
}

export function resolve(source, {thread}) {
  const an = analyze(source)
  const th = threadAt(an, thread)
  if (th.anchor && th.anchor.kind !== 'highlight')
    throw new EditError('Suggested insertions, deletions and substitutions are accepted or rejected in the file itself.')
  const ranges = th.comments.map((c) => [c.start, c.end])
  if (th.anchor) ranges.push(...markerRanges(source, th.anchor))
  const out = removeRanges(source, ranges, !th.anchor && ownLine(source, th))
  return finish(an, out, null, `resolve thread at line ${lineStartNo(source, th.start)}`)
}

function lineStartNo(source, off) {
  let n = 1
  for (let k = 0; k < off; k++) if (source.charCodeAt(k) === 10) n++
  return n
}
