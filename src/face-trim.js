const ranges = new WeakMap();
const mm = (value) => Number(value.toPrecision(7)) + ' mm';

export function trimPlane(min, max, face, trimMode, amount) {
  const height = max - min;
  const cut = trimMode === 'remaining' ? min + amount : face - amount;
  let issue = '';
  if (!['remove', 'remaining'].includes(trimMode))
    issue = 'Choose a trim measurement.';
  else if (!Number.isFinite(height) || !(height > 0) || !Number.isFinite(face))
    issue = 'Select a face on a solid part to trim.';
  else if (!Number.isFinite(amount) || amount <= 0)
    issue = 'Enter a trim measurement greater than zero.';
  else if (cut <= min)
    issue =
      'This would remove the entire part. ' +
      (face > min && trimMode === 'remove'
        ? 'Enter less than ' + mm(face - min) + ' from this face.'
        : 'Choose a plane that leaves material on the opposite side.');
  else if (cut >= max || (trimMode === 'remaining' && amount >= height))
    issue =
      'This plane removes no material. ' +
      (trimMode === 'remaining'
        ? 'Choose a finished size below ' + mm(height) + '.'
        : 'Increase the amount or select a face on the part.');
  return {
    min,
    max,
    face,
    cut,
    height,
    remaining: cut - min,
    removed: max - cut,
    valid: !issue,
    issue,
  };
}

// Cache the support distances of the immutable displayed mesh as the user
// adjusts a measurement. A rotated world bounding box can overstate the span.
export function faceSupportRange(positions, direction, stride = 3) {
  const length = Math.hypot(...direction);
  if (!(length > 0) || !Number.isFinite(length))
    throw new Error('Select a face with a valid normal.');
  const normal = direction.map((v) => v / length);
  if (!Number.isSafeInteger(stride) || stride < 3 || positions.length % stride)
    throw new Error('The target mesh has incomplete vertex coordinates.');
  let range = ranges.get(positions);
  if (
    !range ||
    range.stride !== stride ||
    !range.normal.every((v, i) => v === normal[i])
  ) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < positions.length; i += stride) {
      const d =
        normal[0] * positions[i] +
        normal[1] * positions[i + 1] +
        normal[2] * positions[i + 2];
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    range = { min, max, normal, stride };
    ranges.set(positions, range);
  }
  return range;
}

export function faceTrimMetrics(positions, frame, trimMode, amount) {
  const { min, max, normal } = faceSupportRange(positions, frame.normal);
  const face = frame.origin.reduce((sum, x, i) => sum + x * normal[i], 0);
  return { ...trimPlane(min, max, face, trimMode, amount), normal };
}
