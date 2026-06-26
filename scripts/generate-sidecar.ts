import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sidecarFromGitNameStatusLog, type GitSidecarOptions } from '../src/domain/git-sidecar';

const [repoPathArg, outputPathArg, ...flags] = process.argv.slice(2);

if (!repoPathArg || !outputPathArg) {
  throw new Error(
    'Usage: tsx scripts/generate-sidecar.ts <repo-path> <output-path> [--max-commits=900] [--name=hell-ui]',
  );
}

const repoPath = resolve(repoPathArg);
const outputPath = resolve(outputPathArg);
const maxCommits = Number(readFlag(flags, 'max-commits') ?? 900);
const name = readFlag(flags, 'name') ?? 'repository';

const log = execFileSync(
  'git',
  [
    '-C',
    repoPath,
    'log',
    '--reverse',
    '--name-status',
    '--date=iso-strict',
    `--max-count=${maxCommits}`,
    '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s',
    '--',
  ],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 80 },
);

const sidecar = sidecarFromGitNameStatusLog(log, sidecarOptions(name, maxCommits));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sidecar, null, 2)}\n`);

console.log(
  `Wrote ${sidecar.commits.length} commits from ${repoPath} to ${outputPath}.`,
);

function readFlag(args: string[], name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function sidecarOptions(name: string, maxCommits: number): GitSidecarOptions {
  if (name !== 'hell-ui') {
    return { maxCommits };
  }

  return {
    backgroundColors: ['#081016', '#10243b', '#21162e', '#10261f', '#161b2b'],
    captions: [
      {
        end: '2026-01-01T00:00:00.000Z',
        start: '2024-01-01T00:00:00.000Z',
        text: 'hell-ui grows as a compact component system for dense business apps.',
      },
      {
        end: '2026-12-31T00:00:00.000Z',
        start: '2025-01-01T00:00:00.000Z',
        text: 'Tests, docs, and package automation move alongside the public UI surface.',
      },
    ],
    groups: [
      {
        color: '#24526f',
        id: 'apps-docs',
        pathPrefixes: ['apps/docs/'],
        title: 'Docs App',
      },
      {
        color: '#476833',
        id: 'angular-package',
        pathPrefixes: ['packages/angular/'],
        title: 'Angular Package',
      },
      {
        color: '#745437',
        id: 'pdf-viewer',
        pathPrefixes: ['packages/pdf-viewer/'],
        title: 'PDF Viewer',
      },
      {
        color: '#68406f',
        id: 'project-docs',
        pathPrefixes: ['docs/', 'README.md', 'CONTEXT.md', 'DESIGN.md', 'CHANGELOG.md'],
        title: 'Project Docs',
      },
      {
        color: '#73522f',
        id: 'automation',
        pathPrefixes: ['tools/', '.github/', '.gitlab-ci.yml'],
        title: 'Automation',
      },
      {
        color: '#3d4e75',
        id: 'e2e-tests',
        pathPrefixes: ['e2e/'],
        title: 'E2E Tests',
      },
      {
        color: '#65364a',
        id: 'config',
        pathPrefixes: [
          'package.json',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'tsconfig',
          'vite.config',
          'vitest.config',
          'playwright.config',
          'eslint.config',
          '.editorconfig',
          '.prettierrc',
        ],
        title: 'Config',
      },
    ],
    maxCommits,
    pulseWindowDays: 14,
  };
}
