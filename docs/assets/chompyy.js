// Chompyy on the web: the same cookie and eyes as the Mac app (mac/Sources/Chompyy/Mascot.swift), in SVG.
// Capsule eyes and expressions after open-mascot-studio (MIT, 0oooh); googly pupils after Morkrom/googlyeyes
// (MIT); saccades and blinks after bluey-by-riley (public domain).
//
// Usage: <div data-chompyy data-left="1"></div>, or data-scroll-eat="#section" to be eaten while that section
// scrolls past. Energy (the share left) sets the tempo: lively when whole, calm when nearly eaten.

const SVGNS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const e = (sx = 1, sy = 1, x = 0, y = 0, rot = 0) => ({ sx, sy, x, y, rot });
const p = ({ pitch = 0, yaw = 0, roll = 0, squash = 0, lift = 0, gx = 0, gy = 0, l = e(), r = e() } = {}) => ({ pitch, yaw, roll, squash, lift, gx, gy, l, r });
const EXPRESSIONS = {
  neutral: p(),
  focused: p({ pitch: -3, yaw: 10, roll: 4, gx: 3, l: e(0.95, 1.13), r: e(0.95, 1.13) }),
  curious: p({ pitch: -7, yaw: -14, roll: -7, gx: -4, gy: -2, l: e(0.92, 1.06, 0, 0, 17), r: e(0.82, 0.88, 0, 1, -13) }),
  skyward: p({ pitch: 6, yaw: 20, roll: -10, gx: 5, gy: -10, l: e(1.02, 0.88), r: e(1.02, 0.88) }),
  softGaze: p({ pitch: -10, yaw: -6, roll: -5, gy: 5, l: e(1.08, 0.82), r: e(1.08, 0.82) }),
  sideEye: p({ pitch: -7, yaw: 12, roll: -6, gx: 4, l: e(1.1, 0.34, 0, -1, -4), r: e(0.9, 1.08, 0, 1, 3) }),
  beaming: p({ pitch: -4, yaw: -11, roll: 8, squash: 0.05, lift: -5, l: e(1.32, 1.4, 0, -2, -5), r: e(1.32, 1.4, 0, -2, 5) }),
  cheeky: p({ pitch: 2, yaw: 15, roll: -12, lift: -3, gx: 3, l: e(0.85, 0.86, 0, 0, 22), r: e(0.85, 0.86, 0, 0, -18) }),
  surprised: p({ pitch: -3, yaw: -8, roll: -5, squash: -0.03, lift: -4, l: e(1.55, 0.72), r: e(1.55, 0.72) }),
  shy: p({ pitch: -12, yaw: 7, roll: 5, gx: -2, gy: 10, l: e(0.92, 0.66), r: e(0.92, 0.66) }),
  sleepy: p({ pitch: 5, yaw: 3, roll: 5, squash: 0.03, gy: 4, l: e(1.25, 0.18), r: e(1.25, 0.18) }),
  confident: p({ pitch: 8, yaw: 17, roll: -6, lift: -2, gx: 5, gy: -5, l: e(0.94, 0.82), r: e(0.94, 0.82) }),
};
const NAMES = Object.keys(EXPRESSIONS);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const gentle = (v) => { const t = clamp(v); return t * t * t * (t * (t * 6 - 15) + 10); };
const quick = (v) => 1 - (1 - clamp(v)) ** 4;
const spring = (v) => { const t = clamp(v); return clamp(1 - (1 - t) ** 4 + Math.sin(t * Math.PI * 2.45) * (1 - t) ** 3 * 0.13); };
const lerp = (a, b, k) => a + (b - a) * k;
const lerpEye = (a, b, k) => ({ sx: lerp(a.sx, b.sx, k), sy: lerp(a.sy, b.sy, k), x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), rot: lerp(a.rot, b.rot, k) });
const lerpPose = (a, b, k) => ({
  pitch: lerp(a.pitch, b.pitch, k), yaw: lerp(a.yaw, b.yaw, k), roll: lerp(a.roll, b.roll, k), squash: lerp(a.squash, b.squash, k),
  lift: lerp(a.lift, b.lift, k), gx: lerp(a.gx, b.gx, k), gy: lerp(a.gy, b.gy, k), l: lerpEye(a.l, b.l, k), r: lerpEye(a.r, b.r, k),
});
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Picks expressions at random; energy sets how long each is held and how springy the moves are. */
class Director {
  constructor() { this.current = 'neutral'; this.next = 'neutral'; this.start = null; this.blinkAt = -10; this.nextBlink = 1; this.echo = false; }
  plan(energy) {
    const options = NAMES.filter((n) => n !== this.current);
    this.next = options[Math.floor(Math.random() * options.length)];
    const calm = 1 - energy;
    this.hold = (0.7 + calm * calm * 9.5) * (0.7 + Math.random() * 0.6);
    this.transition = 0.32 + calm * 0.5;
    this.springy = energy > 0.5;
  }
  step(t, energy) {
    if (this.start === null) { this.start = t; this.plan(energy); }
    let local = t - this.start;
    if (local > this.hold + this.transition) { this.current = this.next; this.start = t; local = 0; this.plan(energy); }
    let pose = clone(EXPRESSIONS[this.current]);
    if (local > this.hold) {
      const k = (local - this.hold) / this.transition;
      pose = lerpPose(pose, EXPRESSIONS[this.next], this.springy ? spring(k) : gentle(k));
    }
    // Ambient breathing and sway.
    const a = 0.3 + 0.45 * energy;
    pose.lift += Math.sin(t * 0.79 + 0.4) * 2.1 * a;
    pose.roll += Math.sin(t * 0.53 + 1.1) * 0.72 * a;
    pose.gx += Math.sin(t * 0.29 + 0.7) * 0.42 * a;
    pose.gy += Math.sin(t * 0.23 + 2.7) * 0.3 * a;
    // Blinks: snap shut, hold, ease open; doubles when lively.
    if (t > this.nextBlink) {
      this.blinkAt = t; this.echo = energy > 0.6 && Math.random() < 0.3;
      this.nextBlink = t + (energy > 0.6 ? 3.9 + Math.random() * 3 : 5 + Math.random() * 3);
    }
    const shape = (k) => (k < 0.23 ? quick(k / 0.23) : k < 0.39 ? 1 : 1 - gentle((k - 0.39) / 0.61));
    const w = t - this.blinkAt;
    let blink = w >= 0 && w <= 0.205 ? shape(w / 0.205) : 0;
    const ew = w - 0.323;
    if (this.echo && ew >= 0 && ew <= 0.17) blink = shape(ew / 0.17) * 0.88;
    pose.l.sy *= Math.max(0.055, 1 - blink * 0.95); pose.r.sy *= Math.max(0.055, 1 - blink * 0.96);
    pose.l.y += blink * 1.25; pose.r.y += blink * 1.05;
    return pose;
  }
}

