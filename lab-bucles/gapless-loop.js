// Bucle sin hueco escrito aparte, con AudioBufferSourceNode.loop.
// El motor de Web Audio da la vuelta dentro del hilo de audio, muestra a
// muestra, sin pasar por el hilo principal: no depende de requestAnimationFrame
// ni de los eventos de wavesurfer. wavesurfer queda solo como vista (forma de
// onda + cursor), moviendo su cursor con setTime() desde getCurrentTime().
//
// Límites (leído en la especificación de Web Audio, no medido aquí):
//   - playbackRate cambia velocidad Y tono (no hay estiramiento sin cambio de tono).
//   - Cambiar loopStart/loopEnd en marcha se aplica en la siguiente vuelta.
//   - El salto en la forma de onda sigue ahí (clic) si el punto de corte no cae en
//     un paso por cero: para suavizarlo habría que añadir fundidos cortos (no está hecho aquí).
//   - `rate` se fija antes de play(); cambiarlo en marcha no está contemplado.

export class GaplessLoop {
  /** @param {AudioContext} ctx  @param {AudioBuffer} buffer  @param {AudioNode} [destination] */
  constructor(ctx, buffer, destination = ctx.destination) {
    this.ctx = ctx
    this.buffer = buffer
    this.out = ctx.createGain()
    this.out.connect(destination)
    this.node = null
    this.loopStart = 0
    this.loopEnd = buffer.duration
    this.rate = 1
    this.startedAt = 0 // ctx.currentTime en el que empezó a sonar
    this.offset = 0 // posición del fichero en ese instante
  }

  setLoop(start, end) {
    this.loopStart = start
    this.loopEnd = end
    if (this.node) {
      this.node.loopStart = start
      this.node.loopEnd = end
    }
  }

  /** Empieza en `from` (por defecto, el inicio del bucle) dentro de `when` segundos */
  play(from = this.loopStart, when = 0) {
    this.stop()
    const node = this.ctx.createBufferSource()
    node.buffer = this.buffer
    node.loop = true
    node.loopStart = this.loopStart
    node.loopEnd = this.loopEnd
    node.playbackRate.value = this.rate
    node.connect(this.out)
    this.startedAt = this.ctx.currentTime + when
    this.offset = from
    node.start(this.startedAt, from)
    this.node = node
    return this.startedAt
  }

  stop() {
    if (!this.node) return
    try {
      this.node.stop()
    } catch {
      // ya parado
    }
    this.node.disconnect()
    this.node = null
  }

  get playing() {
    return !!this.node
  }

  /** Posición actual en el fichero (s), calculada con el reloj del AudioContext */
  getCurrentTime() {
    if (!this.node) return this.offset
    const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt) * this.rate
    const pos = this.offset + elapsed
    const len = this.loopEnd - this.loopStart
    if (pos < this.loopEnd || len <= 0) return pos
    return this.loopStart + ((pos - this.loopStart) % len)
  }
}
