/** Pillow-compatible bilinear resize: separable, antialiased and 22-bit weights.
 * Keep parity fixtures against backend/waste_model.py evaluation transforms.
 */
export type RgbImage = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

function numberAt(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error("Image preprocessing data is incomplete.");
  return value;
}

export function roundEven(value: number): number {
  const low = Math.floor(value);
  return value - low === 0.5 ? (low % 2 === 0 ? low : low + 1) : Math.round(value);
}

function coefficients(input: number, output: number) {
  const scale = input / output;
  const filterScale = Math.max(1, scale);
  return Array.from({ length: output }, (_, index) => {
    const center = (index + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - filterScale + 0.5));
    const end = Math.min(input, Math.floor(center + filterScale + 0.5));
    const weights = Array.from({ length: end - start }, (_, i) =>
      Math.max(0, 1 - Math.abs((start + i - center + 0.5) / filterScale)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return { start, weights: weights.map((value) => Math.floor(value / total * 2 ** 22 + 0.5)) };
  });
}

export function resizeBilinear(image: RgbImage, width: number, height: number): RgbImage {
  const horizontal = new Uint8Array(width * image.height * 3);
  const xCoefficients = coefficients(image.width, width);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < width; x++) {
      const coefficient = xCoefficients[x];
      if (!coefficient) throw new Error("Missing horizontal resize coefficient.");
      const { start, weights } = coefficient;
      for (let channel = 0; channel < 3; channel++) {
        let value = 2 ** 21;
        for (let i = 0; i < weights.length; i++) value += numberAt(image.data, (y * image.width + start + i) * 3 + channel) * numberAt(weights, i);
        horizontal[(y * width + x) * 3 + channel] = Math.max(0, Math.min(255, Math.floor(value / 2 ** 22)));
      }
    }
  }
  const data = new Uint8Array(width * height * 3);
  const yCoefficients = coefficients(image.height, height);
  for (let y = 0; y < height; y++) {
    const coefficient = yCoefficients[y];
    if (!coefficient) throw new Error("Missing vertical resize coefficient.");
    const { start, weights } = coefficient;
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let value = 2 ** 21;
        for (let i = 0; i < weights.length; i++) value += numberAt(horizontal, ((start + i) * width + x) * 3 + channel) * numberAt(weights, i);
        data[(y * width + x) * 3 + channel] = Math.max(0, Math.min(255, Math.floor(value / 2 ** 22)));
      }
    }
  }
  return { width, height, data };
}

export function preprocessRgb(image: RgbImage, settings: {
  resizeShortEdge: number; cropSize: number; mean: readonly number[]; std: readonly number[];
}): Float32Array {
  const { resizeShortEdge, cropSize, mean, std } = settings;
  if (image.width < 32 || image.height < 32 || image.data.length !== image.width * image.height * 3) {
    throw new Error("Image must be at least 32 × 32 pixels with valid RGB data.");
  }
  const short = Math.min(image.width, image.height);
  const width = Math.floor(image.width * resizeShortEdge / short);
  const height = Math.floor(image.height * resizeShortEdge / short);
  const resized = resizeBilinear(image, width, height);
  const left = roundEven((width - cropSize) / 2);
  const top = roundEven((height - cropSize) / 2);
  const plane = cropSize * cropSize;
  const tensor = new Float32Array(3 * plane);
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < cropSize; y++) {
      for (let x = 0; x < cropSize; x++) {
        const pixel = numberAt(resized.data, ((y + top) * width + x + left) * 3 + channel);
        // ToTensor rounds /255 to float32 before Normalize's subtract/divide.
        const scaled = Math.fround(pixel / 255);
        const centered = Math.fround(scaled - Math.fround(numberAt(mean, channel)));
        tensor[channel * plane + y * cropSize + x] = centered / Math.fround(numberAt(std, channel));
      }
    }
  }
  return tensor;
}
export function flipHorizontal(image: RgbImage): RgbImage {
  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const from = (y * image.width + x) * 3, to = (y * image.width + image.width - 1 - x) * 3;
    data[to] = numberAt(image.data, from); data[to + 1] = numberAt(image.data, from + 1); data[to + 2] = numberAt(image.data, from + 2);
  }
  return { width: image.width, height: image.height, data };
}

/** Whole object in frame: centre the photo on a grey (128) square, like Pillow ImageOps.pad. */
export function padSquare(image: RgbImage): RgbImage {
  const size = Math.max(image.width, image.height);
  const data = new Uint8Array(size * size * 3).fill(128);
  const left = Math.round((size - image.width) / 2), top = Math.round((size - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    data.set(image.data.subarray((y * image.width) * 3, (y + 1) * image.width * 3), ((y + top) * size + left) * 3);
  }
  return { width: size, height: size, data };
}
