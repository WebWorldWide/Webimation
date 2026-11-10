import { describe, expect, it } from 'vitest';
import { fcpxml, fileUrl, tc, xmeml, type TimelineSpec } from '../timelineXml';

const spec: TimelineSpec = {
  name: 'Ep 1 & more', dir: '/Users/me/My Episode', fps: 30, width: 1920, height: 1080,
  items: [
    { name: 'Lower third', file: '01-lower-third.mov', start: 90, frames: 150, lane: 0 },
    { name: 'Stat', file: '02-stat.mov', start: 600, frames: 210, lane: 1 }
  ]
};

describe('timeline interchange', () => {
  it('builds file URLs for posix and Windows paths', () => {
    expect(fileUrl('/Users/me/My Episode', 'a b.mov')).toBe('file:///Users/me/My%20Episode/a%20b.mov');
    expect(fileUrl('C:\\Users\\me\\Ep', 'a.mov')).toBe('file:///C:/Users/me/Ep/a.mov');
  });
  it('FCPXML places every clip at its frame, one lane per layer, and escapes names', () => {
    const x = fcpxml(spec);
    expect(x).toContain('offset="90/30s"');
    expect(x).toContain('lane="2" offset="600/30s"');
    expect(x).toContain('duration="810/30s"');
    expect(x).toContain('Ep 1 &amp; more');
    expect(x).toContain('src="file:///Users/me/My%20Episode/01-lower-third.mov"');
  });
  it('xmeml has one track per layer with start/end in frames', () => {
    const x = xmeml(spec);
    expect(x.match(/<track>/g)).toHaveLength(2);
    expect(x).toContain('<start>600</start>');
    expect(x).toContain('<end>810</end>');
    expect(x).toContain('<ntsc>FALSE</ntsc>');
    expect(xmeml({ ...spec, fps: 29.97 })).toContain('<ntsc>TRUE</ntsc>');
  });
  it('formats timecode', () => expect(tc(90 + 30 * 3600, 30)).toBe('01:00:03:00'));
});
