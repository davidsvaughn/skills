// The annotation page. All state is the document the server sends; every action posts an edit and re-renders
// from the response. The composer lives outside the document DOM so a re-render never destroys typed text.
'use strict'

const $ = (sel, el = document) => el.querySelector(sel)
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]
const docEl = $('#doc')
const cardsEl = $('#cards')
const marginEl = $('#margin')
const composerEl = $('#composer')
const textEl = $('#composer-text')
const fabEl = $('#fab')
const narrow = matchMedia('(max-width: 1000px)')

const state = {
  doc: null,
  connected: false,
  busy: false,
  pending: null, // {start, end, quote, range} from the current selection
  composer: null, // {mode: 'new'|'general'|'reply'|'edit', key, start, end, quote, thread, comment, stale}
  drafts: new Map(),
}

// ---------------------------------------------------------------------------------------------------------
// Server

async function getDoc() {
  const r = await fetch('api/doc', {cache: 'no-store'})
  if (!r.ok) throw new Error(`api/doc ${r.status}`)
  return r.json()
}

async function post(path, body) {
  const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
  let j = {}
  try {
    j = await r.json()
  } catch {}
  return {ok: r.ok, status: r.status, ...j}
}

function connect() {
  const es = new EventSource('api/events')
  es.addEventListener('hello', async (e) => {
    setConnected(true)
    const {version} = JSON.parse(e.data)
    if (!state.doc || state.doc.version !== version) applyDoc(await getDoc())
  })
  es.addEventListener('doc', async (e) => {
    const {version} = JSON.parse(e.data)
    if (state.doc && state.doc.version === version) return
    applyDoc(await getDoc())
  })
  es.onerror = () => setConnected(false)
}

function setConnected(on) {
  state.connected = on
  document.body.classList.toggle('offline', !on)
  setStatus(on ? 'connected' : 'lost', on ? 'connected' : 'server stopped')
  for (const b of [$('#general'), $('#undo'), fabEl]) b.disabled = !on
}

let statusTimer = null
function setStatus(stateName, text, revertMs = 0) {
  const el = $('#status')
  el.dataset.state = stateName
  el.textContent = text
  clearTimeout(statusTimer)
  if (revertMs) statusTimer = setTimeout(() => setConnected(state.connected), revertMs)
}

let toastTimer = null
function toast(msg, ms = 2500) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), ms)
}

// ---------------------------------------------------------------------------------------------------------
// Rendering

function applyDoc(d) {
  const prev = state.doc
  const y = window.scrollY
  state.doc = d
  document.title = `${d.name} · ann`
  $('#title').textContent = d.name
  $('#title').title = d.file
  docEl.innerHTML = d.html
  for (const img of $$('img', docEl)) img.addEventListener('load', layout, {once: true})
  renderCards()
  window.scrollTo(0, y)
  if (prev && prev.version !== d.version && state.composer) composerDocChanged()
  layout()
}

function renderCards() {
  cardsEl.textContent = ''
  const d = state.doc
  let n = 0
  const threads = [...d.threads].sort((a, b) => (a.placed === b.placed ? a.start - b.start : a.placed ? 1 : -1))
  for (const t of threads) {
    n += t.comments.length
    cardsEl.appendChild(card(t))
  }
  $('#count').textContent = n ? `${n} comment${n === 1 ? '' : 's'}` : 'no comments'
}

const KIND = {highlight: 'Highlight', point: 'Comment', insert: 'Insertion', delete: 'Deletion', subst: 'Substitution'}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v != null) e.setAttribute(k, v)
  }
  for (const c of children) if (c != null) e.append(c)
  return e
}

function card(t) {
  const c = el('div', {class: 'card' + (t.placed ? '' : ' unplaced-card'), 'data-t': t.id})
  const head = el('div', {class: 'card-head'}, el('span', {class: 'kind', text: KIND[t.kind] || t.kind}))
  head.append(t.placed ? el('span', {class: 'line', text: `line ${t.line}`}) : el('span', {class: 'unplaced', text: `line ${t.line} · not shown in the text`}))
  c.append(head)
  if (t.quote) c.append(el('blockquote', {class: 'quote', text: t.quote}))
  const list = el('div', {class: 'comments'})
  for (const cm of t.comments) {
    const editing = state.composer?.mode === 'edit' && state.composer.comment === cm.start
    const item = el('div', {class: 'comment' + (editing ? ' editing' : ''), 'data-c': cm.start})
    const meta = el('div', {class: 'meta'}, el('b', {text: cm.author || 'comment'}), el('span', {text: cm.date || ''}))
    const actions = el(
      'span',
      {class: 'actions'},
      el('button', {class: 'link-btn', type: 'button', text: 'Edit', onclick: () => openComposer('edit', {thread: t, comment: cm})}),
      el('button', {class: 'link-btn danger', type: 'button', text: 'Delete', onclick: () => act('api/delete', {comment: cm.start}, 'deleted')}),
    )
    meta.append(actions)
    item.append(meta, el('div', {class: 'text', text: cm.text}))
    list.append(item)
  }
  c.append(list)
  const acts = el('div', {class: 'card-actions'}, el('button', {class: 'link-btn', type: 'button', text: 'Reply', onclick: () => openComposer('reply', {thread: t})}))
  if (t.kind === 'highlight' || t.kind === 'point')
    acts.append(el('button', {class: 'link-btn', type: 'button', text: 'Resolve', onclick: () => act('api/resolve', {thread: t.start}, 'resolved')}))
  c.append(acts)
  c.addEventListener('mouseenter', () => setHot(t.id, true))
  c.addEventListener('mouseleave', () => setHot(t.id, false))
  return c
}

