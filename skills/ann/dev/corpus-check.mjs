// Read-only corpus check: renders every git-tracked .md under <root> and verifies each rendered span maps to its
// exact source slice; lists unplaced annotation threads and slow renders. Usage: node dev/corpus-check.mjs <repo root>
// Excludes docs numbered 98-/99- (they were being edited concurrently when this was written).
import fs from 'node:fs'
import {execSync} from 'node:child_process'
import {analyze, render} from '../lib/render.mjs'
import {spanMismatches} from '../test/helpers.mjs'
const root = process.argv[2]
const files = execSync(`git -C ${root} ls-files '*.md'`).toString().trim().split('\n').filter((f) => !/(^|\/)9[89]-/.test(f))
let tot = 0, bad = 0, spans = 0, threads = 0, unplaced = 0, slow = []
for (const f of files) {
  const src = fs.readFileSync(`${root}/${f}`, 'utf8')
  const t0 = performance.now()
  const an = analyze(src)
  const {html, placed} = render(an)
  const ms = performance.now() - t0
  if (ms > 150) slow.push(`${f} ${src.length}B ${ms.toFixed(0)}ms`)
  const r = spanMismatches(html, src)
  spans += r.n; tot++
  threads += an.threads.length
  const up = an.threads.filter(t => !placed.has(t.id) && (t.comments.length || t.anchor))
  unplaced += up.length
  for (const u of up) console.log('UNPLACED', f, 'offset', u.start, JSON.stringify(src.slice(u.start, u.end).slice(0, 80)))
  if (r.bad.length) { bad++; console.log('MISMATCH', f, JSON.stringify(r.bad.slice(0, 3))) }
}
console.log({files: tot, filesWithMismatch: bad, spans, threads, unplaced})
console.log('slow (>150ms):', slow.length ? '\n' + slow.join('\n') : 'none')
