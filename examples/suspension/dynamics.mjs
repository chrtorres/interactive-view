// SI units throughout; gravity acts on the inferred center of mass of one rigid panel.
export const DT = 1 / 120;
export const G = 9.80665;
export const radians = degrees => degrees * Math.PI / 180;
export const degrees = radians => radians * 180 / Math.PI;

export function makeJoint(id, parameters, radial) {
  const { mass, length, spring, damping, lower, upper } = parameters;
  if (![mass, length, spring, damping, lower, upper].every(Number.isFinite) ||
      mass <= 0 || length <= 0 || spring < 0 || damping < 0 || lower >= upper ||
      lower > 0 || upper < 0 || !Array.isArray(radial) || radial.length !== 2 || !radial.every(Number.isFinite) ||
      Math.abs(Math.hypot(...radial) - 1) > 1e-6) {
    throw new RangeError("Expected SI joint parameters, limits enclosing rest, and a unit swing direction");
  }
  return {
    id, radial: [...radial], parameters: { ...parameters }, center: length / 2, inertia: mass * length ** 2 / 3,
    angle: 0, speed: 0, stopCount: 0, lastStop: null, lostEnergy: 0,
  };
}

export function forces(joint, acceleration, dampingScale = 1, gravity = G) {
  const { parameters: p, center, angle, speed, radial } = joint;
  const projected = radial[0] * acceleration[0] + radial[1] * acceleration[1];
  return {
    gravity: -p.mass * gravity * center * Math.sin(angle),
    inertial: -p.mass * projected * center * Math.cos(angle),
    tie: -p.spring * angle,
    damping: -p.damping * dampingScale * speed,
  };
}

export function energy(joint, gravity = G) {
  const { parameters: p, angle, speed, center, inertia } = joint;
  return .5 * inertia * speed ** 2 + p.mass * gravity * center * (1 - Math.cos(angle))
    + .5 * p.spring * angle ** 2;
}

export function stepJoint(joint, acceleration, dampingScale = 1, gravity = G) {
  const torque = forces(joint, acceleration, dampingScale, gravity);
  const total = torque.gravity + torque.inertial + torque.tie + torque.damping;
  const { lower, upper } = joint.parameters;
  const heldAtStop = joint.speed === 0 && (
    (joint.angle === lower && total <= 0) || (joint.angle === upper && total >= 0)
  );
  if (heldAtStop) return torque;

  joint.lostEnergy += -torque.damping * joint.speed * DT;
  // Semi-implicit Euler preserves a bounded undamped oscillator at the selected step size.
  const speedIncrement = total / joint.inertia * DT;
  joint.speed += speedIncrement;
  joint.angle += joint.speed * DT;
  if (joint.angle < lower || joint.angle > upper) {
    const limit = joint.angle < lower ? lower : upper;
    if (joint.lastStop !== limit) joint.stopCount++;
    joint.lastStop = limit;
    joint.angle = limit;
    const preImpact = joint.speed;
    // The hard stop represents the cloth limit or body contact in one degree of freedom.
    const rebound = -.16 * preImpact;
    // Sub-step rebounds resolve as contact to avoid numerical chatter under a steady load.
    const settling = Math.abs(preImpact) < .32 || Math.abs(rebound) < Math.abs(speedIncrement);
    joint.speed = settling ? 0 : rebound;
    joint.lostEnergy += .5 * joint.inertia * (preImpact ** 2 - joint.speed ** 2);
  } else {
    joint.lastStop = null;
  }
  return torque;
}

export function drive(mode, time, intensity, cadence) {
  if (mode === "step") {
    const phase = time / (.72 / cadence);
    const pulse = phase > 0 && phase < 1 ? Math.sin(2 * Math.PI * phase) * Math.sin(Math.PI * phase) : 0;
    return [.24 * intensity * pulse, intensity * pulse];
  }
  if (mode === "sway") {
    const phase = 2 * Math.PI * cadence * time;
    const ramp = Math.min(1, time * 2);
    return [.58 * intensity * ramp * Math.sin(phase), intensity * ramp * Math.sin(phase * 2)];
  }
  return [0, 0];
}
