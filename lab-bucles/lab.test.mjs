// Tests de las piezas puras (sin navegador):  node --test lab-bucles/lab.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segments, transitions, stats, rampPos, clickSteps, RAMP } from './analysis.js'
import {
  exportLoops,
  parseLoops,
  importLoops,
  shiftAll,
  padAll,
  snapAll,
  barsToSeconds,
  secondsToBar,
  playChain,
} from './loop-tools.js'

const SR = 1000
const rampAt = (pos) => RAMP.lo + (RAMP.span * pos) / RAMP.dur

test('rampPos invierte la rampa y da NaN en silencio', () => {
  assert.ok(Math.abs(rampPos(rampAt(7.25)) - 7.25) < 1e-9)
  assert.ok(Number.isNaN(rampPos(0)))
})

test('segments + transitions miden sobrepaso, error de inicio y hueco', () => {
  // suena 1.000..2.019 (sobrepasa el fin 2.000 en 20 ms), 5 muestras de silencio, vuelve en 1.000
  const s = []
  for (let i = 0; i < 1020; i++) s.push(rampAt(1 + i / SR))
  for (let i = 0; i < 5; i++) s.push(0)
  for (let i = 0; i < 500; i++) s.push(rampAt(1 + i / SR))
  const segs = segments(Float32Array.from(s), SR)
  assert.equal(segs.length, 2)
  const [t] = transitions(segs, SR, [{ start: 1, end: 2 }], Float32Array.from(s))
  assert.ok(Math.abs(t.overshootMs - 20) < 0.01, `sobrepaso ${t.overshootMs}`)
  assert.ok(Math.abs(t.startErrMs) < 0.01)
  assert.equal(t.gapSamples, 5)
  assert.equal(t.gapZeros, 5)
  assert.equal(t.gapMs, 5)
})

test('stats: mediana y cuartiles', () => {
  const r = stats([1, 2, 3, 4, 100])
  assert.equal(r.mediana, 3)
  assert.equal(r.p25, 2)
  assert.equal(r.p75, 4)
  assert.equal(r.min, 1)
  assert.equal(r.max, 100)
})

test('clickSteps detecta un salto de fase en un seno', () => {
  const s = new Float32Array(4000)
  for (let i = 0; i < 4000; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 10 * (i < 2000 ? i : i + 25)) / SR)
  const r = clickSteps(s, SR, { amp: 0.5, f: 10 })
  assert.equal(r.events.length, 1)
  assert.ok(r.events[0].ratio > 5)
})

// Regiones falsas con la misma forma que las del plugin
function fakeRegion(id, start, end, content) {
  return {
    id,
    start,
    end,
    color: 'rgba(0,0,0,0.1)',
    getContent: () => content,
    setOptions(o) {
      if (o.start !== undefined) this.start = o.start
      if (o.end !== undefined) this.end = o.end
    },
  }
}
function fakePlugin() {
  let regions = []
  const handlers = { 'region-out': new Set() }
  return {
    getRegions: () => regions,
    clearRegions: () => (regions = []),
    addRegion: (p) => {
      const r = fakeRegion(p.id, p.start, p.end, p.content)
      r.play = () => played.push(r.id)
      regions.push(r)
      return r
    },
    on: (ev, cb) => {
      handlers[ev].add(cb)
      return () => handlers[ev].delete(cb)
    },
    emitOut: (r) => handlers['region-out'].forEach((cb) => cb(r)),
  }
}
let played = []

test('edición en bloque: desplazar sin salirse, estrechar, ajustar a rejilla', () => {
  const rs = [fakeRegion('a', 1, 2), fakeRegion('b', 8, 9.5)]
  shiftAll(rs, 5, 10) // solo cabe +0.5
  assert.deepEqual(
    rs.map((r) => [r.start, r.end]),
    [
      [1.5, 2.5],
      [8.5, 10],
    ],
  )
  padAll(rs, -0.25, 10)
  assert.deepEqual(
    rs.map((r) => [r.start, r.end]),
    [
      [1.75, 2.25],
      [8.75, 9.75],
    ],
  )
  // la primera quedaría de largo 0 (2→2) y se deja como estaba; la segunda se ajusta
  snapAll(rs, [0, 1, 2, 3, 8, 9, 10])
  assert.deepEqual(
    rs.map((r) => [r.start, r.end]),
    [
      [1.75, 2.25],
      [9, 10],
    ],
  )
})

