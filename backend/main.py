from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import asyncio
import os
import json
import subprocess
import sys
import threading
from pathlib import Path
from datetime import datetime
import base64
from collections import deque
from typing import Deque, Optional
import httpx
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static configuration (from env only) ──────────────────────────────────────

CONFIDENCE = float(os.getenv("CONFIDENCE", "0.6"))
MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "http://localhost:8080/predict")
RECORDING_PATH = os.getenv("RECORDING_PATH", "")
CONFIG_FILE = Path(os.getenv("CONFIG_FILE", "/config/setup.json"))
MODELS_DIR = Path(os.getenv("MODELS_DIR", "/app/models"))
DATASETS_DIR = Path(os.getenv("DATASETS_DIR", "/app/datasets"))

# ── Env defaults (used before first-run setup is complete) ────────────────────

_ENV_VIDEO_SOURCE = os.getenv("VIDEO_SOURCE", "0")
_ENV_CLASS_NAMES = [n.strip() for n in os.getenv("CLASS_NAMES", "Chicken 1,Chicken 2,Chicken 3,Chicken 4").split(",")]
_ENV_CLASS_COLORS = [c.strip() for c in os.getenv("CLASS_COLORS", "#ef4444,#94a3b8,#3b82f6,#f59e0b").split(",")]


def _hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


# ── Setup / runtime config ────────────────────────────────────────────────────


