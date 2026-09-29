import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addComment, addGeneral, reply, editComment, deleteComment, resolve, EditError} from '../lib/edit.mjs'
import {analyze, render} from '../lib/render.mjs'
import {spanMismatches} from './helpers.mjs'

const D = {author: 'you', date: '2026-09-25'}
const sel = (src, text, n = 0) => {
  let at = -1
  for (let k = 0; k <= n; k++) at = src.indexOf(text, at + 1)
  assert.ok(at >= 0, `"${text}" not in source`)
  return {start: at, end: at + text.length}
}
const add = (src, text, comment = 'c', n = 0) => addComment(src, {...sel(src, text, n), text: comment, ...D}).source
const rejects = (fn, re) => assert.throws(fn, (e) => e instanceof EditError && (!re || re.test(e.message)))

test('plain selection in a paragraph', () => {
  assert.equal(add('Hello brave new world.\n', 'brave new'), 'Hello {==brave new==}{>>you|2026-09-25: c<<} world.\n')
})

test('surrounding whitespace is trimmed off the selection', () => {
  const src = 'Hello brave new world.\n'
  const out = addComment(src, {start: 5, end: 16, text: 'c', ...D}).source
  assert.equal(out, 'Hello {==brave new==}{>>you|2026-09-25: c<<} world.\n')
})

test('selection half inside bold expands to cover the bold', () => {
  assert.equal(add('a **bold text** b\n', 'text** b'), 'a {==**bold text** b==}{>>you|2026-09-25: c<<}\n')
})

test('selection wholly inside bold stays inside it', () => {
  assert.equal(add('a **bold text** b\n', 'bold'), 'a **{==bold==}{>>you|2026-09-25: c<<} text** b\n')
})

test('inline code is covered whole', () => {
  assert.equal(add('run `npm ci` now\n', 'npm'), 'run {==`npm ci`==}{>>you|2026-09-25: c<<} now\n')
})

test('link text half selected expands to the link', () => {
  assert.equal(add('see [the docs](http://x.y) here\n', 'docs](http://x.y) here'), 'see {==[the docs](http://x.y) here==}{>>you|2026-09-25: c<<}\n')
})

test('a selection inside a bare URL covers the whole URL', () => {
  assert.equal(add('see https://x.y/path here\n', 'x.y'), 'see {==https://x.y/path==}{>>you|2026-09-25: c<<} here\n')
})

test('selection across two list items', () => {
  const out = add('- one two\n- three four\n', 'two\n- three')
  assert.equal(out, '- one {==two\n- three==}{>>you|2026-09-25: c<<} four\n')
})

test('selection across paragraphs', () => {
  const out = add('First para.\n\nSecond para.\n', 'para.\n\nSecond')
  assert.equal(out, 'First {==para.\n\nSecond==}{>>you|2026-09-25: c<<} para.\n')
})

test('table cell', () => {
  const src = '| a | b |\n|---|---|\n| x y | z |\n'
  assert.equal(add(src, 'y'), '| a | b |\n|---|---|\n| x {==y==}{>>you|2026-09-25: c<<} | z |\n')
})

test('a pipe in a comment inside a table is accepted (the author|date prefix has one anyway)', () => {
  const src = '| a | b |\n|---|---|\n| x y | z |\n'
  assert.equal(add(src, 'y', 'use a|b'), '| a | b |\n|---|---|\n| x {==y==}{>>you|2026-09-25: use a|b<<} | z |\n')
})

test('a line break in a table comment is refused', () => {
  rejects(() => add('| a |\n|---|\n| x y |\n', 'y', 'one\ntwo'), /line break/)
})

test('a blank line in a comment is refused', () => {
  rejects(() => add('Hello world.\n', 'world', 'one\n\ntwo'), /line break/)
})

test('a single line break in a paragraph comment is fine', () => {
  assert.equal(add('Hello world.\n', 'world', 'one\ntwo'), 'Hello {==world==}{>>you|2026-09-25: one\ntwo<<}.\n')
})

test('comment text cannot close the comment early', () => {
  rejects(() => add('Hello world.\n', 'world', 'bad <<} text'), /<<\}/)
})

test('empty comment is refused', () => {
  rejects(() => add('Hello world.\n', 'world', '   '), /empty/)
})

test('fenced code block is wrapped on lines of its own', () => {
  const src = 'Intro.\n\n```js\nlet x = 1\n```\n\nAfter.\n'
  const out = add(src, 'x = 1')
  assert.equal(out, 'Intro.\n\n{==\n```js\nlet x = 1\n```\n==}{>>you|2026-09-25: c<<}\n\nAfter.\n')
})

test('fenced code inside a blockquote keeps the quote prefix', () => {
  const src = '> Intro.\n>\n> ```\n> code\n> ```\n'
  const out = add(src, 'code')
  assert.equal(out, '> Intro.\n>\n> {==\n> ```\n> code\n> ```\n> ==}{>>you|2026-09-25: c<<}\n')
})

test('code block that opens a list item is refused', () => {
  rejects(() => add('- ```\n  code\n  ```\n', 'code'), /list item/)
})

test('escaped characters and entities map back exactly', () => {
  const src = 'Price \\*not\\* bold &amp; fine.\n'
  const an = analyze(src)
  const {html} = render(an)
  assert.deepEqual(spanMismatches(html, src).bad, [])
  assert.equal(add(src, 'not\\*'), 'Price \\*{==not\\*==}{>>you|2026-09-25: c<<} bold &amp; fine.\n')
})

