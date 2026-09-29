// Markdown -> HTML where every visible character knows its offset in the source file.
//
// Each run of rendered text is emitted as <span data-s="offset">text</span> whose text equals
// source.slice(offset, offset + text.length). Text that cannot map one-to-one (a decoded entity, a whole code
// block) is emitted with data-s and data-e and is treated as a unit. The browser turns a selection into source
// offsets through these attributes alone.

import {fromMarkdown} from 'mdast-util-from-markdown'
import {gfm} from 'micromark-extension-gfm'
import {gfmFromMarkdown} from 'mdast-util-gfm'
import {frontmatter} from 'micromark-extension-frontmatter'
import {frontmatterFromMarkdown} from 'mdast-util-frontmatter'
import {decodeNamedCharacterReference} from 'decode-named-character-reference'
import {MASK, scan, threads, mask, lineOf} from './criticmarkup.mjs'

const MATTERS = ['yaml', 'toml']

export function parse(text) {
  const tree = fromMarkdown(text, {
    extensions: [gfm(), frontmatter(MATTERS)],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(MATTERS)],
  })
  repairPositions(tree, text)
  return tree
}

// The GFM literal-autolink transform (e.g. "see https://x.y." inside brackets) splits a text node into text and
// link nodes that carry no position. Recover them: the pieces appear in order between the neighbouring
// positioned siblings, so find each piece's text from a moving cursor. A piece that cannot be found keeps no
// position and renders as plain, unselectable text.
function repairPositions(tree, text) {
  const at = (s, e) => ({start: {offset: s}, end: {offset: e}})
  visit(tree, (parent) => {
    const kids = parent.children
    if (!kids || !parent.position || kids.every((k) => k.position)) return
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].position) continue
      let j = i
      while (j < kids.length && !kids[j].position) j++
      const from = i > 0 ? kids[i - 1].position.end.offset : parent.position.start.offset
      const limit = j < kids.length ? kids[j].position.start.offset : parent.position.end.offset
      let cursor = from
      for (let k = i; k < j; k++) {
        const node = kids[k]
        const value = node.type === 'text' ? node.value : node.children?.length === 1 && node.children[0].type === 'text' ? node.children[0].value : null
        if (value == null) continue
        const found = text.indexOf(value, cursor)
        if (found === -1 || found + value.length > limit) continue
        node.position = at(found, found + value.length)
        if (node.type !== 'text') node.children[0].position = at(found, found + value.length)
        cursor = found + value.length
      }
      // A text piece whose value differs from its source (continuation-line indentation, escapes) gets the gap
      // between its placed neighbours; align() maps the characters inside it.
      for (let k = i; k < j; k++) {
        const node = kids[k]
        if (node.position || node.type !== 'text' || !node.value) continue
        let s = k > i && kids[k - 1].position ? kids[k - 1].position.end.offset : from
        const e = k + 1 < j && kids[k + 1].position ? kids[k + 1].position.start.offset : limit
        while (s < e && text[s] !== node.value[0] && text[s] !== '\\' && text[s] !== '&') s++
        if (s < e) node.position = at(s, e)
      }
      i = j
    }
  })
}

export function visit(node, fn, parent = null) {
  fn(node, parent)
  if (node.children) for (const c of node.children) visit(c, fn, node)
}

export const pos = (n) => [n.position.start.offset, n.position.end.offset]

// Parse once raw (to find code blocks and front matter, where CriticMarkup is literal), scan, then parse the
// masked copy. One-entry memo: the server renders a version, then edits it, then renders the result; each
// step would otherwise parse the same source again (an edit on a 248 KB file took about 1 s without it).
let memo = null

export function analyze(source) {
  if (memo && memo.source === source) return memo
  const raw = parse(source)
  const excluded = []
  visit(raw, (n) => {
    if ((n.type === 'code' || MATTERS.includes(n.type)) && n.position) excluded.push(pos(n))
  })
  excluded.sort((a, b) => a[0] - b[0])
  const constructs = scan(source, excluded)
  const masked = constructs.length ? mask(source, constructs) : source
  const tree = constructs.length ? parse(masked) : raw
  memo = {source, raw, excluded, constructs, threads: threads(constructs), masked, tree, cache: {}}
  return memo
}

