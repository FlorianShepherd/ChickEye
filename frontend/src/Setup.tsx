import { useState, useEffect } from 'react'
import './Setup.css'

// Default palette — assigned automatically based on class count
const PALETTE = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
]

interface SetupProps {
  onComplete: () => void
}

export default function Setup({ onComplete }: SetupProps) {
  const [videoSource, setVideoSource] = useState('0')
  const [classNamesRaw, setClassNamesRaw] = useState('Chicken 1\nChicken 2\nChicken 3\nChicken 4')
  const [models, setModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/models')
      .then(r => r.json())
      .then(d => setModels(d.models ?? []))
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const names = classNamesRaw
      .split('\n')
      .map(n => n.trim())
      .filter(Boolean)

    if (!names.length) {
      setError('Please enter at least one class name.')
      return
    }

    const colors = names.map((_, i) => PALETTE[i % PALETTE.length])

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_source: videoSource.trim() || '0',
          class_names: names,
          class_colors: colors,
        }),
      })
      if (!res.ok) throw new Error('Server error')
      onComplete()
    } catch {
      setError('Failed to save configuration. Is the backend running?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-logo">
          <span aria-hidden="true">🐔</span>
          <h1>ChickEye Setup</h1>
        </div>
        <p className="setup-subtitle">
          Configure your monitoring system. You can adjust these settings later via the header.
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          {/* Video source */}
          <div className="setup-field">
            <label htmlFor="video-source">Video Source</label>
            <p className="field-hint">
              An RTSP stream URL, or <code>0</code> for the default webcam.
            </p>
            <input
              id="video-source"
              type="text"
              value={videoSource}
              onChange={e => setVideoSource(e.target.value)}
              placeholder="rtsp://user:password@192.168.1.100:554/stream"
              spellCheck={false}
            />
            <div className="field-examples">
              <span>Quick fill:</span>
              <button type="button" onClick={() => setVideoSource('0')}>
                Webcam (0)
              </button>
              <button type="button" onClick={() => setVideoSource('rtsp://user:pass@192.168.1.100:554/stream')}>
                RTSP template
              </button>
            </div>
          </div>

          {/* Class names */}
          <div className="setup-field">
            <label htmlFor="class-names">Animal / Class Names</label>
            <p className="field-hint">
              One name per line. Must match the class order your model was trained with.
              Colors are assigned automatically.
            </p>
            <textarea
              id="class-names"
              value={classNamesRaw}
              onChange={e => setClassNamesRaw(e.target.value)}
              rows={6}
              placeholder={'Chicken 1\nChicken 2\nChicken 3'}
              spellCheck={false}
            />
            <div className="class-preview">
              {classNamesRaw
                .split('\n')
                .map(n => n.trim())
                .filter(Boolean)
                .map((name, i) => (
                  <span
                    key={i}
                    className="class-chip"
                    style={{ '--chip-color': PALETTE[i % PALETTE.length] } as React.CSSProperties}
                  >
                    {name}
                  </span>
                ))}
            </div>
          </div>

          {/* Available models */}
          {models.length > 0 && (
            <div className="setup-field">
              <label>Available Models</label>
              <p className="field-hint">
                Models found in <code>/app/models</code>. The active model is set via{' '}
                <code>MODEL_PATH</code> in <code>docker-compose.yml</code>.
              </p>
              <ul className="model-list">
                {models.map(m => (
                  <li key={m} className="model-item">
                    <span className="model-dot" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="setup-error">{error}</p>}

          <button type="submit" className="setup-submit" disabled={saving}>
            {saving ? 'Saving…' : 'Start Monitoring →'}
          </button>
        </form>
      </div>
    </div>
  )
}
