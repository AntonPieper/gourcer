import {
  canonicalLanguageForExtension,
  extensionForPath,
  type LanguageMetadata,
} from './languages';

export type ChangeKind = 'add' | 'delete' | 'modify';

export type RawSidecar = {
  captions?: RawCaption[];
  commits: RawCommit[];
  groups?: RawGroup[];
  languages?: Record<string, Partial<Omit<LanguageMetadata, 'extension'>>>;
  settings?: Partial<SidecarSettings>;
};

export type RawCaption = {
  end: string;
  start: string;
  text: string;
};

export type RawCommit = {
  author: {
    email: string;
    name: string;
  };
  changes: Array<{
    kind: ChangeKind;
    path: string;
  }>;
  id: string;
  message: string;
  timestamp: string;
};

export type RawGroup = {
  color: string;
  id: string;
  pathPrefixes: string[];
  title: string;
};

export type SidecarSettings = {
  backgroundColors: string[];
  pulseWindowDays: number;
};

export type TimelineRange = {
  end: number;
  start: number;
};

export type Caption = {
  end: number;
  start: number;
  text: string;
};

export type Contributor = {
  email: string;
  id: string;
  name: string;
};

export type SemanticGroup = RawGroup & {
  filePaths: string[];
};

export type FileNode = {
  groupId: string | null;
  language: LanguageMetadata;
  path: string;
};

export type ChangePulse = {
  beamColor: string;
  filePath: string;
  kind: ChangeKind;
};

export type CommitEvent = {
  author: Contributor;
  changes: ChangePulse[];
  id: string;
  message: string;
  timestamp: number;
};

export type ParsedSidecar = {
  captions: Caption[];
  commits: CommitEvent[];
  contributors: Record<string, Contributor>;
  files: Record<string, FileNode>;
  groups: SemanticGroup[];
  settings: SidecarSettings;
  timeline: TimelineRange;
};

const defaultSettings: SidecarSettings = {
  backgroundColors: ['#0b0d12', '#102030', '#161125', '#0f1f1a'],
  pulseWindowDays: 14,
};

const beamColors: Record<ChangeKind, string> = {
  add: '#3ddc84',
  delete: '#ff5c7a',
  modify: '#ffad4d',
};

export function parseSidecar(raw: RawSidecar): ParsedSidecar {
  const settings = {
    ...defaultSettings,
    ...raw.settings,
  };
  const groups = (raw.groups ?? []).map((group) => ({
    ...group,
    filePaths: [] as string[],
  }));
  const files: Record<string, FileNode> = {};
  const contributors: Record<string, Contributor> = {};
  const languageOverrides = normalizeLanguageOverrides(raw.languages ?? {});

  const commits = raw.commits.map((commit) => {
    const author = normalizeContributor(commit.author);
    contributors[author.id] = author;

    return {
      author,
      changes: commit.changes.map((change) => {
        if (!files[change.path]) {
          const group = groupForPath(change.path, groups);
          const file: FileNode = {
            groupId: group?.id ?? null,
            language: canonicalLanguageForExtension(
              extensionForPath(change.path),
              languageOverrides,
            ),
            path: change.path,
          };

          files[change.path] = file;
          group?.filePaths.push(change.path);
        }

        return {
          beamColor: beamColors[change.kind],
          filePath: change.path,
          kind: change.kind,
        };
      }),
      id: commit.id,
      message: commit.message,
      timestamp: Date.parse(commit.timestamp),
    };
  });

  commits.sort((a, b) => a.timestamp - b.timestamp);

  return {
    captions: (raw.captions ?? []).map((caption) => ({
      end: Date.parse(caption.end),
      start: Date.parse(caption.start),
      text: caption.text,
    })),
    commits,
    contributors,
    files,
    groups,
    settings,
    timeline: timelineFor(commits),
  };
}

function normalizeContributor(author: RawCommit['author']): Contributor {
  const email = author.email.trim().toLowerCase();

  return {
    email,
    id: email,
    name: author.name.trim(),
  };
}

function normalizeLanguageOverrides(
  languages: NonNullable<RawSidecar['languages']>,
) {
  return Object.fromEntries(
    Object.entries(languages).map(([extension, language]) => [
      extension.toLowerCase(),
      language,
    ]),
  );
}

function groupForPath(path: string, groups: SemanticGroup[]) {
  return groups.find((group) =>
    group.pathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
}

function timelineFor(commits: CommitEvent[]): TimelineRange {
  if (commits.length === 0) {
    const now = Date.now();
    return { end: now, start: now };
  }

  const firstCommit = commits[0];
  const lastCommit = commits[commits.length - 1];

  if (!firstCommit || !lastCommit) {
    const now = Date.now();
    return { end: now, start: now };
  }

  return {
    end: lastCommit.timestamp,
    start: firstCommit.timestamp,
  };
}
