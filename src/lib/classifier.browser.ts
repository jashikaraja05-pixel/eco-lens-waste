import { imageSchema } from "./scan-schema";
import { modelManifestSchema, predictionFromLogits, type LocalPrediction, type ModelManifest } from "./model-contract";
import { preprocessRgb, type RgbImage } from "./model-preprocessing";
import type { InferenceSession } from "onnxruntime-web";
import wasmAsset from "../../public/models/ort/ort-wasm-simd-threaded.wasm.asset.json";

let resources: Promise<{ manifest: ModelManifest; session: InferenceSession }> | undefined;
let jpegReady: Promise<void> | undefined;
let webpReady: Promise<void> | undefined;

async function loadResources() {
  if (!resources) {
    resources = (async () => {
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = {
        wasm: new URL(wasmAsset.url, window.location.origin).href,
        mjs: new URL("/models/ort/ort-wasm-simd-threaded.mjs", window.location.origin).href,
      };
      const response = await fetch("/models/mobilenet-v3-small.json");
      if (!response.ok) throw new Error("The trained model configuration could not load.");
      const manifest = modelManifestSchema.parse(await response.json());
      const modelResponse = await fetch(`/models/${manifest.model_file}`);
      if (!modelResponse.ok) throw new Error("The trained ONNX model could not load.");
      const bytes = await modelResponse.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== manifest.model_sha256) throw new Error("The model file failed its integrity check.");
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      return { manifest, session };
    })().catch((error: unknown) => { resources = undefined; throw error; });
  }
  return resources;
}

function rgbFromRgba(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (r === undefined || g === undefined || b === undefined) throw new Error("Invalid image pixels.");
    data.set([r, g, b], i * 3);
  }
  return { width, height, data };
}

/** Original file bytes, not shrink()'s canvas/JPEG output. Ignore EXIF like Pillow. */
export async function decodeModelImage(file: Blob): Promise<RgbImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (file.type === "image/jpeg" && jpeg) {
    const { default: decode, init } = await import("@jsquash/jpeg/decode");
    if (!jpegReady) jpegReady = init({ locateFile: () => new URL("/models/ort/mozjpeg_dec.wasm", window.location.origin).href });
    await jpegReady;
    const decoded = await decode(bytes.buffer, { preserveOrientation: false });
    if (decoded.width * decoded.height > 40_000_000) throw new Error("Image resolution is too large.");
    return rgbFromRgba(decoded.width, decoded.height, decoded.data);
  }
  if (file.type === "image/png" && png) {
    const { decode } = await import("fast-png");
    const decoded = decode(bytes, { checkCrc: true });
    if (decoded.width * decoded.height > 40_000_000) throw new Error("Image resolution is too large.");
    const data = new Uint8Array(decoded.width * decoded.height * 3);
    for (let i = 0; i < decoded.width * decoded.height; i++) {
      if (decoded.palette) {
        const index = decoded.data[i];
        const entry = index === undefined ? undefined : decoded.palette[index];
        if (!entry || entry[0] === undefined || entry[1] === undefined || entry[2] === undefined) throw new Error("Invalid PNG palette.");
        data.set(entry.slice(0, 3), i * 3);
      } else {
        for (let c = 0; c < 3; c++) {
          const value = decoded.data[i * decoded.channels + (decoded.channels <= 2 ? 0 : c)];
          if (value === undefined) throw new Error("Invalid PNG pixels.");
          // Pillow converts 16-bit grayscale to 8-bit by clipping, not rescaling.
          data[i * 3 + c] = decoded.depth === 16 && decoded.channels <= 2 ? Math.min(value, 255) : decoded.depth === 16 ? value >>> 8 : value;
        }
      }
    }
    return { width: decoded.width, height: decoded.height, data };
  }
  if (file.type === "image/webp" && webp) {
    const { default: decode, init } = await import("@jsquash/webp/decode");
    if (!webpReady) webpReady = init({ locateFile: () => new URL("/models/ort/webp_dec.wasm", window.location.origin).href });
    await webpReady;
    const decoded = await decode(bytes.buffer);
    if (decoded.width * decoded.height > 40_000_000) throw new Error("Image resolution is too large.");
    return rgbFromRgba(decoded.width, decoded.height, decoded.data);
  }
  throw new Error("Image content does not match its JPEG, PNG or WebP format.");
}

export async function classifyLocally(file: Blob): Promise<LocalPrediction> {
  if (file.size > 15 * 1024 * 1024) throw new Error("Image is over 15 MB.");
  const image = await decodeModelImage(file);
  const { manifest, session } = await loadResources();
  const tensorData = preprocessRgb(image, {
    resizeShortEdge: manifest.preprocessing.resize_short_edge, cropSize: manifest.image_size,
    mean: manifest.normalization.mean, std: manifest.normalization.std,
  });
  const { Tensor } = await import("onnxruntime-web/wasm");
  const output = await session.run({ [manifest.input_name]: new Tensor("float32", tensorData, [1, 3, 224, 224]) });
  const logits = output[manifest.output_name];
  if (!logits || logits.type !== "float32" || !(logits.data instanceof Float32Array) || logits.dims.length !== 2 || logits.dims[0] !== 1 || logits.dims[1] !== 13) {
    throw new Error("The trained model output shape is invalid.");
  }
  return predictionFromLogits(logits.data, manifest);
}

export function capturedImageBlob(image: string): Blob {
  imageSchema.parse(image);
  const encoded = image.split(",")[1];
  if (!encoded) throw new Error("Camera image is invalid.");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: image.slice(5, image.indexOf(";")) });
}