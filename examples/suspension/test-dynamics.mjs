import assert from "node:assert/strict";
import test from "node:test";
import { DT, G, drive, energy, forces, makeJoint as createJoint, radians, stepJoint } from "./dynamics.mjs";

const types = {
  long: { mass: .31, length: .21, spring: .10, damping: .027, lower: radians(-2), upper: radians(21) },
  short: { mass: .16, length: .13, spring: .12, damping: .016, lower: radians(-2), upper: radians(17) },
};
const makeJoint = (id, kind, direction) => createJoint(id, types[kind], direction);

test("rejects an invalid unit direction and a rest pose outside the limits", () => {
  assert.throws(() => createJoint("sample", types.long, [0, 0]), RangeError);
  assert.throws(() => createJoint("sample", { ...types.long, lower: .1 }, [1, 0]), RangeError);
});

test("gravity restores outward and inward deflections while damping opposes both velocities", () => {
  const hip = makeJoint("long", "long", [1, 0]);
  for (const sign of [-1, 1]) {
    hip.angle = radians(1) * sign;
    hip.speed = sign;
    const torque = forces(hip, [0, 0]);
    assert.ok(sign * torque.gravity < 0);
    assert.ok(sign * torque.tie < 0);
    assert.ok(sign * torque.damping < 0);
  }
});

test("support acceleration projects onto the panel swing plane with the inertial sign", () => {
  const left = makeJoint("left", "long", [1, 0]);
  const right = makeJoint("right", "long", [-1, 0]);
  const input = [4, 0];
  assert.equal(forces(left, input).inertial, -forces(right, input).inertial);
  assert.ok(forces(left, input).inertial < 0);
  assert.equal(Math.abs(forces(left, [0, 4]).inertial), 0);
  const neutral = makeJoint("neutral", "long", [0, 1]);
  for (let i = 0; i < 120; i++) stepJoint(neutral, [4, 0]);
  assert.equal(neutral.angle, 0);
  assert.equal(neutral.speed, 0);
});

test("a resting panel exhibits the expected small-angle period without damping", () => {
  const shoulder = makeJoint("short", "short", [0, 1]);
  shoulder.angle = radians(1);
  const predicted = 2 * Math.PI * Math.sqrt(shoulder.inertia /
    (shoulder.parameters.mass * G * shoulder.center + shoulder.parameters.spring));
  let lastTime = 0;
  let nextTime = 0;
  for (let i = 1; i <= 240; i++) {
    const previousAngle = shoulder.angle;
    stepJoint(shoulder, [0, 0], 0);
    if (previousAngle <= 0 || shoulder.angle > 0) continue;
    const crossing = (i - 1 + previousAngle / (previousAngle - shoulder.angle)) * DT;
    if (lastTime === 0) lastTime = crossing;
    else {
      nextTime = crossing;
      break;
    }
  }
  assert.ok(nextTime > lastTime);
  assert.ok(Math.abs((nextTime - lastTime) / predicted - 1) < .005);
});

test("damping reduces mechanical energy and a step pulse leaves each part settled", () => {
  for (const kind of ["long", "short"]) {
    const joint = makeJoint(kind, kind, [0, 1]);
    let peak = 0;
    let postPulseEnergy;
    for (let i = 1; i <= 600; i++) {
      stepJoint(joint, drive("step", i * DT, 4.4, 1.05));
      if (i === 94) postPulseEnergy = energy(joint);
      peak = Math.max(peak, Math.abs(joint.angle));
    }
    assert.ok(peak > radians(4), kind);
    assert.ok(postPulseEnergy > 0);
    assert.ok(energy(joint) < postPulseEnergy * .0001);
    assert.ok(joint.lostEnergy > 0);
    assert.ok(Math.abs(joint.angle) < radians(.001));
  }
});

test("both travel stops respect geometry, record contact and dissipate rotation energy", () => {
  for (const sign of [-1, 1]) {
    const hip = makeJoint("long", "long", [1, 0]);
    const { lower, upper } = hip.parameters;
    for (let i = 0; i < 480; i++) {
      const previousLoss = hip.lostEnergy;
      stepJoint(hip, [-18 * sign, 0]);
      assert.ok(lower <= hip.angle && hip.angle <= upper);
      assert.ok(hip.lostEnergy >= previousLoss);
    }
    assert.ok(hip.stopCount >= 1);
    assert.ok(hip.lostEnergy > 0);
    assert.equal(hip.angle, sign === -1 ? lower : upper);
    assert.equal(hip.speed, 0);
    stepJoint(hip, [0, 0]);
    assert.ok(lower < hip.angle && hip.angle < upper, "Unloading releases the stop");
  }
});

test("repeated drive state is deterministic and bounded at maximum controls", () => {
  const initialize = () => ["long", "short"].map(kind => makeJoint(kind, kind, [Math.SQRT1_2, Math.SQRT1_2]));
  const simulate = () => {
    const joints = initialize();
    for (let i = 1; i <= 12_000; i++) {
      const acceleration = drive("sway", i * DT, 9, 2);
      for (const joint of joints) {
        stepJoint(joint, acceleration, 2.5);
        assert.ok(joint.angle >= joint.parameters.lower && joint.angle <= joint.parameters.upper);
        assert.ok(Number.isFinite(energy(joint)));
      }
    }
    return joints;
  };
  assert.deepEqual(simulate(), simulate());
  assert.deepEqual(drive("rest", 5, 9, 2), [0, 0]);
  assert.deepEqual(drive("step", 2, 9, 2), [0, 0]);
});
