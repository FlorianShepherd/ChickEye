from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import cv2
import numpy as np
from ultralytics import YOLO
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_TYPE   = os.getenv("MODEL_TYPE", "0")   # "0" = detection, "1" = segmentation
MODEL_PATH   = os.getenv("MODEL_PATH", "/app/models/yolo11n.pt")
MODELS_DIR   = os.getenv("MODELS_DIR", "/app/models")
TARGET_WIDTH = int(os.getenv("TARGET_WIDTH", "640"))

model = None
current_model_path = None


def _load_model(path: str) -> bool:
    global model, current_model_path
    if not os.path.exists(path):
        print(f"Model file not found: {path}")
        return False
    try:
        print(f"Loading model: {path}")
        model = YOLO(path)
        current_model_path = path
        print("Model ready.")
        return True
    except Exception as e:
        print(f"Failed to load model {path}: {e}")
        return False


# Try configured path first, then fall back to any .pt in MODELS_DIR
if not _load_model(MODEL_PATH):
    fallbacks = sorted(
        f for f in os.listdir(MODELS_DIR)
        if f.endswith(".pt")
    ) if os.path.isdir(MODELS_DIR) else []
    for fb in fallbacks:
        if _load_model(os.path.join(MODELS_DIR, fb)):
            break
    else:
        print("WARNING: No model loaded. Server will start but /predict will fail until a model is loaded via /reload.")


class PredictionRequest(BaseModel):
    image: str       # base64-encoded JPEG
    confidence: float = 0.6


class ReloadRequest(BaseModel):
    model_path: str


def _resize(frame: np.ndarray, width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    return cv2.resize(frame, (width, int(width * h / w)))


@app.get("/health")
async def health():
    if model is None:
        raise HTTPException(status_code=503, detail="No model loaded")
    return {"status": "healthy", "model": current_model_path}


@app.post("/reload")
async def reload_model(req: ReloadRequest):
    global model, current_model_path
    if not os.path.exists(req.model_path):
        raise HTTPException(status_code=404, detail=f"Model not found: {req.model_path}")
    print(f"Reloading model: {req.model_path}")
    model = YOLO(req.model_path)
    current_model_path = req.model_path
    print("Model reloaded.")
    return {"ok": True, "model": current_model_path}


@app.post("/predict")
async def predict(req: PredictionRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="No model loaded")
    try:
        data = base64.b64decode(req.image)
        arr = np.frombuffer(data, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        orig_h, orig_w = frame.shape[:2]
        small = _resize(frame, TARGET_WIDTH)
        scale_x = orig_w / small.shape[1]
        scale_y = orig_h / small.shape[0]

        results = model(small)
        detections = []

        for result in results:
            if MODEL_TYPE == "1" and result.masks is not None:
                for box, mask in zip(result.boxes, result.masks):
                    conf = float(box.conf[0])
                    if conf < req.confidence:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    mask_arr = cv2.resize(
                        mask.data[0].cpu().numpy(),
                        (orig_w, orig_h),
                    )
                    detections.append({
                        "class": int(box.cls[0]),
                        "confidence": conf,
                        "bbox": [x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y],
                        "mask": mask_arr.tolist(),
                    })
            else:
                for box in result.boxes:
                    conf = float(box.conf[0])
                    if conf < req.confidence:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    detections.append({
                        "class": int(box.cls[0]),
                        "confidence": conf,
                        "bbox": [x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y],
                    })

        return {"detections": detections}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
