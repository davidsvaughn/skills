import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {startDictation, loadKey, availability} from '../lib/dictation.mjs'

// A stand-in for AssemblyAI's socket: records what is sent, lets the test play server messages.
class FakeWS {
  static OPEN = 1
  static last = null
  constructor(url, opts) {
    this.url = new URL(url)
    this.opts = opts
    this.readyState = FakeWS.OPEN
    this.bufferedAmount = 0
    this.sent = []
    this.listeners = {}
    this.closed = false
    FakeWS.last = this
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  fire(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev)
  }
  server(msg) {
    this.fire('message', {data: JSON.stringify(msg)})
  }
  send(data) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  frames() {
    return this.sent.filter((d) => typeof d !== 'string')
  }
  controls() {
    return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d))
  }
}

// A stand-in for parec: stdout is fed by the test; SIGTERM ends it as parec does.
function fakeSpawn() {
  const calls = []
  const spawn = (bin, args) => {
    const p = new EventEmitter()
    p.stdout = new PassThrough()
    p.stderr = new PassThrough()
    p.signals = []
    p.kill = (sig) => {
      p.signals.push(sig)
      p.stdout.end()
    }
    calls.push({bin, args, p})
    return p
  }
  return {spawn, calls}
}

const tick = () => new Promise((r) => setImmediate(r))

function session(extra = {}) {
  const events = []
  const sp = fakeSpawn()
  const s = startDictation({key: 'k', emit: (e) => events.push(e), deps: {WebSocket: FakeWS, spawn: sp.spawn}, ...extra})
  return {s, events, ws: FakeWS.last, sp, last: () => events.at(-1)}
}

test('connects with the key, the rate and the model, and opens the microphone only after Begin', () => {
  const {ws, sp, last} = session({source: 'my.mic'})
  assert.equal(ws.opts.headers.Authorization, 'k')
  assert.equal(ws.url.origin + ws.url.pathname, 'wss://streaming.assemblyai.com/v3/ws')
  assert.equal(ws.url.searchParams.get('sample_rate'), '16000')
  assert.equal(ws.url.searchParams.get('speech_model'), 'universal-3-6-pro')
  assert.equal(last().phase, 'connecting')
  assert.equal(sp.calls.length, 0)
  ws.server({type: 'Begin', id: 'x'})
  assert.equal(sp.calls.length, 1)
  assert.equal(sp.calls[0].bin, 'parec')
  assert.ok(sp.calls[0].args.includes('--rate=16000') && sp.calls[0].args.includes('--device=my.mic'))
  assert.equal(last().phase, 'mic')
})

test('audio goes out in 100 ms frames; turns are revised in place and joined in order; stop drains then terminates', async () => {
  const {s, ws, sp, last} = session()
  ws.server({type: 'Begin', id: 'x'})
  const cap = sp.calls[0].p
  cap.stdout.write(Buffer.alloc(3200 * 2 + 100))
  await tick()
  assert.equal(last().phase, 'recording')
  assert.deepEqual(ws.frames().map((f) => f.length), [3200, 3200])
  ws.server({type: 'Turn', turn_order: 0, transcript: 'hello wor', end_of_turn: false})
  assert.equal(last().text, 'hello wor')
  ws.server({type: 'Turn', turn_order: 1, transcript: 'second', end_of_turn: false})
  ws.server({type: 'Turn', turn_order: 0, transcript: 'Hello world.', end_of_turn: true})
  assert.equal(last().text, 'Hello world. second')
  s.stop()
  assert.equal(last().phase, 'finishing')
  await tick()
  assert.deepEqual(cap.signals, ['SIGTERM'])
  assert.deepEqual(ws.frames().map((f) => f.length), [3200, 3200, 3200], 'the 100-byte tail is padded to a frame')
  assert.deepEqual(ws.controls(), [{type: 'Terminate'}])
  ws.server({type: 'Turn', turn_order: 1, transcript: 'Second.', end_of_turn: true})
  ws.server({type: 'Termination'})
  assert.deepEqual(last(), {phase: 'done', text: 'Hello world. Second.', error: null})
  assert.ok(ws.closed)
})

test('cancel ends at once, without waiting for the last words', async () => {
  const {s, ws, sp, last} = session()
  ws.server({type: 'Begin', id: 'x'})
  sp.calls[0].p.stdout.write(Buffer.alloc(3200))
  await tick()
  s.stop(true)
  assert.equal(last().phase, 'done')
  assert.ok(sp.calls[0].p.signals.includes('SIGKILL'))
  ws.server({type: 'Turn', turn_order: 0, transcript: 'late'})
  assert.equal(last().phase, 'done', 'nothing is emitted after done')
})

test('stop while still connecting closes without a microphone', () => {
  const {s, ws, sp, last} = session()
  s.stop()
  assert.equal(last().phase, 'done')
  assert.ok(ws.closed)
  ws.server({type: 'Begin', id: 'x'})
  assert.equal(sp.calls.length, 0)
})

test('a socket error or an early close is an error that keeps the text so far', async () => {
  const a = session()
  a.ws.fire('error', {message: 'boom'})
  assert.equal(a.last().phase, 'error')
  assert.match(a.last().error, /Could not reach AssemblyAI \(boom\)/)

  const b = session()
  b.ws.server({type: 'Begin', id: 'x'})
  b.ws.server({type: 'Turn', turn_order: 0, transcript: 'kept'})
  b.ws.fire('close', {code: 1011, reason: 'gone'})
  assert.deepEqual(b.last(), {phase: 'error', text: 'kept', error: 'The stream closed early (1011: gone).'})
})

test('a service error during recording drains and terminates, then reports the error', async () => {
  const {ws, sp, last} = session()
  ws.server({type: 'Begin', id: 'x'})
  ws.server({type: 'Error', error: 'Insufficient balance'})
  assert.equal(last().phase, 'finishing')
  await tick()
  assert.deepEqual(ws.controls(), [{type: 'Terminate'}])
  ws.server({type: 'Termination'})
  assert.equal(last().phase, 'error')
  assert.equal(last().error, 'Insufficient balance')
  assert.equal(sp.calls[0].p.signals[0], 'SIGTERM', 'drained, not killed')
})

test('a microphone that fails to start is an error', () => {
  const {ws, sp, last} = session()
  ws.server({type: 'Begin', id: 'x'})
  sp.calls[0].p.emit('error', new Error('spawn parec ENOENT'))
  assert.equal(last().phase, 'error')
  assert.match(last().error, /Microphone capture failed: spawn parec ENOENT/)
})

test('the key comes from the environment first, then the config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-key-'))
  try {
    const env = {XDG_CONFIG_HOME: dir, PATH: ''}
    assert.deepEqual(loadKey(env), {key: null, from: null})
    assert.match(availability(env).reason, /parec|Node/)
    fs.mkdirSync(path.join(dir, 'assemblyai'))
    const file = path.join(dir, 'assemblyai', 'env')
    fs.writeFileSync(file, '# comment\nASSEMBLY_API_KEY=from-file\n')
    assert.deepEqual(loadKey(env), {key: 'from-file', from: file})
    assert.deepEqual(loadKey({...env, ASSEMBLYAI_API_KEY: ' from-env '}), {key: 'from-env', from: '$ASSEMBLYAI_API_KEY'})
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})
