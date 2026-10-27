// Every tweakable value, its default, and how the settings panel presents it.
// Globe defaults mirror the Framer component's property-control defaults.

export interface Settings {
    // Canvas
    backgroundColor: string

    // Text
    textVisible: boolean
    text: string
    textColor: string
    fontSize: number
    letterSpacing: number // percent of font size
    fontWeight: number
    textOffsetX: number
    textOffsetY: number

    // Particles
    particleColor: string
    particleCount: number
    distribution: "surface" | "everywhere"
    sphereRadius: number
    particleSize: number
    depthSizing: boolean
    maxSize: number
    minSize: number
    seed: number

    // Motion
    loop: boolean
    rotationSpeed: number
    floatIntensity: number
    twinkle: boolean
    twinkleSpeed: number

    // Entry spin
    entryAnimation: boolean
    entryDuration: number
    entrySpeed: number

    // Export
    duration: number
    fps: number
    renderScale: number
    bitrate: number // Mbps
}

export const WIDTH = 1200
export const HEIGHT = 630

export const defaultSettings: Settings = {
    backgroundColor: "#f4f3ef",

    textVisible: true,
    text: "Deep Patel",
    textColor: "#111111",
    fontSize: 240,
    letterSpacing: -9,
    fontWeight: 550,
    textOffsetX: 0,
    textOffsetY: 0,

    particleColor: "#333333",
    particleCount: 500,
    distribution: "surface",
    sphereRadius: 2,
    particleSize: 0.05,
    depthSizing: true,
    maxSize: 3,
    minSize: 0.1,
    seed: 1,

    loop: false,
    rotationSpeed: 0.1,
    floatIntensity: 0.5,
    twinkle: true,
    twinkleSpeed: 0.25,

    entryAnimation: true,
    entryDuration: 3,
    entrySpeed: 12,

    duration: 6,
    fps: 60,
    renderScale: 2,
    bitrate: 16,
}

type Hidden = (s: Settings) => boolean

export type Control =
    | {
          key: keyof Settings
          type: "number"
          title: string
          min: number
          max: number
          step: number
          unit?: string
          hidden?: Hidden
      }
    | { key: keyof Settings; type: "color"; title: string; hidden?: Hidden }
    | { key: keyof Settings; type: "boolean"; title: string; hidden?: Hidden }
    | { key: keyof Settings; type: "text"; title: string; hidden?: Hidden }
    | {
          key: keyof Settings
          type: "enum"
          title: string
          options: (string | number)[]
          optionTitles: string[]
          hidden?: Hidden
      }

export interface Section {
    id: string
    title: string
    controls: Control[]
}

const noText: Hidden = (s) => !s.textVisible

export const sections: Section[] = [
    {
        id: "colors",
        title: "Colors",
        controls: [
            { key: "backgroundColor", type: "color", title: "Background" },
            { key: "textColor", type: "color", title: "Text" },
            { key: "particleColor", type: "color", title: "Particles" },
        ],
    },
    {
        id: "text",
        title: "Text",
        controls: [
            { key: "textVisible", type: "boolean", title: "Visible" },
            { key: "text", type: "text", title: "Content", hidden: noText },
            { key: "fontSize", type: "number", title: "Size", min: 12, max: 480, step: 1, unit: "px", hidden: noText },
            { key: "letterSpacing", type: "number", title: "Letter Spacing", min: -20, max: 20, step: 0.5, unit: "%", hidden: noText },
            { key: "fontWeight", type: "number", title: "Weight", min: 100, max: 900, step: 10, hidden: noText },
            { key: "textOffsetX", type: "number", title: "Offset X", min: -600, max: 600, step: 1, unit: "px", hidden: noText },
            { key: "textOffsetY", type: "number", title: "Offset Y", min: -315, max: 315, step: 1, unit: "px", hidden: noText },
        ],
    },
    {
        id: "particles",
        title: "Particles",
        controls: [
            {
                key: "distribution",
                type: "enum",
                title: "Distribution",
                options: ["surface", "everywhere"],
                optionTitles: ["Surface", "Everywhere"],
            },
            { key: "particleCount", type: "number", title: "Count", min: 100, max: 10000, step: 50 },
            { key: "sphereRadius", type: "number", title: "Sphere Radius", min: 0.5, max: 10, step: 0.1 },
            { key: "particleSize", type: "number", title: "Size", min: 0.001, max: 0.5, step: 0.001 },
            { key: "depthSizing", type: "boolean", title: "Depth Sizing" },
            { key: "maxSize", type: "number", title: "Max Size", min: 1, max: 10, step: 0.1, unit: "×", hidden: (s) => !s.depthSizing },
            { key: "minSize", type: "number", title: "Min Size", min: 0.1, max: 1, step: 0.05, unit: "×", hidden: (s) => !s.depthSizing },
            { key: "seed", type: "number", title: "Seed", min: 1, max: 999, step: 1 },
        ],
    },
    {
        id: "motion",
        title: "Motion",
        controls: [
            { key: "loop", type: "boolean", title: "Loop" },
            { key: "rotationSpeed", type: "number", title: "Rotation Speed", min: 0, max: 5, step: 0.05 },
            { key: "floatIntensity", type: "number", title: "Float Intensity", min: 0, max: 2, step: 0.1 },
            { key: "twinkle", type: "boolean", title: "Twinkle" },
            { key: "twinkleSpeed", type: "number", title: "Twinkle Speed", min: 0, max: 5, step: 0.05, hidden: (s) => !s.twinkle },
        ],
    },
    {
        id: "entry",
        title: "Entry Spin",
        controls: [
            // A one-off spin can't loop, so the whole section hides while Loop is on
            { key: "entryAnimation", type: "boolean", title: "Entry Spin", hidden: (s) => s.loop },
            { key: "entryDuration", type: "number", title: "Ease Out", min: 0.1, max: 15, step: 0.1, unit: "s", hidden: (s) => s.loop || !s.entryAnimation },
            { key: "entrySpeed", type: "number", title: "Entry Speed", min: 0, max: 50, step: 0.5, hidden: (s) => s.loop || !s.entryAnimation },
        ],
    },
    {
        id: "export",
        title: "Export",
        controls: [
            { key: "duration", type: "number", title: "Total Duration", min: 1, max: 60, step: 0.5, unit: "s" },
            { key: "fps", type: "enum", title: "Frame Rate", options: [30, 60], optionTitles: ["30 fps", "60 fps"] },
            {
                key: "renderScale",
                type: "enum",
                title: "Resolution",
                options: [1, 2],
                optionTitles: ["1200×630", "2400×1260"],
            },
            { key: "bitrate", type: "number", title: "Bitrate", min: 2, max: 40, step: 1, unit: "Mbps" },
        ],
    },
]