// ---------------------------------------------------------------------------------------------------------
// Aligning a node's value with its source slice.
//
// A text node's value is its source slice minus syntax: escapes (`\*`), blockquote markers and list
// indentation on continuation lines, carriage returns, the backticks of a code span. Entities are decoded.
// Walk both strings, keep runs where they agree character for character, skip syntax, and emit decoded
// entities as units.

const SKIPPABLE = new Set(['\\', '>', ' ', '\t', '\r', '\n', '`'])
const ENTITY = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/

function matchEntity(slice, j) {
  const m = ENTITY.exec(slice.slice(j, j + 40))
  if (!m) return null
  let decoded
  if (m[1]) decoded = String.fromCodePoint(Math.min(+m[1], 0x10ffff) || 0xfffd)
  else if (m[2]) decoded = String.fromCodePoint(Math.min(parseInt(m[2], 16), 0x10ffff) || 0xfffd)
  else decoded = decodeNamedCharacterReference(m[3])
  return decoded ? {len: m[0].length, decoded} : null
}

export function align(value, slice, base) {
  const segs = []
  let i = 0
  let j = 0
  let runV = -1
  let runJ = -1
  const flush = () => {
    if (runV >= 0 && i > runV) segs.push({s: base + runJ, e: base + runJ + (i - runV), text: value.slice(runV, i)})
    runV = -1
  }
  while (i < value.length) {
    if (j >= slice.length) {
      flush()
      segs.push({s: base + slice.length, e: base + slice.length, text: value.slice(i), atomic: true})
      break
    }
    const sc = slice[j]
    if (sc === '&') {
      const ent = matchEntity(slice, j)
      if (ent && !value.startsWith(slice.slice(j, j + ent.len), i) && value.startsWith(ent.decoded, i)) {
        flush()
        segs.push({s: base + j, e: base + j + ent.len, text: ent.decoded, atomic: true})
        i += ent.decoded.length
        j += ent.len
        continue
      }
    }
    if (value[i] === sc) {
      if (runV < 0) {
        runV = i
        runJ = j
      }
      i++
      j++
      continue
    }
    flush()
    if (SKIPPABLE.has(sc)) {
      j++
      continue
    }
    // Unexpected difference: map the rest of the value to the rest of the slice as one unit.
    segs.push({s: base + j, e: base + slice.length, text: value.slice(i), atomic: true})
    break
  }
  flush()
  return segs
}

// ---------------------------------------------------------------------------------------------------------
// Rendering.

const K_NORMAL = 0
const K_HIDDEN = 1
const K_HL = 2
const K_INS = 3
const K_DEL = 4
const K_OLD = 5
const K_NEW = 6
const WRAP = {
  [K_HL]: (t) => [`<mark class="cm-hl" data-t="${t}">`, '</mark>'],
  [K_INS]: (t) => [`<ins class="cm-ins" data-t="${t}">`, '</ins>'],
  [K_DEL]: (t) => [`<del class="cm-del" data-t="${t}">`, '</del>'],
  [K_OLD]: (t) => [`<del class="cm-del cm-old" data-t="${t}">`, '</del>'],
  [K_NEW]: (t) => [`<ins class="cm-ins cm-new" data-t="${t}">`, '</ins>'],
}

export const esc = (s) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])

