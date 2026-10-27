// Shaders, matrix helpers and color parsing, ported from the Framer ParticleSphere component.

export function parseColor(color: string): [number, number, number] {
    let c = (color || "#333333").trim().toLowerCase()
    const varMatch = c.match(/^var\(\s*--[^,]+,\s*(.+)\)$/)
    if (varMatch) c = varMatch[1].trim()

    if (c.startsWith("#")) {
        const hex = c.slice(1)
        if (hex.length === 3 || hex.length === 4) {
            return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16) / 255) as [number, number, number]
        }
        if (hex.length === 6 || hex.length === 8) {
            return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
        }
    }
    if (c.startsWith("rgb")) {
        const m = c.match(/rgba?\s*\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)/)
        if (m) return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255]
    }
    return [0.2, 0.2, 0.2]
}

// Column-major matrix helpers
export function perspective(fov: number, aspect: number, near: number, far: number) {
    const f = 1.0 / Math.tan(fov / 2)
    const nf = 1 / (near - far)
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}
export function multiply(a: Float32Array, b: Float32Array) {
    const r = new Float32Array(16)
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
            r[i * 4 + j] =
                a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j]
    return r
}
export function rotateX(a: number) {
    const c = Math.cos(a),
        s = Math.sin(a)
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
}
export function rotateY(a: number) {
    const c = Math.cos(a),
        s = Math.sin(a)
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
}
export function translate(x: number, y: number, z: number) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
}

// Seeded PRNG so the particle layout stays the same between reloads and recordings
export function mulberry32(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const vertexShaderSource = `
    attribute vec3 basePosition;
    attribute float phase;
    attribute float speed;
    attribute float index;
    uniform mat4 projection;
    uniform mat4 view;
    uniform float time;
    uniform float twinkleClock;
    uniform float twinkleOn;
    uniform float floatIntensity;
    uniform float pointSize;
    uniform float depthSizing;
    uniform float minScale;
    uniform float maxScale;
    uniform float dpr;
    // Loop mode: float and twinkle complete whole cycles per loop. Rotation keeps its own
    // speed; instead, each particle jumps back by one loop's worth of rotation at a moment
    // it's invisible (the bottom of its twinkle), so frame N flows straight into frame 0.
    uniform float loopOn;
    uniform float loopPhase;    // 0..1 through the loop
    uniform vec3 floatCycles;   // whole float cycles per loop (x, y, z)
    uniform float twinkleTotal; // twinkle clock advance over one loop
    uniform float loopRotation; // radians the globe turns over one loop
    uniform float swapWidth;    // half-width of the fade around each particle's jump, in loop phase
    varying float vOpacity;

    const float TAU = 6.28318530718;

    void main() {
        float twinkleAngle = speed * twinkleClock;
        float swapFade = 1.0;
        bool jumped = false;

        if (loopOn > 0.5) {
            // Round each particle's own twinkle cycle count to a whole number
            float cycles = twinkleOn > 0.5 && twinkleTotal > 0.0
                ? max(1.0, floor(speed * twinkleTotal / TAU + 0.5))
                : 0.0;
            twinkleAngle = TAU * cycles * loopPhase;

            // Jump when the twinkle hits zero (sin = -1); without twinkle, at a random moment
            float swapPhase = cycles > 0.0
                ? mod(0.75 * TAU - phase, TAU) / (TAU * cycles)
                : phase / TAU;
            jumped = loopPhase >= swapPhase;
            float d = abs(loopPhase - swapPhase);
            swapFade = smoothstep(0.0, swapWidth, min(d, 1.0 - d));
        }

        // Float
        vec3 floatAngle = loopOn > 0.5
            ? TAU * floatCycles * loopPhase
            : vec3(time * 0.5, time * 0.3, time * 0.4);
        vec3 p = basePosition + vec3(
            sin(floatAngle.x + index * 0.1),
            cos(floatAngle.y + index * 0.2),
            sin(floatAngle.z + index * 0.15)
        ) * floatIntensity * 0.1;

        // Loop jump: rotate the floated position, so the float offset turns with the particle
        if (jumped) {
            float c = cos(-loopRotation), s = sin(-loopRotation);
            p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        }

        // Twinkle
        vOpacity = (twinkleOn > 0.5 ? (sin(phase + twinkleAngle) + 1.0) * 0.5 : 1.0) * swapFade;

        vec4 mv = view * vec4(p, 1.0);
        gl_Position = projection * mv;
        float scale = depthSizing > 0.5 ? (300.0 / max(-mv.z, 0.001)) : 60.0;
        float base = pointSize * 60.0;
        gl_PointSize = clamp(pointSize * scale, base * minScale, base * max(maxScale, minScale)) * dpr;
    }
`

export const fragmentShaderSource = `
    precision mediump float;
    uniform vec3 color;
    varying float vOpacity;
    void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;
        float edge = 1.0 - dist * 1.5;
        gl_FragColor = vec4(color, edge * vOpacity);
    }
`
