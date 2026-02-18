import { useState, useEffect, useRef, useCallback } from 'react'
import './Train.css'

interface TrainStatus {
  running: boolean
  logs: string[]
  error: string | null
  output: string | null
}

export default function Train() {
  const [datasets, setDatasets] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])

  const [dataset, setDataset] = useState('')
  const [model, setModel] = useState('yolo11n.pt')
  const [epochs, setEpochs] = useState('100')
  const [imgsz, setImgsz] = useState('640')
  const [output, setOutput] = useState('trained')

  const [status, setStatus] = useState<TrainStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load available datasets and models on mount
  useEffect(() => {
    fetch('/datasets')
      .then(r => r.json())
      .then(d => {
        const list: string[] = d.datasets ?? []
        setDatasets(list)
        if (list.length > 0) setDataset(list[0])
      })
      .catch(() => {})

    fetch('/models')
      .then(r => r.json())
      .then(d => setModels(d.models ?? []))
      .catch(() => {})
  }, [])

  // Poll /train/status while training or on first load
  const poll = useCallback(() => {
    fetch('/train/status')
      .then(r => r.json())
      .then((s: TrainStatus) => setStatus(s))
      .catch(() => {})
  }, [])

  useEffect(() => {
    poll() // initial check on mount
  }, [poll])

  useEffect(() => {
    if (status?.running) {
      if (!pollRef.current) {
        pollRef.current = setInterval(poll, 1500)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [status?.running, poll])

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [status?.logs])

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!dataset) { setError('Select a dataset first.'); return }
    if (!output.trim()) { setError('Enter an output model name.'); return }

    setError(null)
    setStarting(true)
    try {
      const res = await fetch('/train/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset,
          model,
          epochs: parseInt(epochs) || 100,
          imgsz:  parseInt(imgsz)  || 640,
          output: output.trim(),
        }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      // Start polling immediately
      setStatus({ running: true, logs: [], error: null, output: null })
      pollRef.current = setInterval(poll, 1500)
    } catch {
      setError('Failed to reach backend. Is it running?')
    } finally {
      setStarting(false)
    }
  }

  const isRunning = status?.running ?? false
  const isDone    = !isRunning && status !== null && (status.output !== null || status.error !== null)

  return (
    <div className="train-page">
      {/* Config panel */}
      <aside className="train-sidebar">
        <p className="train-section-label">Training Configuration</p>

        <form onSubmit={handleStart} className="train-form">
          {/* Dataset */}
          <div className="train-field">
            <label htmlFor="t-dataset">Dataset</label>
            {datasets.length === 0 ? (
              <p className="train-hint train-hint--warn">No datasets found in <code>/app/datasets</code>.</p>
            ) : (
              <select
                id="t-dataset"
                value={dataset}
                onChange={e => setDataset(e.target.value)}
                disabled={isRunning}
              >
                {datasets.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>

          {/* Base model */}
          <div className="train-field">
            <label htmlFor="t-model">Base Model</label>
            {models.length > 0 ? (
              <select
                id="t-model"
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={isRunning}
              >
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                id="t-model"
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={isRunning}
                placeholder="yolo11n.pt"
              />
            )}
          </div>

          {/* Epochs */}
          <div className="train-field">
            <label htmlFor="t-epochs">Epochs</label>
            <input
              id="t-epochs"
              type="number"
              min={1}
              max={1000}
              value={epochs}
              onChange={e => setEpochs(e.target.value)}
              disabled={isRunning}
            />
          </div>

          {/* Image size */}
          <div className="train-field">
            <label htmlFor="t-imgsz">Image Size</label>
            <input
              id="t-imgsz"
              type="number"
              min={32}
              max={1280}
              step={32}
              value={imgsz}
              onChange={e => setImgsz(e.target.value)}
              disabled={isRunning}
            />
          </div>

          {/* Output name */}
          <div className="train-field">
            <label htmlFor="t-output">Output Model Name</label>
            <p className="train-hint">Saved as <code>&lt;name&gt;.pt</code> in <code>/app/models</code>.</p>
            <input
              id="t-output"
              type="text"
              value={output}
              onChange={e => setOutput(e.target.value)}
              disabled={isRunning}
              placeholder="trained"
              spellCheck={false}
            />
          </div>

          {error && <p className="train-error">{error}</p>}

          <button
            type="submit"
            className="train-submit"
            disabled={isRunning || starting || datasets.length === 0}
          >
            {isRunning ? (
              <><span className="btn-spinner" /> Training…</>
            ) : starting ? (
              'Starting…'
            ) : (
              'Start Training'
            )}
          </button>
        </form>
      </aside>

      {/* Log panel */}
      <div className="train-main">
        <div className="train-log-header">
          <p className="train-section-label">Training Log</p>
          {isRunning && <span className="train-badge train-badge--running">Running</span>}
          {isDone && status?.output && <span className="train-badge train-badge--done">Done — {status.output}</span>}
          {isDone && status?.error && <span className="train-badge train-badge--error">Failed</span>}
        </div>

        <div className="train-log" ref={logRef}>
          {(!status || status.logs.length === 0) && !isRunning && !isDone && (
            <span className="train-log-placeholder">Training output will appear here…</span>
          )}
          {status?.logs.map((line, i) => (
            <div key={i} className="train-log-line">{line}</div>
          ))}
          {isDone && status?.output && (
            <div className="train-log-line train-log-line--success">
              Model saved: {status.output}
            </div>
          )}
          {isDone && status?.error && (
            <div className="train-log-line train-log-line--error">{status.error}</div>
          )}
        </div>
      </div>
    </div>
  )
}
