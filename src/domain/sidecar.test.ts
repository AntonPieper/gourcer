import { describe, expect, it } from 'vitest';
import { parseSidecar } from './sidecar';

describe('parseSidecar', () => {
  it('normalizes sidecar data into canonical languages, groups, and timeline bounds', () => {
    const sidecar = parseSidecar({
      settings: {
        pulseWindowDays: 14,
      },
      languages: {
        '.tsx': {
          color: '#3178c6',
          icon: '<svg viewBox="0 0 16 16"><text x="2" y="12">TS</text></svg>',
          name: 'TypeScript',
        },
      },
      groups: [
        {
          color: '#173f5f',
          id: 'ui',
          pathPrefixes: ['src/ui/'],
          title: 'Interface',
        },
      ],
      captions: [
        {
          end: '2026-01-08T00:00:00.000Z',
          start: '2026-01-01T00:00:00.000Z',
          text: 'The first renderer lands.',
        },
      ],
      commits: [
        {
          author: {
            email: 'Ada@example.com',
            name: 'Ada Lovelace',
          },
          id: 'a1',
          message: 'Add renderer',
          timestamp: '2026-01-01T12:00:00.000Z',
          changes: [
            {
              kind: 'add',
              path: 'src/ui/App.tsx',
            },
          ],
        },
        {
          author: {
            email: 'Ada@example.com',
            name: 'Ada Lovelace',
          },
          id: 'b2',
          message: 'Tune renderer',
          timestamp: '2026-01-03T09:30:00.000Z',
          changes: [
            {
              kind: 'modify',
              path: 'src/ui/App.tsx',
            },
          ],
        },
      ],
    });

    expect(sidecar.timeline).toEqual({
      end: Date.parse('2026-01-03T09:30:00.000Z'),
      start: Date.parse('2026-01-01T12:00:00.000Z'),
    });
    expect(sidecar.files['src/ui/App.tsx']).toMatchObject({
      groupId: 'ui',
      language: {
        color: '#3178c6',
        extension: '.tsx',
        name: 'TypeScript',
      },
      path: 'src/ui/App.tsx',
    });
    expect(sidecar.commits[0]?.changes[0]).toMatchObject({
      beamColor: '#3ddc84',
      filePath: 'src/ui/App.tsx',
      kind: 'add',
    });
    expect(sidecar.captions[0]).toEqual({
      end: Date.parse('2026-01-08T00:00:00.000Z'),
      start: Date.parse('2026-01-01T00:00:00.000Z'),
      text: 'The first renderer lands.',
    });
  });
});
