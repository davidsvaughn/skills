#!/usr/bin/env node
// The CLI the /ann skill calls.
//
//   ann.mjs open <file> [--no-open] [--idle-minutes N]   start (or reuse) a server for the file, open the browser
//   ann.mjs stop <file>                                  stop the server for the file
//   ann.mjs list                                         running servers
//   ann.mjs serve <file> [--idle-minutes N] [--log F]    foreground server (what `open` spawns, detached)

import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const SKILL = path.dirname(path.dirname(SELF))

if (!fs.existsSync(path.join(SKILL, 'node_modules', 'mdast-util-from-markdown'))) {
  console.error(`Dependencies are missing: run npm ci in ${SKILL}`)
  process.exit(2)
}

const {serve, stateDir, registryKey, registryPath, readRegistry} = await import('../lib/server.mjs')

const args = process.argv.slice(2)
const cmd = args.shift()
const flags = {open: true, idleMinutes: 30, log: null}
const positional = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--no-open') flags.open = false
  else if (a === '--idle-minutes') flags.idleMinutes = Number(args[++i])
  else if (a === '--log') flags.log = args[++i]
  else if (a.startsWith('--')) die(`unknown flag ${a}`)
  else positional.push(a)
}

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

function realFile(arg) {
  if (!arg) die('usage: ann.mjs open|stop|serve <file.md>')
  let real
  try {
    real = fs.realpathSync(path.resolve(arg))
  } catch {
    die(`no such file: ${arg}`)
  }
  if (!fs.statSync(real).isFile()) die(`not a file: ${arg}`)
  return real
}

async function ping(entry) {
  if (!entry || !entry.port || !entry.token) return null
  try {
    const r = await fetch(`http://127.0.0.1:${entry.port}/${entry.token}/api/ping`, {signal: AbortSignal.timeout(1500)})
    if (!r.ok) return null
    const j = await r.json()
    return j.ok && j.file === entry.file ? j : null
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function openBrowser(url) {
  const [bin, a] = process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(bin, a, {detached: true, stdio: 'ignore'}).unref()
    return true
  } catch (e) {
    console.error(`could not open a browser (${e.message}); open the URL by hand`)
    return false
  }
}

async function cmdOpen() {
  const file = realFile(positional[0])
  let entry = readRegistry(file)
  let live = await ping(entry)
  let started = false
  if (!live) {
    const logDir = path.join(stateDir(), 'logs')
    fs.mkdirSync(logDir, {recursive: true})
    const logFile = path.join(logDir, registryKey(file) + '.log')
    const fd = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [SELF, 'serve', file, '--idle-minutes', String(flags.idleMinutes), '--log', logFile], {
      detached: true,
      stdio: ['ignore', fd, fd],
      cwd: SKILL,
    })
    child.unref()
    fs.closeSync(fd)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await sleep(100)
      entry = readRegistry(file)
      if (entry && entry.pid === child.pid) {
        live = await ping(entry)
        if (live) break
      }
    }
    if (!live) die(`the server did not start within 5 s; see ${logFile}`)
    started = true
  }
  const url = `http://127.0.0.1:${entry.port}/${entry.token}/`
  let opened = false
  if (flags.open && !(live.tabs > 0)) opened = openBrowser(url)
  console.log(`url: ${url}`)
  console.log(`file: ${file}`)
  console.log(`log: ${entry.log || '-'}`)
  console.log(
    `server: ${started ? 'started' : 'reused'} (pid ${entry.pid})` +
      (live.tabs > 0 ? `, ${live.tabs} tab${live.tabs === 1 ? '' : 's'} already open` : opened ? ', browser opened' : ''),
  )
}

async function cmdStop() {
  const file = realFile(positional[0])
  const entry = readRegistry(file)
  if (!entry) return console.log(`no server for ${file}`)
  const live = await ping(entry)
  if (!live) {
    try {
      fs.unlinkSync(registryPath(file))
    } catch {}
    return console.log(`no live server for ${file} (stale entry removed)`)
  }
  process.kill(entry.pid, 'SIGTERM')
  console.log(`stopped pid ${entry.pid} for ${file}`)
}

async function cmdList() {
  let names = []
  try {
    names = fs.readdirSync(stateDir()).filter((n) => n.endsWith('.json'))
  } catch {}
  let n = 0
  for (const name of names) {
    let entry
    try {
      entry = JSON.parse(fs.readFileSync(path.join(stateDir(), name), 'utf8'))
    } catch {
      continue
    }
    const live = await ping(entry)
    if (!live) {
      try {
        fs.unlinkSync(path.join(stateDir(), name))
      } catch {}
      continue
    }
    n++
    console.log(`pid ${entry.pid}  ${live.tabs} tab${live.tabs === 1 ? '' : 's'}  http://127.0.0.1:${entry.port}/${entry.token}/  ${entry.file}`)
  }
  if (!n) console.log('no running servers')
}

async function cmdServe() {
  const file = realFile(positional[0])
  await serve({file, idleMinutes: flags.idleMinutes, logFile: flags.log})
}

const commands = {open: cmdOpen, stop: cmdStop, list: cmdList, serve: cmdServe}
if (!commands[cmd]) die('usage: ann.mjs open <file> [--no-open] [--idle-minutes N] | stop <file> | list | serve <file>')
await commands[cmd]()