function marksOf(id) {
  return $$(`[data-t="${id}"]`, docEl)
}

function setHot(id, on) {
  for (const m of marksOf(id)) m.classList.toggle('hot', on)
  const c = $(`.card[data-t="${id}"]`, cardsEl)
  if (c) c.classList.toggle('hot', on)
}

function focusCard(id) {
  const c = $(`.card[data-t="${id}"]`, cardsEl)
  if (!c) return
  c.scrollIntoView({block: 'nearest', behavior: 'smooth'})
  c.classList.add('focus')
  setTimeout(() => c.classList.remove('focus'), 1200)
}

// Anchor element of a thread in the text: the first mark, else a suggestion, a wrapped block, or the point
// where its comments sit.
function anchorOf(id) {
  return $(`mark[data-t="${id}"], ins[data-t="${id}"], del[data-t="${id}"], .cm-block[data-t="${id}"], [data-anchor="${id}"]`, docEl)
}

// Cards sit beside their anchors, pushed down so they never overlap; unplaced threads first, at the top.
function layout() {
  const items = []
  const mtop = marginEl.getBoundingClientRect().top
  const yOf = (node) => (node ? node.getBoundingClientRect().top - mtop : 0)
  let order = 0
  for (const c of $$('.card', cardsEl)) {
    const id = c.dataset.t
    const a = anchorOf(id)
    items.push({el: c, y: a ? Math.max(0, yOf(a)) : 0, order: order++, id})
  }
  if (state.composer && !composerEl.hidden) {
    const cm = state.composer
    let y = 0
    let after = null
    if (cm.mode === 'new' && cm.rect) y = Math.max(0, cm.rect.top - mtop)
    else if (cm.mode === 'reply' || cm.mode === 'edit') after = items.find((i) => i.id === String(cm.threadId))
    items.push({el: composerEl, y: after ? after.y : y, order: after ? after.order + 0.5 : -0.5, composer: true})
  }
  if (narrow.matches) {
    for (const i of items) i.el.style.top = ''
    // In one column the composer goes right after its card, or first.
    const target = items.find((i) => i.composer)
    if (target) {
      const after = items.find((i) => !i.composer && Math.abs(i.order + 0.5 - target.order) < 0.01)
      if (after) after.el.after(composerEl)
      else cardsEl.before(composerEl)
    }
    marginEl.style.minHeight = ''
    return
  }
  if (composerEl.parentElement !== marginEl) marginEl.append(composerEl)
  items.sort((a, b) => a.y - b.y || a.order - b.order)
  let y = 0
  for (const i of items) {
    const top = Math.max(y, i.y)
    i.el.style.top = `${top}px`
    y = top + i.el.offsetHeight + 8
  }
  marginEl.style.minHeight = `${y}px`
}

// ---------------------------------------------------------------------------------------------------------
// Selection -> source offsets

// What part of a rendered element the range covers: null if nothing, else [a, b) as character offsets within
// the element's own text (for a unit element the whole of it).
function selectedPart(range, node) {
  const r = document.createRange()
  r.selectNodeContents(node)
  if (range.compareBoundaryPoints(Range.START_TO_END, r) <= 0) return null // range ends at or before node start
  if (range.compareBoundaryPoints(Range.END_TO_START, r) >= 0) return null // range starts at or after node end
  const startsInside = range.compareBoundaryPoints(Range.START_TO_START, r) > 0
  const endsInside = range.compareBoundaryPoints(Range.END_TO_END, r) < 0
  const text = node.firstChild
  const len = text && text.nodeType === Node.TEXT_NODE ? text.length : 0
  const within = (container, offset) => {
    if (container === text) return offset
    if (container === node) return offset === 0 ? 0 : len
    return null
  }
  let a = 0
  let b = len
  if (startsInside) a = within(range.startContainer, range.startOffset) ?? 0
  if (endsInside) b = within(range.endContainer, range.endOffset) ?? len
  return a < b || len === 0 ? [a, b] : null
}

