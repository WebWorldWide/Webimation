import { describe, expect, it } from 'vitest';
import { CURVES, EASES, KF_PRESETS, TEMPLATES, bezier, build, curveFn, easeFn, fitKeyframes, hasKeyframes, parseKeyframes, poseAt, poseCss, sample, spring, type Clip } from '..';

const grid = Array.from({ length: 101 }, (_, i) => i / 100);

describe('easing curves', () => {
  it('every curve starts at 0 and ends exactly at 1', () => {
    for (const [id, c] of Object.entries(CURVES)) {
      if (id === 'hold') continue;
      expect(c.fn(0), id).toBeCloseTo(0, 9);
      expect(c.fn(1), id).toBe(1);
    }
  });
  it('the preset-facing EASES never leave 0..1 and never run backwards (they become clip geometry)', () => {
    for (const [id, e] of Object.entries(EASES)) {
      let prev = -1;
      for (const x of grid) {
        const y = e.fn(x);
        expect(y, id).toBeGreaterThanOrEqual(-1e-9);
        expect(y, id).toBeLessThanOrEqual(1 + 1e-9);
        // Stepped curves are monotone too (non-decreasing).
        expect(y, id).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
  });
  it('bezier matches CSS: linear identity, ease-in-out symmetry, monotone x', () => {
    const lin = bezier(0, 0, 1, 1), eio = bezier(0.42, 0, 0.58, 1);
    for (const x of grid) expect(lin(x)).toBeCloseTo(x, 6);
    expect(eio(0.5)).toBeCloseTo(0.5, 5);
    expect(eio(0.25) + eio(0.75)).toBeCloseTo(1, 5);
    // Out-of-range x control points are clamped, so the curve stays a function of x.
    const wild = bezier(-3, 0, 4, 1);
    let prev = -Infinity;
    for (const x of grid) { const y = wild(x); expect(Number.isFinite(y)).toBe(true); expect(y).toBeGreaterThanOrEqual(prev - 1e-6); prev = y; }
  });
  it('spring rings (overshoots) when bouncy, settles on 1 exactly, and is critically damped at 0', () => {
    const s = spring(0.6);
    expect(Math.max(...grid.map(s))).toBeGreaterThan(1.02);
    expect(s(1)).toBe(1);
    const calm = spring(0);
    expect(Math.max(...grid.map(calm))).toBeLessThanOrEqual(1 + 1e-6);
  });
  it('overshooting curves are kept out of the preset registry', () => {
    for (const id of ['back', 'elastic', 'bounce', 'spring']) {
      expect(CURVES[id]).toBeTruthy();
      expect(id in EASES).toBe(false);
    }
  });
  it('curveFn resolves ids and expressions, rejects junk, and easeFn still falls back safely', () => {
    expect(curveFn('expo')).toBe(EASES.expo.fn);
    expect(curveFn('bezier(.2, .8, .2, 1)')).toBeTypeOf('function');
    expect(curveFn('spring(0.3)')).toBeTypeOf('function');
    expect(curveFn('bezier(1,2)')).toBeNull();
    expect(curveFn('constructor')).toBeNull();
    expect(curveFn('__proto__')).toBeNull();
    expect(curveFn(undefined)).toBeNull();
    expect(easeFn('nope')(0.5)).toBe(EASES.out.fn(0.5));
  });
});

describe('keyframe sampling', () => {
  const track = [{ t: 1, v: 10 }, { t: 3, v: 30 }, { t: 4, v: 0 }];
  it('holds before the first key and after the last', () => {
    expect(sample(track, 0, 99)).toBe(10);
    expect(sample(track, 9, 99)).toBe(0);
    expect(sample(undefined, 1, 99)).toBe(99);
    expect(sample([], 1, 99)).toBe(99);
  });
  it('interpolates linearly by default and lands exactly on keys', () => {
    expect(sample(track, 2, 0)).toBeCloseTo(20, 9);
    expect(sample(track, 3, 0)).toBe(30);
    expect(sample(track, 3.5, 0)).toBeCloseTo(15, 9);
  });
  it('a key\'s ease shapes the segment that leaves it', () => {
    const t = [{ t: 0, v: 0, ease: 'hold' }, { t: 1, v: 100 }];
    expect(sample(t, 0.99, 0)).toBe(0);
    expect(sample(t, 1, 0)).toBe(100);
    const e = [{ t: 0, v: 0, ease: 'expo' }, { t: 1, v: 100 }];
    expect(sample(e, 0.2, 0)).toBeGreaterThan(20);
  });
  it('a spring segment overshoots its target and then settles on it', () => {
    const t = [{ t: 0, v: 0, ease: 'spring(0.7)' }, { t: 1, v: 100 }];
    expect(Math.max(...grid.map(x => sample(t, x, 0)))).toBeGreaterThan(100);
    expect(sample(t, 1, 0)).toBe(100);
  });
  it('is a pure function of t: order of calls does not matter', () => {
    const ts = [0, 0.4, 1.7, 2.2, 3.9, 5];
    const fwd = ts.map(x => sample(track, x, 0)), rev = [...ts].reverse().map(x => sample(track, x, 0)).reverse();
    expect(fwd).toEqual(rev);
  });
});

describe('keyframe parsing', () => {
  it('drops junk instead of throwing', () => {
    for (const bad of [undefined, '', 'nope', '[]', 'null', '42', '{"x":"no"}', '{"x":[null,1,"a",{"t":"a","v":1},{"t":NaN}]}']) {
      expect(hasKeyframes(parseKeyframes(bad as string))).toBe(false);
    }
  });
  it('sorts keys, lets the last key on an instant win, clamps values, drops unknown eases and props', () => {
    const kf = parseKeyframes(JSON.stringify({
      opacity: [{ t: 2, v: 5 }, { t: 0, v: -3, ease: 'evil' }, { t: 2, v: 0.5 }],
      scale: [{ t: 0, v: 0 }],
      bogus: [{ t: 0, v: 1 }]
    }));
    expect(kf.opacity).toEqual([{ t: 0, v: 0 }, { t: 2, v: 0.5 }]);
    expect(kf.scale![0].v).toBe(0.01);
    expect('bogus' in kf).toBe(false);
  });
  it('caps runaway input', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ t: i, v: 1 }));
    expect(parseKeyframes(JSON.stringify({ x: many })).x!.length).toBe(64);
  });
  it('fitKeyframes rescales time', () => {
    const kf = fitKeyframes(parseKeyframes('{"x":[{"t":0,"v":0},{"t":2,"v":10}]}'), 2, 4);
    expect(kf.x!.map(k => k.t)).toEqual([0, 4]);
  });
  it('every ready-made motion parses cleanly and is non-empty', () => {
    for (const [id, p] of Object.entries(KF_PRESETS)) {
      const made = p.make(5), back = parseKeyframes(JSON.stringify(made));
      expect(hasKeyframes(back), id).toBe(true);
      expect(back, id).toEqual(made);
    }
  });
});

