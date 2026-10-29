// Saca de resultados/medidas.json las tablas que se copian en el informe.
//   node lab-bucles/resumen.mjs > lab-bucles/resultados/tablas.md
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { meta, results } = JSON.parse(readFileSync(join(here, 'resultados', 'medidas.json'), 'utf8'))
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '–')
const rango = (s, d = 2) => `${f(s.min, d)} … ${f(s.max, d)}`

console.log(`Medido el ${meta.fecha} con Chromium ${meta.navegador} headless, Node ${meta.node}.`)
for (const r of meta.repetidas ?? []) console.log(`Repetidas el ${r.fecha} las pruebas que contienen «${r.filtro}».`)
console.log('')

console.log('### Bucle con el plugin de regiones y referencia sin hueco\n')
console.log(
  '| prueba | vueltas | sobrepaso del fin: mediana (p25–p75) [mín … máx] ms | inicio: mediana ms | hueco: mediana [mín … máx] ms | vueltas con hueco | sobrepaso visto en JS: mediana [mín … máx] ms |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const [name, r] of Object.entries(results)) {
  if (!r.sobrepasoMs) continue
  const js = r.jsSobrepasoMs?.n ? `${f(r.jsSobrepasoMs.mediana)} [${rango(r.jsSobrepasoMs)}]` : '–'
  console.log(
    `| ${name} | ${r.transiciones} | ${f(r.sobrepasoMs.mediana)} (${f(r.sobrepasoMs.p25)}–${f(r.sobrepasoMs.p75)}) [${rango(r.sobrepasoMs)}] | ${f(r.errorInicioMs.mediana, 3)} | ${f(r.huecoMs.mediana)} [${rango(r.huecoMs)}] | ${r.vueltasConHueco} | ${js} |`,
  )
}

console.log('\n### Clic (salto de forma de onda, seno 440 Hz)\n')
console.log('| prueba | cortes | salto / salto normal: mediana [mín … máx] | muestras a 0 en el corte: mediana [máx] |')
console.log('| --- | --- | --- | --- |')
for (const [name, r] of Object.entries(results)) {
  if (!r.clic) continue
  console.log(
    `| ${name} | ${r.clic.resumen.n} | ${f(r.clic.resumen.mediana, 1)} [${rango(r.clic.resumen, 1)}] | ${f(r.clic.ceros.mediana, 0)} [${f(r.clic.ceros.max, 0)}] |`,
  )
}

console.log('\n### Eventos region-in / region-out\n')
console.log('| prueba | in | out | out repetidos | in repetidos |')
console.log('| --- | --- | --- | --- | --- |')
for (const [name, r] of Object.entries(results)) {
  if (!r.eventos) continue
  console.log(`| ${name} | ${r.eventos.in} | ${r.eventos.out} | ${r.eventos.outRepetidos} | ${r.eventos.inRepetidos} |`)
}

console.log('\n### Varias pistas (3 instancias, audio grabado cada 10 ms)\n')
console.log(
  '| prueba | desfase pista 1 vs 0: mín … máx ms | pista 2 vs 0: mín … máx ms | % tiempo >1 ms desfasada (p1 / p2) | posición vs reloj de audio (ppm) | getCurrentTime vs performance.now (ppm; residuo máx ms) | getCurrentTime vs AudioContext (ppm; residuo máx ms) | AudioContext vs performance.now (ppm) | desfase leído en JS p1: mín … máx ms |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [name, r] of Object.entries(results)) {
  if (!r.desfaseAudioMs) continue
  const [a, b] = r.desfaseAudioMs
  const p = r.jsVsPerformanceNow
  const ac = r.jsVsAudioContext
  console.log(
    `| ${name} | ${rango(a, 3)} | ${rango(b, 3)} | ${f(a.fraccionMas1ms * 100, 1)} / ${f(b.fraccionMas1ms * 100, 1)} | ${f(r.audioVsRelojAudio.ppm, 3)} | ${p ? `${f(p.ppm, 1)}; ${f(p.residuoMaxMs)}` : '–'} | ${ac ? `${f(ac.ppm, 1)}; ${f(ac.residuoMaxMs)}` : '–'} | ${f(r.relojAudioVsPerformanceNow?.ppm, 1)} | ${rango(r.jsDesfaseEntrePistasMs[0])} |`,
  )
}

console.log('\n### Edición en bloque y JSON con el plugin real\n')
console.log(
  '| regiones | crear ms | desplazar todas ms | estrechar todas ms | ajustar a rejilla ms | exportar ms | importar ms | JSON bytes | ida y vuelta igual |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [, r] of Object.entries(results)) {
  if (r.crearMs === undefined) continue
  console.log(
    `| ${r.n} | ${f(r.crearMs, 1)} | ${f(r.desplazarTodasMs, 1)} | ${f(r.estrecharTodasMs, 1)} | ${f(r.ajustarRejillaMs, 1)} | ${f(r.exportarMs, 1)} | ${f(r.importarMs, 1)} | ${r.jsonBytes} | ${r.idaYVueltaIgual ? 'sí' : 'no'} |`,
  )
}
const errors = Object.entries(results).filter(([, r]) => r.error)
if (errors.length) console.log('\nErrores:', errors.map(([n, r]) => `${n}: ${r.error}`).join('; '))
