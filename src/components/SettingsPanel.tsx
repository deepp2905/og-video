import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { sections, type Settings } from "../settings"
import { ControlRow } from "./controls"

const ease = [0.23, 1, 0.32, 1] as const

interface Props {
    open: boolean
    settings: Settings
    onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void
    onReset: () => void
    footer: React.ReactNode
}

export function SettingsPanel({ open, settings, onChange, onReset, footer }: Props) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

    return (
        <AnimatePresence>
            {open && (
                <motion.aside
                    className="panel"
                    initial={{ opacity: 0, x: 16, scale: 0.98 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 16, scale: 0.98 }}
                    transition={{ duration: 0.22, ease }}
                >
                    <header className="panel-header">
                        <span>Settings</span>
                        <button type="button" className="link-button" onClick={onReset}>
                            Reset
                        </button>
                    </header>

                    <div className="panel-body">
                        {sections.map((section) => {
                            const isOpen = !collapsed[section.id]
                            const visible = section.controls.filter((c) => !c.hidden?.(settings))
                            if (!visible.length) return null
                            return (
                                <section key={section.id} className="section">
                                    <button
                                        type="button"
                                        className="section-header"
                                        aria-expanded={isOpen}
                                        onClick={() => setCollapsed((c) => ({ ...c, [section.id]: isOpen }))}
                                    >
                                        <span>{section.title}</span>
                                        <motion.svg
                                            width="10"
                                            height="10"
                                            viewBox="0 0 10 10"
                                            animate={{ rotate: isOpen ? 0 : -90 }}
                                            transition={{ duration: 0.2, ease }}
                                        >
                                            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                        </motion.svg>
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {isOpen && (
                                            <motion.div
                                                className="section-content"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22, ease }}
                                            >
                                                <div className="section-inner">
                                                    {visible.map((control) => (
                                                        <ControlRow
                                                            key={control.key}
                                                            control={control}
                                                            value={settings[control.key]}
                                                            onChange={(v) => onChange(control.key, v as never)}
                                                        />
                                                    ))}
                                                    {section.id === "export" && footer}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </section>
                            )
                        })}
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    )
}
