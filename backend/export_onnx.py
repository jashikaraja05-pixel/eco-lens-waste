"""Export the real saved classifier, validate ONNX and compare its logits.

Run from the project root:
  python backend/export_onnx.py --output public/models/mobilenet-v3-small.onnx
No retraining, synthetic weights or external Python deployment is involved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torchvision
from PIL import __version__ as pillow_version

from common import DISPOSAL_STEPS, UNCERTAIN_THRESHOLD
from waste_model import IMAGENET_MEAN, IMAGENET_STD, load_model


def export_model(models_dir: Path, output: Path) -> dict:
    model, config = load_model(models_dir)
    if config.get("arch") != "mobilenet_v3_small" or config["num_classes"] != 13:
        raise ValueError("Expected the existing 13-class MobileNetV3-Small checkpoint.")
    if config["normalization"] != {"mean": IMAGENET_MEAN, "std": IMAGENET_STD}:
        raise ValueError("Config normalization differs from waste_model.py evaluation transforms.")
    if config["uncertain_threshold"] != UNCERTAIN_THRESHOLD:
        raise ValueError("Uncertainty threshold differs from common.py.")
    classes = [config["idx_to_class"][str(i)] for i in range(13)]
    if classes != config["classes"]:
        raise ValueError("Class order does not match idx_to_class.")
    torch.set_num_threads(1)
    size = int(config["image_size"])
    tensor = torch.linspace(-2, 2, 3 * size * size).reshape(1, 3, size, size)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model, tensor, str(output), input_names=["image"],
                      output_names=["logits"], opset_version=17, dynamo=False)
    onnx.checker.check_model(onnx.load(output))
    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    with torch.inference_mode():
        expected = model(tensor).numpy()
    actual = session.run(None, {"image": tensor.numpy()})[0]
    np.testing.assert_allclose(actual, expected, rtol=1e-4, atol=1e-4)
    manifest = {
        **config,
        "model_file": output.name,
        "model_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "checkpoint_sha256": hashlib.sha256((models_dir / "best.pt").read_bytes()).hexdigest(),
        "input_name": "image", "output_name": "logits", "opset": 17,
        "preprocessing": {"resize_short_edge": int(size * 1.15), "crop_size": size,
                          "interpolation": "pillow-bilinear", "center_rounding": "ties-to-even",
                          "channel_order": "RGB", "layout": "NCHW", "scale": 255,
                          "exif_transpose": False},
        "disposal_steps": DISPOSAL_STEPS,
        "export_versions": {"torch": torch.__version__, "torchvision": torchvision.__version__,
                            "pillow": pillow_version, "onnx": onnx.__version__},
        "export_check": {"max_absolute_logit_difference": float(np.abs(actual - expected).max()),
                         "rtol": 1e-4, "atol": 1e-4,
                         "note": "Tensor parity only; not image accuracy or all-class browser verification."},
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", type=Path, default=Path("backend/models"))
    parser.add_argument("--output", type=Path, default=Path("public/models/mobilenet-v3-small.onnx"))
    args = parser.parse_args()
    result = export_model(args.models_dir, args.output)
    print(f"Verified real ONNX: {args.output}; max logit difference "
          f"{result['export_check']['max_absolute_logit_difference']:.8f}")