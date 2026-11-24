import { overlap, petSettings } from 'src/family/pets/family-pet.service.js';
import { decodeDetections, toChw } from 'src/family/pets/pet-models.js';

const logit = (p: number) => Math.log(p / (1 - p));

/** One detector output with `queries` rows of 91 COCO classes, everything very unlikely by default. */
const output = (queries: number) => ({
  boxes: new Float32Array(queries * 4),
  logits: new Float32Array(queries * 91).fill(logit(0.001)),
});

describe(decodeDetections.name, () => {
  it('reads dogs and cats with their COCO-91 ids, sigmoid scores and pixel boxes', () => {
    const { boxes, logits } = output(3);
    // query 0: a dog in the middle of the image, half its width and height
    boxes.set([0.5, 0.5, 0.5, 0.5], 0);
    logits[18] = logit(0.9);
    // query 1: a cat on the left
    boxes.set([0.2, 0.5, 0.2, 0.4], 4);
    logits[1 * 91 + 17] = logit(0.7);
    // query 2: a person (id 1): not a pet, whatever the score
    boxes.set([0.8, 0.5, 0.2, 0.8], 8);
    logits[2 * 91 + 1] = logit(0.99);

    const pets = decodeDetections(boxes, logits, 3, 91, 1000, 800, 0.5);

    expect(pets).toHaveLength(2);
    expect(pets[0]).toEqual({ species: 'dog', score: expect.closeTo(0.9, 5), box: { x1: 250, y1: 200, x2: 750, y2: 600 } });
    expect(pets[1]).toMatchObject({ species: 'cat', box: { x1: 100, y1: 240, x2: 300, y2: 560 } });
  });

  it('drops animals below the score and slivers too small to identify', () => {
    const { boxes, logits } = output(2);
    boxes.set([0.5, 0.5, 0.5, 0.5], 0);
    logits[18] = logit(0.4);
    boxes.set([0.5, 0.5, 0.01, 0.5], 4);
    logits[91 + 18] = logit(0.95);
    expect(decodeDetections(boxes, logits, 2, 91, 1000, 1000, 0.5)).toEqual([]);
  });

  it('keeps boxes inside the image', () => {
    const { boxes, logits } = output(1);
    boxes.set([0.05, 0.95, 0.3, 0.3], 0);
    logits[18] = logit(0.8);
    const [pet] = decodeDetections(boxes, logits, 1, 91, 200, 100, 0.5);
    expect(pet.box).toEqual({ x1: 0, y1: 80, x2: 40, y2: 100 });
  });
});

describe(toChw.name, () => {
  it('turns RGB pixels into ImageNet-normalised channel planes', () => {
    // two pixels: pure red, then mid grey
    const chw = toChw(Buffer.from([255, 0, 0, 128, 128, 128]), 2, 1);
    expect(chw).toHaveLength(6);
    expect(chw[0]).toBeCloseTo((1 - 0.485) / 0.229, 5); // R plane, pixel 0
    expect(chw[2]).toBeCloseTo((0 - 0.456) / 0.224, 5); // G plane, pixel 0
    expect(chw[5]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5); // B plane, pixel 1
  });
});

describe(overlap.name, () => {
  it('compares boxes found in different sizes of the same photo', () => {
    const a = { x1: 0, y1: 0, x2: 50, y2: 50, width: 100, height: 100 };
    const b = { x1: 0, y1: 0, x2: 100, y2: 100, width: 200, height: 200 };
    expect(overlap(a, b)).toBeCloseTo(1);
    expect(overlap(a, { ...b, x1: 100, x2: 200 })).toBe(0);
  });
});

describe('petSettings', () => {
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
    delete process.env.IMMICH_FAMILY_PETS;
    delete process.env.IMMICH_FAMILY_PET_MAX_DISTANCE;
  });

  it('is on with the family feature, unless turned off', () => {
    expect(petSettings().enabled).toBe(false);
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(petSettings().enabled).toBe(true);
    process.env.IMMICH_FAMILY_PETS = 'false';
    expect(petSettings().enabled).toBe(false);
  });

  it('reads thresholds from the environment and ignores rubbish', () => {
    expect(petSettings().maxDistance).toBe(0.65);
    process.env.IMMICH_FAMILY_PET_MAX_DISTANCE = '0.5';
    expect(petSettings().maxDistance).toBe(0.5);
    process.env.IMMICH_FAMILY_PET_MAX_DISTANCE = 'lots';
    expect(petSettings().maxDistance).toBe(0.65);
  });
});
