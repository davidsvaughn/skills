// One markdown file served for annotation in the browser. Every edit lands in the file as CriticMarkup; the
// file on disk is the only store. Node's http module, no framework.
//
// Security model: bind 127.0.0.1 only, a random token in every URL, the Host header checked (DNS rebinding),
// JSON bodies only. Files under the document's directory tree are served for relative links and images.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {analyze, render, threadInfo} from './render.mjs'
import {addComment, addGeneral, reply, editComment, deleteComment, resolve, EditError, cleanAuthor} from './edit.mjs'

const WEB = fileURLToPath(new URL('../web/', import.meta.url))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}
const MAX_BODY = 1 << 20
const UNDO_DEPTH = 200

// ---------------------------------------------------------------------------------------------------------
// Registry: one JSON file per served document, so `open` can find and reuse a running server.

export function stateDir() {
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'ann')
}

export function registryKey(realFile) {
  return crypto.createHash('sha1').update(realFile).digest('hex').slice(0, 12)
}

export function registryPath(realFile) {
  return path.join(stateDir(), registryKey(realFile) + '.json')
}

export function readRegistry(realFile) {
  try {
    return JSON.parse(fs.readFileSync(registryPath(realFile), 'utf8'))
  } catch {
    return null
  }
}

export const hashOf = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12)

// ANN_AUTHOR, else the VS Code md-comments extension's author name (the settings file is JSONC, so a regex
// on uncommented lines rather than JSON.parse), else the extension's default.
export function detectAuthor(env = process.env) {
  if (env.ANN_AUTHOR) return cleanAuthor(env.ANN_AUTHOR)
  try {
    const s = fs.readFileSync(path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json'), 'utf8')
    const m = /^\s*"review-comments\.authorName"\s*:\s*"([^"\n]*)"/m.exec(s)
    if (m && m[1].trim()) return cleanAuthor(m[1])
  } catch {}
  return 'you'
}

function gitRoot(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {stdio: ['ignore', 'pipe', 'ignore']})
      .toString()
      .trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------

