// All dimensions are in millimetres. Without a motor the crank has an eye
// for a pushrod worked from outside the piece. With a motor mount, a slider
// between the main slot and the pit slot works the crank (turnout-drive.js).
export const PIT_MOTOR_DEFAULTS = Object.freeze({
  motorMount: false,
  motorLength: 15,
  motorWidth: 8,
  motorHeight: 5,
  motorStroke: 2,
  plungerProjection: 2,
  eyeDiameter: 1.6,
  rodDiameter: 1,
});

export const PIT_MOTOR_LIMITS = Object.freeze({
  motorLength: [3, 150],
  motorWidth: [2, 100],
  motorHeight: [2, 100],
  motorStroke: [0.3, 50],
  plungerProjection: [0, 100],
  eyeDiameter: [0.7, 6],
  rodDiameter: [0.4, 4],
});

export function pitMotorSettings(special) {
  return Object.fromEntries(Object.entries(PIT_MOTOR_DEFAULTS).map(([key, value]) =>
    [key, special[key] === undefined ? value : special[key]]));
}

const labels = {
  motorLength: 'Motor length', motorWidth: 'Motor width', motorHeight: 'Motor height',
  motorStroke: 'Usable motor stroke', plungerProjection: 'Retracted plunger projection',
  eyeDiameter: 'Crank hole diameter', rodDiameter: 'Pushrod diameter',
};

export function validatePitMotorSettings(special) {
  const s = pitMotorSettings(special);
  if (typeof s.motorMount !== 'boolean')
    throw Error('Choose whether to fit a push-pull motor mount.');
  for (const [key, [min, max]] of Object.entries(PIT_MOTOR_LIMITS)) {
    if (!s.motorMount && key !== 'eyeDiameter' && key !== 'rodDiameter') continue;
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
      throw Error(`${labels[key]} must be between ${min} and ${max} mm.`);
  }
  // The pushrod and its eye belong to the crank without a motor.
  if (!s.motorMount && s.eyeDiameter - s.rodDiameter < 0.15 - 1e-9)
    throw Error('Set the crank hole diameter at least 0.15 mm larger than the pushrod diameter so the hooked pin can turn.');
}
