// Renders the particle globe (WebGL, offscreen) and the name text (2D) into one
// visible canvas. That single canvas is both the live preview and the recording source,
// so what you see is exactly what gets exported.
import { ArrayBufferTarget, Muxer } from "mp4-muxer"
import { HEIGHT, WIDTH, type Settings } from "../settings"
import {
    fragmentShaderSource,
    mulberry32,
    multiply,
    parseColor,
    perspective,
    rotateX,
    rotateY,
    translate,
    vertexShaderSource,
} from "./gl"

export interface RecordingResult {
    blob: Blob
    extension: "mp4" | "webm"
}

const MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.640033",
    "video/mp4;codecs=avc1.4d0033",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
]

export class CancelledError extends Error {
    constructor() {
        super("Export cancelled")
    }
}

// H.264 profiles to try with WebCodecs, best first
const AVC_CODECS = ["avc1.640033", "avc1.4d0033", "avc1.420033", "avc1.640028", "avc1.42001f"]

export async function pickAvcCodec(width: number, height: number, s: Settings) {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null
    for (const codec of AVC_CODECS) {
        try {
            const { supported } = await VideoEncoder.isConfigSupported({
                codec,
                width,
                height,
                bitrate: s.bitrate * 1_000_000,
                framerate: s.fps,
            })
            if (supported) return codec
        } catch {}
    }
    return null
}

/** Format the Download button will produce, for display. */
export function exportFormat() {
    if (typeof VideoEncoder !== "undefined") return "MP4 (H.264)"
    const mime = pickMimeType()
    return mime?.startsWith("video/mp4") ? "MP4 (H.264)" : mime ? "WebM" : null
}