export async function serve(opts) {
  const file = fs.realpathSync(opts.file)
  if (!fs.statSync(file).isFile()) throw new Error(`${file} is not a file`)
  const dir = path.dirname(file)
  const root = fs.realpathSync(gitRoot(dir) || dir)
  const idleMinutes = opts.idleMinutes ?? 30
  const idleMs = idleMinutes > 0 ? idleMinutes * 60_000 : 0
  const token = crypto.randomBytes(16).toString('hex')
  const prefix = `/${token}/`
  const author = detectAuthor()
  const log = (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`)

  let source = fs.readFileSync(file, 'utf8')
  let version = hashOf(source)
  let rendered = null
  const undo = []
  const clients = new Set()
  let port = 0

  function doc() {
    if (!rendered || rendered.version !== version) {
      const t0 = performance.now()
      const an = analyze(source)
      const {html, placed} = render(an)
      rendered = {file, name: path.basename(file), version, html, threads: threadInfo(an, placed), author}
      rendered.renderMs = Math.round(performance.now() - t0)
    }
    return rendered
  }

  // Atomic write: temp file beside the document, same mode, rename. The in-memory hash is updated first so the
  // watcher sees its own write as no change.
  function apply(next, why) {
    source = next
    version = hashOf(next)
    const tmp = path.join(dir, `.${path.basename(file)}.ann-${process.pid}.tmp`)
    let mode = 0o644
    try {
      mode = fs.statSync(file).mode & 0o777
    } catch {}
    fs.writeFileSync(tmp, next, 'utf8')
    fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, file)
    broadcast('doc', {version, why})
  }

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(msg)
  }

  // Outside changes: Claude revising the doc, an editor saving it.
  let pendingCheck = null
  const schedule = () => {
    clearTimeout(pendingCheck)
    pendingCheck = setTimeout(checkOutside, 150)
  }
  function checkOutside() {
    let next
    try {
      next = fs.readFileSync(file, 'utf8')
    } catch (e) {
      log(`read failed (${e.code || e.message}); will retry on the next change`)
      return
    }
    const h = hashOf(next)
    if (h === version) return
    source = next
    version = h
    log(`outside change: version ${h}, ${next.length} chars`)
    broadcast('doc', {version, why: 'outside'})
  }
  try {
    fs.watch(dir, {persistent: false}, (_ev, name) => {
      if (!name || name === path.basename(file)) schedule()
    })
  } catch (e) {
    log(`fs.watch unavailable (${e.message}); polling only`)
  }
  fs.watchFile(file, {persistent: false, interval: 1500}, schedule)

  // Lifecycle: exit after `idleMinutes` with no browser tab connected.
  let idleTimer = null
  const armIdle = (why) => {
    clearTimeout(idleTimer)
    if (idleMs) idleTimer = setTimeout(() => exit(`idle ${idleMinutes} min, ${why}`), idleMs)
  }
  function exit(reason) {
    log(`exit: ${reason}`)
    try {
      const entry = readRegistry(file)
      if (entry && entry.pid === process.pid) fs.unlinkSync(registryPath(file))
    } catch {}
    for (const c of clients) c.end()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', () => exit('SIGINT'))
  process.on('SIGTERM', () => exit('SIGTERM'))

  // ---- HTTP ----

  const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', ...extra})
    res.end(body)
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8')

  function readJson(req) {
    return new Promise((resolvePromise, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(new Error('body too large'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          reject(new Error('invalid JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  function serveStatic(res, abs, name) {
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      return send(res, 404, 'not found')
    }
    if (!st.isFile()) return send(res, 404, 'not found')
    const type = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, {'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store'})
    fs.createReadStream(abs).pipe(res)
  }

  function events(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`event: hello\ndata: ${JSON.stringify({version, pid: process.pid})}\n\n`)
    clients.add(res)
    clearTimeout(idleTimer)
    log(`tab connected (${clients.size} open)`)
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(hb)
      clients.delete(res)
      log(`tab disconnected (${clients.size} open)`)
      if (!clients.size) armIdle('no tab connected')
    })
  }

  const int = (v) => (Number.isInteger(v) ? v : null)
  const str = (v) => (typeof v === 'string' ? v : null)
  const MUTATIONS = {
    comment: (b) => {
      if (int(b.start) === null || int(b.end) === null) throw new EditError('Select some text first.')
      return addComment(source, {start: b.start, end: b.end, text: str(b.text), author})
    },
    general: (b) => addGeneral(source, {text: str(b.text), author}),
    reply: (b) => {
      if (int(b.thread) === null) throw new EditError('That annotation is no longer in the file.')
      return reply(source, {thread: b.thread, text: str(b.text), author})
    },
    edit: (b) => {
      if (int(b.comment) === null) throw new EditError('That comment is no longer in the file.')
      return editComment(source, {comment: b.comment, text: str(b.text)})
    },
    delete: (b) => {
      if (int(b.comment) === null) throw new EditError('That comment is no longer in the file.')
      return deleteComment(source, {comment: b.comment})
    },
    resolve: (b) => {
      if (int(b.thread) === null) throw new EditError('That annotation is no longer in the file.')
      return resolve(source, {thread: b.thread})
    },
  }

  async function mutate(name, req, res) {
    const t0 = performance.now()
    let body
    try {
      body = await readJson(req)
    } catch (e) {
      return json(res, 400, {error: e.message})
    }
    if (body.version !== version) {
      log(`${name}: stale version ${body.version} (current ${version})`)
      return json(res, 409, {error: 'The document changed since this page was loaded; it has been reloaded.', doc: doc()})
    }
    if (name === 'undo') {
      const top = undo.at(-1)
      if (!top) return json(res, 422, {error: 'Nothing to undo.'})
      if (top.afterHash !== version) return json(res, 422, {error: 'The file changed since the last edit, so it cannot be undone here.'})
      undo.pop()
      apply(top.before, 'undo')
      log(`undo: ${top.summary} (${Math.round(performance.now() - t0)} ms)`)
      return json(res, 200, {doc: doc(), summary: `undid ${top.summary}`})
    }
    let out
    try {
      out = MUTATIONS[name](body)
    } catch (e) {
      if (!(e instanceof EditError)) throw e
      log(`${name}: refused: ${e.message}${e.detail ? ` [${e.detail}]` : ''} (${Math.round(performance.now() - t0)} ms)`)
      return json(res, 422, {error: e.message, detail: e.detail || null})
    }
    undo.push({before: source, afterHash: hashOf(out.source), summary: out.summary})
    if (undo.length > UNDO_DEPTH) undo.shift()
    apply(out.source, name)
    const d = doc()
    log(`${name}: ${out.summary} -> version ${version} (${Math.round(performance.now() - t0)} ms, render ${d.renderMs} ms)`)
    return json(res, 200, {doc: d, summary: out.summary})
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || ''
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, 'forbidden')
      const u = new URL(req.url, 'http://localhost')
      if (u.pathname === `/${token}`) return send(res, 302, '', 'text/plain', {Location: prefix})
      if (!u.pathname.startsWith(prefix)) return send(res, 404, 'not found')
      const rel = u.pathname.slice(prefix.length)
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (rel === '') return serveStatic(res, path.join(WEB, 'index.html'), 'index.html')
        if (rel === 'app.js' || rel === 'app.css') return serveStatic(res, path.join(WEB, rel), rel)
        if (rel === 'api/doc') return json(res, 200, doc())
        if (rel === 'api/ping') return json(res, 200, {ok: true, file, version, tabs: clients.size, pid: process.pid})
        if (rel === 'api/events') return events(req, res)
        if (rel.startsWith('files/')) {
          let p
          try {
            p = decodeURIComponent(rel.slice(6))
          } catch {
            return send(res, 400, 'bad path')
          }
          const abs = path.resolve(dir, p)
          let real
          try {
            real = fs.realpathSync(abs)
          } catch {
            return send(res, 404, 'not found')
          }
          if (real !== root && !real.startsWith(root + path.sep)) return send(res, 403, 'outside the document root')
          return serveStatic(res, real, real)
        }
        return send(res, 404, 'not found')
      }
      if (req.method === 'POST') {
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, 'JSON only')
        const m = /^api\/(comment|general|reply|edit|delete|resolve|undo)$/.exec(rel)
        if (!m) return send(res, 404, 'not found')
        return await mutate(m[1], req, res)
      }
      return send(res, 405, 'method not allowed')
    } catch (e) {
      log(`error: ${req.method} ${req.url}: ${e.stack || e}`)
      if (!res.headersSent) json(res, 500, {error: 'internal error: ' + e.message})
      else res.end()
    }
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
  const url = `http://127.0.0.1:${port}${prefix}`
  fs.mkdirSync(stateDir(), {recursive: true})
  const entry = {pid: process.pid, port, token, file, log: opts.logFile || null, started: new Date().toISOString()}
  fs.writeFileSync(registryPath(file), JSON.stringify(entry, null, 1) + '\n')
  log(`serving ${file} at ${url} (pid ${process.pid}, author ${author}, root ${root}, idle ${idleMinutes} min)`)
  armIdle('no tab ever connected')
  return {url, port, token, file, close: () => exit('closed')}
}
