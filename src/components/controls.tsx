import { useEffect, useRef, useState } from "react"
import type { Control, Settings } from "../settings"

type Value = Settings[keyof Settings]

interface Props {
    control: Control
    value: Value
    onChange: (v: Value) => void
}

export function ControlRow({ control, value, onChange }: Props) {
    return (
        <div className="row">
            <label className="row-label">{control.title}</label>
            <div className="row-input">
                {control.type === "number" && (
                    <NumberControl control={control} value={value as number} onChange={onChange} />
                )}
                {control.type === "color" && <ColorControl value={value as string} onChange={onChange} />}
                {control.type === "boolean" && <Toggle value={value as boolean} onChange={onChange} />}
                {control.type === "text" && (
                    <input
                        className="text-input"
                        type="text"
                        value={value as string}
                        onChange={(e) => onChange(e.target.value)}
                    />
                )}
                {control.type === "enum" && (
                    <Segmented
                        options={control.options}
                        titles={control.optionTitles}
                        value={value as string | number}
                        onChange={onChange}
                    />
                )}
            </div>
        </div>
    )
}

function decimals(step: number) {
    const s = String(step)
    return s.includes(".") ? s.split(".")[1].length : 0
}

function NumberControl({
    control,
    value,
    onChange,
}: {
    control: Extract<Control, { type: "number" }>
    value: number
    onChange: (v: number) => void
}) {
    const { min, max, step, unit } = control
    const [draft, setDraft] = useState<string | null>(null)
    const pct = ((value - min) / (max - min)) * 100
    const commit = () => {
        if (draft === null) return
        const n = parseFloat(draft)
        if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
        setDraft(null)
    }
    return (
        <div className="number">
            <input
                className="slider"
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                style={{ "--pct": `${pct}%` } as React.CSSProperties}
                onChange={(e) => onChange(parseFloat(e.target.value))}
            />
            <div className="number-field">
                <input
                    type="text"
                    inputMode="decimal"
                    value={draft ?? value.toFixed(decimals(step))}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                            e.preventDefault()
                            const dir = e.key === "ArrowUp" ? 1 : -1
                            const mult = e.shiftKey ? 10 : 1
                            const next = Math.min(max, Math.max(min, value + dir * step * mult))
                            onChange(parseFloat(next.toFixed(decimals(step))))
                            setDraft(null)
                        }
                    }}
                />
                {unit && <span className="unit">{unit}</span>}
            </div>
        </div>
    )
}

function ColorControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [draft, setDraft] = useState(value)
    const editing = useRef(false)
    useEffect(() => {
        if (!editing.current) setDraft(value)
    }, [value])
    return (
        <div className="color">
            <label className="swatch" style={{ background: value }}>
                <input type="color" value={toHex6(value)} onChange={(e) => onChange(e.target.value)} />
            </label>
            <input
                className="text-input mono"
                type="text"
                value={draft}
                spellCheck={false}
                onFocus={() => (editing.current = true)}
                onChange={(e) => {
                    setDraft(e.target.value)
                    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(e.target.value)) onChange(e.target.value)
                }}
                onBlur={() => {
                    editing.current = false
                    setDraft(value)
                }}
            />
        </div>
    )
}

function toHex6(c: string) {
    if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("")
    return /^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={value}
            className={`toggle ${value ? "on" : ""}`}
            onClick={() => onChange(!value)}
        >
            <span className="knob" />
        </button>
    )
}

function Segmented({
    options,
    titles,
    value,
    onChange,
}: {
    options: (string | number)[]
    titles: string[]
    value: string | number
    onChange: (v: string | number) => void
}) {
    return (
        <div className="segmented">
            {options.map((o, i) => (
                <button
                    type="button"
                    key={String(o)}
                    className={o === value ? "active" : ""}
                    onClick={() => onChange(o)}
                >
                    {titles[i]}
                </button>
            ))}
        </div>
    )
}
