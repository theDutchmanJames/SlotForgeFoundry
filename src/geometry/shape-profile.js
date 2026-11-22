export function validateSlotDimensions(length, width) {
  if (![length, width].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('Enter a positive overall length and width for the slot.');
  if (length < width)
    throw new Error('Slot overall length must be at least its width.');
}

function circle(radius) {
  return Array.from({ length: 64 }, (_, i) => [
    Math.cos((i * Math.PI) / 32) * radius,
    Math.sin((i * Math.PI) / 32) * radius,
  ]);
}

// All built-in outlines are centred at the pick point in local face coordinates.
export function shapeOutline(kind, sizeX, sizeY) {
  if (kind === 'slot') {
    validateSlotDimensions(sizeX, sizeY);
    const radius = sizeY / 2;
    const centre = (sizeX - sizeY) / 2;
    if (centre === 0) return circle(radius);
    const cap = (cx, start) =>
      Array.from({ length: 31 }, (_, i) => {
        const angle = start + (i * Math.PI) / 30;
        return [cx + Math.cos(angle) * radius, Math.sin(angle) * radius];
      });
    return [...cap(centre, -Math.PI / 2), ...cap(-centre, Math.PI / 2)];
  }
  if (!(Number.isFinite(sizeX) && sizeX > 0))
    throw new Error('Use positive shape dimensions.');
  const x = sizeX / 2;
  if (kind === 'circle') return circle(x);
  if (kind !== 'rectangle') throw new Error('Choose a built-in profile.');
  if (!(Number.isFinite(sizeY) && sizeY > 0))
    throw new Error('Use positive shape dimensions.');
  const y = sizeY / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [-x, y],
  ];
}
