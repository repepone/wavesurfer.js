// Banco de medida en el navegador. medir.mjs llama a estas funciones con Playwright.
// Usa el wavesurfer compilado del propio repo (dist/), sin cambios.
import WaveSurfer from '../dist/wavesurfer.js'
import WebAudioPlayer from '../dist/webaudio.js'
import RegionsPlugin from '../dist/plugins/regions.esm.js'
import { segments, transitions, stats, clickSteps, rampPos } from './analysis.js'
import { playChain, exportLoops, importLoops, shiftAll, snapAll, padAll } from './loop-tools.js'
import { GaplessLoop } from './gapless-loop.js'

const SR = 44100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function makeRecorder(ctx, channels) {
  await ctx.audioWorklet.addModule('./recorder-worklet.js')
  const node = new AudioWorkletNode(ctx, 'lab-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: channels,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
    processorOptions: { channels },
  })
  // La grabadora tiene que estar conectada al destino para que el motor la ejecute
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)
  const merger = ctx.createChannelMerger(channels)
  merger.connect(node)
  const chunks = []
  let firstFrame = -1
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  node.port.onmessage = (e) => {
    if (e.data.done) return resolveDone()
    if (firstFrame < 0) firstFrame = e.data.firstFrame
    chunks.push(e.data.chunk)
  }
  return {
    input: (k) => [merger, 0, k],
    async stop() {
      node.port.postMessage('stop')
      await done
      const len = chunks.reduce((s, c) => s + c[0].length, 0)
      const out = Array.from({ length: channels }, () => new Float32Array(len))
      let o = 0
      for (const c of chunks) {
        for (let k = 0; k < channels; k++) out[k].set(c[k], o)
        o += c[0].length
      }
      return { data: out, firstFrame }
    },
  }
}

function connect(src, rec, k) {
  const [merger, out, inp] = rec.input(k)
  src.connect(merger, out, inp)
}

/** Crea una instancia de wavesurfer con el backend pedido y engancha su salida a la grabadora */
async function makeTrack(ctx, rec, k, backend, url) {
  const container = document.createElement('div')
  document.getElementById('tracks').appendChild(container)
  let ws
  if (backend === 'WebAudio') {
    const player = new WebAudioPlayer(ctx)
    ws = WaveSurfer.create({ container, media: player, url, height: 40 })
    // gainNode es privado en TypeScript pero accesible en JS: es la salida del reproductor
    connect(player.gainNode, rec, k)
  } else {
    ws = WaveSurfer.create({ container, url, height: 40 })
    const src = ctx.createMediaElementSource(ws.getMediaElement())
    connect(src, rec, k)
  }
  await new Promise((r) => ws.once('ready', r))
  return { ws, container }
}

function startLoad(load) {
  if (!load) return () => {}
  // Carga artificial del hilo principal: bloques de `load.block` ms cada `load.every` ms
  // (simula, por ejemplo, el repintado de una partitura pesada)
  const id = setInterval(() => {
    const t = performance.now()
    while (performance.now() - t < load.block);
  }, load.every)
  return () => clearInterval(id)
}

/**
 * Bucle (o cadena) con el plugin de regiones.
 * cfg = { backend, file, regions: [{start,end}], chain?: [{idx, repeat}], passes, playEnd, load }
 */
