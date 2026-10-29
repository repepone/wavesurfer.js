// Lo que el plugin de regiones NO trae y hay que escribir aparte:
//   - edición en bloque (mover, estirar, ajustar a la rejilla de compases)
//   - cadenas A→B→C con repeticiones
//   - exportar / importar la lista de bucles como JSON
// Funciona sobre la API pública del plugin: addRegion, getRegions,
// clearRegions, region.setOptions, region.play y los eventos region-in/out.

export const FORMAT = 'lab-bucles'
export const VERSION = 1

// ---------------------------------------------------------------- edición en bloque

/** Aplica `change(region) -> {start?, end?, color?, content?...}` a varias regiones a la vez */
export function batchUpdate(regions, change) {
  for (const r of regions) {
    const opts = change(r)
    if (opts) r.setOptions(opts)
  }
}

/** Desplaza todas las regiones Δ segundos, sin salirse de [0, duración] y sin deformarlas */
export function shiftAll(regions, delta, duration) {
  if (!regions.length) return
  const minStart = Math.min(...regions.map((r) => r.start))
  const maxEnd = Math.max(...regions.map((r) => r.end))
  const d = Math.max(-minStart, Math.min(duration - maxEnd, delta))
  batchUpdate(regions, (r) => ({ start: r.start + d, end: r.end + d }))
}

/** Ensancha (+) o estrecha (−) cada región `seconds` por cada lado */
export function padAll(regions, seconds, duration) {
  batchUpdate(regions, (r) => {
    const start = Math.max(0, r.start - seconds)
    const end = Math.min(duration, r.end + seconds)
    return end > start ? { start, end } : null
  })
}

/** Ajusta inicio y fin de cada región al tiempo de compás/pulso más cercano de la rejilla */
export function snapAll(regions, grid) {
  if (!grid.length) return
  const snap = (t) => grid.reduce((best, g) => (Math.abs(g - t) < Math.abs(best - t) ? g : best), grid[0])
  batchUpdate(regions, (r) => {
    const start = snap(r.start)
    const end = snap(r.end)
    return end > start ? { start, end } : null
  })
}

// ---------------------------------------------------------------- partitura

/**
 * Convierte compases a segundos con un mapa de compases: `barTimes[i]` es el
 * segundo en que empieza el compás i+1 en la grabación (el último elemento
 * es el final del último compás). Así un bucle «compases 5–8» no depende del
 * tempo, que en una grabación real no es constante.
 */
export function barsToSeconds(barTimes, fromBar, toBar) {
  const start = barTimes[fromBar - 1]
  const end = barTimes[toBar]
  if (start === undefined || end === undefined || end <= start)
    throw new Error(`compases ${fromBar}-${toBar} fuera del mapa`)
  return { start, end }
}

/** Compás (1-based, con fracción) en el que está un instante: para mover el cursor de la partitura */
export function secondsToBar(barTimes, t) {
  for (let i = 0; i < barTimes.length - 1; i++) {
    if (t < barTimes[i + 1]) return i + 1 + Math.max(0, (t - barTimes[i]) / (barTimes[i + 1] - barTimes[i]))
  }
  return barTimes.length - 1
}

// ---------------------------------------------------------------- JSON

/** Lista de bucles + cadenas → objeto JSON-serializable */
export function exportLoops(regions, { chains = [], audio = {}, barTimes } = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    audio,
    ...(barTimes ? { barTimes } : {}),
    loops: regions.map((r) => ({
      id: r.id,
      start: round(r.start),
      end: round(r.end),
      ...(textOf(r) ? { label: textOf(r) } : {}),
      ...(r.color ? { color: r.color } : {}),
    })),
    chains: chains.map((c) => ({ id: c.id, steps: c.steps.map((s) => ({ loop: s.loop, repeat: s.repeat ?? 1 })) })),
  }
}

