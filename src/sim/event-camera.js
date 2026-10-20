// A temporary camera pose layered over the ordinary walking camera.
// Does not own the Three camera, orbit controls, actor targets or terrain collision.
import { Vector3 } from 'three';

const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const vector = (p) => new Vector3(p.x, p.y, p.z);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const duration = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const EPSILON = 1e-8;

export class EventCamera {
  /** Durations and sample dt are in real seconds; pass the user's reduced-motion preference. */
  constructor({ reducedMotion = false, enterDuration = 0.85, exitDuration = 0.65, distance = 8.5 } = {}) {
    this.reducedMotion = !!reducedMotion;
    this.enterDuration = duration(enterDuration, 0.85);
    this.exitDuration = duration(exitDuration, 0.65);
    this.distance = Number.isFinite(distance) ? clamp(distance, 7, 10) : 8.5;
    this.reset();
  }

  /** True while entering, holding a shot or returning to the live walking-camera pose. */
  get active() { return this._phase !== null; }

  /**
   * target is a world-space point of interest (normally an actor's torso).
   * position/lookAt are the currently displayed camera pose; player is optional world position.
   * Returns false for invalid inputs or reduced motion. Inputs are copied, never mutated.
   */
  focus(target, { position, lookAt, player, reducedMotion = false, distance = this.distance } = {}) {
    if (this.reducedMotion || reducedMotion) { this.reset(); return false; }
    if (!finitePoint(target) || !finitePoint(position) || !finitePoint(lookAt)) return false;

    // Preserve the current side of the scene rather than orbiting across actors.
    const anchor = vector(target);
    const outward = vector(position).sub(anchor).setY(0);
    if (outward.lengthSq() < EPSILON && finitePoint(player)) outward.copy(player).sub(anchor).setY(0);
    if (outward.lengthSq() < EPSILON) outward.copy(position).sub(lookAt).setY(0);
    if (outward.lengthSq() < EPSILON) outward.set(0, 0, 1);
    outward.normalize();

    const shotDistance = Number.isFinite(distance) ? clamp(distance, 7, 10) : this.distance;
    const rise = 2.8;
    const horizontal = Math.sqrt(shotDistance * shotDistance - rise * rise);
    this._shotPosition = anchor.clone().addScaledVector(outward, horizontal);
    this._shotPosition.y += rise;
    // Looking below the actor leaves the subject in the upper half of a portrait viewport.
    // With the game's 60-degree vertical FOV, the anchor projects near NDC y +0.22..+0.28.
    this._shotTarget = anchor.clone().add(new Vector3(0, -1.4, 0));

    // Even a re-entry starts at the actual displayed pose supplied by the caller.
    this._fromPosition = vector(position);
    this._fromTarget = vector(lookAt);
    this._position = vector(position);
    this._target = vector(lookAt);
    this._phase = 'enter';
    this._elapsed = 0;
    return true;
  }

  /** Begin a continuous return to normalPosition/normalLookAt supplied to sample(). */
  end() {
    if (!this.active || this._phase === 'exit') return;
    this._fromPosition = this._position.clone();
    this._fromTarget = this._target.clone();
    this._phase = 'exit';
    this._elapsed = 0;
  }

  /** Clear immediately, for scene changes, load/restart or a reduced-motion preference change. */
  reset() {
    this._phase = null;
    this._elapsed = 0;
    this._fromPosition = null;
    this._fromTarget = null;
    this._shotPosition = null;
    this._shotTarget = null;
    this._position = null;
    this._target = null;
  }

  /**
   * Return independent Vector3 copies, or null when the ordinary camera should render unmodified.
   * The live normal pose may change during exit. Large/fast-forward dt is bounded to avoid a cut.
   * Caller applies ground/obstacle collision AFTER this overlay and never writes back orbit angles.
   */
  sample(dt, normalPosition, normalLookAt) {
    if (this.reducedMotion) { this.reset(); return null; }
    if (!this.active) return null;
    if (!finitePoint(normalPosition) || !finitePoint(normalLookAt)) return null;
    const delta = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    this._elapsed += delta;

    if (this._phase === 'enter') {
      const t = clamp(this._elapsed / this.enterDuration, 0, 1);
      const weight = smooth(t);
      this._position.lerpVectors(this._fromPosition, this._shotPosition, weight);
      this._target.lerpVectors(this._fromTarget, this._shotTarget, weight);
      if (t === 1) this._phase = 'hold';
    } else if (this._phase === 'exit') {
      const t = clamp(this._elapsed / this.exitDuration, 0, 1);
      if (t === 1) { this.reset(); return null; }
      const weight = smooth(t);
      this._position.lerpVectors(this._fromPosition, normalPosition, weight);
      this._target.lerpVectors(this._fromTarget, normalLookAt, weight);
    }
    return { position: this._position.clone(), target: this._target.clone() };
  }
}
