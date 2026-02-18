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

MODEL_TYPE = os.getenv("MODEL_TYPE", "0")   # "0" = detection, "1" = segmentation
MODEL_PATH = os.getenv("MODEL_PATH", "./best.pt")
TARGET_WIDTH = int(os.getenv("TARGET_WIDTH", "640"))

print(f"Loading model: {MODEL_PATH}")
model = YOLO(MODEL_PATH)
print("Model ready.")


class PredictionRequest(BaseModel):
    image: str       # base64-encoded JPEG
    confidence: float = 0.6


def _resize(frame: np.ndarray, width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    return cv2.resize(frame, (width, int(width * h / w)))


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/predict")
async def predict(req: PredictionRequest):
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