export function pickMimeType() {
    if (typeof MediaRecorder === "undefined") return null
    return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

export function fontString(s: Settings, scale = 1) {
    return `${s.fontWeight} ${s.fontSize * scale}px "Work Sans"`
}

export class Studio {
    private ctx: CanvasRenderingContext2D
    private glCanvas = document.createElement("canvas")
    private gl: WebGLRenderingContext
    private program: WebGLProgram
    private buffer: WebGLBuffer | null = null
    private U: Record<string, WebGLUniformLocation | null> = {}
    private count = 0
    private settings: Settings
    private geometryKey = ""
    private scale = 0

    // Animation state
    private time = 0
    private twinkleClock = 0
    private entryElapsed = 0
    private rotation = { x: 0, y: 0 }
    private velocity = { x: 0, y: 0 }
    private dragging = false
    private last = { x: 0, y: 0 }
    private lastFrame = 0
    private frame: number | null = null

    // Export state
    private exporting = false
    private cancelExport = false
    private recorder: MediaRecorder | null = null
    private recordElapsed = 0
    private onRecordProgress: ((p: number) => void) | null = null
    private cleanupListeners: () => void

    constructor(private canvas: HTMLCanvasElement, settings: Settings) {
        this.settings = settings
        const ctx = canvas.getContext("2d", { alpha: false })
        const gl = this.glCanvas.getContext("webgl", {
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
        })
        if (!ctx || !gl) throw new Error("Canvas 2D / WebGL not available")
        this.ctx = ctx
        this.gl = gl
        this.program = this.createProgram()
        this.applySettings(settings)
        this.cleanupListeners = this.attachListeners()
        this.frame = requestAnimationFrame(this.render)
    }

    get isRecording() {
        return this.recorder !== null
    }

    setSettings(s: Settings) {
        this.settings = s
        this.applySettings(s)
    }

    /** Replays the entry spin from the start, as the video will. */
    restart() {
        this.time = 0
        this.twinkleClock = 0
        this.entryElapsed = 0
        this.rotation = { x: 0, y: 0 }
        this.velocity = { x: 0, y: 0 }
    }

    /**
     * Replays the animation from the start and encodes `duration` seconds of it.
     * Prefers WebCodecs: frames are rendered at an exact 1/fps step, so the result is
     * perfectly smooth and doesn't depend on the tab keeping up in real time.
     */
    async record(onProgress: (p: number) => void): Promise<RecordingResult> {
        await document.fonts.load(fontString(this.settings))
        const codec = await pickAvcCodec(this.canvas.width, this.canvas.height, this.settings)
        if (codec) return this.encodeFrames(codec, onProgress)
        return this.recordRealtime(onProgress)
    }

    private async encodeFrames(codec: string, onProgress: (p: number) => void): Promise<RecordingResult> {
        const s = { ...this.settings }
        const { width, height } = this.canvas
        const target = new ArrayBufferTarget()
        const muxer = new Muxer({
            target,
            video: { codec: "avc", width, height, frameRate: s.fps },
            fastStart: "in-memory",
        })
        let failure: Error | null = null
        const encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
        })
        encoder.configure({ codec, width, height, bitrate: s.bitrate * 1_000_000, framerate: s.fps })

        this.exporting = true
        this.cancelExport = false
        this.dragging = false
        this.restart()
        try {
            const total = Math.round(s.duration * s.fps)
            const frameUs = 1_000_000 / s.fps
            for (let i = 0; i < total; i++) {
                if (this.cancelExport) throw new CancelledError()
                if (failure) throw failure
                if (i > 0) this.step(1 / s.fps)
                this.draw()
                const frame = new VideoFrame(this.canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) })
                encoder.encode(frame, { keyFrame: i % (s.fps * 2) === 0 })
                frame.close()
                // Let the encoder drain and the UI breathe
                if (encoder.encodeQueueSize > 8 || i % 10 === 0) {
                    onProgress(i / total)
                    await new Promise((r) => setTimeout(r, 0))
                }
            }
            await encoder.flush()
            if (failure) throw failure
            muxer.finalize()
            onProgress(1)
            return { blob: new Blob([target.buffer], { type: "video/mp4" }), extension: "mp4" }
        } finally {
            if (encoder.state !== "closed") encoder.close()
            this.exporting = false
            this.lastFrame = 0
            this.restart()
        }
    }

    private async recordRealtime(onProgress: (p: number) => void): Promise<RecordingResult> {
        const mimeType = pickMimeType()
        if (!mimeType) throw new Error("This browser can't record canvas video (MediaRecorder unavailable).")

        const s = this.settings
        const stream = this.canvas.captureStream(s.fps)
        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: s.bitrate * 1_000_000,
        })
        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

        const done = new Promise<RecordingResult>((resolve, reject) => {
            recorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop())
                this.recorder = null
                this.onRecordProgress = null
                if (!chunks.length) return reject(new Error("Recording produced no data."))
                resolve({
                    blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
                    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
                })
            }
            recorder.onerror = () => reject(new Error("Recording failed."))
        })

        this.dragging = false
        this.restart()
        this.recordElapsed = 0
        this.onRecordProgress = onProgress
        this.recorder = recorder
        recorder.start(250)
        return done
    }

    cancelRecording() {
        this.cancelExport = true
        if (this.recorder?.state === "recording") this.recorder.stop()
    }

    destroy() {
        if (this.frame !== null) cancelAnimationFrame(this.frame)
        this.cancelRecording()
        this.cleanupListeners()
        const gl = this.gl
        gl.deleteBuffer(this.buffer)
        gl.deleteProgram(this.program)
        gl.getExtension("WEBGL_lose_context")?.loseContext()
    }

    private createProgram() {
        const gl = this.gl
        const compile = (source: string, type: number) => {
            const sh = gl.createShader(type)!
            gl.shaderSource(sh, source)
            gl.compileShader(sh)
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
                throw new Error("Shader compile error: " + gl.getShaderInfoLog(sh))
            return sh
        }
        const vs = compile(vertexShaderSource, gl.VERTEX_SHADER)
        const fs = compile(fragmentShaderSource, gl.FRAGMENT_SHADER)
        const program = gl.createProgram()!
        gl.attachShader(program, vs)
        gl.attachShader(program, fs)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error("Program link error: " + gl.getProgramInfoLog(program))
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        gl.useProgram(program)

        for (const name of [
            "projection", "view", "time", "twinkleClock", "twinkleOn", "floatIntensity", "pointSize", "depthSizing", "minScale", "maxScale", "dpr", "color",
            "loopOn", "loopPhase", "floatCycles", "twinkleTotal",
            "loopRotation", "swapWidth",
        ])
            this.U[name] = gl.getUniformLocation(program, name)

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.disable(gl.DEPTH_TEST)
        return program
    }

    // Only geometry and resolution changes touch GPU resources; everything else is read per frame.
    private applySettings(s: Settings) {
        const key = `${s.particleCount}|${s.sphereRadius}|${s.distribution}|${s.seed}`
        if (key !== this.geometryKey) {
            this.geometryKey = key
            this.buildGeometry(s)
        }
        if (s.renderScale !== this.scale) {
            this.scale = s.renderScale
            const w = WIDTH * s.renderScale
            const h = HEIGHT * s.renderScale
            this.canvas.width = this.glCanvas.width = w
            this.canvas.height = this.glCanvas.height = h
            this.gl.viewport(0, 0, w, h)
        }
    }

    private buildGeometry(s: Settings) {
        const gl = this.gl
        const rand = mulberry32(s.seed)
        const n = Math.round(s.particleCount)
        const data = new Float32Array(n * 6) // x, y, z, phase, speed, index
        for (let i = 0; i < n; i++) {
            const theta = rand() * Math.PI * 2
            const phi = Math.acos(2 * rand() - 1)
            // Surface: on the shell. Everywhere: uniform through the volume
            const r = s.distribution === "everywhere" ? s.sphereRadius * Math.cbrt(rand()) : s.sphereRadius
            const o = i * 6
            data[o] = r * Math.sin(phi) * Math.cos(theta)
            data[o + 1] = r * Math.sin(phi) * Math.sin(theta)
            data[o + 2] = r * Math.cos(phi)
            data[o + 3] = rand() * Math.PI * 2
            data[o + 4] = 0.5 + rand() * 1.5
            data[o + 5] = i
        }
        if (this.buffer) gl.deleteBuffer(this.buffer)
        this.buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        const stride = 6 * 4
        const attr = (name: string, size: number, offset: number) => {
            const loc = gl.getAttribLocation(this.program, name)
            if (loc < 0) return
            gl.enableVertexAttribArray(loc)
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4)
        }
        attr("basePosition", 3, 0)
        attr("phase", 1, 3)
        attr("speed", 1, 4)
        attr("index", 1, 5)
        this.count = n
    }

    private attachListeners() {
        const canvas = this.canvas
        const sensitivity = 0.0008
        const locked = () => this.recorder !== null || this.exporting

        // Drag to rotate only; the globe doesn't react to hover
        const onMouseMove = (e: MouseEvent) => {
            if (locked() || !this.dragging) return
            const dx = e.clientX - this.last.x,
                dy = e.clientY - this.last.y
            this.rotation.y += dx * sensitivity
            this.rotation.x += dy * sensitivity
            this.velocity.x = dx * sensitivity
            this.velocity.y = dy * sensitivity
            this.last.x = e.clientX
            this.last.y = e.clientY
        }
        const onMouseLeave = () => {
            this.dragging = false
        }
        const onMouseDown = (e: MouseEvent) => {
            if (locked()) return
            this.dragging = true
            this.last.x = e.clientX
            this.last.y = e.clientY
            this.velocity.x = this.velocity.y = 0
        }
        const onMouseUp = () => {
            this.dragging = false
        }
        canvas.addEventListener("mousemove", onMouseMove)
        canvas.addEventListener("mouseleave", onMouseLeave)
        canvas.addEventListener("mousedown", onMouseDown)
        window.addEventListener("mouseup", onMouseUp)
        return () => {
            canvas.removeEventListener("mousemove", onMouseMove)
            canvas.removeEventListener("mouseleave", onMouseLeave)
            canvas.removeEventListener("mousedown", onMouseDown)
            window.removeEventListener("mouseup", onMouseUp)
        }
    }

    // Live loop, driven by real elapsed time (consistent at 60Hz, 120Hz, etc.). Paused while exporting.
    private render = (now: number) => {
        const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0
        this.lastFrame = now
        if (!this.exporting) {
            this.step(dt)
            this.draw()
            if (this.recorder) {
                const s = this.settings
                this.recordElapsed += dt
                this.onRecordProgress?.(Math.min(this.recordElapsed / s.duration, 1))
                if (this.recordElapsed >= s.duration) this.cancelRecording()
            }
        }
        this.frame = requestAnimationFrame(this.render)
    }

    private draw() {
        this.drawGlobe(this.settings)
        this.drawComposite(this.settings)
    }

    private step(dt: number) {
        const s = this.settings
        const f = dt * 60 // frames elapsed at a 60Hz reference

        this.time += dt
        if (s.twinkle) this.twinkleClock += s.twinkleSpeed * 1.2 * dt

        // Entry spin: cancelled by dragging, replayed by restart()
        if (this.dragging || !s.entryAnimation || s.loop) this.entryElapsed = Infinity
        const duration = Math.max(0.1, s.entryDuration)
        const t0 = Math.min(this.entryElapsed, duration)
        const t1 = Math.min(t0 + dt, duration)
        this.entryElapsed = t1
        // Quintic ease-out: lose speed earlier, then settle with a gentler, slower tail.
        const entryRotation = s.entryAnimation && !s.loop
            ? (((Math.max(s.rotationSpeed, s.entrySpeed) - s.rotationSpeed) * 0.6 * duration) / 6) *
              (Math.pow(1 - t0 / duration, 6) - Math.pow(1 - t1 / duration, 6))
            : 0
        if (!this.dragging) {
            const decay = Math.pow(0.9, f)
            this.rotation.y += this.velocity.x * 0.9 * f
            this.rotation.x += this.velocity.y * 0.9 * f
            this.velocity.x *= decay
            this.velocity.y *= decay
            // In loop mode the auto-rotation is derived from loop progress instead (see drawGlobe)
            if (!s.loop && Math.abs(this.velocity.x) < 0.0001 && Math.abs(this.velocity.y) < 0.0001) {
                this.rotation.y += s.rotationSpeed * 0.01 * f + entryRotation
            }
        }
    }

    private drawGlobe(s: Settings) {
        const { gl, U, glCanvas } = this
        const projection = perspective((75 * Math.PI) / 180, glCanvas.width / glCanvas.height, 0.1, 1000)

        // Loop: float and twinkle complete whole cycles over `duration`. Rotation keeps the normal
        // Rotation Speed; the shader moves each particle back by `loopRotation` while it's invisible,
        // so by the end every particle is back where it started.
        const TAU = Math.PI * 2
        const loopDuration = Math.max(0.1, s.duration)
        const loopTime = this.time % loopDuration
        const loopPhase = loopTime / loopDuration
        const cycles = (freq: number) => Math.max(1, Math.round((freq * loopDuration) / TAU))
        const angularSpeed = s.rotationSpeed * 0.6 // rad/s, same as the free-running rotation at 60Hz
        const loopAngle = s.loop ? angularSpeed * loopTime : 0
        // Short fade around each jump: brief when hidden by the twinkle, a little longer without it
        const swapWidth = (s.twinkle ? 0.1 : 0.3) / loopDuration

        let view = rotateY(this.rotation.y + loopAngle)
        view = multiply(view, rotateX(this.rotation.x))
        view = multiply(view, translate(0, 0, -5))

        const bg = parseColor(s.backgroundColor)
        const color = parseColor(s.particleColor)
        gl.clearColor(bg[0], bg[1], bg[2], 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniformMatrix4fv(U.projection, false, projection)
        gl.uniformMatrix4fv(U.view, false, view)
        gl.uniform1f(U.time, this.time)
        gl.uniform1f(U.twinkleClock, this.twinkleClock)
        gl.uniform1f(U.twinkleOn, s.twinkle ? 1 : 0)
        gl.uniform1f(U.floatIntensity, s.floatIntensity)
        gl.uniform1f(U.pointSize, s.particleSize)
        gl.uniform1f(U.depthSizing, s.depthSizing ? 1 : 0)
        gl.uniform1f(U.minScale, s.minSize)
        gl.uniform1f(U.maxScale, s.maxSize)
        // The globe is laid out at 1200×630 "CSS pixels"; renderScale plays the role of devicePixelRatio
        gl.uniform1f(U.dpr, this.scale)
        gl.uniform3f(U.color, color[0], color[1], color[2])
        gl.uniform1f(U.loopOn, s.loop ? 1 : 0)
        gl.uniform1f(U.loopPhase, loopPhase)
        gl.uniform3f(U.floatCycles, cycles(0.5), cycles(0.3), cycles(0.4))
        gl.uniform1f(U.twinkleTotal, s.twinkleSpeed * 1.2 * loopDuration)
        gl.uniform1f(U.loopRotation, angularSpeed * loopDuration)
        gl.uniform1f(U.swapWidth, swapWidth)
        gl.drawArrays(gl.POINTS, 0, this.count)
    }

    private drawComposite(s: Settings) {
        const { ctx, canvas, scale } = this
        ctx.drawImage(this.glCanvas, 0, 0)
        if (!s.textVisible || !s.text) return

        const spacing = (s.fontSize * scale * s.letterSpacing) / 100
        ctx.save()
        ctx.fillStyle = s.textColor
        ctx.font = fontString(s, scale)
        ctx.letterSpacing = `${spacing}px`
        ctx.textAlign = "center"
        ctx.textBaseline = "alphabetic"

        // Canvas adds letter spacing after the last glyph too, so subtract it to get the visible width
        const measure = (t: string) => ctx.measureText(t).width - spacing
        const lines = balanceLines(s.text, (canvas.width * s.textMaxWidth) / 100, measure)
        const lineGap = s.fontSize * scale * s.lineHeight

        // Center the visible ink of the whole block, not the em boxes
        const first = ctx.measureText(lines[0])
        const last = ctx.measureText(lines[lines.length - 1])
        const inkTop = -first.actualBoundingBoxAscent
        const inkBottom = (lines.length - 1) * lineGap + last.actualBoundingBoxDescent
        const x = canvas.width / 2 + s.textOffsetX * scale + spacing / 2
        const y0 = canvas.height / 2 + s.textOffsetY * scale - (inkTop + inkBottom) / 2
        lines.forEach((line, i) => ctx.fillText(line, x, y0 + i * lineGap))
        ctx.restore()
    }
}

/** Greedy word wrap at `maxWidth`. A single word wider than that gets a line of its own. */
function wrapLines(words: string[], maxWidth: number, measure: (t: string) => number) {
    const lines: string[] = []
    let line = ""
    for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (line && measure(next) > maxWidth) {
            lines.push(line)
            line = word
        } else line = next
    }
    if (line) lines.push(line)
    return lines
}

/**
 * Like CSS `text-wrap: balance`: keep the line count greedy wrapping needs, but find the
 * narrowest width that still fits it, so the lines come out about equally long.
 */
function balanceLines(text: string, maxWidth: number, measure: (t: string) => number) {
    const words = text.trim().split(/\s+/)
    const target = wrapLines(words, maxWidth, measure).length
    if (target <= 1) return [words.join(" ")]
    let lo = Math.max(...words.map(measure))
    let hi = maxWidth
    if (lo >= hi) return wrapLines(words, maxWidth, measure)
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2
        if (wrapLines(words, mid, measure).length <= target) hi = mid
        else lo = mid
    }
    return wrapLines(words, hi, measure)
}
