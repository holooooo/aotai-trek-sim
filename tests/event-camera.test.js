import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { EventCamera } from '../src/sim/event-camera.js';

const normalPosition = new Vector3(0, 13, 24);
const normalTarget = new Vector3(0, 1.5, 0);
const actor = new Vector3(2, 1.4, -3);
const player = new Vector3(0, 0, 0);
const options = () => ({ position: normalPosition, lookAt: normalTarget, player });
const assertPoint = (a, b, message = '') => assert.ok(a.distanceTo(b) < 1e-8, message);
const settle = (rig, seconds = 1.2, position = normalPosition, target = normalTarget) => {
  let pose;
  for (let i = 0; i < Math.ceil(seconds * 60); i++) pose = rig.sample(1 / 60, position, target);
  return pose;
};

test('inactive EventCamera leaves the normal camera untouched', () => {
  const rig = new EventCamera();
  assert.equal(rig.active, false);
  assert.equal(rig.sample(1 / 60, normalPosition, normalTarget), null);
  rig.end(); rig.reset();
  assert.equal(rig.active, false);
});

test('entry starts at displayed pose and eases continuously into a close shot', () => {
  const rig = new EventCamera();
  const beforePosition = normalPosition.clone(), beforeTarget = normalTarget.clone();
  assert.equal(rig.focus(actor, options()), true);
  assert.equal(rig.active, true);
  const first = rig.sample(0, normalPosition, normalTarget);
  assertPoint(first.position, normalPosition);
  assertPoint(first.target, normalTarget);
  const small = rig.sample(1 / 60, normalPosition, normalTarget);
  assert.ok(small.position.distanceTo(normalPosition) > 0);
  assert.ok(small.position.distanceTo(normalPosition) < 0.02, 'no opening cut');
  const final = settle(rig);
  assert.ok(final.position.distanceTo(normalPosition) > 5);
  assert.ok(final.position.distanceTo(actor) >= 7 && final.position.distanceTo(actor) <= 10);
  assertPoint(beforePosition, normalPosition, 'position input is immutable');
  assertPoint(beforeTarget, normalTarget, 'look-at input is immutable');
  assert.equal(rig.active, true, 'held shot stays active');
});

test('actor and torso remain above portrait midpoint, clear of bottom dialogue', () => {
  const rig = new EventCamera(); rig.focus(actor, options());
  const pose = settle(rig);
  const camera = new PerspectiveCamera(60, 9 / 16, 0.1, 700);
  camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
  const center = actor.clone().project(camera);
  const head = actor.clone().add(new Vector3(0, 1.2, 0)).project(camera);
  const feet = actor.clone().add(new Vector3(0, -1.2, 0)).project(camera);
  assert.ok(Math.abs(center.x) < 0.01, 'subject stays horizontally centered');
  assert.ok(center.y > 0.15 && center.y < 0.5, 'torso lies in upper half');
  assert.ok(head.y < 0.9 && head.y > center.y, 'head is not clipped');
  assert.ok(feet.y > -0.1, 'full actor stays clear of bottom dialogue region');
});

test('exit begins at current pose, follows live normal pose, and becomes inactive', () => {
  const rig = new EventCamera(); rig.focus(actor, options());
  const held = settle(rig); rig.end();
  const first = rig.sample(0, normalPosition, normalTarget);
  assertPoint(first.position, held.position);
  assertPoint(first.target, held.target);
  const livePosition = normalPosition.clone().add(new Vector3(3, 0, 0));
  const liveTarget = normalTarget.clone().add(new Vector3(3, 0, 0));
  const midway = settle(rig, 0.3, livePosition, liveTarget);
  assert.ok(midway.position.distanceTo(livePosition) < held.position.distanceTo(livePosition));
  assert.equal(settle(rig, 1, livePosition, liveTarget), null);
  assert.equal(rig.active, false);
  assertPoint(livePosition, normalPosition.clone().add(new Vector3(3, 0, 0)));
});

