import { describe, expect, it } from 'vitest';
import { sidecarFromGitNameStatusLog } from './git-sidecar';

describe('sidecarFromGitNameStatusLog', () => {
  it('turns git name-status output into sidecar data with configured semantic groups', () => {
    const sidecar = sidecarFromGitNameStatusLog(
      [
        '\u001eca1\u001fAda\u001fada@example.com\u001f2026-01-01T00:00:00+00:00\u001fAdd UI',
        'A\tpackages/angular/src/button.ts',
        'M\tdocs/adr/rendering.md',
        '\u001ecb2\u001fGrace\u001fgrace@example.com\u001f2026-01-03T00:00:00+00:00\u001fRemove draft',
        'D\tpackages/angular/src/draft.ts',
        'R100\told/path.ts\tpackages/angular/src/new-path.ts',
      ].join('\n'),
      {
        captions: [
          {
            end: '2026-01-05T00:00:00.000Z',
            start: '2026-01-01T00:00:00.000Z',
            text: 'The public package takes shape.',
          },
        ],
        groups: [
          {
            color: '#244f75',
            id: 'package-angular',
            pathPrefixes: ['packages/angular/'],
            title: 'Angular Package',
          },
          {
            color: '#5b3f77',
            id: 'docs',
            pathPrefixes: ['docs/'],
            title: 'Docs',
          },
        ],
      },
    );

    expect(sidecar.groups).toHaveLength(2);
    expect(sidecar.captions).toEqual([
      {
        end: '2026-01-05T00:00:00.000Z',
        start: '2026-01-01T00:00:00.000Z',
        text: 'The public package takes shape.',
      },
    ]);
    expect(sidecar.commits).toEqual([
      {
        author: { email: 'ada@example.com', name: 'Ada' },
        changes: [
          { additions: 1, deletions: 0, kind: 'add', path: 'packages/angular/src/button.ts' },
          { additions: 1, deletions: 0, kind: 'modify', path: 'docs/adr/rendering.md' },
        ],
        id: 'ca1',
        message: 'Add UI',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        author: { email: 'grace@example.com', name: 'Grace' },
        changes: [
          { additions: 1, deletions: 0, kind: 'delete', path: 'packages/angular/src/draft.ts' },
          {
            additions: 1,
            deletions: 0,
            kind: 'modify',
            path: 'packages/angular/src/new-path.ts',
            previousPath: 'old/path.ts',
          },
        ],
        id: 'cb2',
        message: 'Remove draft',
        timestamp: '2026-01-03T00:00:00.000Z',
      },
    ]);
  });
});
