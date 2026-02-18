import { useState, useEffect, useRef, useCallback } from 'react'
import type { CSSProperties } from 'react'
import CategoryManagement from './CategoryManagement'
import './App.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface Detection {
  class: number
  confidence: number
  bbox: [number, number, number, number]
}

interface Config {
  names: string[]
  colors: string[]
}

type View = 'live' | 'label'

const DEFAULT_CONFIG: Config = {
  names: ['Class 0', 'Class 1', 'Class 2', 'Class 3'],
  colors: ['#ef4444', '#94a3b8', '#3b82f6', '#f59e0b'],
}

// ── LiveView ───────────────────────────────────────────────────────────────

function LiveView({ config }: { config: Config }) {
  const [detections, setDetections] = useState<Detection[]>([])
  const [lastSeen, setLastSeen] = useState<Record<number, Date>>({})
  const [connected, setConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const [latency, setLatency] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameTs = useRef<number[]>([])

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/video`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          frame?: string
          detections?: Detection[]
          timestamp?: number
          error?: string
        }

        const now = Date.now()

        // FPS tracking
        frameTs.current.push(now)
        frameTs.current = frameTs.current.filter(t => now - t < 1000)
        setFps(frameTs.current.length)

        if (data.timestamp) {
          setLatency(Math.round(now - data.timestamp))
        }

        // Render frame
        if (data.frame && canvasRef.current) {
          const hex = data.frame
          const bytes = new Uint8Array(hex.length / 2)
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
          }
          const blob = new Blob([bytes], { type: 'image/jpeg' })
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            const canvas = canvasRef.current
            if (!canvas) { URL.revokeObjectURL(url); return }
            const ctx = canvas.getContext('2d')
            if (!ctx) { URL.revokeObjectURL(url); return }
            if (canvas.width !== img.width)  canvas.width  = img.width
            if (canvas.height !== img.height) canvas.height = img.height
            ctx.drawImage(img, 0, 0)
            URL.revokeObjectURL(url)
          }
          img.src = url
        }

        // Update detections + last-seen
        const newDets: Detection[] = data.detections ?? []
        setDetections(newDets)
        if (newDets.length > 0) {
          const ts = new Date()
          setLastSeen(prev => {
            const next = { ...prev }
            newDets.forEach(d => { next[d.class] = ts })
            return next
          })
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => ws.close()

    ws.onclose = () => {
      setConnected(false)
      reconnectRef.current = setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      reconnectRef.current && clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  function fmtLastSeen(d: Date | undefined) {
    if (!d) return 'Never seen'
    return `Last seen ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="live-view">
      {/* Status strip */}
      <div className="status-strip">
        <div className="status-item">
          <span className={`status-dot${connected ? ' connected' : ''}`} />
          <span className="status-label">{connected ? 'Live' : 'Connecting…'}</span>
        </div>
        <div className="status-item">
          <span className="stat-label">FPS&nbsp;</span>
          <span className="stat-value">{fps}</span>
        </div>
        {latency !== null && (
          <div className="status-item">
            <span className="stat-label">Latency&nbsp;</span>
            <span className="stat-value">{latency} ms</span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="content">
        {/* Video */}
        <div className="video-panel">
          <div className="video-wrapper">
            {!connected && (
              <div className="video-overlay">
                <div className="spinner" />
                <span>Connecting to stream…</span>
              </div>
            )}
            <canvas ref={canvasRef} className="video-canvas" />
          </div>
        </div>

        {/* Detection cards */}
        <aside className="side-panel">
          <p className="panel-heading">Detection Status</p>
          <ul className="chicken-list">
            {config.names.map((name, cls) => {
              const det = detections.find(d => d.class === cls)
              const active = Boolean(det)
              const color = config.colors[cls] ?? '#94a3b8'
              return (
                <li
                  key={cls}
                  className={`chicken-card${active ? ' active' : ''}`}
                  style={{ '--color': color } as CSSProperties}
                >
                  <div className="card-indicator">
                    <span className={`indicator-dot${active ? ' active' : ''}`} />
                  </div>
                  <div className="card-body">
                    <span className="card-name">{name}</span>
                    {active ? (
                      <div className="confidence-row">
                        <div className="confidence-track">
                          <div
                            className="confidence-fill"
                            style={{ width: `${(det!.confidence * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <span className="confidence-pct">
                          {(det!.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="last-seen">{fmtLastSeen(lastSeen[cls])}</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>('live')
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)

  useEffect(() => {
    fetch('/config')
      .then(r => r.json())
      .then((d: Config) => setConfig(d))
      .catch(() => { /* fall back to defaults */ })
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon" aria-hidden="true">🐔</span>
          <span className="logo-text">ChickEye</span>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn${view === 'live' ? ' active' : ''}`}
            onClick={() => setView('live')}
          >
            Live View
          </button>
          <button
            className={`nav-btn${view === 'label' ? ' active' : ''}`}
            onClick={() => setView('label')}
          >
            Label Data
          </button>
        </nav>
      </header>

      {view === 'live' ? <LiveView config={config} /> : <CategoryManagement />}
    </div>
  )
}