test('compases ↔ segundos con un mapa de compases', () => {
  const bars = [0, 2, 4.1, 6.3, 8.2]
  assert.deepEqual(barsToSeconds(bars, 2, 3), { start: 2, end: 6.3 })
  assert.throws(() => barsToSeconds(bars, 3, 9))
  assert.ok(Math.abs(secondsToBar(bars, 5.2) - 3.5) < 1e-9)
})

test('JSON: ida y vuelta, cadenas y validación', () => {
  const rs = [fakeRegion('A', 1, 2, 'Intro'), fakeRegion('B', 3, 4.5), fakeRegion('C', 6, 7)]
  const chains = [{ id: 'ABC', steps: [{ loop: 'A', repeat: 2 }, { loop: 'B' }, { loop: 'C', repeat: 3 }] }]
  const json = JSON.stringify(exportLoops(rs, { chains, audio: { name: 'x.wav', duration: 10 } }))
  const p = parseLoops(json, 10)
  assert.deepEqual(
    p.loops.map((l) => [l.id, l.start, l.end, l.label]),
    [
      ['A', 1, 2, 'Intro'],
      ['B', 3, 4.5, undefined],
      ['C', 6, 7, undefined],
    ],
  )
  assert.deepEqual(p.chains[0].steps, [
    { loop: 'A', repeat: 2 },
    { loop: 'B', repeat: 1 },
    { loop: 'C', repeat: 3 },
  ])

  assert.throws(() => parseLoops('{"format":"otro"}'), /no es un fichero/)
  const bad = JSON.parse(json)
  bad.chains[0].steps[1].loop = 'Z'
  assert.throws(() => parseLoops(bad), /no existe/)
  const dup = JSON.parse(json)
  dup.loops[1].id = 'A'
  assert.throws(() => parseLoops(dup), /repetido/)
  const inv = JSON.parse(json)
  inv.loops[0].end = 0.5
  assert.throws(() => parseLoops(inv), /mayor que start/)
  // compases en lugar de segundos
  const withBars = { format: 'lab-bucles', version: 1, barTimes: [0, 2, 4, 6], loops: [{ id: 'x', bars: [2, 3] }] }
  assert.deepEqual(parseLoops(withBars).loops[0], { id: 'x', start: 2, end: 6, label: undefined, color: undefined })
  // recorta a la duración
  assert.equal(parseLoops(json, 6.5).loops[2].end, 6.5)

  const plugin = fakePlugin()
  const { regions } = importLoops(plugin, json, 10)
  assert.equal(regions.length, 3)
})

test('playChain: A×2 → B → C×3 → A…', () => {
  played = []
  const plugin = fakePlugin()
  plugin.addRegion({ id: 'A', start: 1, end: 2 })
  plugin.addRegion({ id: 'B', start: 3, end: 4 })
  plugin.addRegion({ id: 'C', start: 5, end: 6 })
  const ws = { on: () => () => {}, pause: () => {} }
  const byId = (id) => plugin.getRegions().find((r) => r.id === id)
  const ctl = playChain(ws, plugin, { steps: [{ loop: 'A', repeat: 2 }, { loop: 'B' }, { loop: 'C', repeat: 3 }] })
  // simula el final de cada pasada de la región que está sonando
  for (let i = 0; i < 7; i++) plugin.emitOut(byId(played[played.length - 1]))
  // un region-out repetido de una región que ya no suena se ignora
  plugin.emitOut(byId('B'))
  assert.deepEqual(played, ['A', 'A', 'B', 'C', 'C', 'C', 'A', 'A'])
  ctl.stop()
  plugin.emitOut(byId('A'))
  assert.equal(played.length, 8)
})
