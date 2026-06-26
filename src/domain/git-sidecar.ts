import type { RawCaption, RawGroup, RawSidecar } from './sidecar';

export type GitSidecarOptions = {
  backgroundColors?: string[];
  captions?: RawCaption[];
  groups?: RawGroup[];
  maxCommits?: number;
  pulseWindowDays?: number;
};

const commitSeparator = '\u001e';
const fieldSeparator = '\u001f';

export function sidecarFromGitNameStatusLog(
  log: string,
  options: GitSidecarOptions = {},
): RawSidecar {
  return sidecarFromGitLogs(log, '', options);
}

export function sidecarFromGitLogs(
  nameStatusLog: string,
  numstatLog: string,
  options: GitSidecarOptions = {},
): RawSidecar {
  const stats = parseNumstatLog(numstatLog);
  const commits = nameStatusLog
    .split(commitSeparator)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseCommitEntry(entry, stats))
    .filter((commit) => commit.changes.length > 0);

  return rawSidecarFor(commits, options);
}

function rawSidecarFor(
  commits: RawSidecar['commits'],
  options: GitSidecarOptions,
): RawSidecar {
  return {
    captions: options.captions ?? captionsFor(commits),
    commits: options.maxCommits ? commits.slice(-options.maxCommits) : commits,
    groups: options.groups ?? groupsFor(commits),
    settings: {
      backgroundColors:
        options.backgroundColors ?? ['#0b0d12', '#102030', '#16213c', '#141b2d'],
      pulseWindowDays: options.pulseWindowDays ?? 14,
    },
  };
}

function parseCommitEntry(
  entry: string,
  stats: Map<string, Map<string, { additions: number; deletions: number }>>,
): RawSidecar['commits'][number] {
  const [headerLine = '', ...changeLines] = entry.split('\n');
  const [id = '', name = 'Unknown', email = '', timestamp = '', ...messageParts] =
    headerLine.split(fieldSeparator);
  const commitStats = stats.get(id) ?? new Map();

  return {
    author: {
      email,
      name,
    },
    changes: changeLines
      .map((line) => parseChangeLine(line, commitStats))
      .filter(isPresent),
    id,
    message: messageParts.join(fieldSeparator),
    timestamp: new Date(timestamp).toISOString(),
  };
}

function parseChangeLine(
  line: string,
  stats: Map<string, { additions: number; deletions: number }>,
) {
  const [status = '', firstPath = '', secondPath] = line.split('\t');
  const statusKind = status.at(0);
  const path = secondPath ?? firstPath;
  const changeStats = stats.get(path) ?? stats.get(firstPath) ?? {
    additions: 1,
    deletions: 0,
  };

  if (!path) {
    return null;
  }

  if (statusKind === 'A') {
    return { ...changeStats, kind: 'add' as const, path };
  }

  if (statusKind === 'D') {
    return { ...changeStats, kind: 'delete' as const, path };
  }

  if (statusKind === 'R') {
    return {
      ...changeStats,
      kind: 'modify' as const,
      path,
      previousPath: firstPath,
    };
  }

  return { ...changeStats, kind: 'modify' as const, path };
}

function parseNumstatLog(log: string) {
  const stats = new Map<string, Map<string, { additions: number; deletions: number }>>();

  log
    .split(commitSeparator)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [headerLine = '', ...lines] = entry.split('\n');
      const [id = ''] = headerLine.split(fieldSeparator);
      const commitStats = new Map<string, { additions: number; deletions: number }>();

      lines.forEach((line) => {
        const [rawAdditions = '0', rawDeletions = '0', rawPath = ''] = line.split('\t');
        const path = normalizeNumstatPath(rawPath);

        if (!path) {
          return;
        }

        commitStats.set(path, {
          additions: parseStat(rawAdditions),
          deletions: parseStat(rawDeletions),
        });
      });

      stats.set(id, commitStats);
    });

  return stats;
}

function normalizeNumstatPath(path: string) {
  const braceRename = /^(.*)\{(.+) => (.+)\}(.*)$/.exec(path);

  if (!braceRename) {
    return path;
  }

  return `${braceRename[1] ?? ''}${braceRename[3] ?? ''}${braceRename[4] ?? ''}`;
}

function parseStat(value: string) {
  return value === '-' ? 1 : Number.parseInt(value, 10) || 0;
}

function groupsFor(commits: RawSidecar['commits']): RawGroup[] {
  const candidateGroups: RawGroup[] = [
    {
      color: '#24526f',
      id: 'apps',
      pathPrefixes: ['apps/'],
      title: 'Apps',
    },
    {
      color: '#425f35',
      id: 'packages',
      pathPrefixes: ['packages/'],
      title: 'Packages',
    },
    {
      color: '#68406f',
      id: 'docs',
      pathPrefixes: ['docs/', 'README.md', 'CONTEXT.md', 'DESIGN.md'],
      title: 'Docs',
    },
    {
      color: '#73522f',
      id: 'automation',
      pathPrefixes: ['tools/', '.github/', '.gitlab-ci.yml'],
      title: 'Automation',
    },
    {
      color: '#3d4e75',
      id: 'tests',
      pathPrefixes: ['e2e/', 'test/', 'tests/'],
      title: 'Tests',
    },
    {
      color: '#65364a',
      id: 'config',
      pathPrefixes: [
        'package.json',
        'pnpm-lock.yaml',
        'tsconfig',
        'vite.config',
        'vitest.config',
        'playwright.config',
        'eslint.config',
      ],
      title: 'Config',
    },
  ];
  const touchedPaths = new Set(
    commits.flatMap((commit) => commit.changes.map((change) => change.path)),
  );

  return candidateGroups.filter((group) =>
    group.pathPrefixes.some((prefix) =>
      Array.from(touchedPaths).some((path) => path.startsWith(prefix)),
    ),
  );
}

function captionsFor(commits: RawSidecar['commits']): RawCaption[] {
  if (commits.length === 0) {
    return [];
  }

  const first = commits[0];
  const last = commits[commits.length - 1];

  if (!first || !last) {
    return [];
  }

  return [
    {
      end: last.timestamp,
      start: first.timestamp,
      text: 'Repository history from first captured change to latest commit.',
    },
  ];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
