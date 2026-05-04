// AudioWorkletProcessor: downsample ctx.sampleRate Float32 -> 16kHz Int16.
// Emits ~100ms chunks (1600 samples) to the main thread as ArrayBuffers.
class PCM16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;   // e.g. 48000/16000 = 3
    this.frame = 1600;                            // 100ms @16kHz
    this.buf = new Int16Array(this.frame);
    this.bufPos = 0;
    this.inPos = 0;                               // fractional read position into source
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    // Linear-resample ch (Float32 @sampleRate) into 16kHz samples.
    while (true) {
      const i = this.inPos;
      const i0 = Math.floor(i);
      if (i0 >= ch.length - 1) {
        // Ran out of input in this block. Rewind inPos relative to next block.
        this.inPos -= ch.length;
        if (this.inPos < 0) this.inPos = 0;
        break;
      }
      const frac = i - i0;
      const s = ch[i0] * (1 - frac) + ch[i0 + 1] * frac;
      const clamped = Math.max(-1, Math.min(1, s));
      this.buf[this.bufPos++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      if (this.bufPos >= this.frame) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(this.frame);
        this.bufPos = 0;
      }
      this.inPos += this.ratio;
    }
    return true;
  }
}

registerProcessor('pcm16-downsampler', PCM16Downsampler);
