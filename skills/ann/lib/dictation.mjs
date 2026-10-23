// Live dictation into the comment box: the server records the microphone with `parec` (PulseAudio or
// PipeWire's pulse layer) and streams it to AssemblyAI's v3 streaming API; the transcript is pushed to the
// page that asked for it. Recording on the server rather than in the browser means no microphone permission
// prompt per server (each server listens on a new port, and browsers remember permission per origin), and the
// API key never reaches the page.
//
// Protocol (https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket): connect with the key in
// the Authorization header, wait for `Begin`, send raw 16 kHz mono s16le audio in binary frames, read `Turn`
// messages (the same `turn_order` repeats as the recognizer revises it; the last one wins), send
// `{"type":"Terminate"}` to finish and wait for `Termination`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn as nodeSpawn} from 'node:child_process'
import {parseEnv} from 'node:util'

const KEY_NAMES = ['ASSEMBLY_API_KEY', 'ASSEMBLYAI_API_KEY']
export const DEFAULT_MODEL = 'universal-3-6-pro'
const RATE = 16000
const FRAME = (RATE * 2) / 10 // 100 ms of s16le mono; AssemblyAI wants 50-1000 ms per message
const MAX_BUFFERED = FRAME * 100 // ten seconds of audio queued on the socket means the network is not keeping up
const CONNECT_MS = 15_000
const FINISH_MS = 10_000

export function keyFile(env = process.env) {
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'assemblyai', 'env')
}

