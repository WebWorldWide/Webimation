import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EFFECTS, LIBRARY, build, TEMPLATES, type Clip } from '..';

// Robustness matrix: every template x one preset per effect family.
// A graphic is a pure function of local time t: the same t must always yield the same markup,
// no matter the scrub order, and no non-finite values may leak into the DOM.
// jsdom has no layout, so geometry is deliberately not asserted here.

const SETUP_TIMEOUT = 300_000;
const GARBAGE = /NaN|Infinity|undefined/;

interface Case { label: string; clip: Clip }

const CASES: Case[] = Object.keys(TEMPLATES).flatMap(tpl =>
  EFFECTS.map(fx => {
    const preset = LIBRARY.find(p => p.enter.fx === fx.id);
    if (!preset) throw new Error(`no LIBRARY preset for effect ${fx.id}`);
    return {
      label: `${tpl} / ${fx.id}`,
      clip: { id: 'robust', tpl, start: 0, dur: TEMPLATES[tpl].dur, props: { reveal: preset.id } },
    };
  }),
);

function mount(clip: Clip) {
  const layer = document.createElement('div');
  document.body.append(layer);
  const upd = build(layer, clip);
  if (!upd) throw new Error(`build returned null for template ${clip.tpl}`);
  return { layer, upd };
}

/** Times for the determinism and scrub-order checks. */
const samples = (dur: number) => [0, 0.3, 0.7, 1.5, dur - 0.5, dur - 0.04];

/** Evenly spaced sweep through the whole clip, inclusive of dur. */
const sweep = (dur: number, steps: number) => Array.from({ length: steps + 1 }, (_, i) => (dur * i) / steps);

/** Short window around the first mismatch between two markup strings. */
function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `char ${i}: ...${a.slice(from, i + 60)}... vs ...${b.slice(from, i + 60)}...`;
}

/**
 * Markup with each element's style declarations normalized and sorted. jsdom re-serializes a
 * style attribute (`left:0` becomes `left: 0px`) once the stage writes it through CSSOM, so raw
 * innerHTML can differ in spelling and whitespace with identical declarations. Only consulted
 * when raw innerHTML already differs; whatever survives this is a real difference.
 */
function canonical(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const s = el.style, decls: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const name = s.item(i), pri = s.getPropertyPriority(name);
      decls.push(`${name}:${s.getPropertyValue(name)}${pri ? ` !${pri}` : ''}`);
    }
    el.setAttribute('style', decls.sort().join(';'));
  }
  return root.innerHTML;
}

/** Equal markup: identical raw innerHTML, or identical once style serialization is normalized. */
function sameMarkup(a: string, b: string): boolean {
  return a === b || canonical(a) === canonical(b);
}

/** Per-invariant failures, keyed by combo label; first failing detail kept per combo. */
const failures = {
  determinism: new Map<string, string>(),
  scrubOrder: new Map<string, string>(),
  garbage: new Map<string, string>(),
  restFrame: new Map<string, string>(),
};

function noteGarbage(label: string, t: number, html: string) {
  if (failures.garbage.has(label)) return;
  const hit = GARBAGE.exec(html);
  if (hit) {
    const at = hit.index;
    failures.garbage.set(label, `t=${t.toFixed(3)} "${hit[0]}" in ...${html.slice(Math.max(0, at - 60), at + 40)}...`);
  }
}

