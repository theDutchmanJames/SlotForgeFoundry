// Explains where an imported track's slot and conductor sizes came from, so a
// Circuit drawing without edge layers never silently takes the sizes of
// whatever project was open before.

const mm = (v) => Number(Number(v).toFixed(2)) + ' mm';

// Circuit designs routed boards, often deeper than a printed piece. Keep an
// imported depth only where it leaves the track printable at its current
// height; otherwise keep the current depth and say why.
function fitDepths(drawing, current, notes) {
  const widths = drawing.inferredWidths;
  if (!widths) return;
  const height = current.height,
    floor = current.hollow ? current.wall : 0;
  if (
    widths.slotDepth !== undefined &&
    (widths.slotDepth >= height || widths.slotDepth + floor > height)
  ) {
    notes.push(
      'Circuit’s ' +
        mm(widths.slotDepth) +
        ' slot depth does not fit the current ' +
        mm(height) +
        ' track height, so Foundry kept ' +
        mm(current.slotDepth) +
        '. Raise Track height under Cross-section to use the Circuit depth.',
    );
    delete widths.slotDepth;
  }
  const slotDepth = widths.slotDepth ?? current.slotDepth;
  if (
    widths.braidDepth !== undefined &&
    (widths.braidDepth >= (current.hollow ? current.deck : height) ||
      widths.braidDepth > slotDepth)
  ) {
    notes.push(
      'Circuit’s ' +
        mm(widths.braidDepth) +
        ' conductor recess is too deep for this deck, so Foundry kept ' +
        mm(current.braidDepth) +
        '.',
    );
    delete widths.braidDepth;
  }
}

// Returns notices for the import, and drops imported depths that would make
// the current track unprintable (so call it before the profile is applied).
export function profileWarnings(drawing, current) {
  const source = drawing?.profileSource;
  if (!source || !drawing.lanes?.length) return [];
  const notes = [];
  fitDepths(drawing, current, notes);
  const options = source.exportOptions;
  const fromCircuit = source.circuit;
  const hint = (layers) =>
    fromCircuit
      ? ' In Circuit’s CAD export, turn on ' + layers + ' to carry the sizes across.'
      : ' Add a ' + layers + ' layer to the drawing to carry the sizes across.';
  if (source.slot === 'missing') {
    const layers =
      fromCircuit && options?.conductors === false
        ? 'Slot edges and Braid/tape edges'
        : fromCircuit
          ? 'Slot edges'
          : 'SLOT_EDGES';
    notes.push(
      'The drawing has no slot edges, so Foundry kept the current slot width (' +
        mm(current.slotWidth) +
        ') and braid (' +
        mm(current.braidWidth) +
        ' wide, ' +
        mm(current.braidGap) +
        ' from the slot).' +
        hint(layers) +
        ' Otherwise check them under Cross-section.',
    );
    return notes;
  }
  if (source.slot === 'inconsistent' || source.slot === 'unmeasured') {
    notes.push(
      'The slot width varies along this drawing or could not be measured, so Foundry kept the current ' +
        mm(current.slotWidth) +
        '. Check it under Cross-section.',
    );
  } else if (source.slot === 'too-many') {
    notes.push(
      'This drawing has too many lanes or edges to measure the slot automatically. Foundry kept the current ' +
        mm(current.slotWidth) +
        '.',
    );
  }
  if (source.conductor === 'missing' && source.slot === 'inferred') {
    notes.push(
      'The drawing has no braid or tape edges, so Foundry kept the current braid (' +
        mm(current.braidWidth) +
        ' wide, ' +
        mm(current.braidGap) +
        ' from the slot).' +
        hint(fromCircuit ? 'Braid/tape edges' : 'BRAID_EDGES or TAPE_EDGES'),
    );
  } else if (
    source.conductor === 'inconsistent' ||
    source.conductor === 'unmeasured'
  ) {
    notes.push(
      'The ' +
        (source.conductorType === 'tape' ? 'copper tape' : 'braid') +
        ' size varies along this drawing or could not be measured, so Foundry kept the current braid settings. Check them under Cross-section.',
    );
  }
  if (
    source.conductorType === 'tape' &&
    ['inferred', 'metadata'].includes(source.conductor)
  )
    notes.push(
      'This track uses copper tape, which sits on the road surface, so Foundry cuts no conductor recess (Braid depth 0 mm). Set a Braid depth under Cross-section if you want a locating groove.',
    );
  return notes;
}