window.testLoop = async function (cfg) {
  const ctx = new AudioContext({ sampleRate: SR })
  await ctx.resume()
  const rec = await makeRecorder(ctx, 1)
  const { ws, container } = await makeTrack(ctx, rec, 0, cfg.backend, `./audio/${cfg.file}`)
  const regionsPlugin = ws.registerPlugin(RegionsPlugin.create())
  const regs = cfg.regions.map((r, i) => regionsPlugin.addRegion({ id: `r${i}`, ...r, color: 'rgba(0,0,255,0.2)' }))

  const jsOvershoot = []
  let count = 0
  let finish
  const finished = new Promise((r) => (finish = r))
  const stopLoad = startLoad(cfg.load)

  // Registro de region-in/out por región, para ver si algún evento llega repetido
  const evlog = []
  regionsPlugin.on('region-in', (r) => evlog.push({ t: 'in', id: r.id, ct: ws.getCurrentTime() }))
  regionsPlugin.on('region-out', (r) => evlog.push({ t: 'out', id: r.id, ct: ws.getCurrentTime() }))

  if (cfg.chain) {
    const chain = { id: 'c', steps: cfg.chain.map((s) => ({ loop: `r${s.idx}`, repeat: s.repeat ?? 1 })) }
    let cur = regs[cfg.chain[0].idx]
    let ctl = null
    // Registrado ANTES que el de playChain: ve el region-out primero y puede parar la cadena
    regionsPlugin.on('region-out', (r) => {
      if (r !== cur || !ctl) return
      jsOvershoot.push((ws.getCurrentTime() - r.end) * 1000)
      if (++count >= cfg.passes) {
        ctl.stop()
        ws.pause()
        finish()
      }
    })
    ctl = playChain(ws, regionsPlugin, chain)
    ctl.onStep(({ region }) => (cur = region))
  } else {
    // Mismo patrón que examples/regions.js: region-in marca la región activa y
    // region-out la vuelve a reproducir. playEnd=true usa region.play(true).
    const region = regs[0]
    let activeRegion = null
    regionsPlugin.on('region-in', (r) => (activeRegion = r))
    regionsPlugin.on('region-out', (r) => {
      if (activeRegion !== r) return
      jsOvershoot.push((ws.getCurrentTime() - r.end) * 1000)
      if (++count >= cfg.passes) {
        ws.pause()
        finish()
        return
      }
      r.play(cfg.playEnd)
    })
    activeRegion = region
    region.play(cfg.playEnd)
  }

  // Tiempo límite: si el bucle se queda parado, se anota en vez de colgar la prueba
  const loopLen = Math.max(...cfg.regions.map((r) => r.end - r.start))
  const timedOut = await Promise.race([
    finished.then(() => false),
    sleep((loopLen * cfg.passes * 2 + 5) * 1000).then(() => true),
  ])
  const stallInfo = timedOut
    ? {
        atascado: true,
        vueltasAntesDeAtascarse: count,
        posicionAlAtascarse: ws.getCurrentTime(),
        sonando: ws.isPlaying(),
      }
    : { atascado: false }
  if (timedOut) ws.pause()
  stopLoad()
  await sleep(300)
  const { data } = await rec.stop()
  ws.destroy()
  container.remove()
  await ctx.close()

  const samples = data[0]
  let result
  if (cfg.file === 'seno.wav') {
    result = { clic: clickSteps(samples, SR) }
    result.clic.resumen = stats(result.clic.events.map((e) => e.ratio))
    result.clic.ceros = stats(result.clic.events.map((e) => e.zeros))
    result.clic.events = result.clic.events.slice(0, 5)
  } else {
    const segs = segments(samples, SR)
    const tr = transitions(segs, SR, cfg.regions, samples)
    result = {
      transiciones: tr.length,
      sobrepasoMs: stats(tr.map((t) => t.overshootMs)),
      errorInicioMs: stats(tr.map((t) => t.startErrMs)),
      huecoMs: stats(tr.map((t) => t.gapMs)),
      huecoCeros: stats(tr.map((t) => t.gapZeros)),
      vueltasConHueco: tr.filter((t) => t.gapSamples > 0).length,
      muestra: tr.slice(0, 5),
    }
  }
  Object.assign(result, stallInfo)
  result.jsSobrepasoMs = stats(jsOvershoot)
  result.eventos = eventSummary(evlog)
  result.segundosGrabados = samples.length / SR
  return result
}

/** Referencia: AudioBufferSourceNode.loop (gapless-loop.js), sin wavesurfer */
window.testGapless = async function (cfg) {
  const ctx = new AudioContext({ sampleRate: SR })
  await ctx.resume()
  const rec = await makeRecorder(ctx, 1)
  const buf = await ctx.decodeAudioData(await (await fetch(`./audio/${cfg.file}`)).arrayBuffer())
  const sink = ctx.createGain()
  connect(sink, rec, 0)
  const loop = new GaplessLoop(ctx, buf, sink)
  loop.setLoop(cfg.start, cfg.end)
  const stopLoad = startLoad(cfg.load)
  loop.play()
  // getCurrentTime() contra el inicio y fin del bucle: se muestrea para ver que la vista puede seguirle
  await sleep((cfg.end - cfg.start) * cfg.passes * 1000 + 200)
  loop.stop()
  stopLoad()
  await sleep(300)
  const { data } = await rec.stop()
  await ctx.close()
  const samples = data[0]
  if (cfg.file === 'seno.wav') {
    const clic = clickSteps(samples, SR)
    return {
      clic: {
        resumen: stats(clic.events.map((e) => e.ratio)),
        ceros: stats(clic.events.map((e) => e.zeros)),
        normalStep: clic.normalStep,
        events: clic.events.slice(0, 5),
      },
    }
  }
  const tr = transitions(segments(samples, SR), SR, [{ start: cfg.start, end: cfg.end }], samples)
  return {
    transiciones: tr.length,
    sobrepasoMs: stats(tr.map((t) => t.overshootMs)),
    errorInicioMs: stats(tr.map((t) => t.startErrMs)),
    huecoMs: stats(tr.map((t) => t.gapMs)),
    huecoCeros: stats(tr.map((t) => t.gapZeros)),
    vueltasConHueco: tr.filter((t) => t.gapSamples > 0).length,
    muestra: tr.slice(0, 5),
  }
}

