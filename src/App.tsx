import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { SettingsPanel } from "./components/SettingsPanel"
import { CancelledError, exportFormat, fontString, Studio } from "./engine/studio"
import { defaultSettings, HEIGHT, WIDTH, type Settings } from "./settings"

const STORAGE_KEY = "og-video-settings"

function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
    } catch {}
    return defaultSettings
}

function slug(s: string) {
    return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "og"
}

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const studioRef = useRef<Studio | null>(null)
    const [settings, setSettings] = useState<Settings>(loadSettings)
    const [panelOpen, setPanelOpen] = useState(true)
    const [progress, setProgress] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const format = exportFormat()

    useEffect(() => {
        const studio = new Studio(canvasRef.current!, settings)
        studioRef.current = studio
        return () => studio.destroy()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Live: every settings change is pushed straight into the render loop
    useEffect(() => {
        studioRef.current?.setSettings(settings)
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
        } catch {}
    }, [settings])

    useEffect(() => {
        document.fonts.load(fontString(settings)).catch(() => {})
    }, [settings.fontWeight])

    const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings((s) => ({ ...s, [key]: value }))
    }, [])

    const recording = progress !== null

    const download = async () => {
        const studio = studioRef.current
        if (!studio || recording) return
        setError(null)
        setProgress(0)
        try {
            const { blob, extension } = await studio.record(setProgress)
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${slug(settings.text)}-og.${extension}`
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 10_000)
        } catch (e) {
            if (!(e instanceof CancelledError)) setError(e instanceof Error ? e.message : String(e))
        } finally {
            setProgress(null)
        }
    }

    return (
        <div className={`app ${panelOpen ? "panel-open" : ""}`}>
            <main className="stage">
                <div className="frame" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
                    <canvas ref={canvasRef} className="canvas" />
                    <AnimatePresence>
                        {recording && (
                            <motion.div
                                className="rec-badge"
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                            >
                                <span className="rec-dot" /> REC {(progress! * settings.duration).toFixed(1)}s /{" "}
                                {settings.duration}s
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <p className="meta">
                    {WIDTH * settings.renderScale}×{HEIGHT * settings.renderScale} · {settings.fps} fps ·{" "}
                    {settings.duration}s · {format ?? "Recording unsupported in this browser"}
                    {error && <span className="error"> · {error}</span>}
                </p>
            </main>

            <div className="toolbar">
                <button
                    type="button"
                    className="tool-button"
                    onClick={() => studioRef.current?.restart()}
                    disabled={recording}
                    title="Replay entry animation"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                        <path d="M2.5 2.5v3h3" />
                    </svg>
                    Replay
                </button>
                <button
                    type="button"
                    className="tool-button primary"
                    onClick={recording ? () => studioRef.current?.cancelRecording() : download}
                    disabled={!format}
                    style={{ "--progress": `${(progress ?? 0) * 100}%` } as React.CSSProperties}
                >
                    {recording ? (
                        <>Rendering… {Math.round(progress! * 100)}% · Cancel</>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
                            </svg>
                            Download {settings.duration}s
                        </>
                    )}
                </button>
                <button
                    type="button"
                    className={`icon-button ${panelOpen ? "active" : ""}`}
                    onClick={() => setPanelOpen((o) => !o)}
                    aria-label="Settings"
                    aria-expanded={panelOpen}
                >
                    <motion.svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        animate={{ rotate: panelOpen ? 90 : 0 }}
                        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                    >
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </motion.svg>
                </button>
            </div>

            <SettingsPanel
                open={panelOpen}
                settings={settings}
                onChange={update}
                onReset={() => setSettings(defaultSettings)}
                footer={
                    <p className="hint">
                        Download replays the animation from the start and renders it frame by frame, so the
                        video is smooth even if the preview stutters. Dragging isn't recorded. With Loop on, Total
                        Duration is the loop length.
                    </p>
                }
            />
        </div>
    )
}