function rangeToOffsets(range) {
  const anc = range.commonAncestorContainer
  const ancEl = anc.nodeType === Node.ELEMENT_NODE ? anc : anc.parentElement
  if (!ancEl || !docEl.contains(ancEl)) return null
  const nodes = new Set()
  const self = ancEl.closest('[data-s]')
  if (self && docEl.contains(self)) nodes.add(self)
  for (const n of $$('[data-s]', ancEl)) nodes.add(n)
  let start = Infinity
  let end = -Infinity
  for (const n of nodes) {
    const part = selectedPart(range, n)
    if (!part) continue
    const s = +n.dataset.s
    if (n.dataset.e !== undefined) {
      start = Math.min(start, s)
      end = Math.max(end, +n.dataset.e)
    } else {
      start = Math.min(start, s + part[0])
      end = Math.max(end, s + part[1])
    }
  }
  return start < end ? {start, end} : null
}

let selTimer = null
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer)
  selTimer = setTimeout(onSelection, 120)
})

function onSelection() {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideFab()
  const range = sel.getRangeAt(0)
  if (!docEl.contains(range.commonAncestorContainer)) return hideFab()
  const off = rangeToOffsets(range)
  if (!off) return hideFab()
  const rects = range.getClientRects()
  const last = rects[rects.length - 1] || range.getBoundingClientRect()
  state.pending = {...off, quote: sel.toString().trim(), range: range.cloneRange(), rect: range.getBoundingClientRect()}
  fabEl.hidden = false
  const w = fabEl.offsetWidth
  fabEl.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, last.right + window.scrollX + 6))}px`
  fabEl.style.top = `${last.top + window.scrollY - 6}px`
}

function hideFab() {
  fabEl.hidden = true
  state.pending = null
}

fabEl.addEventListener('mousedown', (e) => e.preventDefault()) // keep the selection
fabEl.addEventListener('click', () => state.pending && openComposer('new', state.pending))

// ---------------------------------------------------------------------------------------------------------
// Composer: one element for new comments, whole-document comments, replies and edits.

function draftKey(mode, target) {
  if (mode === 'new') return 'new'
  if (mode === 'general') return 'general'
  if (mode === 'reply') return `reply:${target.thread.start}`
  return `edit:${target.comment.start}`
}

function openComposer(mode, target = {}) {
  if (!state.connected) return toast('The server is not connected.')
  if (state.composer) state.drafts.set(state.composer.key, textEl.value)
  const key = draftKey(mode, target)
  const cm = {mode, key, stale: false}
  if (mode === 'new') Object.assign(cm, {start: target.start, end: target.end, quote: target.quote, rect: target.rect, range: target.range})
  if (mode === 'reply' || mode === 'edit') Object.assign(cm, {threadId: target.thread.id, thread: target.thread.start, threadRef: threadRef(target.thread)})
  if (mode === 'edit') Object.assign(cm, {comment: target.comment.start, original: target.comment.text})
  state.composer = cm
  const titles = {new: 'New comment', general: 'Comment on the whole document', reply: 'Reply', edit: 'Edit comment'}
  $('#composer-title').textContent = titles[mode]
  const q = $('#composer-quote')
  q.hidden = mode !== 'new'
  q.textContent = mode === 'new' ? cm.quote : ''
  $('#composer-note').hidden = true
  $('#composer-error').hidden = true
  textEl.value = state.drafts.has(key) ? state.drafts.get(key) : mode === 'edit' ? target.comment.text : ''
  composerEl.hidden = false
  highlightRange(mode === 'new' ? cm.range : null)
  if (mode === 'edit') renderCards()
  hideFab()
  getSelection().removeAllRanges()
  layout()
  textEl.focus()
  textEl.setSelectionRange(textEl.value.length, textEl.value.length)
}

function threadRef(t) {
  const c = t.comments[0]
  return c ? `${t.kind}|${t.quote}|${c.author}|${c.date}|${c.text}` : `${t.kind}|${t.quote}`
}

function closeComposer(keepDraft = false) {
  if (!state.composer) return
  if (keepDraft) state.drafts.set(state.composer.key, textEl.value)
  else state.drafts.delete(state.composer.key)
  const wasEdit = state.composer.mode === 'edit'
  state.composer = null
  composerEl.hidden = true
  textEl.value = ''
  highlightRange(null)
  if (wasEdit) renderCards()
  layout()
}

function highlightRange(range) {
  if (!('highlights' in CSS)) return
  if (range) CSS.highlights.set('ann-composing', new Highlight(range))
  else CSS.highlights.delete('ann-composing')
}

// The document changed under an open composer: keep the text, re-find the target if it is a thread, and ask
// for a new selection when the target was a selection.
function composerDocChanged() {
  const cm = state.composer
  if (cm.mode === 'general') return
  if (cm.mode === 'new') {
    cm.stale = true
    highlightRange(null)
    showNote('The document changed. Select the text again, then press Comment: your text is kept.')
    return
  }
  const t = state.doc.threads.find((x) => threadRef(x) === cm.threadRef)
  if (!t) {
    cm.stale = true
    showNote('The document changed and that annotation is gone. Cancel, or pick another one: your text is kept.')
    return
  }
  cm.threadId = t.id
  cm.thread = t.start
  if (cm.mode === 'edit') {
    const c = t.comments.find((x) => x.text === cm.original)
    if (!c) {
      cm.stale = true
      showNote('The document changed and that comment is gone. Cancel, or pick another one: your text is kept.')
      return
    }
    cm.comment = c.start
    renderCards()
  }
  cm.stale = false
  $('#composer-note').hidden = true
}

function showNote(msg) {
  const n = $('#composer-note')
  n.textContent = msg
  n.hidden = false
}

function showError(msg) {
  const n = $('#composer-error')
  n.textContent = msg
  n.hidden = false
}

async function saveComposer() {
  const cm = state.composer
  if (!cm || state.busy) return
  const text = textEl.value.trim()
  if (!text) return showError('Type a comment first.')
  if (cm.stale) return showError(cm.mode === 'new' ? 'Select the text again first.' : 'That annotation is gone; cancel or pick another one.')
  const body = {version: state.doc.version, text}
  let path
  if (cm.mode === 'new') {
    path = 'api/comment'
    body.start = cm.start
    body.end = cm.end
  } else if (cm.mode === 'general') path = 'api/general'
  else if (cm.mode === 'reply') {
    path = 'api/reply'
    body.thread = cm.thread
  } else {
    path = 'api/edit'
    body.comment = cm.comment
  }
  $('#composer-error').hidden = true
  state.busy = true
  setStatus('saving', 'saving')
  try {
    const r = await post(path, body)
    if (r.ok) {
      closeComposer()
      applyDoc(r.doc)
      setStatus('saved', 'saved', 1500)
    } else if (r.status === 409) {
      applyDoc(r.doc)
      composerDocChanged()
      setConnected(state.connected)
      if (!cm.stale) showError('The document changed; check the target and save again.')
    } else {
      showError(r.error || `Error ${r.status}`)
      setConnected(state.connected)
    }
  } catch (e) {
    showError(`Could not reach the server: ${e.message}`)
    setConnected(false)
  } finally {
    state.busy = false
  }
}

composerEl.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act
  if (act === 'save') saveComposer()
  if (act === 'cancel') closeComposer()
})
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    saveComposer()
  } else if (e.key === 'Escape') {
    if (textEl.value.trim() === '') closeComposer()
    else showError('Clear the text or press Cancel to discard it.')
  }
})
textEl.addEventListener('input', () => {
  $('#composer-error').hidden = true
  layout()
})

// ---------------------------------------------------------------------------------------------------------
// Direct actions: delete, resolve, undo

async function act(path, body, done) {
  if (!state.connected || state.busy) return
  state.busy = true
  setStatus('saving', 'saving')
  try {
    const r = await post(path, {version: state.doc.version, ...body})
    if (r.ok) {
      applyDoc(r.doc)
      setStatus('saved', done, 1500)
    } else if (r.status === 409) {
      applyDoc(r.doc)
      setConnected(state.connected)
      toast('The document changed; try again.')
    } else {
      setConnected(state.connected)
      toast(r.error || `Error ${r.status}`, 5000)
    }
  } catch (e) {
    setConnected(false)
  } finally {
    state.busy = false
  }
}

$('#undo').addEventListener('click', () => act('api/undo', {}, 'undone'))
$('#general').addEventListener('click', () => openComposer('general'))

document.addEventListener('keydown', (e) => {
  const inField = /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName)
  if (e.key.toLowerCase() === 'm' && e.ctrlKey && e.shiftKey) {
    if (state.pending) {
      e.preventDefault()
      openComposer('new', state.pending)
    }
  } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !inField) {
    e.preventDefault()
    act('api/undo', {}, 'undone')
  }
})

// Marks in the text: hover links to the card, click focuses it.
docEl.addEventListener('mouseover', (e) => {
  const m = e.target.closest('[data-t]')
  if (m) setHot(m.dataset.t, true)
})
docEl.addEventListener('mouseout', (e) => {
  const m = e.target.closest('[data-t]')
  if (m) setHot(m.dataset.t, false)
})
docEl.addEventListener('click', (e) => {
  const m = e.target.closest('[data-t]')
  if (m && getSelection().isCollapsed) focusCard(m.dataset.t)
})

window.addEventListener('resize', layout)
narrow.addEventListener('change', layout)

connect()
