// Demo: bucles A-B con el plugin de regiones + las piezas de loop-tools.js y gapless-loop.js.
// Necesita `yarn build` (usa ../dist) y servirse por HTTP: `node lab-bucles/server.mjs`.
import WaveSurfer from '../dist/wavesurfer.js'
import RegionsPlugin from '../dist/plugins/regions.esm.js'
import { exportLoops, importLoops, shiftAll, padAll, snapAll, secondsToBar, playChain } from './loop-tools.js'
import { GaplessLoop } from './gapless-loop.js'

const $ = (id) => document.getElementById(id)
const regions = RegionsPlugin.create()
// Backend WebAudio: setTime() es barato, así la onda puede seguir al motor sin hueco
const ws = WaveSurfer.create({
  container: '#onda',
  backend: 'WebAudio',
  waveColor: '#8a8fb5',
  progressColor: '#3b4285',
  url: '../examples/audio/demo.wav',
  plugins: [regions],
})
regions.enableDragSelection({ color: 'rgba(80, 120, 255, 0.25)' })

let letter = 0
const nextName = () => String.fromCharCode(65 + (letter++ % 26))
regions.on('region-created', (r) => {
  if (!r.getContent()) r.setOptions({ content: nextName() })
  renderList()
})
regions.on('region-removed', renderList)
regions.on('region-updated', renderList)

// ------------------------------------------------------------ selección y edición en bloque
const selected = new Set()
function renderList() {
  const ul = $('lista')
  ul.replaceChildren(
    ...regions.getRegions().map((r) => {
      const li = document.createElement('li')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = selected.has(r.id)
      cb.onchange = () => (cb.checked ? selected.add(r.id) : selected.delete(r.id))
      const b = document.createElement('button')
      b.textContent = 'bucle'
      b.onclick = () => loopOne(r)
      li.append(cb, ` ${r.getContent() || r.id}: ${r.start.toFixed(3)} – ${r.end.toFixed(3)} s `, b)
      return li
    }),
  )
}
const selectedRegions = () => regions.getRegions().filter((r) => selected.has(r.id))
const barTimes = () => {
  const spb = (60 / Number($('bpm').value)) * Number($('pulsos').value)
  const d = ws.getDuration()
  const out = []
  for (let t = Number($('desfase').value); t <= d + 1e-9; t += spb) out.push(t)
  return out
}
document.querySelectorAll('[data-op]').forEach((b) => {
  b.onclick = () => {
    const rs = selectedRegions()
    const d = ws.getDuration()
    const op = b.dataset.op
    if (op === 'izq') shiftAll(rs, -0.1, d)
    if (op === 'der') shiftAll(rs, 0.1, d)
    if (op === 'ancho') padAll(rs, 0.05, d)
    if (op === 'estrecho') padAll(rs, -0.05, d)
    if (op === 'rejilla') snapAll(rs, barTimes())
    if (op === 'borrar') rs.forEach((r) => r.remove())
    if (gapless?.playing && rs.includes(current)) gapless.setLoop(current.start, current.end)
    renderList()
  }
})

// ------------------------------------------------------------ reproducción
let ctl = null // cadena o bucle con el plugin
let gapless = null
let current = null
let raf = 0

function stopAll() {
  ctl?.stop()
  ctl = null
  gapless?.stop()
  cancelAnimationFrame(raf)
  ws.pause()
}

function followGapless() {
  ws.setTime(gapless.getCurrentTime())
  raf = requestAnimationFrame(followGapless)
}

function loopOne(r) {
  stopAll()
  current = r
  if ($('motor').value === 'sinhueco') {
    const buffer = ws.getDecodedData()
    gapless ??= new GaplessLoop(new AudioContext(), buffer)
    gapless.setLoop(r.start, r.end)
    gapless.ctx.resume()
    gapless.play()
    followGapless()
  } else {
    ctl = playChain(ws, regions, { id: 'uno', steps: [{ loop: r.id }] })
  }
}

$('play').onclick = () => {
  if (ws.isPlaying() || gapless?.playing) return stopAll()
  ws.play()
}

function parseChain(text) {
  const byName = new Map(regions.getRegions().map((r) => [String(r.getContent() || r.id), r.id]))
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, rep] = s.split(/[×x*]/).map((x) => x.trim())
      if (!byName.has(name)) throw new Error(`no hay bucle «${name}»`)
      return { loop: byName.get(name), repeat: rep ? Number(rep) : 1 }
    })
}
$('tocarCadena').onclick = () => {
  stopAll()
  try {
    ctl = playChain(ws, regions, { id: 'cadena', steps: parseChain($('cadena').value) })
    ctl.onStep(
      ({ step, pass, region }) => ($('paso').textContent = `paso ${step + 1}: ${region.getContent()} (${pass + 1})`),
    )
  } catch (e) {
    $('paso').textContent = e.message
  }
}
$('pararCadena').onclick = stopAll

// Cursor de partitura: compás actual
ws.on('timeupdate', (t) => ($('compas').textContent = secondsToBar(barTimes(), t).toFixed(2)))

// ------------------------------------------------------------ JSON
$('exportar').onclick = () => {
  let chains = []
  try {
    chains = [{ id: 'cadena', steps: parseChain($('cadena').value) }]
  } catch {
    // cadena vacía o con nombres que no existen: se exporta sin ella
  }
  const data = exportLoops(regions.getRegions(), {
    chains,
    audio: { name: $('estado').dataset.name || 'demo.wav', duration: ws.getDuration() },
    barTimes: barTimes(),
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = 'bucles.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
$('importar').onchange = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  try {
    stopAll()
    const { chains } = importLoops(regions, await file.text(), ws.getDuration())
    if (chains[0]) {
      const names = new Map(regions.getRegions().map((r) => [r.id, r.getContent() || r.id]))
      $('cadena').value = chains[0].steps
        .map((s) => names.get(s.loop) + (s.repeat > 1 ? `×${s.repeat}` : ''))
        .join(', ')
    }
    renderList()
  } catch (err) {
    alert(err.message)
  }
}

// ------------------------------------------------------------ audio local
$('fichero').onchange = (e) => {
  const file = e.target.files[0]
  if (!file) return
  stopAll()
  gapless = null
  regions.clearRegions()
  $('estado').textContent = file.name
  $('estado').dataset.name = file.name
  ws.loadBlob(file)
}
