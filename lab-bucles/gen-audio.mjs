// Genera las señales de prueba sintéticas (no se usa ninguna grabación real).
//   rampa.wav: mono, float32, 44,1 kHz, 20 s. Muestra = 0,1 + 0,8 · t/20.
//     El valor de cada muestra dice en qué punto del fichero estamos, así que
//     grabando la salida se sabe exactamente qué trozo sonó y cuándo.
//     Nunca vale 0: un 0 en la salida es silencio (hueco).
//   seno.wav: mono, float32, 44,1 kHz, 20 s, seno de 440 Hz con amplitud 0,5.
//     Sirve para ver el salto de forma de onda (clic) en el punto de vuelta.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SR = 44100
export const DUR = 20
export const RAMP_LO = 0.1
export const RAMP_SPAN = 0.8

function wavFloat32(samples, sr) {
  const dataBytes = samples.length * 4
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20) // WAVE_FORMAT_IEEE_FLOAT
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4)
  return buf
}

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'audio')
mkdirSync(out, { recursive: true })
const n = SR * DUR
const ramp = new Float32Array(n)
const sine = new Float32Array(n)
for (let i = 0; i < n; i++) {
  ramp[i] = RAMP_LO + (RAMP_SPAN * i) / n
  sine[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR)
}
writeFileSync(join(out, 'rampa.wav'), wavFloat32(ramp, SR))
writeFileSync(join(out, 'seno.wav'), wavFloat32(sine, SR))
console.log('audio generado en', out)
