import { useState, useEffect, useRef } from 'react'
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
  const [selectedModel, setSelectedModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetch('/config').then(r => r.json()).catch(() => null),
      fetch('/models').then(r => r.json()).catch(() => null),
    ]).then(([cfg, mdl]) => {
      // Pre-populate from saved config
      if (cfg) {
        if (cfg.video_source) setVideoSource(cfg.video_source)
        if (cfg.names?.length)  setClassNamesRaw(cfg.names.join('\n'))
      }

      // Populate model list, then resolve which one to select
      const list: string[] = mdl?.models ?? []
      setModels(list)
      if (list.length > 0) {
        if (cfg?.model_path && list.includes(cfg.model_path)) {
          // Restore previously saved selection
          setSelectedModel(cfg.model_path)
        } else {
          // Prefer trained models over base weights as default
          const trained = list.filter(m => !/^yolo\d/i.test(m))
          setSelectedModel(trained.length > 0 ? trained[0] : list[0])
        }
      }
    })
  }, [])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/upload-video', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setVideoSource(data.path)
    } catch {
      setError('Video upload failed. Is the backend running?')
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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
          model_path: selectedModel || undefined,
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : 'Upload video file'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv,.webm"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
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

          {/* Model selector */}
          {models.length > 0 && (
            <div className="setup-field">
              <label htmlFor="active-model">Active Model</label>
              <p className="field-hint">
                The model used for live detection. Train a new one in the{' '}
                <strong>Train</strong> tab.
              </p>
              <select
                id="active-model"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                {models.map(m => (
                  <option key={m} value={m}>
                    {/^yolo\d/i.test(m) ? `${m} (base model)` : m}
                  </option>
                ))}
              </select>
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
