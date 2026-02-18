#!/usr/bin/env python3
"""
ChickEye YOLO training script.

Usage:
    python train.py --dataset /app/datasets/chicken \
                    --model yolo11n.pt \
                    --epochs 100 \
                    --imgsz 640 \
                    --output trained_chicken \
                    --models-dir /app/models
"""

import argparse
import shutil
import sys
from pathlib import Path

import yaml
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description="Train a YOLO model on a local dataset")
    parser.add_argument("--dataset",    required=True,         help="Path to dataset directory (must contain data.yaml)")
    parser.add_argument("--model",      default="yolo11n.pt",  help="Base model filename (in models-dir) or ultralytics model name")
    parser.add_argument("--epochs",     type=int, default=100, help="Number of training epochs")
    parser.add_argument("--imgsz",      type=int, default=640, help="Input image size")
    parser.add_argument("--output",     default="trained",     help="Output model filename stem (saved as <output>.pt)")
    parser.add_argument("--models-dir", default="/app/models", help="Directory where models are stored")
    args = parser.parse_args()

    dataset_path = Path(args.dataset).resolve()
    data_yaml = dataset_path / "data.yaml"

    if not data_yaml.exists():
        print(f"ERROR: data.yaml not found at {data_yaml}", flush=True)
        sys.exit(1)

    # Rewrite data.yaml with absolute path so YOLO can find images
    with open(data_yaml) as f:
        cfg = yaml.safe_load(f)
    cfg["path"] = str(dataset_path)

    tmp_yaml = Path("/tmp/chickeye_train_data.yaml")
    with open(tmp_yaml, "w") as f:
        yaml.dump(cfg, f)

    # Resolve base model (prefer local copy, fall back to ultralytics download)
    models_dir = Path(args.models_dir)
    model_path = models_dir / args.model
    if not model_path.exists():
        model_path = args.model  # ultralytics will download it

    print(f"Starting training", flush=True)
    print(f"  base model : {args.model}", flush=True)
    print(f"  dataset    : {dataset_path}", flush=True)
    print(f"  epochs     : {args.epochs}", flush=True)
    print(f"  imgsz      : {args.imgsz}", flush=True)
    print(f"  output     : {args.output}.pt", flush=True)
    print("", flush=True)

    model = YOLO(str(model_path))
    model.train(
        data=str(tmp_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        project="/tmp/yolo_runs",
        name="train",
        exist_ok=True,
    )

    best = Path("/tmp/yolo_runs/train/weights/best.pt")
    if not best.exists():
        print("ERROR: best.pt not found after training", flush=True)
        tmp_yaml.unlink(missing_ok=True)
        sys.exit(1)

    output_path = models_dir / f"{args.output}.pt"
    shutil.copy2(best, output_path)
    print(f"Model saved: {output_path}", flush=True)

    tmp_yaml.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
