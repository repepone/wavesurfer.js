// Lanza todas las mediciones en Chromium headless y guarda resultados/medidas.json.
//   node lab-bucles/gen-audio.mjs && yarn build && node lab-bucles/medir.mjs [filtro]
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './server.mjs'

// require() para usar también el Playwright global (NODE_PATH), que import no ve
const { chromium } = createRequire(import.meta.url)('playwright')

const here = dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2]

const LARGO = { start: 3.217, end: 4.243 } // 1,026 s
const CORTO = { start: 7.531, end: 7.832 } // 0,301 s
const N = Number(process.env.N) || 35
const CARGA = { block: 40, every: 60 }
const R = Number(process.env.R) || 5 // repeticiones de las pruebas multipista
const S = Number(process.env.S) || 18 // segundos de cada prueba multipista (rampa.wav dura 20 s)

const runs = [
  ['loop-media-largo', 'testLoop', { backend: 'MediaElement', file: 'rampa.wav', regions: [LARGO], passes: N }],
  ['loop-webaudio-largo', 'testLoop', { backend: 'WebAudio', file: 'rampa.wav', regions: [LARGO], passes: N }],
  ['loop-media-corto', 'testLoop', { backend: 'MediaElement', file: 'rampa.wav', regions: [CORTO], passes: N }],
  ['loop-webaudio-corto', 'testLoop', { backend: 'WebAudio', file: 'rampa.wav', regions: [CORTO], passes: N }],
  [
    'loop-media-playEnd',
    'testLoop',
    { backend: 'MediaElement', file: 'rampa.wav', regions: [LARGO], passes: N, playEnd: true },
  ],
  [
    'loop-webaudio-playEnd',
    'testLoop',
    { backend: 'WebAudio', file: 'rampa.wav', regions: [LARGO], passes: N, playEnd: true },
  ],
  [
    'loop-media-carga',
    'testLoop',
    { backend: 'MediaElement', file: 'rampa.wav', regions: [LARGO], passes: N, load: CARGA },
  ],
  [
    'loop-webaudio-carga',
    'testLoop',
    { backend: 'WebAudio', file: 'rampa.wav', regions: [LARGO], passes: N, load: CARGA },
  ],
  ['clic-media', 'testLoop', { backend: 'MediaElement', file: 'seno.wav', regions: [LARGO], passes: N }],
  ['clic-webaudio', 'testLoop', { backend: 'WebAudio', file: 'seno.wav', regions: [LARGO], passes: N }],
  ['gapless-largo', 'testGapless', { file: 'rampa.wav', ...LARGO, passes: N }],
  ['gapless-corto', 'testGapless', { file: 'rampa.wav', ...CORTO, passes: N }],
  ['gapless-carga', 'testGapless', { file: 'rampa.wav', ...LARGO, passes: N, load: CARGA }],
  ['clic-gapless', 'testGapless', { file: 'seno.wav', ...LARGO, passes: N }],
  [
    'cadena-media',
    'testLoop',
    {
      backend: 'MediaElement',
      file: 'rampa.wav',
      regions: [
        { start: 2.113, end: 2.904 },
        { start: 5.307, end: 6.118 },
        { start: 9.711, end: 10.402 },
      ],
      chain: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
      passes: Number(process.env.NC) || 36,
    },
  ],
  [
    'cadena-webaudio',
    'testLoop',
    {
      backend: 'WebAudio',
      file: 'rampa.wav',
      regions: [
        { start: 2.113, end: 2.904 },
        { start: 5.307, end: 6.118 },
        { start: 9.711, end: 10.402 },
      ],
      chain: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
      passes: Number(process.env.NC) || 36,
    },
  ],
  // Las pruebas multipista se repiten R veces: el desfase tras un salto varía de una vez a otra
  ...Array.from({ length: R }, (_, i) => [
    [`multi-media-3-r${i + 1}`, 'testMulti', { backend: 'MediaElement', tracks: 3, seconds: S }],
    [`multi-webaudio-3-r${i + 1}`, 'testMulti', { backend: 'WebAudio', tracks: 3, seconds: S }],
    [`multi-media-3-carga-r${i + 1}`, 'testMulti', { backend: 'MediaElement', tracks: 3, seconds: S, load: CARGA }],
    [
      `multi-media-3-saltos-r${i + 1}`,
      'testMulti',
      { backend: 'MediaElement', tracks: 3, seconds: S, from: 3.217, seekEvery: 1.026 },
    ],
    [
      `multi-webaudio-3-saltos-r${i + 1}`,
      'testMulti',
      { backend: 'WebAudio', tracks: 3, seconds: S, from: 3.217, seekEvery: 1.026 },
    ],
  ]).flat(),
  [
    'multi-media-3-control',
    'testMulti',
    { backend: 'MediaElement', tracks: 3, seconds: 5, from: 1, offsets: [0, 0.5, -0.25] },
  ],
  ['lote-50', 'testBatch', { count: 50 }],
  ['lote-500', 'testBatch', { count: 500 }],
]

const server = await startServer(0)
const url = `http://localhost:${server.address().port}/lab-bucles/harness.html`
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const meta = { fecha: new Date().toISOString(), navegador: browser.version(), node: process.version, repeticiones: N }
const results = {}
for (const [name, fn, cfg] of runs) {
  if (filter && !name.includes(filter)) continue
  // Página nueva por prueba: nada se arrastra de una a otra
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  await page.goto(url)
  await page.waitForFunction(() => window.harnessReady)
  const t = Date.now()
  try {
    results[name] = { cfg, ...(await page.evaluate(([f, c]) => window[f](c), [fn, cfg])) }
  } catch (e) {
    results[name] = { cfg, error: String(e) }
  }
  console.log(`${name} (${((Date.now() - t) / 1000).toFixed(0)} s)`, JSON.stringify(results[name]).slice(0, 400))
  await page.close()
}
await browser.close()
server.close()
mkdirSync(join(here, 'resultados'), { recursive: true })
// Con filtro, los resultados nuevos sustituyen a los del mismo nombre en medidas.json
const file = join(here, 'resultados', 'medidas.json')
let out = { meta, results }
if (filter && existsSync(file)) {
  const prev = JSON.parse(readFileSync(file, 'utf8'))
  out = {
    meta: { ...prev.meta, repetidas: [...(prev.meta.repetidas ?? []), { ...meta, filtro: filter }] },
    results: { ...prev.results, ...results },
  }
}
writeFileSync(file, JSON.stringify(out, null, 2))
console.log('guardado en', file)