test('selecting inside an existing highlight replies to it', () => {
  const src = 'A {==big idea==}{>>you|2026-09-01: first<<} here.\n'
  const out = add(src, 'big')
  assert.equal(out, 'A {==big idea==}{>>you|2026-09-01: first<<}{>>you|2026-09-25: c<<} here.\n')
})

test('selection overlapping an existing annotation is refused', () => {
  const src = 'A {==big idea==}{>>you|2026-09-01: first<<} here and there.\n'
  rejects(() => addComment(src, {start: src.indexOf('idea'), end: src.indexOf('and'), text: 'x', ...D}), /overlaps/)
})

test('reply, edit, delete, resolve round trip', () => {
  const src = 'Hello world.\n'
  let s = add(src, 'world', 'first')
  const an = analyze(s)
  const th = an.threads[0]
  s = reply(s, {thread: th.start, text: 'second', ...D}).source
  assert.equal(s, 'Hello {==world==}{>>you|2026-09-25: first<<}{>>you|2026-09-25: second<<}.\n')
  const c2 = analyze(s).threads[0].comments[1]
  s = editComment(s, {comment: c2.start, text: 'second, edited'}).source
  assert.match(s, /second, edited<<}/)
  const c1 = analyze(s).threads[0].comments[0]
  s = deleteComment(s, {comment: c1.start}).source
  assert.equal(s, 'Hello {==world==}{>>you|2026-09-25: second, edited<<}.\n')
  const c = analyze(s).threads[0].comments[0]
  assert.equal(deleteComment(s, {comment: c.start}).source, src, 'deleting the last comment removes the highlight')
  assert.equal(resolve(s, {thread: analyze(s).threads[0].start}).source, src)
})

test('edit keeps the original author and date', () => {
  const src = 'x {==y==}{>>alice|2026-01-02: old<<}\n'
  const c = analyze(src).threads[0].comments[0]
  assert.equal(editComment(src, {comment: c.start, text: 'new'}).source, 'x {==y==}{>>alice|2026-01-02: new<<}\n')
})

test('general comment goes above the first block, after front matter, and resolves cleanly', () => {
  const src = '---\ndate: x\n---\n\n# Title\n\nBody.\n'
  const out = addGeneral(src, {text: 'overall', ...D}).source
  assert.equal(out, '---\ndate: x\n---\n\n{>>you|2026-09-25: overall<<}\n\n# Title\n\nBody.\n')
  assert.equal(resolve(out, {thread: analyze(out).threads[0].start}).source, src)
  const plain = '# Title\n'
  const out2 = addGeneral(plain, {text: 'overall', ...D}).source
  assert.equal(out2, '{>>you|2026-09-25: overall<<}\n\n# Title\n')
  assert.equal(resolve(out2, {thread: analyze(out2).threads[0].start}).source, plain)
})

test('CriticMarkup inside code blocks is literal, inside inline code it is live', () => {
  const src = '```\n{==a==}{>>you|2026-01-01: not real<<}\n```\n\nSee `{==B==}{>>you|2026-01-01: real<<}` here.\n'
  const an = analyze(src)
  assert.equal(an.threads.length, 1)
  assert.equal(an.threads[0].comments[0].text, 'real')
  const {html, placed} = render(an)
  assert.ok(placed.has(0))
  assert.deepEqual(spanMismatches(html, src).bad, [])
})

test('substitution is not mistaken for strikethrough', () => {
  const src = 'Say {~~hello~>goodbye~~} now.\n'
  const {html} = render(analyze(src))
  assert.match(html, /<del class="cm-del cm-old" data-t="0"><span data-s="\d+">hello<\/span><\/del>/)
  assert.match(html, /<ins class="cm-ins cm-new" data-t="0"><span data-s="\d+">goodbye<\/span><\/ins>/)
  assert.doesNotMatch(html, /<s>/)
})

test('CRLF files keep CRLF', () => {
  const src = 'Intro.\r\n\r\n```\r\ncode\r\n```\r\n'
  const out = add(src, 'code')
  assert.equal(out, 'Intro.\r\n\r\n{==\r\n```\r\ncode\r\n```\r\n==}{>>you|2026-09-25: c<<}\r\n')
})

test('a selection that starts or ends inside a word covers the whole word', () => {
  const src = 'Alpha bravo charlie.\n'
  const out = addComment(src, {start: src.indexOf('pha'), end: src.indexOf('bra') + 3, text: 'c', ...D}).source
  assert.equal(out, '{==Alpha bravo==}{>>you|2026-09-25: c<<} charlie.\n')
})

test('resolving a highlight wrapped around a code block restores the file exactly', () => {
  for (const src of ['Intro.\n\n```js\nlet x = 1\n```\n\nAfter.\n', '> Intro.\n>\n> ```\n> code\n> ```\n', 'Text before\n```\ncode\n```\ntext after\n']) {
    const out = add(src, src.includes('x = 1') ? 'x = 1' : 'code')
    assert.equal(resolve(out, {thread: analyze(out).threads[0].start}).source, src)
    const c = analyze(out).threads[0].comments[0]
    assert.equal(deleteComment(out, {comment: c.start}).source, src)
  }
})

test('a selection from a paragraph into a code block wraps only the end', () => {
  const src = 'Text before\n```\ncode\n```\ntext after\n'
  const out = addComment(src, {start: 0, end: src.indexOf('code') + 2, text: 'c', ...D}).source
  assert.equal(out, '{==Text before\n```\ncode\n```\n==}{>>you|2026-09-25: c<<}\ntext after\n')
  assert.equal(resolve(out, {thread: analyze(out).threads[0].start}).source, src)
})
