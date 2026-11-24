// family fork: the two models behind pet recognition, run in the server with onnxruntime-node.
// Contracts are from the model cards (see internal/docs/pets-design.md); getting one wrong degrades
// results silently, so each step below says which part of the contract it implements.
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

/** Changes whenever a model or its settings change, so every photo is scanned again once. */
export const PET_MODEL_VERSION = 'rfdetr-m+pet-recognition-base/1';

export const PET_MODEL_FILES = {
  /** onnx-community/rfdetr_medium-ONNX onnx/model.onnx, Apache-2.0 */
  detector: { file: 'pet-detector-rfdetr-medium.onnx', size: 576 },
  /** open-noodle/pet-recognition-base recognition/model.onnx, Apache-2.0 */
  recognizer: { file: 'pet-recognition-base.onnx', size: 224 },
};

/** COCO 91-class ids, as RF-DETR uses them. */
const DOG = 18;
const CAT = 17;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export type PetBox = { x1: number; y1: number; x2: number; y2: number };
export type DetectedPet = { species: 'dog' | 'cat'; score: number; box: PetBox };

type Ort = typeof import('onnxruntime-node');
type Session = import('onnxruntime-node').InferenceSession;

/** RGB bytes (HWC) → float32 CHW, scaled to [0, 1] and normalised with ImageNet statistics. */
export const toChw = (rgb: Buffer, width: number, height: number): Float32Array => {
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      data[c * plane + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return data;
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
RF-DETR output → animals in pixel boxes. `boxes` are cx, cy, w, h normalised to [0, 1]; `logits` are
pre-sigmoid per class; the queries are already de-duplicated (no NMS).
*/
export const decodeDetections = (
  boxes: Float32Array,
  logits: Float32Array,
  queries: number,
  classes: number,
  width: number,
  height: number,
  minScore: number,
): DetectedPet[] => {
  const found: DetectedPet[] = [];
  for (let q = 0; q < queries; q++) {
    const dog = sigmoid(logits[q * classes + DOG]);
    const cat = sigmoid(logits[q * classes + CAT]);
    const score = Math.max(dog, cat);
    if (score < minScore) {
      continue;
    }
    const [cx, cy, w, h] = boxes.subarray(q * 4, q * 4 + 4);
    const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));
    const box = {
      x1: clamp((cx - w / 2) * width, width),
      y1: clamp((cy - h / 2) * height, height),
      x2: clamp((cx + w / 2) * width, width),
      y2: clamp((cy + h / 2) * height, height),
    };
    // a sliver at the edge of the photo is no use for telling animals apart
    if (box.x2 - box.x1 < 16 || box.y2 - box.y1 < 16) {
      continue;
    }
    found.push({ species: dog >= cat ? 'dog' : 'cat', score, box });
  }
  return found.sort((a, b) => b.score - a.score);
};

export class PetModels {
  private sessions?: Promise<{ ort: Ort; detector: Session; recognizer: Session }>;

  constructor(private readonly folder: string) {}

  /** Whether both model files are present (they're baked into the server image). */
  available() {
    return Object.values(PET_MODEL_FILES).every(({ file }) => existsSync(join(this.folder, file)));
  }

  private load() {
    this.sessions ??= (async () => {
      const ort = await import('onnxruntime-node');
      // half the cores (at most 4): fast enough, and leaves the rest of the server responsive
      const threads = Math.min(4, Math.max(1, Math.ceil(availableParallelism() / 2)));
      const options = { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' as const };
      const [detector, recognizer] = await Promise.all([
        ort.InferenceSession.create(join(this.folder, PET_MODEL_FILES.detector.file), options),
        ort.InferenceSession.create(join(this.folder, PET_MODEL_FILES.recognizer.file), options),
      ]);
      return { ort, detector, recognizer };
    })();
    return this.sessions;
  }

  /** Dogs and cats in the image (the photo's preview), with boxes in the image's own pixels. */
  async detect(path: string, minScore: number): Promise<{ width: number; height: number; pets: DetectedPet[] }> {
    const { ort, detector } = await this.load();
    const size = PET_MODEL_FILES.detector.size;
    // RGB, plain square resize (not letterboxed), as the model was trained
    const image = sharp(path).rotate().removeAlpha();
    const { width = 0, height = 0 } = await image.clone().metadata().then((meta) => orientedSize(meta));
    const rgb = await image.clone().resize(size, size, { fit: 'fill' }).raw().toBuffer();
    const input = new ort.Tensor('float32', toChw(rgb, size, size), [1, 3, size, size]);
    const output = await detector.run({ [detector.inputNames[0]]: input });
    const boxes = output[outputName(detector, 'boxes')];
    const logits = output[outputName(detector, 'logits')];
    const [, queries, classes] = logits.dims;
    return {
      width,
      height,
      pets: decodeDetections(
        boxes.data as Float32Array,
        logits.data as Float32Array,
        queries,
        classes,
        width,
        height,
        minScore,
      ),
    };
  }

  /** The animal's identity: 512 numbers, unit length; compare two with cosine similarity. */
  async embed(path: string, box: PetBox): Promise<number[]> {
    const { ort, recognizer } = await this.load();
    const size = PET_MODEL_FILES.recognizer.size;
    const rgb = await sharp(path)
      .rotate()
      .removeAlpha()
      .extract({ left: box.x1, top: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 })
      .resize(size, size, { fit: 'fill' })
      .raw()
      .toBuffer();
    const input = new ort.Tensor('float32', toChw(rgb, size, size), [1, 3, size, size]);
    const output = await recognizer.run({ [recognizer.inputNames[0]]: input });
    const vector = [...(output[recognizer.outputNames[0]].data as Float32Array)];
    // the model already returns unit vectors; normalise anyway so a cosine distance is always valid
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }
}

/** The image's size after its EXIF rotation, which is how sharp's .rotate() hands us the pixels. */
const orientedSize = (meta: { width?: number; height?: number; orientation?: number }) =>
  (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };

/** RF-DETR exports name their outputs pred_boxes/logits or dets/labels. */
const outputName = (session: Session, kind: 'boxes' | 'logits') => {
  const names = session.outputNames;
  const found =
    kind === 'boxes'
      ? names.find((name) => name === 'pred_boxes' || name === 'dets')
      : names.find((name) => name === 'logits' || name === 'labels');
  if (!found) {
    throw new Error(`Pet detector has no ${kind} output (outputs: ${names.join(', ')})`);
  }
  return found;
};
