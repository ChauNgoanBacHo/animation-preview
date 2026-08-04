// The export canvas is centered on the skeleton's root bone (spine local 0,0),
// not on the artwork's bounding box — so frames of different animations (and
// of characters with lopsided FX attachments) line up by the character origin.
// Returns the smallest box centered on 0,0 that still contains the whole pose,
// so nothing clips.
export function rootCenteredBounds(bounds) {
  const halfWidth = Math.max(Math.abs(bounds.x), Math.abs(bounds.x + bounds.width));
  const halfHeight = Math.max(Math.abs(bounds.y), Math.abs(bounds.y + bounds.height));
  return {
    x: -halfWidth,
    y: -halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}