describe('pose css', () => {
  it('the identity pose adds nothing', () => {
    expect(poseCss(poseAt({}, 1.2))).toEqual({ transform: '', opacity: '' });
  });
  it('composes translate, rotate, scale in a fixed order', () => {
    expect(poseCss({ x: 10, y: -4, scale: 2, rotate: 15, opacity: 0.5 })).toEqual({ transform: 'translate(10px,-4px) rotate(15deg) scale(2)', opacity: '0.5' });
  });
});

describe('stage integration', () => {
  const mount = (props: Record<string, string>) => {
    const layer = document.createElement('div');
    document.body.append(layer);
    const clip: Clip = { id: 'k', tpl: 'lt', start: 0, dur: TEMPLATES.lt.dur, props };
    return { layer, clip, upd: build(layer, clip)! };
  };
  const wrapper = (layer: HTMLElement) => layer.firstElementChild as HTMLElement;

  it('a clip without keyframes is byte-for-byte what it was', () => {
    const a = mount({}), b = mount({ kf: '{"junk":1}' });
    a.upd(1); b.upd(1);
    expect(b.layer.innerHTML).toBe(a.layer.innerHTML);
    a.layer.remove(); b.layer.remove();
  });

  it('moves, scales and fades the whole graphic on its own timeline', () => {
    const kf = JSON.stringify({ x: [{ t: 0, v: -100 }, { t: 2, v: 100 }], opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] });
    const m = mount({ kf });
    m.upd(1);
    expect(wrapper(m.layer).style.transform).toBe('');            // x = 0 at t = 1: identity
    expect(wrapper(m.layer).style.opacity).toBe('');              // fully opaque
    m.upd(0);
    expect(wrapper(m.layer).style.transform).toBe('translate(-100px,0px)');
    expect(wrapper(m.layer).style.opacity).toBe('0');
    m.upd(0.5);
    expect(wrapper(m.layer).style.opacity).toBe('0.5');
    m.layer.remove();
  });

  it('is scrub-order independent', () => {
    const kf = JSON.stringify({ scale: [{ t: 0, v: 0.5, ease: 'spring(0.5)' }, { t: 1.5, v: 1 }], rotate: [{ t: 0, v: 20 }, { t: 3, v: 0 }] });
    const ts = [0, 0.4, 1.1, 2.5, 4];
    const a = mount({ kf }), b = mount({ kf });
    // The pose is the keyframes' whole output (reveal purity is the robustness suite's job).
    const pose = (m: ReturnType<typeof mount>, t: number) => (m.upd(t), wrapper(m.layer).style.cssText);
    const fwd = ts.map(t => pose(a, t));
    const rev = [...ts].reverse().map(t => pose(b, t)).reverse();
    expect(new Set(fwd).size).toBeGreaterThan(3);
    expect(rev).toEqual(fwd);
    a.layer.remove(); b.layer.remove();
  });

  it('keeps the reveal effects measuring an untransformed layout', () => {
    const m = mount({ kf: '{"scale":[{"t":0,"v":3},{"t":1,"v":3}],"rotate":[{"t":0,"v":45},{"t":1,"v":45}]}' });
    const seen: string[] = [];
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) { const w = wrapper(m.layer); seen.push(w.style.transform); return orig.call(this); };
    try { m.upd(0.3); m.upd(2); } finally { Element.prototype.getBoundingClientRect = orig; }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(t => t === '')).toBe(true);
    // ...and the pose is applied once the frame is done.
    expect(wrapper(m.layer).style.transform).toBe('rotate(45deg) scale(3)');
    m.layer.remove();
  });
});