function safeUrl(url) {
  const u = (url || '').trim()
  if (/^(https?:|mailto:|#)/i.test(u)) return u
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null // javascript:, data:, file: ...
  return u // relative
}

function slugger() {
  const seen = new Map()
  return (text) => {
    let slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-')
    const n = seen.get(slug) || 0
    seen.set(slug, n + 1)
    return n ? `${slug}-${n}` : slug
  }
}

function plainText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value.replaceAll(MASK, '')
  return (node.children || []).map(plainText).join('')
}

// Relative link targets are served by the server under files/, resolved against the document's directory.
function linkHref(url) {
  const u = safeUrl((url || '').replaceAll(MASK, ''))
  if (u === null) return null
  if (/^(https?:|mailto:|#)/i.test(u)) return u
  return 'files/' + u.replace(/^\.\//, '')
}

export function render(an) {
  const {source, masked, tree} = an
  const n = source.length
  const kind = new Uint8Array(n)
  const tid = new Int32Array(n).fill(-1)
  const fill = ([s, e], k, t) => {
    for (let x = s; x < e; x++) {
      kind[x] = k
      tid[x] = t
    }
  }
  const anchorAt = new Map()
  for (const t of an.threads) {
    const a = t.anchor
    if (a) {
      if (a.kind === 'subst') {
        fill(a.old, K_OLD, t.id)
        fill(a.new, K_NEW, t.id)
        fill(a.mid, K_HIDDEN, t.id)
      } else fill(a.content, a.kind === 'highlight' ? K_HL : a.kind === 'insert' ? K_INS : K_DEL, t.id)
      fill(a.open, K_HIDDEN, t.id)
      fill(a.close, K_HIDDEN, t.id)
    }
    for (const c of t.comments) fill([c.start, c.end], K_HIDDEN, t.id)
    if (t.comments.length) anchorAt.set(t.comments[0].start, t.id)
  }

  const placed = new Set()
  const defs = new Map()
  visit(tree, (node) => {
    if (node.type === 'definition') defs.set(node.identifier, node)
  })
  const slug = slugger()

  const wrapped = (k, t, inner) => {
    if (k === K_NORMAL || k === K_HIDDEN) return inner
    placed.add(t)
    const [o, c] = WRAP[k](t)
    return o + inner + c
  }

  // Emit the characters [s, e) of the source that one aligned segment covers.
  function emitRun(s, e) {
    let out = ''
    let x = s
    while (x < e) {
      const k = kind[x]
      const t = tid[x]
      let y = x + 1
      while (y < e && kind[y] === k && tid[y] === t) y++
      if (k === K_HIDDEN) {
        for (let z = x; z < y; z++) {
          if (anchorAt.has(z)) {
            const id = anchorAt.get(z)
            placed.add(id)
            out += `<span class="cm-anchor" data-anchor="${id}" contenteditable="false"></span>`
          }
        }
      } else {
        out += wrapped(k, t, `<span data-s="${x}">${esc(source.slice(x, y))}</span>`)
      }
      x = y
    }
    return out
  }

  function emitText(value, s, e) {
    let out = ''
    for (const seg of align(value, masked.slice(s, e), s)) {
      if (seg.atomic) {
        const k = seg.s < n ? kind[seg.s] : K_NORMAL
        if (k === K_HIDDEN) continue
        const inner = `<span data-s="${seg.s}" data-e="${seg.e}">${esc(seg.text.replaceAll(MASK, ''))}</span>`
        out += wrapped(k, seg.s < n ? tid[seg.s] : -1, inner)
      } else out += emitRun(seg.s, seg.e)
    }
    return out
  }

  // A block rendered as one unit (code, raw HTML): selectable as a whole, highlighted as a whole.
  function blockUnit(node, tag, cls, inner) {
    const [s, e] = pos(node)
    let k = K_NORMAL
    let t = -1
    for (let x = s; x < e; x++) {
      if (kind[x] !== K_NORMAL && kind[x] !== K_HIDDEN) {
        k = kind[x]
        t = tid[x]
        break
      }
    }
    const el = `<${tag} class="${cls}" data-s="${s}" data-e="${e}">${inner}</${tag}>`
    if (k === K_NORMAL) return el
    placed.add(t)
    return `<div class="cm-block ${k === K_HL ? 'cm-hl' : k === K_DEL || k === K_OLD ? 'cm-del' : 'cm-ins'}" data-t="${t}">${el}</div>`
  }

  const kids = (node) => (node.children || []).map((c) => r(c, node)).join('')

  function r(node, parent) {
    switch (node.type) {
      case 'root':
        return kids(node)
      case 'paragraph':
        return `<p>${kids(node)}</p>`
      case 'heading': {
        const id = slug(plainText(node))
        return `<h${node.depth} id="${esc(id)}">${kids(node)}</h${node.depth}>`
      }
      case 'thematicBreak':
        return '<hr>'
      case 'blockquote':
        return `<blockquote>${kids(node)}</blockquote>`
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul'
        const start = node.ordered && node.start != null && node.start !== 1 ? ` start="${node.start}"` : ''
        return `<${tag}${start} class="${node.spread ? 'loose' : 'tight'}">${kids(node)}</${tag}>`
      }
      case 'listItem': {
        const box =
          node.checked == null ? '' : `<input type="checkbox" disabled${node.checked ? ' checked' : ''}> `
        return `<li${node.checked == null ? '' : ' class="task"'}>${box}${kids(node)}</li>`
      }
      case 'table': {
        const align = node.align || []
        const rows = node.children.map((row, ri) => {
          const cells = row.children.map((cell, ci) => {
            const tag = ri === 0 ? 'th' : 'td'
            const a = align[ci] ? ` style="text-align:${align[ci]}"` : ''
            return `<${tag}${a}>${kids(cell)}</${tag}>`
          })
          return `<tr>${cells.join('')}</tr>`
        })
        const head = rows.length ? `<thead>${rows[0]}</thead>` : ''
        return `<div class="table-wrap"><table>${head}<tbody>${rows.slice(1).join('')}</tbody></table></div>`
      }
      case 'code': {
        const lang = node.lang ? `<span class="lang">${esc(node.lang)}</span>` : ''
        return blockUnit(node, 'pre', 'code', `${lang}<code>${esc(node.value)}</code>`)
      }
      case 'html':
        if (parent && (parent.type === 'root' || parent.type === 'blockquote' || parent.type === 'listItem'))
          return blockUnit(node, 'pre', 'raw-html', esc(node.value.replaceAll(MASK, '')))
        return `<code class="raw-html">${esc(node.value.replaceAll(MASK, ''))}</code>`
      case 'yaml':
      case 'toml':
        return `<pre class="frontmatter" title="front matter">${esc(node.value)}</pre>`
      case 'definition':
        return ''
      case 'footnoteDefinition':
        return `<div class="footnote" id="fn-${esc(node.identifier)}"><sup>${esc(node.label || node.identifier)}</sup>${kids(node)}</div>`
      case 'footnoteReference':
        return `<sup class="fnref"><a href="#fn-${esc(node.identifier)}">${esc(node.label || node.identifier)}</a></sup>`
      case 'text':
        return node.position ? emitText(node.value, ...pos(node)) : esc(node.value.replaceAll(MASK, ''))
      case 'inlineCode':
        return `<code>${node.position ? emitText(node.value, ...pos(node)) : esc(node.value.replaceAll(MASK, ''))}</code>`
      case 'emphasis':
        return `<em>${kids(node)}</em>`
      case 'strong':
        return `<strong>${kids(node)}</strong>`
      case 'delete':
        return `<s>${kids(node)}</s>`
      case 'break':
        return '<br>'
      case 'link': {
        const href = linkHref(node.url)
        const title = node.title ? ` title="${esc(node.title)}"` : ` title="${esc(node.url)}"`
        return href === null
          ? `<span class="link"${title}>${kids(node)}</span>`
          : `<a href="${esc(href)}"${title} target="_blank" rel="noopener noreferrer">${kids(node)}</a>`
      }
      case 'linkReference': {
        const def = defs.get(node.identifier)
        const href = def ? linkHref(def.url) : null
        return href === null
          ? `<span class="link">${kids(node)}</span>`
          : `<a href="${esc(href)}" title="${esc(def.url)}" target="_blank" rel="noopener noreferrer">${kids(node)}</a>`
      }
      case 'image':
      case 'imageReference': {
        const url = node.type === 'image' ? node.url : defs.get(node.identifier)?.url
        const src = linkHref(url)
        return src === null ? `<span class="link">[${esc(node.alt || 'image')}]</span>` : `<img src="${esc(src)}" alt="${esc(node.alt || '')}">`
      }
      default:
        return node.children ? kids(node) : ''
    }
  }

  const html = r(tree, null)
  return {html, placed}
}

// Thread summaries for the browser.
export function threadInfo(an, placed) {
  const {source} = an
  return an.threads.map((t) => {
    const a = t.anchor
    let quote = ''
    if (a && a.kind === 'subst') quote = `${source.slice(...a.old)} → ${source.slice(...a.new)}`
    else if (a) quote = source.slice(...a.content)
    return {
      id: t.id,
      kind: t.kind,
      start: t.start,
      end: t.end,
      line: lineOf(source, t.start),
      quote,
      placed: placed.has(t.id),
      comments: t.comments.map((c) => ({start: c.start, author: c.author, date: c.date, text: c.text})),
    }
  })
}
