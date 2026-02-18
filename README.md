# ChickEye

Real-time AI detection and tracking of individual animals from RTSP camera streams or webcam input. Built on [Ultralytics YOLO](https://github.com/ultralytics/ultralytics), served through a FastAPI backend and a live React dashboard.

---

## Quick Start

### 1. Add your trained model

Copy your `.pt` file into the `models/` directory:

```bash
cp /path/to/your/best.pt models/best.pt
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
VIDEO_SOURCE=rtsp://user:password@192.168.1.100:554/stream
CLASS_NAMES=Hen,Rooster,Chick,Bantam
CLASS_COLORS=#f59e0b,#ef4444,#94a3b8,#3b82f6
```

### 3. Run

```bash
docker compose up --build
```

Open **http://localhost** in your browser. That's it.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VIDEO_SOURCE` | `0` | Camera source — RTSP URL or webcam index |
| `CLASS_NAMES` | `Chicken 1,…` | Comma-separated class names matching your model |
| `CLASS_COLORS` | `#ef4444,…` | Hex colours for each class in the dashboard |
| `CONFIDENCE` | `0.6` | Minimum detection confidence (0 – 1) |
| `MODEL_PATH` | `/app/models/best.pt` | Path inside the model container |
| `MODEL_TYPE` | `0` | `0` = detection, `1` = segmentation |
| `HOST_PORT` | `80` | Host port for the web interface |

---

## Architecture

```
Browser → nginx :80
            ├── /          → React SPA (static files)
            ├── /ws/video  → backend :8000 (WebSocket stream)
            └── /config    → backend :8000 (REST)

backend :8000
  ├── reads VIDEO_SOURCE (camera / RTSP)
  └── calls model :8080/predict for each frame

model :8080
  └── runs YOLO inference on base64-encoded frames
```

All three services are wired together by `docker compose`.

---

## Training Your Own Model

1. **Record footage** of your subjects.
2. **Extract and label frames** using the **Label Data** tab in the dashboard.
3. **Export** the corrected detections as a ZIP and prepare a `data.yaml`.
4. **Train** a YOLO model:
   ```bash
   yolo train data=data.yaml model=yolo11n.pt epochs=100 imgsz=640
   ```
5. **Deploy** the new weights:
   ```bash
   cp runs/detect/train/weights/best.pt models/best.pt
   docker compose restart model
   ```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Detection | [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) |
| Backend | [FastAPI](https://fastapi.tiangolo.com) + [OpenCV](https://opencv.org) |
| Streaming | WebSocket (base64-encoded JPEG frames) |
| Frontend | [React](https://react.dev) + TypeScript + [Vite](https://vite.dev) |
| Proxy | [nginx](https://nginx.org) |
| Deploy | [Docker Compose](https://docs.docker.com/compose/) |

---

## Project Structure

```
ChickEyePublic/
├── docker-compose.yml   # One-command deployment
├── .env.example         # Configuration template
├── models/              # Put your .pt model file here
├── backend/
│   ├── main.py          # WebSocket streaming server
│   ├── model_server.py  # YOLO inference server
│   ├── Dockerfile       # Multi-target: backend + model
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx              # Live dashboard
    │   └── CategoryManagement.tsx  # Training data labelling tool
    ├── Dockerfile       # Multi-stage: build + nginx
    └── nginx.conf       # Serves SPA + proxies to backend
```