test('early end, repeated end and reentry preserve the last displayed pose', () => {
  const rig = new EventCamera(); rig.focus(actor, options());
  const early = settle(rig, 0.15); rig.end();
  assertPoint(rig.sample(0, normalPosition, normalTarget).position, early.position);
  const exiting = settle(rig, 0.2);
  rig.end(); // must not restart the exit timer
  const other = new Vector3(-8, 2, -6);
  assert.equal(rig.focus(other, { position: exiting.position, lookAt: exiting.target, player }), true);
  const reentered = rig.sample(0, normalPosition, normalTarget);
  assertPoint(reentered.position, exiting.position);
  assertPoint(reentered.target, exiting.target);
  const held = settle(rig);
  assert.ok(held.position.distanceTo(other) >= 7 && held.position.distanceTo(other) <= 10);
  rig.reset(); assert.equal(rig.sample(1 / 60, normalPosition, normalTarget), null);
});

test('fast-forward or tab-resume dt cannot cut immediately to the destination', () => {
  const rig = new EventCamera(); rig.focus(actor, options());
  const pose = rig.sample(3600, normalPosition, normalTarget);
  assert.ok(pose.position.distanceTo(normalPosition) < 1);
  for (const dt of [NaN, Infinity, -1, undefined]) {
    const still = rig.sample(dt, normalPosition, normalTarget);
    assertPoint(still.position, pose.position, 'invalid dt does not advance');
  }
  settle(rig); rig.end();
  assert.ok(rig.sample(3600, normalPosition, normalTarget), 'exit is also bounded');
  settle(rig); assert.equal(rig.active, false);
});

test('invalid targets never start a shot or corrupt an existing valid shot', () => {
  const rig = new EventCamera();
  for (const bad of [null, {}, { x: 0, z: 0 }, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }]) {
    assert.equal(rig.focus(bad, options()), false);
    assert.equal(rig.active, false);
  }
  assert.equal(rig.focus(actor, { position: normalPosition }), false);
  rig.focus(actor, options()); const held = settle(rig);
  assert.equal(rig.focus({ x: NaN, y: 0, z: 0 }, options()), false);
  assertPoint(rig.sample(0, normalPosition, normalTarget).position, held.position);
  assert.equal(rig.sample(1, {}, normalTarget), null);
});

test('reduced motion disables event travel, including a live preference change', () => {
  const rig = new EventCamera({ reducedMotion: true });
  assert.equal(rig.focus(actor, options()), false);
  assert.equal(rig.active, false);
  rig.reducedMotion = false;
  assert.equal(rig.focus(actor, { ...options(), reducedMotion: true }), false);
  rig.focus(actor, options()); settle(rig);
  rig.reducedMotion = true;
  assert.equal(rig.sample(1 / 60, normalPosition, normalTarget), null);
  assert.equal(rig.active, false);
});

test('coincident horizontal inputs use deterministic finite framing and distance limits', () => {
  for (const distance of [0, 7, 100]) {
    const rig = new EventCamera({ distance });
    const p = new Vector3(0, 0, 0);
    rig.focus(p, { position: p, lookAt: p, player: p });
    const pose = settle(rig);
    assert.ok(pose.position.toArray().every(Number.isFinite));
    assert.ok(pose.position.distanceTo(p) >= 7 && pose.position.distanceTo(p) <= 10);
  }
});

test('returned poses and later input mutations cannot alter internal shot state', () => {
  const rig = new EventCamera();
  const target = actor.clone(), position = normalPosition.clone(), lookAt = normalTarget.clone();
  rig.focus(target, { position, lookAt, player });
  target.set(999, 999, 999); position.set(888, 888, 888); lookAt.set(777, 777, 777);
  const pose = settle(rig), expectedPosition = pose.position.clone(), expectedTarget = pose.target.clone();
  pose.position.set(1, 1, 1); pose.target.set(2, 2, 2);
  const next = rig.sample(0, normalPosition, normalTarget);
  assertPoint(next.position, expectedPosition);
  assertPoint(next.target, expectedTarget);
});