/**
 * Varias pistas a la vez. Cada pista (rampa.wav) va a un canal de la grabadora;
 * como la muestra dice la posición, se ve el desfase real entre pistas, y
 * contra el reloj del AudioContext (las muestras grabadas) y performance.now().
 */
window.testMulti = async function (cfg) {
  const ctx = new AudioContext({ sampleRate: SR })
  await ctx.resume()
  const rec = await makeRecorder(ctx, cfg.tracks)
  const tracks = []
  for (let k = 0; k < cfg.tracks; k++) tracks.push(await makeTrack(ctx, rec, k, cfg.backend, './audio/rampa.wav'))
  const wss = tracks.map((t) => t.ws)
  const stopLoad = startLoad(cfg.load)

  // Reloj externo: performance.now(). Se anota qué dice cada pista con getCurrentTime()
  const reads = []
  const t0 = performance.now()
  // offsets: desfase intencionado por pista (s), para comprobar que la medida lo detecta
  const from = (k) => (cfg.from ?? 0) + (cfg.offsets?.[k] ?? 0)
  await Promise.all(wss.map((ws, k) => ws.play(from(k))))
  const tPlay = performance.now()
  // seekEvery: cada X s todas las pistas saltan atrás a la vez (como un bucle multipista hecho con setTime)
  const seekId = cfg.seekEvery
    ? setInterval(() => wss.forEach((ws, k) => ws.setTime(from(k))), cfg.seekEvery * 1000)
    : null
  const id = setInterval(() => {
    const now = performance.now()
    reads.push({ t: (now - t0) / 1000, ac: ctx.currentTime, pos: wss.map((ws) => ws.getCurrentTime()) })
  }, 50)
  await sleep(cfg.seconds * 1000)
  clearInterval(id)
  const durations = wss.map((ws) => ws.getDuration())
  if (seekId) clearInterval(seekId)
  wss.forEach((ws) => ws.pause())
  stopLoad()
  await sleep(300)
  const { data } = await rec.stop()
  tracks.forEach((t) => {
    t.ws.destroy()
    t.container.remove()
  })
  await ctx.close()

  // --- Audio: desfase entre pistas (ms), mirado cada 10 ms de audio grabado
  const step = SR / 100
  const offsets = Array.from({ length: cfg.tracks }, () => [])
  const vsClock = [] // [segundos de reloj de audio, posición pista 0]
  for (let i = 0; i < data[0].length; i += step) {
    const p0 = rampPos(data[0][i])
    if (Number.isNaN(p0)) continue
    vsClock.push([i / SR, p0])
    for (let k = 1; k < cfg.tracks; k++) {
      const pk = rampPos(data[k][i])
      if (!Number.isNaN(pk)) offsets[k].push((pk - p0) * 1000)
    }
  }
  // Con saltos la posición no es lineal: el ajuste contra el reloj solo vale sin seekEvery
  const fit = cfg.seekEvery ? { slope: NaN, maxResid: NaN } : linfit(vsClock)
  const result = {
    arranqueMs: (tPlay - t0).toFixed(1),
    desfaseAudioMs: offsets.slice(1).map((o, k) => ({
      pista: k + 1,
      ...stats(o),
      primero: o[0],
      ultimo: o[o.length - 1],
      // fracción del tiempo en que la pista va desfasada más de 1 ms respecto a la pista 0
      fraccionMas1ms: o.filter((x) => Math.abs(x - (cfg.offsets?.[k + 1] ?? 0) * 1000) > 1).length / o.length,
    })),
    // pendiente posición/reloj de audio: 1 = misma velocidad; (pendiente-1)*1e6 = ppm
    audioVsRelojAudio: { ppm: (fit.slope - 1) * 1e6, residuoMaxMs: fit.maxResid * 1000, puntos: vsClock.length },
  }
  // --- Lo que ve el JS: getCurrentTime() contra performance.now() y contra ctx.currentTime
  // Solo lecturas con todas las pistas sonando (ni el primer medio segundo ni el final del fichero)
  const dur = Math.min(...durations)
  const usable = reads.filter((r) => r.t > 0.5 && r.pos.every((p) => p < dur - 0.2))
  // El reloj del AudioContext contra performance.now(): los dos relojes «externos» posibles
  const fitClocks = linfit(usable.map((r) => [r.t, r.ac]))
  result.relojAudioVsPerformanceNow = { ppm: (fitClocks.slope - 1) * 1e6, residuoMaxMs: fitClocks.maxResid * 1000 }
  if (cfg.seekEvery) {
    result.jsDesfaseEntrePistasMs = Array.from({ length: cfg.tracks - 1 }, (_, k) =>
      stats(usable.map((r) => (r.pos[k + 1] - r.pos[0]) * 1000)),
    )
    return result
  }
  const fitPerf = linfit(usable.map((r) => [r.t, r.pos[0]]))
  const fitAc = linfit(usable.map((r) => [r.ac, r.pos[0]]))
  result.jsVsPerformanceNow = {
    ppm: (fitPerf.slope - 1) * 1e6,
    residuoMaxMs: fitPerf.maxResid * 1000,
    residuoDesvMs: fitPerf.sdResid * 1000,
    lecturas: usable.length,
  }
  result.jsVsAudioContext = {
    ppm: (fitAc.slope - 1) * 1e6,
    residuoMaxMs: fitAc.maxResid * 1000,
    residuoDesvMs: fitAc.sdResid * 1000,
  }
  result.jsDesfaseEntrePistasMs = Array.from({ length: cfg.tracks - 1 }, (_, k) =>
    stats(usable.map((r) => (r.pos[k + 1] - r.pos[0]) * 1000)),
  )
  return result
}