// The environment first, then a dotenv-style file that holds the key for every local tool.
export function loadKey(env = process.env) {
  for (const n of KEY_NAMES) if (env[n]?.trim()) return {key: env[n].trim(), from: `$${n}`}
  const file = keyFile(env)
  try {
    const vars = parseEnv(fs.readFileSync(file, 'utf8'))
    for (const n of KEY_NAMES) if (vars[n]?.trim()) return {key: vars[n].trim(), from: file}
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return {key: null, from: null}
}

function onPath(bin, env) {
  return (env.PATH || '').split(path.delimiter).some((d) => {
    try {
      fs.accessSync(path.join(d, bin), fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

// Whether dictation can start here, and if not, a sentence saying why.
export function availability(env = process.env) {
  if (typeof WebSocket !== 'function') return {available: false, reason: `Dictation needs Node 22 or later (this is ${process.version}).`}
  if (!onPath('parec', env)) return {available: false, reason: 'Dictation needs `parec` (PulseAudio or PipeWire) on the PATH.'}
  let k
  try {
    k = loadKey(env)
  } catch (e) {
    return {available: false, reason: `Could not read ${keyFile(env)}: ${e.message}`}
  }
  if (!k.key) return {available: false, reason: `No AssemblyAI key: set ASSEMBLY_API_KEY, or put ASSEMBLY_API_KEY=... in ${keyFile(env)}.`}
  return {available: true, reason: null}
}

// One dictation session. `emit({phase, text, error})` reports progress, where phase is connecting | recording |
// finishing | done | error, and text is the whole transcript so far. The session never emits after done or
// error. `deps` replaces the WebSocket class and spawn for tests.
//
// The microphone opens at once and its audio is held until the recognizer is ready, so words spoken right after
// the key press are kept (push-to-talk gives no time to wait for the connection).
export function startDictation({key, model = DEFAULT_MODEL, source = null, maxMs = 0, emit, log = () => {}, deps = {}}) {
  const WS = deps.WebSocket || WebSocket
  const spawn = deps.spawn || nodeSpawn
  const url = new URL('wss://streaming.assemblyai.com/v3/ws')
  url.searchParams.set('sample_rate', String(RATE))
  url.searchParams.set('speech_model', model)
  const socket = new WS(url, {headers: {Authorization: key}})
  const turns = new Map()
  const queue = [] // frames recorded before Begin
  let phase = 'connecting'
  let began = false // Begin received
  let stopping = false // a stop was asked for: drain the microphone, then Terminate once begun
  let drained = false // the microphone's output has ended
  let error = null
  let stderr = ''
  let pending = Buffer.alloc(0)
  let timer = setTimeout(() => finish('Connection timed out.'), CONNECT_MS)
  const capTimer = maxMs ? setTimeout(() => stop(false, `${Math.round(maxMs / 60000)} min limit`), maxMs) : null
  const t0 = Date.now()

  const text = () =>
    [...turns.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, t]) => t)
      .filter(Boolean)
      .join(' ')
  const report = () => emit({phase, text: text(), error})
  const over = () => phase === 'done' || phase === 'error'
  report()

  function finish(err = null) {
    if (over()) return
    clearTimeout(timer)
    clearTimeout(capTimer)
    error = error || err
    phase = error ? 'error' : 'done'
    capture.kill('SIGKILL')
    try {
      socket.close()
    } catch {}
    log(`dictation ${phase}${error ? `: ${error}` : ''} (${Math.round((Date.now() - t0) / 1000)} s, ${text().length} chars)`)
    report()
  }

  function terminate() {
    if (socket.readyState === WS.OPEN) socket.send(JSON.stringify({type: 'Terminate'}))
    else finish()
  }

  function send(frame) {
    if (!began) return queue.push(frame)
    if (socket.readyState !== WS.OPEN) return
    if (socket.bufferedAmount > MAX_BUFFERED) {
      error = error || 'The network cannot keep up with the microphone.'
      return stop()
    }
    socket.send(frame)
  }

  // cancel: the page has thrown the text away, so do not wait for the last words.
  function stop(cancel = false, why = null) {
    if (over()) return
    if (why) log(`dictation stopping: ${why}`)
    if (cancel) return finish()
    if (stopping) return
    stopping = true
    phase = 'finishing'
    report()
    if (began) {
      clearTimeout(timer)
      timer = setTimeout(() => finish('Timed out waiting for the last words.'), FINISH_MS)
    } // before Begin the connection timer keeps running
    capture.kill('SIGTERM') // stdout 'end' sends the remaining audio, then Terminate
  }

  const args = ['--raw', '--format=s16le', `--rate=${RATE}`, '--channels=1', '--latency-msec=100']
  if (source) args.push(`--device=${source}`)
  const capture = spawn('parec', args, {stdio: ['ignore', 'pipe', 'pipe']})
  capture.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
  capture.on('error', (e) => finish(`Microphone capture failed: ${e.message}`))
  capture.stdout.on('data', (chunk) => {
    if (over()) return
    const audio = pending.length ? Buffer.concat([pending, chunk]) : chunk
    let at = 0
    for (; audio.length - at >= FRAME; at += FRAME) send(audio.subarray(at, at + FRAME))
    pending = audio.subarray(at)
  })
  capture.stdout.on('end', () => {
    if (over()) return
    if (pending.length) {
      const last = Buffer.alloc(FRAME)
      pending.copy(last)
      send(last)
      pending = Buffer.alloc(0)
    }
    drained = true
    if (!stopping) {
      error = error || `Microphone capture ended unexpectedly${stderr.trim() ? `: ${stderr.trim()}` : ''}.`
      stop()
    }
    if (began) terminate() // otherwise Begin terminates after sending the queue
  })

  socket.addEventListener('message', (ev) => {
    if (over()) return
    let m
    try {
      m = JSON.parse(String(ev.data))
    } catch {
      return finish('The streaming service sent something unreadable.')
    }
    if (m.type === 'Begin') {
      clearTimeout(timer)
      began = true
      log(`dictation session ${m.id} (${m.configuration?.model || model}), ${queue.length * 100} ms of audio held`)
      for (const f of queue.splice(0)) send(f)
      if (stopping) {
        timer = setTimeout(() => finish('Timed out waiting for the last words.'), FINISH_MS)
        if (drained) terminate()
      } else {
        phase = 'recording'
        report()
      }
    } else if (m.type === 'Turn') {
      turns.set(m.turn_order, m.transcript || '')
      report()
    } else if (m.type === 'Termination') {
      finish()
    } else if (m.type === 'Error' || m.error) {
      error = error || String(m.error || m.message || 'Streaming service error')
      if (stopping) finish()
      else stop()
    }
  })
  socket.addEventListener('error', (ev) => finish(`Could not reach AssemblyAI${ev?.message ? ` (${ev.message})` : ''}; check the key, the account balance and the network.`))
  socket.addEventListener('close', (ev) => {
    if (!over()) finish(`The stream closed early (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`)
  })

  return {stop, get phase() { return phase }}
}
