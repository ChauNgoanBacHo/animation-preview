// node src/shared/rootCenteredBounds.test.mjs
import assert from 'node:assert/strict';
import { rootCenteredBounds } from './rootCenteredBounds.mjs';

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const contains = (box, b) => box.x <= b.x
  && box.y <= b.y
  && box.x + box.width >= b.x + b.width
  && box.y + box.height >= b.y + b.height;

// Typical character: root at the feet, artwork stretching up and slightly left.
const feet = { x: -40, y: -200, width: 90, height: 200 };
const feetBox = rootCenteredBounds(feet);
assert.deepEqual(center(feetBox), { x: 0, y: 0 });
assert.ok(contains(feetBox, feet), 'must not clip the pose');
assert.deepEqual(feetBox, { x: -50, y: -200, width: 100, height: 400 });

// Lopsided FX attachment on one side only — box grows on both sides so the
// root bone stays dead center instead of the box drifting toward the FX.
const fx = { x: -10, y: -100, width: 300, height: 100 };
const fxBox = rootCenteredBounds(fx);
assert.deepEqual(center(fxBox), { x: 0, y: 0 });
assert.ok(contains(fxBox, fx), 'must not clip the pose');

// Pose entirely on one side of the root still yields a root-centered box.
const offset = { x: 20, y: 30, width: 10, height: 10 };
const offsetBox = rootCenteredBounds(offset);
assert.deepEqual(center(offsetBox), { x: 0, y: 0 });
assert.ok(contains(offsetBox, offset), 'must not clip the pose');

console.log('rootCenteredBounds ok');