/** A googly pupil: a ball in a socket, pulled toward the target, slowed by drag, bouncing off the rim. */
class Pupil {
  constructor(pull, drag, bounce) { Object.assign(this, { pull, drag, bounce, x: 0, y: 0, vx: 0, vy: 0 }); }
  step(tx, ty, dt) {
    this.vx += (this.pull * (tx - this.x) - this.drag * this.vx) * dt;
    this.vy += (this.pull * (ty - this.y) - this.drag * this.vy) * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const d = Math.hypot(this.x, this.y);
    if (d > 1) {
      const nx = this.x / d, ny = this.y / d; this.x = nx; this.y = ny;
      const out = this.vx * nx + this.vy * ny;
      if (out > 0) { this.vx -= (1 + this.bounce) * out * nx; this.vy -= (1 + this.bounce) * out * ny; }
    }
  }
}

let mouse = null, lastMove = -100;
addEventListener('pointermove', (ev) => { mouse = { x: ev.clientX, y: ev.clientY }; lastMove = performance.now() / 1000; }, { passive: true });

const CHIPS = [[-0.40, -0.30, 0.30], [0.20, -0.48, 0.26], [0.42, 0.10, 0.30], [-0.05, 0.08, 0.28], [-0.50, 0.32, 0.24], [0.12, 0.52, 0.30],
  [-0.18, -0.70, 0.20], [0.68, -0.22, 0.20], [-0.72, -0.05, 0.22], [0.55, 0.50, 0.24], [-0.28, 0.68, 0.22], [0.35, -0.75, 0.18],
  [0.78, 0.18, 0.18], [-0.62, -0.55, 0.20], [0.02, -0.30, 0.18], [-0.30, 0.30, 0.16], [0.30, 0.32, 0.16], [-0.82, 0.30, 0.16],
  [0.10, 0.82, 0.18], [0.62, -0.55, 0.16]];
