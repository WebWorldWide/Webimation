// Timeline interchange files, so a whole episode's graphics drop into an editor already in place.
//   FCPXML 1.8  → DaVinci Resolve, Final Cut Pro            (File → Import → Timeline)
//   FCP7 xmeml  → Adobe Premiere Pro, DaVinci Resolve       (File → Import)
// Every item is a rendered movie placed at its frame on the timeline, one lane per layer.
export interface TimelineItem {
  name: string;
  /** File name inside the export folder (movies) — the folder itself is `dir`. */
  file: string;
  /** Position on the timeline and length, in frames at `fps`. */
  start: number;
  frames: number;
  /** 0 = lowest video track. */
  lane: number;
}
export interface TimelineSpec { name: string; dir: string; fps: number; width: number; height: number; items: TimelineItem[] }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** file:// URL for an absolute path on any OS. */
export function fileUrl(dir: string, file: string): string {
  const p = (dir.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + file).split('/').map(encodeURIComponent).join('/');
  return 'file://' + (p.startsWith('/') ? '' : '/') + p.replace(/^%2F/, '/').replace(/^([A-Za-z])%3A/, '$1:');
}

const end = (s: TimelineSpec) => Math.max(1, ...s.items.map(i => i.start + i.frames));
const nominal = (fps: number) => Math.round(fps);

export function fcpxml(s: TimelineSpec): string {
  const fd = `1/${s.fps}s`, t = (f: number) => `${f}/${s.fps}s`;
  const items = s.items.map((it, i) => ({ ...it, id: `a${i + 1}` }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" name="FFVideoFormatCustom" frameDuration="${fd}" width="${s.width}" height="${s.height}" colorSpace="1-1-1 (Rec. 709)"/>
${items.map(it => `    <asset id="${it.id}" name="${esc(it.name)}" uid="${esc(it.file)}" src="${esc(fileUrl(s.dir, it.file))}" start="0s" duration="${t(it.frames)}" hasVideo="1" format="r1"/>`).join('\n')}
  </resources>
  <library>
    <event name="${esc(s.name)}">
      <project name="${esc(s.name)}">
        <sequence format="r1" duration="${t(end(s))}" tcStart="0s" tcFormat="NDF">
          <spine>
            <gap name="Gap" offset="0s" start="0s" duration="${t(end(s))}">
${items.map(it => `              <asset-clip ref="${it.id}" lane="${it.lane + 1}" offset="${t(it.start)}" name="${esc(it.name)}" start="0s" duration="${t(it.frames)}"/>`).join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export function xmeml(s: TimelineSpec): string {
  const tb = nominal(s.fps), ntsc = Math.abs(s.fps - tb) > 0.01 ? 'TRUE' : 'FALSE';
  const rate = `<rate><timebase>${tb}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const lanes = Math.max(0, ...s.items.map(i => i.lane)) + 1;
  const track = (lane: number) => `        <track>
${s.items.filter(i => i.lane === lane).sort((a, b) => a.start - b.start).map(it => {
    const n = s.items.indexOf(it) + 1;
    return `          <clipitem id="clip-${n}">
            <name>${esc(it.name)}</name>
            <duration>${it.frames}</duration>
            ${rate}
            <start>${it.start}</start>
            <end>${it.start + it.frames}</end>
            <in>0</in>
            <out>${it.frames}</out>
            <file id="file-${n}">
              <name>${esc(it.file)}</name>
              <pathurl>${esc(fileUrl(s.dir, it.file))}</pathurl>
              ${rate}
              <duration>${it.frames}</duration>
              <media><video><samplecharacteristics>${rate}<width>${s.width}</width><height>${s.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video></media>
            </file>
          </clipitem>`;
  }).join('\n')}
        </track>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${esc(s.name)}</name>
    <duration>${end(s)}</duration>
    ${rate}
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${s.width}</width><height>${s.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${Array.from({ length: lanes }, (_, l) => track(l)).join('\n')}
      </video>
    </media>
  </sequence>
</xmeml>
`;
}

export const readme = (s: TimelineSpec) => `${s.name} — graphics for your video editor
${'='.repeat(s.name.length + 31)}

Every graphic is a transparent movie, already placed where it sits on your Webimation timeline.

Premiere Pro   File → Import → ${s.name}.xml
DaVinci Resolve   File → Import → Timeline → ${s.name}.fcpxml
Final Cut Pro   File → Import → XML → ${s.name}.fcpxml
CapCut / Others   Drag the .mov (or .webm) files onto a track above your footage and
                  place each at the time listed below.

Keep this folder together: the timeline files point at the movies next to them.
Then copy the imported clips onto a track above your footage (or paste them over your edit).

Frame rate ${s.fps} · ${s.width}x${s.height}

${s.items.slice().sort((a, b) => a.start - b.start).map(i => `${tc(i.start, s.fps)}  ${i.file}`).join('\n')}
`;

export const tc = (f: number, fps: number) => {
  const b = nominal(fps), p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / b / 3600))}:${p(Math.floor(f / b / 60) % 60)}:${p(Math.floor(f / b) % 60)}:${p(f % b)}`;
};
