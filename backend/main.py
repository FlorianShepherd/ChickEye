from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import asyncio
import os
from datetime import datetime
import base64
from collections import deque
from typing import Deque
import httpx
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ─────────────────────────────────────────────────────────────

CONFIDENCE = float(os.getenv("CONFIDENCE", "0.6"))
MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "http://localhost:8080/predict")
VIDEO_SOURCE_RAW = os.getenv("VIDEO_SOURCE", "0")
RECORDING_PATH = os.getenv("RECORDING_PATH", "")

_names_raw = os.getenv("CLASS_NAMES", "Chicken 1,Chicken 2,Chicken 3,Chicken 4")
_colors_raw = os.getenv("CLASS_COLORS", "#ef4444,#94a3b8,#3b82f6,#f59e0b")

CLASS_NAMES = [n.strip() for n in _names_raw.split(",")]
CLASS_COLORS_HEX = [c.strip() for c in _colors_raw.split(",")]
NUM_CLASSES = len(CLASS_NAMES)


def _hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


CLASS_COLORS_BGR = [_hex_to_bgr(c) for c in CLASS_COLORS_HEX]


def _video_source():
    try:
        return int(VIDEO_SOURCE_RAW)
    except ValueError:
        return VIDEO_SOURCE_RAW


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/")
async def root():
    return {"status": "ChickEye backend running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/config")
async def config():
    return {"names": CLASS_NAMES, "colors": CLASS_COLORS_HEX}


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


def _draw(frame: np.ndarray, detections: list) -> np.ndarray:
    for det in detections:
        x1, y1, x2, y2 = (int(v) for v in det["bbox"])
        cls = det["class"]
        conf = det["confidence"]
        color = CLASS_COLORS_BGR[cls] if cls < len(CLASS_COLORS_BGR) else (255, 255, 255)
        name = CLASS_NAMES[cls] if cls < len(CLASS_NAMES) else str(cls)

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        label = f"{name} {conf * 100:.0f}%"
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 1)
        cv2.rectangle(frame, (x1, y1 - lh - 8), (x1 + lw, y1), color, -1)

        # White text on coloured background (except very light colours)
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


# ── WebSocket ─────────────────────────────────────────────────────────────────


@app.websocket("/ws/video")
async def ws_video(websocket: WebSocket):
    await websocket.accept()

    # Rolling detection history for stability filtering
    history: dict[int, Deque[int]] = {i: deque(maxlen=10) for i in range(NUM_CLASSES)}

    source = _video_source()
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
                await asyncio.sleep(0.1)
                continue

            detections = await _call_model(frame)

            # Update presence history for each class
            detected_classes = {d["class"] for d in detections}
            for cls in range(NUM_CLASSES):
                history[cls].append(1 if cls in detected_classes else 0)

            # Keep only detections present in ≥80 % of the last 10 frames
            stable = [
                d for d in detections
                if d["class"] < NUM_CLASSES
                and len(history[d["class"]]) > 0
                and sum(history[d["class"]]) / len(history[d["class"]]) >= 0.8
            ]
            stable.sort(key=lambda d: d["confidence"], reverse=True)
            stable = stable[:NUM_CLASSES]

            annotated = _draw(frame.copy(), stable)
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
