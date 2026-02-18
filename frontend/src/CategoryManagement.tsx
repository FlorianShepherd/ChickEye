import { useState, useEffect, useRef } from 'react'
import JSZip from 'jszip'
import './CategoryManagement.css'

// ── Types ──────────────────────────────────────────────────────────────────

const CATEGORIES = ['Class 0', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7']

const DETECT_COLORS = ['#00d4aa', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#22d3ee', '#84cc16']

interface Detection {
  class: number
  x: number
  y: number
  width: number
  height: number
  newCategory?: number
}

interface FrameData {
  image: string
  detections: Detection[]
  filename: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readDetections(file: File): Promise<Detection[]> {
  const text = await file.text()
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      const [classId, x, y, width, height] = l.split(' ').map(Number)
      return { class: classId, x, y, width, height }
    })
}

function drawFrame(canvas: HTMLCanvasElement, image: HTMLImageElement, dets: Detection[]) {
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(image, 0, 0)
  dets.forEach((det, i) => {
    const cx = det.x * canvas.width
    const cy = det.y * canvas.height
    const w  = det.width  * canvas.width
    const h  = det.height * canvas.height
    const x  = cx - w / 2
    const y  = cy - h / 2
    const color = DETECT_COLORS[i % DETECT_COLORS.length]

    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(2, canvas.width / 320)
    ctx.strokeRect(x, y, w, h)

    ctx.fillStyle = color
    const fontSize = Math.max(14, canvas.width / 40)
    ctx.font = `bold ${fontSize}px Inter, sans-serif`
    ctx.fillText(String(i + 1), x + 6, y + fontSize + 4)
  })
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CategoryManagement() {
  const [frames, setFrames] = useState<FrameData[]>([])
  const [index, setIndex] = useState(0)
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  const [remap, setRemap] = useState<Record<string, string>>({})
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── Load folder ──────────────────────────────────────────────────────────

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const jpgFiles = Array.from(files)
      .filter(f => f.webkitRelativePath.includes('frames/') && f.name.endsWith('.jpg'))
      .sort(() => Math.random() - 0.5)
      .slice(0, 100)

    const loaded: FrameData[] = []
    for (const jpg of jpgFiles) {
      const baseName = jpg.name.replace('.jpg', '')
      const txtFile = Array.from(files).find(
        f => f.webkitRelativePath.includes('detections/') && f.name === `${baseName}.txt`,
      )
      if (txtFile) {
        loaded.push({
          image: URL.createObjectURL(jpg),
          detections: await readDetections(txtFile),
          filename: baseName,
        })
      }
    }
    setFrames(loaded)
    setIndex(0)
    setDeleted(new Set())
    setRemap({})
  }

  // ── Draw canvas when frame changes ───────────────────────────────────────

  useEffect(() => {
    if (!frames[index] || !canvasRef.current) return
    const canvas = canvasRef.current
    const img = new Image()
    img.onload = () => drawFrame(canvas, img, frames[index].detections)
    img.src = frames[index].image
  }, [index, frames])

  // ── Category remap ───────────────────────────────────────────────────────

  const handleRemap = (frameIdx: number, detIdx: number, value: string) => {
    const key = `${frameIdx}-${detIdx}`
    setRemap(prev => ({ ...prev, [key]: value }))
    const newCat = CATEGORIES.indexOf(value)
    setFrames(prev => {
      const next = [...prev]
      const dets = [...next[frameIdx].detections]
      dets[detIdx] = { ...dets[detIdx], newCategory: newCat >= 0 ? newCat : dets[detIdx].class }
      next[frameIdx] = { ...next[frameIdx], detections: dets }
      return next
    })
  }

  // ── Delete frame ─────────────────────────────────────────────────────────

  const handleDelete = () => {
    if (!frames[index]) return
    setDeleted(prev => new Set([...prev, frames[index].filename]))
    setIndex(i => Math.max(0, i - 1))
  }

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExport = async () => {
    const zip = new JSZip()
    const folder = zip.folder('detections')!
    for (const frame of frames) {
      if (deleted.has(frame.filename)) continue
      const lines = frame.detections.map(d => {
        const cat = d.newCategory !== undefined ? d.newCategory : d.class
        return `${cat} ${d.x} ${d.y} ${d.width} ${d.height}`
      })
      folder.file(`${frame.filename}.txt`, lines.join('\n'))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'detections.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const current = frames[index]
  const isDeleted = current ? deleted.has(current.filename) : false

  return (
    <div className="cat-page">
      <div className="cat-header">
        <h1 className="cat-title">Label Data</h1>
        <div className="cat-actions">
          <label className="btn btn-primary">
            Select Folder
            <input
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              multiple
              onChange={handleFolder}
              style={{ display: 'none' }}
            />
          </label>
          {frames.length > 0 && (
            <button className="btn btn-primary" onClick={handleExport}>
              Export ZIP
            </button>
          )}
        </div>
      </div>

      {frames.length === 0 ? (
        <div className="cat-empty">
          <div className="cat-empty-icon">📂</div>
          <p>
            Select a folder that contains a <strong>frames/</strong> directory (JPEG images)
            and a <strong>detections/</strong> directory (YOLO .txt files).
          </p>
        </div>
      ) : (
        <div className="frame-card">
          {/* Card header */}
          <div className="frame-card-header">
            <div className="frame-meta">
              <span className="frame-counter">
                Frame {index + 1} of {frames.length}
                {isDeleted && <span className="deleted-badge" style={{ marginLeft: 10 }}>Deleted</span>}
              </span>
              <span className="frame-filename">{current?.filename}</span>
            </div>
            <button className="btn btn-danger" onClick={handleDelete} title="Delete this frame">
              Delete
            </button>
          </div>

          {/* Canvas + detection controls */}
          <div className="frame-card-body">
            <div className="canvas-wrapper">
              <canvas ref={canvasRef} className="frame-canvas" />
            </div>

            <div className="detection-panel">
              <p className="detection-panel-heading">Detections</p>
              {current?.detections.map((det, di) => {
                const key = `${index}-${di}`
                return (
                  <div key={di} className="detection-item">
                    <label className="detection-label">
                      #{di + 1} — currently class {det.class}
                    </label>
                    <select
                      className="cat-select"
                      value={remap[key] ?? CATEGORIES[det.class] ?? ''}
                      onChange={e => handleRemap(index, di, e.target.value)}
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Navigation */}
          <div className="frame-nav">
            <button
              className="btn"
              disabled={index === 0}
              onClick={() => setIndex(i => i - 1)}
            >
              ← Previous
            </button>
            <span className="frame-progress">
              {frames.length - deleted.size} of {frames.length} kept
            </span>
            <button
              className="btn"
              disabled={index === frames.length - 1}
              onClick={() => setIndex(i => i + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
