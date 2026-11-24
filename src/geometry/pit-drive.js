// The motor drive of a pit lane's flipper: the cam slider and in-line motor
// of the turnout (turnout-drive.js), in the island between the outer main
// slot and the pit slot. Nothing passes under a guide slot.
import { turnoutDriveLayout } from './turnout-drive.js';
import { pitBayStart } from './special-junction-paths.js';

const WORDS = Object.freeze({
  narrow:
    'The island between the main slot and the pit slot is too narrow for the slider and its motor. Increase Pit lane offset, lengthen the pit, or use a narrower motor or a shorter Usable stroke.',
  branchEnds:
    'The pit box ends before the motor does. Lengthen the pit, or use a shorter motor or stroke.',
  waist:
    'The island between the main slot and the pit slot is too narrow behind the flipper for the crank arm and a wall beside each slot. Increase Pit lane offset or shorten the pit.',
});

/**
 * The drive for one fork of a pit lane. branch is the fork's pit lane as
 * [x, y] points; it leaves the main lane at branch[0]. The result is in the
 * frame of turnout-drive.js: across the road it is measured from that main
 * lane (base) towards the pit lane (sign).
 */
export function pitDriveLayout(p, fork, branch) {
  const base = branch[0][1];
  // The island is as wide as it gets from the start of the pit box.
  const lastX = (0.5 - pitBayStart) * p.length;
  const shift = ([x, y]) => [x, y - base];
  const lane = [
    [-p.length / 2 - 0.05, 0],
    ...branch.map(shift).filter(([x]) => x <= lastX + 1e-6),
  ];
  const drive = turnoutDriveLayout(
    p,
    {
      sign: fork.sign,
      fork: { ...fork, heel: shift(fork.heel), mainToe: shift(fork.mainToe) },
      cutLanes: [null, lane],
      ends: { branch: { point: [lastX, 0] } },
    },
    { words: WORDS, roadHalf: Infinity },
  );
  return { ...drive, base, sign: fork.sign, crank: { ...drive.crank, base } };
}
