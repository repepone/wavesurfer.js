// Análisis de la salida de audio grabada. Módulo puro: se usa en el navegador
// (harness.js) y en Node (analysis.test.mjs).

/** Constantes de la señal rampa.wav (ver gen-audio.mjs) */
export const RAMP = { lo: 0.1, span: 0.8, dur: 20 }

/** Posición en el fichero (s) codificada en una muestra de la rampa; NaN si es silencio */
export function rampPos(v, ramp = RAMP) {
  if (!(v > ramp.lo - 0.02 && v < ramp.lo + ramp.span + 0.02)) return NaN
  return ((v - ramp.lo) / ramp.span) * ramp.dur
}

/**
 * Trocea la salida grabada en tramos continuos: muestras seguidas cuya posición
 * avanza exactamente 1/sr (tolerancia: ±tol muestras). Lo que no encaja en un
 * tramo continuo (silencio, fundidos, basura) se cuenta como hueco.
 */
export function segments(samples, sr, ramp = RAMP, tol = 0.25) {
  const out = []
  let cur = null
  let prevPos = NaN
  for (let i = 0; i < samples.length; i++) {
    const p = rampPos(samples[i], ramp)
    const continuous = cur && !Number.isNaN(p) && Math.abs((p - prevPos) * sr - 1) <= tol
    if (continuous) {
      cur.endIdx = i
      cur.lastPos = p
    } else {
      if (cur) out.push(cur)
      cur = Number.isNaN(p) ? null : { startIdx: i, endIdx: i, firstPos: p, lastPos: p }
    }
    prevPos = p
  }
  if (cur) out.push(cur)
  // Un tramo de 1 muestra suele ser una muestra de transición (no audio real)
  return out.filter((s) => s.endIdx - s.startIdx >= 8)
}

/**
 * Cada salto entre dos tramos continuos es una «vuelta» (o un paso de cadena).
 * Para cada uno: dónde se dejó de sonar (respecto al final esperado), dónde se
 * retomó (respecto al inicio esperado) y cuánto duró el hueco.
 * `regions` = [{start, end}] posibles; se empareja con la más cercana.
 */
export function transitions(segs, sr, regions, samples) {
  const res = []
  for (let k = 1; k < segs.length; k++) {
    const a = segs[k - 1]
    const b = segs[k]
    // posición justo después de la última muestra que sonó
    const stopPos = a.lastPos + 1 / sr
    const from = nearest(regions, (r) => r.end, stopPos)
    const to = nearest(regions, (r) => r.start, b.firstPos)
    res.push({
      from: from.idx,
      to: to.idx,
      overshootMs: (stopPos - from.r.end) * 1000,
      startErrMs: (b.firstPos - to.r.start) * 1000,
      gapMs: ((b.startIdx - a.endIdx - 1) / sr) * 1000,
      gapSamples: b.startIdx - a.endIdx - 1,
      // de esas muestras de hueco, cuántas son silencio exacto (0)
      ...(samples ? { gapZeros: countZeros(samples, a.endIdx + 1, b.startIdx) } : {}),
    })
  }
  return res
}

function countZeros(samples, from, to) {
  let n = 0
  for (let i = from; i < to; i++) if (samples[i] === 0) n++
  return n
}

function nearest(regions, key, value) {
  let best = { idx: -1, r: null, d: Infinity }
  regions.forEach((r, idx) => {
    const d = Math.abs(key(r) - value)
    if (d < best.d) best = { idx, r, d }
  })
  return best
}

/** Mediana, cuartiles, media, desviación típica, mínimo y máximo */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  const n = v.length
  if (!n) return { n: 0 }
  const q = (p) => {
    const i = (n - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)
  }
  const mean = v.reduce((s, x) => s + x, 0) / n
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1))
  return {
    n,
    mediana: q(0.5),
    p25: q(0.25),
    p75: q(0.75),
    iqr: q(0.75) - q(0.25),
    media: mean,
    desv: sd,
    min: v[0],
    max: v[n - 1],
  }
}

/**
 * Clic con la señal seno.wav: el mayor salto entre muestras consecutivas
 * dentro de ±win muestras alrededor de cada discontinuidad, comparado con el
 * mayor salto normal de un seno de amplitud amp y frecuencia f.
 */
export function clickSteps(samples, sr, { amp = 0.5, f = 440, win = 64 } = {}) {
  const normal = amp * 2 * Math.PI * (f / sr)
  const thr = normal * 1.5
  const events = []
  let last = -Infinity
  let firstSound = samples.findIndex((x) => Math.abs(x) > 1e-4)
  let lastSound = samples.length - 1
  while (lastSound > 0 && Math.abs(samples[lastSound]) <= 1e-4) lastSound--
  // Silencio dentro del audio: racha de muestras exactamente a 0 de más de 4 muestras
  for (let i = firstSound + 1; i < lastSound; i++) {
    const step = Math.abs(samples[i] - samples[i - 1])
    const silentRun = samples[i] === 0 && samples[i - 1] === 0 && samples[i - 2] === 0 && samples[i - 3] === 0
    if ((step > thr || silentRun) && i - last > win * 4) {
      let maxStep = 0
      let zeros = 0
      const end = Math.min(lastSound, i + win * 64)
      for (let j = Math.max(firstSound + 1, i - win); j < end; j++) {
        maxStep = Math.max(maxStep, Math.abs(samples[j] - samples[j - 1]))
        if (samples[j] === 0) zeros++
        if (j > i + win && Math.abs(samples[j]) > 0.01 && Math.abs(samples[j] - samples[j - 1]) <= thr && zeros === 0)
          break
      }
      events.push({ idx: i, maxStep, ratio: maxStep / normal, zeros })
      last = i
    }
  }
  return { normalStep: normal, events }
}
