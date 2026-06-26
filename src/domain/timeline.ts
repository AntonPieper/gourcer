import md5 from 'blueimp-md5';
import type {
  ChangeKind,
  CommitEvent,
  FileNode,
  ParsedSidecar,
  SemanticGroup,
} from './sidecar';

export type Point = {
  x: number;
  y: number;
};

export type TimelineFrameOptions = {
  beamDurationHours?: number;
  legendWindowDays?: number;
};

export type FrameLanguage = {
  color: string;
  fileCount: number;
  icon: string;
  name: string;
};

export type FrameGroup = {
  color: string;
  fileCount: number;
  id: string;
  shape: {
    center: Point;
    height: number;
    radius: number;
    width: number;
  };
  title: string;
};

export type FrameFile = {
  groupId: string | null;
  language: FileNode['language'];
  path: string;
  position: Point;
};

export type FrameContributor = {
  avatarUrl: string;
  id: string;
  name: string;
  opacity: number;
  position: Point;
  targetPath: string | null;
};

export type FrameBeam = {
  color: string;
  fromContributorId: string;
  id: string;
  intensity: number;
  kind: ChangeKind;
  toFilePath: string;
};

export type TimelineFrame = {
  backgroundColor: string;
  beams: FrameBeam[];
  captions: string[];
  contributors: FrameContributor[];
  files: FrameFile[];
  groups: FrameGroup[];
  languages: FrameLanguage[];
  progress: number;
  time: number;
};

type Layout = {
  files: Record<string, Point>;
  groups: Record<string, FrameGroup>;
};

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

export function buildTimelineFrame(
  sidecar: ParsedSidecar,
  time: number,
  options: TimelineFrameOptions = {},
): TimelineFrame {
  const progress = timelineProgress(sidecar, time);
  const layout = buildGraphLayout(sidecar);
  const legendWindowMs = (options.legendWindowDays ?? 7) * dayMs;
  const beamDurationMs = (options.beamDurationHours ?? 18) * hourMs;

  return {
    backgroundColor: interpolatePalette(sidecar.settings.backgroundColors, progress),
    beams: beamsAt(sidecar.commits, time, beamDurationMs),
    captions: sidecar.captions
      .filter((caption) => caption.start <= time && time <= caption.end)
      .map((caption) => caption.text),
    contributors: contributorsAt(sidecar, layout, time),
    files: Object.values(sidecar.files).map((file) => ({
      groupId: file.groupId,
      language: file.language,
      path: file.path,
      position: layout.files[file.path] ?? { x: 0, y: 0 },
    })),
    groups: sidecar.groups.map((group) => layout.groups[group.id]).filter(isPresent),
    languages: languagesAt(sidecar, time, legendWindowMs),
    progress,
    time,
  };
}

function timelineProgress(sidecar: ParsedSidecar, time: number) {
  const duration = sidecar.timeline.end - sidecar.timeline.start;

  if (duration <= 0) {
    return 0;
  }

  return clamp((time - sidecar.timeline.start) / duration, 0, 1);
}

function buildGraphLayout(sidecar: ParsedSidecar): Layout {
  const groupCount = Math.max(sidecar.groups.length, 1);
  const groupRadius = Math.max(5, groupCount * 2.4);
  const groups: Record<string, FrameGroup> = {};
  const files: Record<string, Point> = {};

  sidecar.groups.forEach((group, groupIndex) => {
    const center = pointOnCircle(groupRadius, angleFor(groupIndex, groupCount) - Math.PI / 2);
    const radius = round(Math.max(1.8, 1.1 + Math.sqrt(group.filePaths.length) * 0.95));

    groups[group.id] = {
      color: group.color,
      fileCount: group.filePaths.length,
      id: group.id,
      shape: {
        center,
        height: round(radius * 1.55),
        radius,
        width: round(radius * 2.35),
      },
      title: group.title,
    };

    placeFiles(group, center, radius, files);
  });

  const ungroupedFiles = Object.values(sidecar.files).filter((file) => !file.groupId);
  ungroupedFiles.forEach((file, index) => {
    files[file.path] = pointOnCircle(1.8 + index * 0.18, angleFor(index, ungroupedFiles.length));
  });

  return { files, groups };
}

function placeFiles(
  group: SemanticGroup,
  center: Point,
  groupRadius: number,
  files: Record<string, Point>,
) {
  const distance = Math.max(0.7, groupRadius * 0.42);

  group.filePaths.forEach((path, index) => {
    const offset = pointOnCircle(distance, angleFor(index, group.filePaths.length));
    files[path] = {
      x: round(center.x + offset.x),
      y: round(center.y + offset.y),
    };
  });
}