def _load_setup() -> dict | None:
    """Return parsed setup JSON, or None if first-run setup has not been done."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return None


def _get_runtime_config() -> dict:
    """Merge saved setup with env-var defaults."""
    setup = _load_setup()
    if setup:
        return {
            "video_source":  setup.get("video_source",  _ENV_VIDEO_SOURCE),
            "class_names":   setup.get("class_names",   _ENV_CLASS_NAMES),
            "class_colors":  setup.get("class_colors",  _ENV_CLASS_COLORS),
            "model_path":    setup.get("model_path",    None),
        }
    return {
        "video_source": _ENV_VIDEO_SOURCE,
        "class_names":  _ENV_CLASS_NAMES,
        "class_colors": _ENV_CLASS_COLORS,
        "model_path":   None,
    }


def _parse_video_source(raw: str):
    try:
        return int(raw)
    except ValueError:
        return raw


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/")
async def root():
    return {"status": "ChickEye backend running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/setup-status")
async def setup_status():
    return {"setup_done": _load_setup() is not None}


@app.post("/setup")
async def save_setup(body: dict):
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(body))
    # If a model was selected, tell the model server to reload it
    model_name = body.get("model_path")
    if model_name:
        model_full_path = str(MODELS_DIR / model_name)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                await client.post(
                    MODEL_ENDPOINT.replace("/predict", "/reload"),
                    json={"model_path": model_full_path},
                )
        except Exception as e:
            print(f"Model reload failed: {e}")
    return {"ok": True}


@app.get("/models")
async def list_models():
    if MODELS_DIR.exists():
        models = sorted(f.name for f in MODELS_DIR.glob("*.pt"))
    else:
        models = []
    return {"models": models}


@app.get("/config")
async def config():
    cfg = _get_runtime_config()
    return {
        "names":        cfg["class_names"],
        "colors":       cfg["class_colors"],
        "video_source": cfg["video_source"],
        "model_path":   cfg["model_path"],
    }


@app.post("/save-video")
async def save_video(file: UploadFile = File(...)):
    if not RECORDING_PATH:
        return {"error": "RECORDING_PATH not configured"}
    os.makedirs(RECORDING_PATH, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(RECORDING_PATH, f"recording_{ts}.webm")
    with open(path, "wb") as f:
        f.write(await file.read())
    return {"message": "Saved", "path": path}


@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    uploads_dir = CONFIG_FILE.parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    # Sanitise filename: keep only safe characters
    safe_name = "".join(c for c in (file.filename or "video") if c.isalnum() or c in "._- ")
    safe_name = safe_name.strip() or "video"
    dest = uploads_dir / safe_name
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"path": str(dest)}


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _call_model(frame: np.ndarray) -> list:
    try:
        _, buf = cv2.imencode(".jpg", frame)
        img_b64 = base64.b64encode(buf).decode()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                MODEL_ENDPOINT,
                json={"image": img_b64, "confidence": CONFIDENCE},
            )
            resp.raise_for_status()
            return resp.json().get("detections", [])
    except Exception as e:
        print(f"Model call failed: {e}")
        return []


def _draw(frame: np.ndarray, detections: list, class_names: list, colors_bgr: list) -> np.ndarray:
    for det in detections:
        x1, y1, x2, y2 = (int(v) for v in det["bbox"])
        cls = det["class"]
        conf = det["confidence"]
        color = colors_bgr[cls] if cls < len(colors_bgr) else (255, 255, 255)
        name = class_names[cls] if cls < len(class_names) else str(cls)

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        label = f"{name} {conf * 100:.0f}%"
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 1)
        cv2.rectangle(frame, (x1, y1 - lh - 8), (x1 + lw, y1), color, -1)

        font_color = (0, 0, 0) if sum(color) > 500 else (255, 255, 255)
        cv2.putText(frame, label, (x1, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.8, font_color, 1)

        if "mask" in det:
            mask = cv2.resize(np.array(det["mask"], dtype=np.float32), (frame.shape[1], frame.shape[0]))
            overlay = frame.copy()
            colored = np.zeros_like(frame)
            colored[:] = color
            overlay[mask > 0.5] = (overlay[mask > 0.5] * 0.65 + colored[mask > 0.5] * 0.35).astype(np.uint8)
            frame = overlay

    return frame


def _encode_frame(frame: np.ndarray, quality: int = 60) -> bytes:
    h, w = frame.shape[:2]
    if w > 640:
        frame = cv2.resize(frame, (640, int(640 * h / w)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes()


# ── Training ──────────────────────────────────────────────────────────────────

_train_lock = threading.Lock()
_train_running: bool = False
_train_logs: list[str] = []
_train_error: Optional[str] = None
_train_output: Optional[str] = None


@app.get("/datasets")
async def list_datasets():
    if DATASETS_DIR.exists():
        datasets = sorted(
            d.name for d in DATASETS_DIR.iterdir()
            if d.is_dir() and (d / "data.yaml").exists()
        )
    else:
        datasets = []
    return {"datasets": datasets}


@app.post("/train/start")
async def train_start(body: dict):
    global _train_running, _train_logs, _train_error, _train_output

    with _train_lock:
        if _train_running:
            return {"error": "Training is already running"}
        _train_running = True
        _train_logs = []
        _train_error = None
        _train_output = None

    dataset = body.get("dataset", "chicken")
    model   = body.get("model",   "yolo11n.pt")
    epochs  = int(body.get("epochs", 100))
    imgsz   = int(body.get("imgsz",  640))
    output  = body.get("output",  "trained")

    def run():
        global _train_running, _train_error, _train_output
        try:
            cmd = [
                sys.executable, "/app/train.py",
                "--dataset",    str(DATASETS_DIR / dataset),
                "--model",      model,
                "--epochs",     str(epochs),
                "--imgsz",      str(imgsz),
                "--output",     output,
                "--models-dir", str(MODELS_DIR),
            ]
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    with _train_lock:
                        _train_logs.append(line)
            proc.wait()
            if proc.returncode != 0:
                with _train_lock:
                    _train_error = f"Training failed (exit code {proc.returncode})"
            else:
                with _train_lock:
                    _train_output = f"{output}.pt"
        except Exception as e:
            with _train_lock:
                _train_error = str(e)
        finally:
            with _train_lock:
                _train_running = False

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True}


@app.get("/train/status")
async def train_status():
    with _train_lock:
        return {
            "running": _train_running,
            "logs":    list(_train_logs[-300:]),
            "error":   _train_error,
            "output":  _train_output,
        }


# ── WebSocket ─────────────────────────────────────────────────────────────────


@app.websocket("/ws/video")
async def ws_video(websocket: WebSocket):
    await websocket.accept()

    # Read fresh config so any post-setup settings apply immediately
    cfg = _get_runtime_config()
    class_names = cfg["class_names"]
    class_colors_bgr = [_hex_to_bgr(c) for c in cfg["class_colors"]]
    num_classes = len(class_names)

    history: dict[int, Deque[int]] = {i: deque(maxlen=10) for i in range(num_classes)}

    source = _parse_video_source(cfg["video_source"])
    print(f"Opening video source: {source}")
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        await websocket.send_json({"error": f"Cannot open video source: {source}"})
        await websocket.close()
        return

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # End of file — loop back to the start if it's a video file
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                await asyncio.sleep(0.1)
                continue

            detections = await _call_model(frame)

            detected_classes = {d["class"] for d in detections}
            for cls in range(num_classes):
                history[cls].append(1 if cls in detected_classes else 0)

            stable = [
                d for d in detections
                if d["class"] < num_classes
                and len(history[d["class"]]) > 0
                and sum(history[d["class"]]) / len(history[d["class"]]) >= 0.8
            ]
            stable.sort(key=lambda d: d["confidence"], reverse=True)
            stable = stable[:num_classes]

            annotated = _draw(frame.copy(), stable, class_names, class_colors_bgr)
            frame_bytes = _encode_frame(annotated)

            await websocket.send_json({
                "frame": frame_bytes.hex(),
                "detections": stable,
                "timestamp": time.time() * 1000.0,
            })

            await asyncio.sleep(0.001)

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        cap.release()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