/** Cuenta region-in/out y los que llegan repetidos (dos 'out' seguidos de la misma región sin 'in' entre medias) */
function eventSummary(evlog) {
  const last = {}
  let dupOut = 0
  let dupIn = 0
  for (const e of evlog) {
    if (last[e.id] === e.t) e.t === 'out' ? dupOut++ : dupIn++
    last[e.id] = e.t
  }
  return {
    in: evlog.filter((e) => e.t === 'in').length,
    out: evlog.filter((e) => e.t === 'out').length,
    outRepetidos: dupOut,
    inRepetidos: dupIn,
    ejemplo: evlog.slice(0, 12),
  }
}

function linfit(pts) {
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p[0], 0) / n
  const my = pts.reduce((s, p) => s + p[1], 0) / n
  let sxy = 0
  let sxx = 0
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
  }
  const slope = sxy / sxx
  const icpt = my - slope * mx
  const resid = pts.map(([x, y]) => y - (icpt + slope * x))
  const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2))
  return { slope, icpt, maxResid: Math.max(...resid.map(Math.abs)), sdResid: sd }
}

/** Edición en bloque y JSON con el plugin real: tiempos y comprobación de ida y vuelta */
window.testBatch = async function (cfg) {
  const container = document.createElement('div')
  document.getElementById('tracks').appendChild(container)
  const ws = WaveSurfer.create({ container, url: './audio/rampa.wav', height: 60 })
  await new Promise((r) => ws.once('ready', r))
  const plugin = ws.registerPlugin(RegionsPlugin.create())
  const dur = ws.getDuration()
  const out = { n: cfg.count }
  const len = (dur - 0.5) / cfg.count

  let t = performance.now()
  for (let i = 0; i < cfg.count; i++)
    plugin.addRegion({ id: `b${i}`, start: i * len, end: i * len + len * 0.8, content: `B${i}` })
  out.crearMs = performance.now() - t

  t = performance.now()
  shiftAll(plugin.getRegions(), 0.25, dur)
  out.desplazarTodasMs = performance.now() - t

  t = performance.now()
  padAll(plugin.getRegions(), -0.01, dur)
  out.estrecharTodasMs = performance.now() - t

  const grid = Array.from({ length: Math.floor(dur / 0.5) + 1 }, (_, i) => i * 0.5)
  t = performance.now()
  snapAll(plugin.getRegions(), grid)
  out.ajustarRejillaMs = performance.now() - t

  const chains = [{ id: 'A-B-C', steps: [{ loop: 'b0', repeat: 2 }, { loop: 'b1' }, { loop: 'b2', repeat: 3 }] }]
  t = performance.now()
  const json = JSON.stringify(exportLoops(plugin.getRegions(), { chains, audio: { name: 'rampa.wav', duration: dur } }))
  out.exportarMs = performance.now() - t
  out.jsonBytes = json.length

  const before = plugin.getRegions().map((r) => [r.id, r.start, r.end, r.getContent()])
  t = performance.now()
  const imported = importLoops(plugin, json, dur)
  out.importarMs = performance.now() - t
  await sleep(50)
  const after = plugin.getRegions().map((r) => [r.id, r.start, r.end, r.getContent()])
  out.idaYVueltaIgual =
    before.length === after.length &&
    before.every(
      (b, i) =>
        b[0] === after[i][0] &&
        Math.abs(b[1] - after[i][1]) < 1e-6 &&
        Math.abs(b[2] - after[i][2]) < 1e-6 &&
        b[3] === after[i][3],
    )
  out.cadenasImportadas = imported.chains.length
  out.regionesEnDom = container.querySelector('div')?.shadowRoot?.querySelectorAll('[part~="region"]').length ?? null
  ws.destroy()
  container.remove()
  return out
}

window.harnessReady = true