const FROM = [0.72, -0.69];
const ROW = [[-1.5, 0.30], [-1.05, 0.34], [-0.55, 0.31], [0, 0.36], [0.5, 0.31], [1.0, 0.33], [1.5, 0.30]];
let uid = 0;

/** Where the face goes: the middle of the piece left (grid estimate, cached), and how big it can be. */
const spots = new Map();
function faceSpot(l, bite) {
  const key = Math.round(l * 200);
  if (spots.has(key)) return spots.get(key);
  const edge = 1.36 - bite, px = -FROM[1], py = FROM[0];
  const circles = ROW.map(([t, r]) => [FROM[0] * edge + px * t, FROM[1] * edge + py * t, r]);
  let n = 0, sx = 0, sy = 0;
  const N = 32;
  for (let yi = 0; yi < N; yi++) for (let xi = 0; xi < N; xi++) {
    const x = ((xi + 0.5) / N) * 2 - 1, y = ((yi + 0.5) / N) * 2 - 1;
    if (x * x + y * y > 1) continue;
    if (x * FROM[0] + y * FROM[1] > edge) continue;
    if (circles.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)) continue;
    n++; sx += x; sy += y;
  }
  const spot = l > 0.97 ? { fx: 0, fy: 0.05, fs: 1 } : { fx: n ? sx / n : 0, fy: (n ? sy / n : 0) + 0.05, fs: Math.max(0.45, Math.min(1, Math.sqrt(l) * 1.1)) };
  spots.set(key, spot);
  return spot;
}

