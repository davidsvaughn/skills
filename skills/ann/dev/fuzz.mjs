// Usage: node dev/fuzz.mjs <samples-out.json> <repo root>. Random selections on real docs, in memory only;
// every accepted edit is undone by hand and compared with the original byte for byte.
// Two passes: (1) random selections anywhere (new highlights, or replies when the selection falls inside an
// existing highlight); (2) selections placed inside existing highlights on purpose, so replies get exercised
// even though few docs carry annotations. Nothing is written back.
import fs from 'node:fs'
import {execSync} from 'node:child_process'
import {analyze, render} from '../lib/render.mjs'
import {addComment, resolve, deleteComment, EditError} from '../lib/edit.mjs'
import {spanMismatches} from '../test/helpers.mjs'
const root = process.argv[3]
if (!root) { console.error('Usage: node dev/fuzz.mjs <samples-out.json> <repo root>'); process.exit(2) }
let seed = 12345
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const files = execSync(`git -C ${root} ls-files '*.md'`).toString().trim().split('\n').filter((f) => !/(^|\/)9[89]-/.test(f))
const picks = []; for (let k = 0; k < 60; k++) picks.push(files[rnd(files.length)])
const stats = {ok: 0, reply: 0, refused: {}, bugs: 0, replyPass: {ok: 0, refused: 0, docs: 0}}
const samples = {ok: [], refused: [], replies: []}

// Strip exactly what one accepted addComment added and compare with the original.
function checkAdded(f, src, out, k, start, end) {
  const an = analyze(out)
  const mine = an.threads.filter((t) => t.comments.some((c) => c.text === `fuzz ${k}`))
  if (mine.length !== 1) { stats.bugs++; console.log('NOT FOUND', f, start, end); return null }
  const th = mine[0]
  // A reply joins a thread that existed before the edit (its anchor start is unchanged, since the comment is
  // appended after it); a new highlight has a new anchor.
  const isReply = analyze(src).threads.some((t) => t.anchor && t.start === th.start)
  const c = th.comments.find((x) => x.text === `fuzz ${k}`)
  let stripped = out.slice(0, c.start) + out.slice(c.end)
  let wrapped = false
  if (!isReply) {
    let [o0, o1] = th.anchor.open
    let [c0, c1] = th.anchor.close
    const before = /\r?\n[ \t>]*$/.exec(stripped.slice(0, c0))
    if (before && /[`~]$/.test(stripped.slice(0, c0 - before[0].length))) { c0 -= before[0].length; wrapped = true }
    stripped = stripped.slice(0, c0) + stripped.slice(c1)
    const after = /^\r?\n/.exec(stripped.slice(o1))
    if (after && /^[ \t>]*(```|~~~)/.test(stripped.slice(o1 + after[0].length))) {
      o1 += after[0].length
      o0 = stripped.lastIndexOf('\n', o0 - 1) + 1
      wrapped = true
    }
    stripped = stripped.slice(0, o0) + stripped.slice(o1)
  }
  if (stripped !== src) { stats.bugs++; console.log('STRIP MISMATCH', f, start, end, JSON.stringify(out.slice(th.start - 20, th.end + 5).slice(0, 200))); return null }
  const r = spanMismatches(render(an).html, out)
  if (r.bad.length) { stats.bugs++; console.log('SPAN MISMATCH', f, JSON.stringify(r.bad[0])); return null }
  // The tool's own undo paths must give the original back too: deleting the new comment (which removes the
  // highlight when it was the only comment), and resolving a new highlight thread.
  const del = deleteComment(out, {comment: c.start}).source
  if (del !== src) { stats.bugs++; console.log('DELETE MISMATCH', f, start, end); return null }
  if (!isReply) {
    const back = resolve(out, {thread: th.start}).source
    if (back !== src) { stats.bugs++; console.log('RESOLVE MISMATCH', f); return null }
  }
  return {th, isReply, wrapped}
}

for (const f of picks) {
  const src = fs.readFileSync(`${root}/${f}`, 'utf8')
  if (src.length > 120000) continue
  const {html} = render(analyze(src))
  const spans = [...html.matchAll(/<(?:span|pre class="code") data-s="(\d+)"(?: data-e="(\d+)")?>([^<]*)/g)].map((m) => ({s: +m[1], e: m[2] ? +m[2] : +m[1] + m[3].replace(/&(amp|lt|gt|quot);/g, 'x').length}))
  if (spans.length < 2) continue
  for (let k = 0; k < 25; k++) {
    const a = rnd(spans.length)
    const b = Math.min(spans.length - 1, a + rnd(k % 5 === 0 ? 40 : 6))
    const start = spans[a].s + rnd(Math.max(1, spans[a].e - spans[a].s))
    const end = Math.max(start + 1, spans[b].s + 1 + rnd(Math.max(1, spans[b].e - spans[b].s)))
    let out
    try {
      out = addComment(src, {start, end, text: `fuzz ${k}`, author: 'you', date: '2026-09-25'}).source
    } catch (e) {
      if (!(e instanceof EditError)) { stats.bugs++; console.log('CRASH', f, start, end, e.stack.split('\n').slice(0, 3).join(' | ')); continue }
      const key = e.message.slice(0, 50) + (e.detail ? ` [${e.detail}]` : '')
      stats.refused[key] = (stats.refused[key] || 0) + 1
      if (samples.refused.length < 400) samples.refused.push({f, key, sel: src.slice(start, end)})
      continue
    }
    const r = checkAdded(f, src, out, k, start, end)
    if (!r) continue
    r.isReply ? stats.reply++ : stats.ok++
    if (samples.ok.length < 400 || r.wrapped) samples.ok.push({f, wrapped: r.wrapped, sel: src.slice(start, end), placed: out.slice(Math.max(0, r.th.start - 30), Math.min(out.length, r.th.end + 10))})
  }
}

// Pass 2: every doc that carries highlights; random selections inside each highlight's content.
for (const f of files) {
  const src = fs.readFileSync(`${root}/${f}`, 'utf8')
  if (src.length > 120000 || !src.includes('{==')) continue
  const an = analyze(src)
  const hls = an.threads.filter((t) => t.anchor && (t.anchor.kind === 'highlight' || t.anchor.kind === 'insert' || t.anchor.kind === 'delete'))
  if (!hls.length) continue
  stats.replyPass.docs++
  hls.forEach((t, i) => {
    const [cs, ce] = t.anchor.content
    if (ce - cs < 2) return
    const k = 1000 + i
    const start = cs + rnd(ce - cs - 1)
    const end = Math.min(ce, start + 1 + rnd(Math.max(1, ce - start)))
    let out
    try {
      out = addComment(src, {start, end, text: `fuzz ${k}`, author: 'you', date: '2026-09-25'}).source
    } catch (e) {
      if (!(e instanceof EditError)) { stats.bugs++; console.log('CRASH(reply)', f, start, end, e.stack.split('\n').slice(0, 3).join(' | ')); return }
      stats.replyPass.refused++
      samples.replies.push({f, refused: e.message, detail: e.detail, sel: src.slice(start, end)})
      return
    }
    const r = checkAdded(f, src, out, k, start, end)
    if (!r) return
    if (!r.isReply) { stats.bugs++; console.log('NOT A REPLY', f, start, end); return }
    stats.replyPass.ok++
    samples.replies.push({f, sel: src.slice(start, end), placed: out.slice(Math.max(0, r.th.start - 20), Math.min(out.length, r.th.end + 5)).slice(0, 400)})
  })
}
console.log(JSON.stringify(stats, null, 1))
fs.writeFileSync(process.argv[2], JSON.stringify(samples, null, 1))