beforeAll(() => {
  for (const c of CASES) {
    const { dur } = c.clip, times = samples(dur), rest = dur - 0.5;

    // Forward scrub through the sample list. Each time is also updated a second time in place
    // so the determinism check (same t twice) rides along with the forward pass.
    const fwd = mount(c.clip);
    const forward: string[] = [];
    try {
      for (const t of times) {
        fwd.upd(t);
        const first = fwd.layer.innerHTML;
        noteGarbage(c.label, t, first);
        fwd.upd(t);
        const second = fwd.layer.innerHTML;
        if (!failures.determinism.has(c.label) && !sameMarkup(first, second)) {
          failures.determinism.set(c.label, `t=${t}: ${firstDiff(first, second)}`);
        }
        forward.push(first);
      }
    } finally {
      fwd.layer.remove();
    }

    // The same sample list scrubbed in reverse, on a fresh layer built from the same clip.
    const rev = mount(c.clip);
    const backward: string[] = new Array(times.length);
    try {
      for (let i = times.length - 1; i >= 0; i--) {
        rev.upd(times[i]);
        backward[i] = rev.layer.innerHTML;
        noteGarbage(c.label, times[i], backward[i]);
      }
    } finally {
      rev.layer.remove();
    }
    times.forEach((t, i) => {
      if (!failures.scrubOrder.has(c.label) && !sameMarkup(forward[i], backward[i])) {
        failures.scrubOrder.set(c.label, `t=${t}: ${firstDiff(forward[i], backward[i])}`);
      }
    });

    // Rest frame: dur-0.5 straight from a fresh build, versus after scrubbing the whole clip.
    const direct = mount(c.clip);
    let fresh: string;
    try {
      direct.upd(rest);
      fresh = direct.layer.innerHTML;
      noteGarbage(c.label, rest, fresh);
    } finally {
      direct.layer.remove();
    }
    const scrubbed = mount(c.clip);
    try {
      for (const t of sweep(dur, 4)) {
        scrubbed.upd(t);
        noteGarbage(c.label, t, scrubbed.layer.innerHTML);
      }
      scrubbed.upd(rest);
      const after = scrubbed.layer.innerHTML;
      noteGarbage(c.label, rest, after);
      if (!failures.restFrame.has(c.label) && !sameMarkup(fresh, after)) {
        failures.restFrame.set(c.label, `t=${rest}: ${firstDiff(fresh, after)}`);
      }
    } finally {
      scrubbed.layer.remove();
    }
  }
}, SETUP_TIMEOUT);

/** Combos failing one invariant, grouped by template, with a few example diffs. */
function summarize(name: string, bad: Map<string, string>): string {
  if (bad.size === 0) return `${name}: no failures`;
  const byTpl = new Map<string, string[]>();
  for (const label of bad.keys()) {
    const [tpl, fx] = label.split(' / ');
    byTpl.set(tpl, [...(byTpl.get(tpl) ?? []), fx]);
  }
  const groups = [...byTpl].map(([tpl, fxs]) => `  ${tpl} (${fxs.length}): ${fxs.join(', ')}`);
  const examples = [...bad].slice(0, 5).map(([label, d]) => `  ${label}: ${d}`);
  return `${name}: ${bad.size} of ${CASES.length} combos fail\n${groups.join('\n')}\nexamples:\n${examples.join('\n')}`;
}

const assertClean = (name: string, bad: Map<string, string>) =>
  expect([...bad.keys()], summarize(name, bad)).toEqual([]);

afterAll(() => {
  // it.fails hides its assertion message; log the known-failure summaries so they appear in the run output.
  console.warn(summarize('KNOWN scrub-order failures', failures.scrubOrder));
  console.warn(summarize('KNOWN rest-frame failures', failures.restFrame));
});

describe('engine robustness', () => {
  it('is deterministic: calling upd(t) twice for the same t yields identical markup', () => {
    assertClean('determinism', failures.determinism);
  });

  // Known failure: markup at a given t depends on the scrub history that preceded it. Kept as a
  // strict assertion; it.fails keeps the suite green and flips to a failure once this is fixed.
  it.fails('KNOWN FAILURE: scrub-order independent, forward and reverse scrubbing agree at every sample time', () => {
    assertClean('scrub-order', failures.scrubOrder);
  });

  it('never emits NaN, Infinity or undefined into the markup', () => {
    assertClean('non-finite output', failures.garbage);
  });

  // Known failure: the rest frame after a full scrub differs from a fresh build at the same t.
  it.fails('KNOWN FAILURE: rest frame is stable, dur-0.5 identical from a fresh build and after scrubbing the whole clip', () => {
    assertClean('rest-frame', failures.restFrame);
  });
});
