export function formatMm(value) {
  return Number(value.toFixed(4)) + ' mm';
}

// Keep a readable message for direct callers and carry the field reference
// separately so the UI never has to infer a setting from the wording.
export function connectorWarning(location, reason, advice, setting) {
  const error = new Error([location + '.', reason, advice].join(' '));
  error.warning = { location, reason, advice, setting };
  return error;
}