function el(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function mount(host) {
  const id = `cy${uid++}`;
  const R = 100, C = 120; // cookie radius and centre in a 240×240 box
  const svg = el('svg', { viewBox: '0 0 240 240', role: 'img', 'aria-label': 'Chompyy, a cookie with googly eyes' }, host);
  const defs = el('defs', {}, svg);
  const grad = el('radialGradient', { id: `${id}g`, cx: '45%', cy: '40%', r: '62%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#e2ab6b' }, grad);
  el('stop', { offset: '1', 'stop-color': '#b37840' }, grad);
  const mask = el('mask', { id: `${id}m`, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '240', height: '240' }, defs);
  el('rect', { x: 0, y: 0, width: 240, height: 240, fill: '#fff' }, mask);
  const eatenSide = el('polygon', { fill: '#000' }, mask);
  const bites = ROW.map(() => el('circle', { fill: '#000' }, mask));
  const body = el('g', {}, svg);
  const cookie = el('g', { mask: `url(#${id}m)` }, body);
  el('circle', { cx: C, cy: C, r: R, fill: `url(#${id}g)`, stroke: '#5c3a26', 'stroke-opacity': '.35', 'stroke-width': 2 }, cookie);
  const chips = CHIPS.map(([x, y, s], i) => el('ellipse', { cx: C + x * R, cy: C + y * R, rx: s * 0.42 * R, ry: s * 0.34 * R, fill: '#4d2e1c', opacity: '.8', transform: `rotate(${i * 37} ${C + x * R} ${C + y * R})` }, cookie));
  const eyes = [el('rect', { fill: '#3d1c14' }, body), el('rect', { fill: '#3d1c14' }, body)];

  const director = new Director();
  const pupils = [new Pupil(160, 9, 0.55), new Pupil(150, 8, 0.6)];
  const fixedLeft = parseFloat(host.dataset.left ?? '1');
  const scrollTarget = host.dataset.scrollEat ? document.querySelector(host.dataset.scrollEat) : null;
  let left = fixedLeft, shownLeft = fixedLeft, last = null, visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(host);

  function shape(l) {
    const bite = (1 - l) * 2.25; // 0 = whole … ~crescent at the end
    const edge = 1.36 - bite, px = -FROM[1], py = FROM[0];
    const far = 4;
    const pt = (along, out) => `${C + (FROM[0] * out + px * along) * R},${C + (FROM[1] * out + py * along) * R}`;
    eatenSide.setAttribute('points', [pt(-far, edge), pt(far, edge), pt(far, far), pt(-far, far)].join(' '));
    ROW.forEach(([t, r], i) => {
      bites[i].setAttribute('cx', C + (FROM[0] * edge + px * t) * R);
      bites[i].setAttribute('cy', C + (FROM[1] * edge + py * t) * R);
      bites[i].setAttribute('r', r * R);
    });
    return faceSpot(l, bite);
  }

  function frame(ms) {
    requestAnimationFrame(frame);
    draw(ms);
  }
  function draw(ms, fromScroll = false) {
    if (!visible && last !== null && !fromScroll) return;
    const t = ms / 1000, dt = Math.min(1 / 30, last === null ? 0 : t - last);
    last = t;
    if (scrollTarget) {
      const r = scrollTarget.getBoundingClientRect();
      const k = clamp((innerHeight * 0.75 - r.top) / (r.height + innerHeight * 0.25));
      left = 1 - 0.88 * k;
    }
    // Scroll-driven: follow the scroll exactly (it's already smooth). Otherwise ease toward the target.
    if (scrollTarget) shownLeft = left;
    else shownLeft += (left - shownLeft) * Math.min(1, dt * 6);
    const face = shape(shownLeft);
    const pose = reduced ? clone(EXPRESSIONS.neutral) : director.step(t, shownLeft);

    // Googly: follow the mouse while it moves; when it rests, the expression leads.
    const box = host.getBoundingClientRect();
    let tx = 0, ty = 0;
    if (mouse && t - lastMove < 4 && !reduced) {
      const dx = mouse.x - (box.left + box.width / 2), dy = mouse.y - (box.top + box.height / 2);
      const d = Math.hypot(dx, dy), reach = Math.min(1, d / (box.width * 2));
      if (d > 0.1) { tx = dx / d * reach; ty = dy / d * reach; }
    }
    pupils.forEach((pp) => pp.step(tx, ty, dt));

    body.setAttribute('transform', `translate(0 ${pose.lift * 0.9}) rotate(${pose.roll} ${C} ${C + R}) translate(${C} ${C + R}) scale(${1 + pose.squash * 0.5} ${1 - pose.squash}) translate(${-C} ${-C - R})`);
    const k = (R * 2 * 0.95 * face.fs) / 220;
    const ox = C + face.fx * R, oy = C + face.fy * R;
    const yawS = Math.max(0.8, 1 - Math.abs(pose.yaw) * 0.005), pitchS = Math.max(0.9, 1 - Math.abs(pose.pitch) * 0.0025);
    [pose.l, pose.r].forEach((eye, i) => {
      const dir = i === 0 ? -1 : 1;
      const x = dir * 21 + pose.gx + eye.x + pupils[i].x * 9;
      const y = -10 + pose.gy + eye.y + pupils[i].y * 7;
      const cx = x * yawS + pose.yaw * (y / 135) * 0.18 + pose.yaw * 0.16, cy = y * pitchS;
      const w = Math.max(2, 23 * eye.sx * yawS) * k, h = Math.max(2, 56 * eye.sy * pitchS) * k;
      const ex = ox + cx * k, ey = oy + cy * k;
      const n = eyes[i];
      n.setAttribute('x', ex - w / 2); n.setAttribute('y', ey - h / 2);
      n.setAttribute('width', w); n.setAttribute('height', h);
      n.setAttribute('rx', Math.min(w, h) / 2);
      n.setAttribute('transform', `rotate(${eye.rot} ${ex} ${ey})`);
    });
    chips.forEach((c, i) => { // no chips under the eyes
      const [x, y] = CHIPS[i];
      const near = Math.abs(x - face.fx) < 0.55 * face.fs && Math.abs(y - face.fy + 0.05) < 0.45 * face.fs;
      c.setAttribute('opacity', near ? 0 : 0.8);
    });
    if (host.dataset.label !== undefined) host.dataset.label = `${Math.round(shownLeft * 100)}`;
    host.dispatchEvent(new CustomEvent('chompyy:left', { detail: shownLeft }));
  }
  if (scrollTarget) addEventListener('scroll', () => draw(performance.now(), true), { passive: true });
  draw(performance.now()); // the first frame right away, so the cookie is whole even before animation starts
  requestAnimationFrame(frame);
}

document.querySelectorAll('[data-chompyy]').forEach(mount);