function contributorsAt(
  sidecar: ParsedSidecar,
  layout: Layout,
  time: number,
): FrameContributor[] {
  const pulseWindowMs = sidecar.settings.pulseWindowDays * dayMs;

  return Object.values(sidecar.contributors)
    .map((contributor, index) => {
      const nextPulse = nextPulseFor(sidecar.commits, contributor.id, time);
      const opacity =
        nextPulse && nextPulse.timestamp - time <= pulseWindowMs
          ? round(1 - (nextPulse.timestamp - time) / pulseWindowMs)
          : 0;
      const targetPath = opacity > 0 ? nextPulse?.filePath ?? null : null;
      const targetPosition = targetPath ? layout.files[targetPath] : undefined;
      const contributorAngle = angleFor(index, Math.max(Object.keys(sidecar.contributors).length, 1));
      const anchor = targetPosition ?? pointOnCircle(6.2, contributorAngle);
      const drift = pointOnCircle(0.75, contributorAngle + time / (dayMs * 1.7));

      return {
        avatarUrl: gravatarUrl(contributor.email),
        id: contributor.id,
        name: contributor.name,
        opacity,
        position: {
          x: round(anchor.x + drift.x),
          y: round(anchor.y + drift.y),
        },
        targetPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nextPulseFor(commits: CommitEvent[], contributorId: string, time: number) {
  for (const commit of commits) {
    if (commit.timestamp < time || commit.author.id !== contributorId) {
      continue;
    }

    const firstChange = commit.changes[0];

    if (!firstChange) {
      continue;
    }

    return {
      filePath: firstChange.filePath,
      timestamp: commit.timestamp,
    };
  }

  return null;
}

function languagesAt(
  sidecar: ParsedSidecar,
  time: number,
  legendWindowMs: number,
): FrameLanguage[] {
  const filesByLanguage = new Map<string, Set<string>>();

  sidecar.commits
    .filter((commit) => Math.abs(commit.timestamp - time) <= legendWindowMs)
    .forEach((commit) => {
      commit.changes.forEach((change) => {
        const file = sidecar.files[change.filePath];

        if (!file) {
          return;
        }

        const filePaths = filesByLanguage.get(file.language.name) ?? new Set<string>();
        filePaths.add(file.path);
        filesByLanguage.set(file.language.name, filePaths);
      });
    });

  return Array.from(filesByLanguage.entries())
    .map(([name, filePaths]) => {
      const firstFilePath = filePaths.values().next().value as string | undefined;
      const file = firstFilePath ? sidecar.files[firstFilePath] : undefined;

      return {
        color: file?.language.color ?? '#8b98ad',
        fileCount: filePaths.size,
        icon: file?.language.icon ?? '',
        name,
      };
    })
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
}

function beamsAt(commits: CommitEvent[], time: number, beamDurationMs: number): FrameBeam[] {
  return commits.flatMap((commit) => {
    const distance = Math.abs(commit.timestamp - time);

    if (distance > beamDurationMs / 2) {
      return [];
    }

    const intensity = round(1 - distance / (beamDurationMs / 2));

    return commit.changes.map((change, index) => ({
      color: change.beamColor,
      fromContributorId: commit.author.id,
      id: `${commit.id}:${index}`,
      intensity,
      kind: change.kind,
      toFilePath: change.filePath,
    }));
  });
}

function gravatarUrl(email: string) {
  return `https://www.gravatar.com/avatar/${md5(email)}?d=identicon&s=96`;
}

function interpolatePalette(colors: string[], progress: number) {
  if (colors.length === 0) {
    return '#0b0d12';
  }

  if (colors.length === 1) {
    return colors[0] ?? '#0b0d12';
  }

  const scaled = progress * (colors.length - 1);
  const index = Math.floor(scaled);
  const nextIndex = Math.min(index + 1, colors.length - 1);
  const localProgress = scaled - index;

  return interpolateHexColor(
    colors[index] ?? colors[0] ?? '#0b0d12',
    colors[nextIndex] ?? colors[index] ?? '#0b0d12',
    localProgress,
  );
}

function interpolateHexColor(from: string, to: string, progress: number) {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);

  return rgbToHex({
    b: Math.round(fromRgb.b + (toRgb.b - fromRgb.b) * progress),
    g: Math.round(fromRgb.g + (toRgb.g - fromRgb.g) * progress),
    r: Math.round(fromRgb.r + (toRgb.r - fromRgb.r) * progress),
  });
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');

  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function rgbToHex({ b, g, r }: { b: number; g: number; r: number }) {
  const channel = (value: number) => value.toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function pointOnCircle(radius: number, angle: number): Point {
  return {
    x: round(Math.cos(angle) * radius),
    y: round(Math.sin(angle) * radius),
  };
}

function angleFor(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (Math.PI * 2 * index) / total;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
