import { describe, expect, it } from 'vitest';
import { parseSidecar } from './sidecar';
import { buildTimelineFrame } from './timeline';

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
          changes: [{ kind: 'add', path: 'src/ui/App.tsx' }],
          id: 'c1',
          message: 'Start UI',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          author: { email: 'grace@example.com', name: 'Grace' },
          changes: [{ kind: 'modify', path: 'src/engine/timeline.ts' }],
          id: 'c2',
          message: 'Tune engine',
          timestamp: '2026-01-06T00:00:00.000Z',
        },
        {
          author: { email: 'ada@example.com', name: 'Ada' },
          changes: [{ kind: 'delete', path: 'src/ui/OldPanel.tsx' }],
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
      opacity: 0.5,
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
});
