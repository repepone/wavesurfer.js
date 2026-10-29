// Graba lo que llega a su entrada (N canales) y lo envía al hilo principal en bloques.
class Recorder extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.channels = options.processorOptions.channels
    this.size = 16384
    this.bufs = Array.from({ length: this.channels }, () => new Float32Array(this.size))
    this.n = 0
    this.firstFrame = -1
    this.recording = true
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush()
        this.recording = false
        this.port.postMessage({ done: true })
      }
    }
  }
  flush() {
    if (!this.n) return
    const chunk = this.bufs.map((b) => b.slice(0, this.n))
    this.port.postMessage(
      { chunk, firstFrame: this.firstFrame },
      chunk.map((c) => c.buffer),
    )
    this.n = 0
  }
  process(inputs) {
    if (!this.recording) return false
    if (this.firstFrame < 0) this.firstFrame = currentFrame
    const input = inputs[0]
    const frames = input[0] ? input[0].length : 128
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < this.channels; c++) this.bufs[c][this.n] = input[c] ? input[c][i] : 0
      this.n++
      if (this.n === this.size) this.flush()
    }
    return true
  }
}
registerProcessor('lab-recorder', Recorder)
