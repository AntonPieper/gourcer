import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSidecar, type RawSidecar } from './sidecar';
import { buildTimelineFrame, type FrameFile, type Point } from './timeline';

describe('buildTimelineFrame', () => {
  it('builds time-aware captions, legends, contributor anticipation, beams, and background color', () => {
    const sidecar = parseSidecar({
      settings: {
        backgroundColors: ['#001122', '#224466'],
        pulseWindowDays: 14,
      },
      groups: [
        {
          color: '#19324f',
          id: 'ui',
          pathPrefixes: ['src/ui/'],
          title: 'Interface',
        },
        {
          color: '#2d4f32',
          id: 'engine',
          pathPrefixes: ['src/engine/'],
          title: 'Engine',
        },
      ],
      captions: [
        {
          end: '2026-01-05T00:00:00.000Z',
          start: '2026-01-02T00:00:00.000Z',
          text: 'The interface appears.',
        },
      ],
      commits: [
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ additions: 40, deletions: 5, kind: 'add', path: 'src/ui/App.tsx' }],
          id: 'c1',
          message: 'Start UI',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          author: { email: 'grace@example.com', name: 'Grace' },
          changes: [
            { additions: 2, deletions: 3, kind: 'modify', path: 'src/engine/timeline.ts' },
          ],
          id: 'c2',
          message: 'Tune engine',
          timestamp: '2026-01-06T00:00:00.000Z',
        },
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ additions: 0, deletions: 90, kind: 'delete', path: 'src/ui/OldPanel.tsx' }],
          id: 'c3',
          message: 'Remove old panel',
          timestamp: '2026-01-10T00:00:00.000Z',
        },
      ],
    });

    const frame = buildTimelineFrame(sidecar, Date.parse('2026-01-03T00:00:00.000Z'), {
      beamDurationHours: 24,
      legendWindowDays: 7,
    });

    expect(frame.captions).toEqual(['The interface appears.']);
    expect(frame.backgroundColor).toBe('#081c31');
    expect(frame.languages.map((language) => language.name)).toEqual(['TypeScript']);
    expect(frame.directories.map((directory) => directory.path)).toEqual(
      expect.arrayContaining(['src', 'src/ui', 'src/engine']),
    );
    expect(frame.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'dir:src', targetId: 'dir:src/ui' }),
        expect.objectContaining({ sourceId: 'dir:src/ui', targetId: 'file:src/ui/App.tsx' }),
      ]),
    );
    expect(frame.bounds.width).toBeLessThanOrEqual(60);
    expect(frame.bounds.height).toBeLessThanOrEqual(42);
    expect(frame.groups).toEqual([
      expect.objectContaining({
        fileCount: 2,
        id: 'ui',
        shape: expect.objectContaining({
          radius: expect.any(Number),
        }),
        title: 'Interface',
      }),
      expect.objectContaining({
        fileCount: 1,
        id: 'engine',
        title: 'Engine',
      }),
    ]);

    const ada = frame.contributors.find((contributor) => contributor.name === 'Ada');
    const grace = frame.contributors.find((contributor) => contributor.name === 'Grace');

    expect(ada).toMatchObject({
      avatarUrl:
        'https://www.gravatar.com/avatar/3e3417d7ef77d5932a6734b916515ed5?d=identicon&s=96',
      opacity: 0.86,
      targetPath: 'src/ui/OldPanel.tsx',
    });
    expect(grace).toMatchObject({
      opacity: 0.79,
      targetPath: 'src/engine/timeline.ts',
    });

    const pulseFrame = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-06T00:00:00.000Z'),
      { beamDurationHours: 24, legendWindowDays: 7 },
    );

    expect(pulseFrame.beams).toEqual([
      expect.objectContaining({
        color: '#ffad4d',
        fromContributorId: 'grace@example.com',
        strength: 0.42,
        toFilePath: 'src/engine/timeline.ts',
      }),
    ]);

    const afterAllPulses = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-25T00:00:00.000Z'),
    );

    expect(afterAllPulses.contributors.every((contributor) => contributor.opacity === 0)).toBe(
      true,
    );
  });

  it('initializes pre-existing files at timeline start and tears down deleted files over time', () => {
    const sidecar = parseSidecar({
      initialFiles: ['src/existing.ts', 'src/removed.ts'],
      commits: [
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [
            { additions: 3, deletions: 1, kind: 'modify', path: 'src/existing.ts' },
            { additions: 0, deletions: 20, kind: 'delete', path: 'src/removed.ts' },
            { additions: 7, deletions: 0, kind: 'add', path: 'src/new.ts' },
          ],
          id: 'c1',
          message: 'Change files',
          timestamp: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    const startFrame = buildTimelineFrame(sidecar, sidecar.timeline.start);
    expect(startFrame.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['src/existing.ts', 'src/removed.ts', 'src/new.ts']),
    );

    const laterFrame = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-05T00:00:00.000Z'),
    );

    expect(laterFrame.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['src/existing.ts', 'src/new.ts']),
    );
    expect(laterFrame.files.some((file) => file.path === 'src/removed.ts')).toBe(false);
  });

  it('keeps the generated repository layout readable without overlapping file nodes', () => {
    const sidecar = parseSidecar(
      JSON.parse(
        readFileSync(join(process.cwd(), 'public/sidecars/hell-ui.json'), 'utf8'),
      ) as RawSidecar,
    );
    const frame = buildTimelineFrame(
      sidecar,
      sidecar.timeline.start + (sidecar.timeline.end - sidecar.timeline.start) * 0.75,
    );

    expect(minimumFileDistance(frame.files)).toBeGreaterThanOrEqual(0.5);
    expect(minimumFileClearance(frame.files)).toBeGreaterThanOrEqual(0.05);
  });

  it('renders commit lasers only after the pulse and keeps them ephemeral', () => {
    const sidecar = parseSidecar({
      commits: [
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ additions: 12, deletions: 1, kind: 'modify', path: 'src/app.ts' }],
          id: 'c1',
          message: 'Change app',
          timestamp: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    const beforePulse = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-01T23:40:00.000Z'),
      { beamDurationHours: 1 },
    );
    expect(beforePulse.beams).toEqual([]);

    const duringPulse = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-02T00:20:00.000Z'),
      { beamDurationHours: 1 },
    );
    expect(duringPulse.beams).toHaveLength(1);
    expect(duringPulse.beams[0]?.intensity).toBeGreaterThanOrEqual(0.2);

    const afterPulse = buildTimelineFrame(
      sidecar,
      Date.parse('2026-01-02T01:01:00.000Z'),
      { beamDurationHours: 1 },
    );
    expect(afterPulse.beams).toEqual([]);
  });

  it('moves contributors continuously through a commit instead of teleporting', () => {
    const sidecar = parseSidecar({
      settings: {
        pulseWindowDays: 14,
      },
      commits: [
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ additions: 10, deletions: 0, kind: 'add', path: 'src/alpha.ts' }],
          id: 'c1',
          message: 'Alpha',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ additions: 4, deletions: 2, kind: 'modify', path: 'src/beta.ts' }],
          id: 'c2',
          message: 'Beta',
          timestamp: '2026-01-15T00:00:00.000Z',
        },
      ],
    });

    const before = buildTimelineFrame(sidecar, Date.parse('2026-01-14T23:59:00.000Z'));
    const after = buildTimelineFrame(sidecar, Date.parse('2026-01-15T00:01:00.000Z'));
    const beforeAda = before.contributors.find((contributor) => contributor.name === 'Ada');
    const afterAda = after.contributors.find((contributor) => contributor.name === 'Ada');

    expect(beforeAda).toBeDefined();
    expect(afterAda).toBeDefined();
    expect(distanceBetween(beforeAda!.position, afterAda!.position)).toBeLessThan(0.85);
  });
});

function minimumFileDistance(files: FrameFile[]) {
  return minimumFileMetric(files, (first, second, distance) => distance);
}

function minimumFileClearance(files: FrameFile[]) {
  return minimumFileMetric(
    files,
    (first, second, distance) => distance - first.radius - second.radius,
  );
}

function minimumFileMetric(
  files: FrameFile[],
  metric: (first: FrameFile, second: FrameFile, distance: number) => number,
) {
  let minimum = Infinity;

  for (let firstIndex = 0; firstIndex < files.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < files.length; secondIndex += 1) {
      const first = files[firstIndex];
      const second = files[secondIndex];

      if (!first || !second) {
        continue;
      }

      minimum = Math.min(
        minimum,
        metric(first, second, distanceBetween(first.position, second.position)),
      );
    }
  }

  return minimum;
}

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
