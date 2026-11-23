// Waypoint paths whose plans were recorded before the flowing curve arrived.
// Each digest is the first 16 hex digits of the SHA-256 of the plan's JSON,
// with numbers rounded to a millionth of a millimetre.
export const WAYPOINT_CASES = (defaults) => {
  const p = { ...defaults, kind: 'import', lanes: 2, width: 60, laneSpacing: 25 };
  const squeeze = { version: 1, mode: 'squeeze', spacingMm: 18, anchor: 'centre' };
  return [
    [
      'straight',
      { version: 1, radius: 70, points: [[0, 0], [200, 0]] },
      p,
    ],
    [
      'S piece',
      { version: 1, radius: 70, points: [[0, 0], [140, 0], [140, 220], [320, 220]] },
      p,
    ],
    [
      'S piece, squeezed',
      { version: 1, radius: 70, points: [[0, 0], [140, 0], [140, 220], [320, 220]] },
      { ...p, laneAdjustment: squeeze },
    ],
    [
      'wide four-lane hook, spread',
      { version: 1, radius: 260, points: [[0, 0], [400, 30], [520, 480], [120, 700]] },
      {
        ...p,
        width: 300,
        lanes: 4,
        laneSpacing: 60,
        laneAdjustment: { version: 1, mode: 'spread', spacingMm: 70, anchor: 'centre' },
      },
    ],
    [
      'closed oval',
      { version: 1, radius: 80, closed: true, points: [[0, 0], [400, 0], [400, 200], [0, 200]] },
      p,
    ],
    [
      'figure eight on supports',
      {
        version: 1,
        radius: 40,
        closed: true,
        crossingMode: 'flat-pieces',
        upperPasses: ['first'],
        points: [[-150, -100], [150, 100], [150, -100], [-150, 100]],
      },
      p,
    ],
  ];
};