/** Comprueba y normaliza un JSON importado. Lanza un Error con mensaje en castellano si no vale. */
export function parseLoops(json, duration = Infinity) {
  const data = typeof json === 'string' ? JSON.parse(json) : json
  if (!data || data.format !== FORMAT) throw new Error('no es un fichero de bucles (falta format: "lab-bucles")')
  if (data.version !== VERSION) throw new Error(`versión ${data.version} no soportada`)
  if (!Array.isArray(data.loops)) throw new Error('falta la lista "loops"')
  const ids = new Set()
  const loops = data.loops.map((l, i) => {
    if (typeof l.id !== 'string' || !l.id) throw new Error(`bucle ${i}: falta id`)
    if (ids.has(l.id)) throw new Error(`bucle ${i}: id repetido "${l.id}"`)
    ids.add(l.id)
    let { start, end } = l
    if (l.bars && data.barTimes) ({ start, end } = barsToSeconds(data.barTimes, l.bars[0], l.bars[1]))
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`bucle "${l.id}": start/end no numéricos`)
    start = Math.max(0, Math.min(duration, start))
    end = Math.max(0, Math.min(duration, end))
    if (end <= start) throw new Error(`bucle "${l.id}": end debe ser mayor que start`)
    return { id: l.id, start, end, label: l.label, color: l.color }
  })
  const chains = (data.chains ?? []).map((c, i) => {
    if (!Array.isArray(c.steps) || !c.steps.length) throw new Error(`cadena ${i}: sin pasos`)
    const steps = c.steps.map((s) => {
      if (!ids.has(s.loop)) throw new Error(`cadena "${c.id}": el bucle "${s.loop}" no existe`)
      const repeat = s.repeat ?? 1
      if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`cadena "${c.id}": repeat debe ser entero ≥ 1`)
      return { loop: s.loop, repeat }
    })
    return { id: c.id ?? `cadena-${i + 1}`, steps }
  })
  return { loops, chains, audio: data.audio ?? {}, barTimes: data.barTimes }
}

/** Sustituye las regiones del plugin por las del JSON. Devuelve {regions, chains}. */
export function importLoops(regionsPlugin, json, duration) {
  const parsed = parseLoops(json, duration)
  regionsPlugin.clearRegions()
  const regions = parsed.loops.map((l) =>
    regionsPlugin.addRegion({ id: l.id, start: l.start, end: l.end, content: l.label, color: l.color }),
  )
  return { regions, chains: parsed.chains, barTimes: parsed.barTimes }
}

function round(x) {
  return Math.round(x * 1e6) / 1e6
}

function textOf(r) {
  const c = typeof r.getContent === 'function' ? r.getContent() : undefined
  return typeof c === 'string' && c ? c : undefined
}

// ---------------------------------------------------------------- reproducción

/**
 * Reproduce una cadena de bucles: cada paso suena `repeat` veces y pasa al
 * siguiente; al acabar vuelve al primero (o para, con loop: false).
 * Usa el mismo mecanismo que el ejemplo del repo (region-out → region.play()),
 * así que hereda su hueco y su imprecisión (ver INFORME-LAB-BUCLES.md).
 * Devuelve { stop, onStep(cb) }.
 */
export function playChain(ws, regionsPlugin, chain, { loop = true } = {}) {
  const byId = new Map(regionsPlugin.getRegions().map((r) => [r.id, r]))
  const steps = chain.steps.map((s) => ({ region: byId.get(s.loop), repeat: s.repeat ?? 1 }))
  if (steps.some((s) => !s.region)) throw new Error('la cadena usa un bucle que no está cargado')
  let stepIdx = 0
  let pass = 0
  let stopped = false
  const listeners = []
  const current = () => steps[stepIdx].region

  const go = () => {
    listeners.forEach((cb) => cb({ step: stepIdx, pass, region: current() }))
    current().play()
  }

  const offOut = regionsPlugin.on('region-out', (region) => {
    if (stopped || region !== current()) return
    pass++
    if (pass >= steps[stepIdx].repeat) {
      pass = 0
      stepIdx++
      if (stepIdx >= steps.length) {
        if (!loop) {
          stop()
          ws.pause()
          return
        }
        stepIdx = 0
      }
    }
    go()
  })
  // Si el usuario pincha fuera, la cadena se suelta (igual que el ejemplo del repo)
  const offInteraction = ws.on('interaction', () => stop())

  function stop() {
    stopped = true
    offOut()
    offInteraction()
  }
  go()
  return { stop, onStep: (cb) => listeners.push(cb) }
}

/** Bucle simple sobre una región, como en examples/regions.js */
export function loopRegion(ws, regionsPlugin, region) {
  return playChain(ws, regionsPlugin, { id: 'simple', steps: [{ loop: region.id, repeat: 1 }] })
}
