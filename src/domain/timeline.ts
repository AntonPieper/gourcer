import md5 from 'blueimp-md5';
import type {
  ChangeKind,
  CommitEvent,
  FileNode,
  ParsedSidecar,
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
  opacity: number;
  shape: {
    center: Point;
    height: number;
    radius: number;
    width: number;
  };
  title: string;
};

export type FrameDirectory = {
  depth: number;
  groupId: string | null;
  id: string;
  name: string;
  opacity: number;
  path: string;
  position: Point;
  radius: number;
};

export type FrameFile = {
  groupId: string | null;
  id: string;
  language: FileNode['language'];
  opacity: number;
  path: string;
  position: Point;
  radius: number;
};

export type FrameEdge = {
  id: string;
  opacity: number;
  sourceId: string;
  targetId: string;
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
  strength: number;
  toFilePath: string;
};

export type FrameBounds = {
  center: Point;
  height: number;
  width: number;
};

export type TimelineFrame = {
  backgroundColor: string;
  beams: FrameBeam[];
  bounds: FrameBounds;
  captions: string[];
  contributors: FrameContributor[];
  directories: FrameDirectory[];
  edges: FrameEdge[];
  files: FrameFile[];
  groups: FrameGroup[];
  languages: FrameLanguage[];
  progress: number;
  time: number;
};

type GraphNodeType = 'directory' | 'file';

type GraphNode = {
  depth: number;
  groupId: string | null;
  id: string;
  name: string;
  path: string;
  radius: number;
  type: GraphNodeType;
  x?: number;
  y?: number;
};

type GraphLink = {
  id: string;
  sourceId: string;
  targetId: string;
};

type GraphCache = {
  bounds: FrameBounds;
  directories: Record<string, GraphNode>;
  edges: GraphLink[];
  files: Record<string, GraphNode>;
  nodes: Record<string, GraphNode>;
};

type ActiveFileState = {
  file: FileNode;
  opacity: number;
};

type Lifecycle = {
  createdAt: number;
  deletedAt: number | null;
};

const activeGraphCache = new WeakMap<ParsedSidecar, Map<string, GraphCache>>();
const lifecycleCache = new WeakMap<ParsedSidecar, Map<string, Lifecycle>>();
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const fileFadeMs = 36 * hourMs;
const fileNodeRadius = 0.24;
const directoryNodeRadius = 0.18;

export function buildTimelineFrame(
  sidecar: ParsedSidecar,
  time: number,
  options: TimelineFrameOptions = {},
): TimelineFrame {
  const progress = timelineProgress(sidecar, time);
  const lifecycle = lifecycleFor(sidecar);
  const legendWindowMs = (options.legendWindowDays ?? 7) * dayMs;
  const beamDurationMs = (options.beamDurationHours ?? 18) * hourMs;
  const activeFiles = activeFileStatesAt(sidecar, lifecycle, time);
  const graph = activeGraphFor(sidecar, activeFiles);
  const files = frameFilesFor(graph, activeFiles);
  const directories = activeDirectoriesFor(graph, files);
  const edges = activeEdgesFor(graph, files, directories);

  return {
    backgroundColor: interpolatePalette(sidecar.settings.backgroundColors, progress),
    beams: beamsAt(sidecar.commits, time, beamDurationMs),
    bounds: graph.bounds,
    captions: sidecar.captions
      .filter((caption) => caption.start <= time && time <= caption.end)
      .map((caption) => caption.text),
    contributors: contributorsAt(sidecar, graph, lifecycle, time),
    directories,
    edges,
    files,
    groups: activeGroupsFor(sidecar, graph, files, directories),
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

function activeGraphFor(sidecar: ParsedSidecar, activeFiles: ActiveFileState[]): GraphCache {
  const key = activeFiles.map(({ file }) => file.path).join('\n');
  const sidecarCache = activeGraphCache.get(sidecar) ?? new Map<string, GraphCache>();
  const cached = sidecarCache.get(key);

  if (cached) {
    return cached;
  }

  const graph = computeGraphLayout(sidecar, activeFiles.map(({ file }) => file));
  sidecarCache.set(key, graph);
  activeGraphCache.set(sidecar, sidecarCache);
  return graph;
}

function computeGraphLayout(sidecar: ParsedSidecar, files: FileNode[]): GraphCache {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphLink>();
  const anchors = groupAnchors(sidecar);

  files.forEach((file) => {
    ensureDirectoryChain(file.path, file.groupId, nodes, edges, anchors);
    const seed = seedPosition(file.path, file.groupId, segmentsFor(file.path).length, anchors);
    const fileNode: GraphNode = {
      depth: segmentsFor(file.path).length,
      groupId: file.groupId,
      id: fileId(file.path),
      name: basename(file.path),
      path: file.path,
      radius: fileNodeRadius,
      type: 'file',
      x: seed.x,
      y: seed.y,
    };
    nodes.set(fileNode.id, fileNode);

    const parent = parentDirectoryPath(file.path);
    if (parent) {
      addEdge(edges, dirId(parent), fileNode.id);
    }
  });

  const nodeList = Array.from(nodes.values());
  const edgeList = Array.from(edges.values());

  enforceGourceTreeSpacing(Object.fromEntries(nodeList.map((node) => [node.id, node])), edgeList);
  normalizeNodePositions(nodeList);
  relaxTargetCollisions(nodeList);
  centerNodePositions(nodeList);

  const graph: GraphCache = {
    bounds: boundsFor(nodeList),
    directories: Object.fromEntries(
      nodeList
        .filter((node) => node.type === 'directory')
        .map((node) => [node.path, node]),
    ),
    edges: edgeList,
    files: Object.fromEntries(
      nodeList
        .filter((node) => node.type === 'file')
        .map((node) => [node.path, node]),
    ),
    nodes: Object.fromEntries(nodeList.map((node) => [node.id, node])),
  };

  return graph;
}

function ensureDirectoryChain(
  filePath: string,
  groupId: string | null,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphLink>,
  anchors: Map<string, Point>,
) {
  const segments = segmentsFor(filePath).slice(0, -1);

  segments.forEach((_, index) => {
    const path = segments.slice(0, index + 1).join('/');
    const id = dirId(path);

    if (!nodes.has(id)) {
      const seed = seedPosition(path, groupId, index + 1, anchors);
      nodes.set(id, {
        depth: index + 1,
        groupId,
        id,
        name: basename(path),
        path,
        radius: directoryNodeRadius + Math.min(index, 4) * 0.025,
        type: 'directory',
        x: seed.x,
        y: seed.y,
      });
    }

    const parent = segments.slice(0, index).join('/');
    if (parent) {
      addEdge(edges, dirId(parent), id);
    }
  });
}

function seedPosition(
  path: string,
  groupId: string | null,
  depth: number,
  anchors: Map<string, Point>,
) {
  const anchor = anchors.get(groupId ?? '') ?? { x: 0, y: 0 };
  const angle = hashAngle(path);
  const distance = 0.7 + depth * 0.62 + hashUnit(`${path}:distance`) * 1.15;

  return {
    x: round(anchor.x + Math.cos(angle) * distance + depth * 0.18),
    y: round(anchor.y + Math.sin(angle) * distance),
  };
}

function addEdge(edges: Map<string, GraphLink>, sourceId: string, targetId: string) {
  const id = `${sourceId}->${targetId}`;

  if (!edges.has(id)) {
    edges.set(id, { id, sourceId, targetId });
  }
}

function activeFileStatesAt(
  sidecar: ParsedSidecar,
  lifecycle: Map<string, Lifecycle>,
  time: number,
): ActiveFileState[] {
  return Object.values(sidecar.files)
    .map((file) => {
      const life = lifecycle.get(file.path);
      const opacity = life ? opacityForLifecycle(life, time) : 0;

      if (opacity <= 0.01) {
        return null;
      }

      return { file, opacity } satisfies ActiveFileState;
    })
    .filter(isPresent)
    .sort((a, b) => a.file.path.localeCompare(b.file.path));
}

function frameFilesFor(graph: GraphCache, activeFiles: ActiveFileState[]): FrameFile[] {
  return activeFiles
    .map(({ file, opacity }) => {
      const node = graph.files[file.path];

      if (!node) {
        return null;
      }

      return {
        groupId: file.groupId,
        id: fileId(file.path),
        language: file.language,
        opacity,
        path: file.path,
        position: pointFor(node),
        radius: node.radius,
      } satisfies FrameFile;
    })
    .filter(isPresent);
}

function activeDirectoriesFor(graph: GraphCache, files: FrameFile[]): FrameDirectory[] {
  const directories = new Map<string, FrameDirectory>();

  files.forEach((file) => {
    const segments = segmentsFor(file.path).slice(0, -1);

    segments.forEach((_, index) => {
      const path = segments.slice(0, index + 1).join('/');
      const node = graph.directories[path];

      if (!node) {
        return;
      }

      const current = directories.get(path);
      const opacity = Math.max(current?.opacity ?? 0, file.opacity);
      directories.set(path, {
        depth: node.depth,
        groupId: node.groupId,
        id: node.id,
        name: node.name,
        opacity,
        path,
        position: pointFor(node),
        radius: node.radius,
      });
    });
  });

  return Array.from(directories.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function activeEdgesFor(
  graph: GraphCache,
  files: FrameFile[],
  directories: FrameDirectory[],
): FrameEdge[] {
  const visible = new Map<string, number>();

  files.forEach((file) => visible.set(file.id, file.opacity));
  directories.forEach((directory) => visible.set(directory.id, directory.opacity));

  return graph.edges
    .map((edge) => {
      const sourceOpacity = visible.get(edge.sourceId) ?? 0;
      const targetOpacity = visible.get(edge.targetId) ?? 0;
      const opacity = Math.min(sourceOpacity, targetOpacity);

      if (opacity <= 0.01) {
        return null;
      }

      return {
        id: edge.id,
        opacity,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
      } satisfies FrameEdge;
    })
    .filter(isPresent);
}

function activeGroupsFor(
  sidecar: ParsedSidecar,
  graph: GraphCache,
  files: FrameFile[],
  directories: FrameDirectory[],
): FrameGroup[] {
  const nodesByGroup = new Map<string, { opacity: number; point: Point }[]>();

  [...files, ...directories].forEach((node) => {
    if (!node.groupId) {
      return;
    }

    const groupNodes = nodesByGroup.get(node.groupId) ?? [];
    groupNodes.push({ opacity: node.opacity, point: node.position });
    nodesByGroup.set(node.groupId, groupNodes);
  });

  return sidecar.groups
    .map((group) => {
      const groupNodes =
        nodesByGroup.get(group.id) ??
        group.filePaths
          .map((path) => graph.files[path])
          .filter(isPresent)
          .map((node) => ({ opacity: 1, point: pointFor(node) }));

      if (groupNodes.length === 0) {
        return null;
      }

      const points = groupNodes.map((node) => node.point);
      const bounds = boundsForPoints(points);
      const padding = 0.75 + Math.sqrt(points.length) * 0.025;
      const width = round(Math.max(1.6, bounds.width + padding * 2));
      const height = round(Math.max(1.1, bounds.height + padding * 2));

      return {
        color: group.color,
        fileCount: group.filePaths.length,
        id: group.id,
        opacity: round(Math.max(...groupNodes.map((node) => node.opacity))),
        shape: {
          center: bounds.center,
          height,
          radius: round(Math.min(width, height) * 0.18),
          width,
        },
        title: group.title,
      } satisfies FrameGroup;
    })
    .filter(isPresent);
}

function lifecycleFor(sidecar: ParsedSidecar) {
  const cached = lifecycleCache.get(sidecar);

  if (cached) {
    return cached;
  }

  const lifecycle = new Map<string, Lifecycle>();

  sidecar.initialFiles.forEach((path) => {
    lifecycle.set(path, { createdAt: sidecar.timeline.start, deletedAt: null });
  });

  sidecar.commits.forEach((commit) => {
    commit.changes.forEach((change) => {
      if (change.previousPath) {
        const previous = lifecycle.get(change.previousPath) ?? {
          createdAt: sidecar.timeline.start,
          deletedAt: null,
        };
        lifecycle.set(change.previousPath, {
          ...previous,
          deletedAt: previous.deletedAt ?? commit.timestamp,
        });
        lifecycle.set(change.filePath, {
          createdAt: commit.timestamp,
          deletedAt: null,
        });
        return;
      }

      if (change.kind === 'add') {
        lifecycle.set(change.filePath, {
          createdAt: lifecycle.get(change.filePath)?.createdAt ?? commit.timestamp,
          deletedAt: null,
        });
        return;
      }

      const existing = lifecycle.get(change.filePath) ?? {
        createdAt: sidecar.timeline.start,
        deletedAt: null,
      };
      lifecycle.set(change.filePath, {
        ...existing,
        deletedAt: change.kind === 'delete' ? commit.timestamp : existing.deletedAt,
      });
    });
  });

  Object.keys(sidecar.files).forEach((path) => {
    if (!lifecycle.has(path)) {
      lifecycle.set(path, { createdAt: sidecar.timeline.start, deletedAt: null });
    }
  });

  lifecycleCache.set(sidecar, lifecycle);
  return lifecycle;
}

function opacityForLifecycle(lifecycle: Lifecycle, time: number) {
  if (time < lifecycle.createdAt) {
    return 0;
  }

  if (lifecycle.deletedAt && time > lifecycle.deletedAt + fileFadeMs) {
    return 0;
  }

  if (lifecycle.deletedAt && time >= lifecycle.deletedAt) {
    return round(clamp(1 - (time - lifecycle.deletedAt) / fileFadeMs, 0, 1));
  }

  if (time < lifecycle.createdAt + fileFadeMs) {
    return round(clamp(0.35 + ((time - lifecycle.createdAt) / fileFadeMs) * 0.65, 0.35, 1));
  }

  return 1;
}

function contributorsAt(
  sidecar: ParsedSidecar,
  graph: GraphCache,
  lifecycle: Map<string, Lifecycle>,
  time: number,
): FrameContributor[] {
  const pulseWindowMs = sidecar.settings.pulseWindowDays * dayMs;

  return Object.values(sidecar.contributors)
    .map((contributor, index) => {
      const nextPulse = nextPulseFor(sidecar.commits, contributor.id, time, lifecycle);
      const previousPulse = previousPulseFor(sidecar.commits, contributor.id, time);
      const contributorAngle = angleFor(index, Math.max(Object.keys(sidecar.contributors).length, 1));
      const fallback = pointOnCircle(7.4, contributorAngle);
      const previousPosition = previousPulse
        ? pointFor(graph.files[previousPulse.filePath])
        : fallback;
      const nextPosition = nextPulse ? pointFor(graph.files[nextPulse.filePath]) : previousPosition;
      const timeUntilNext = nextPulse ? nextPulse.timestamp - time : Infinity;
      const timeSincePrevious = previousPulse ? time - previousPulse.timestamp : Infinity;
      const anticipation =
        nextPulse && timeUntilNext <= pulseWindowMs
          ? smoothstep(1 - timeUntilNext / pulseWindowMs)
          : 0;
      const recentOpacity =
        previousPulse && timeSincePrevious <= pulseWindowMs
          ? 1 - timeSincePrevious / pulseWindowMs
          : 0;
      const upcomingOpacity =
        nextPulse && timeUntilNext <= pulseWindowMs ? 1 - timeUntilNext / pulseWindowMs : 0;
      const anchor = lerpPoint(previousPosition, nextPosition, anticipation);
      const drift = pointOnCircle(0.22, contributorAngle + time / (dayMs * 4.5));
      const opacity = round(clamp(Math.max(recentOpacity, upcomingOpacity), 0, 1));
      const targetPath =
        upcomingOpacity > 0 ? nextPulse?.filePath ?? null : previousPulse?.filePath ?? null;

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

function nextPulseFor(
  commits: CommitEvent[],
  contributorId: string,
  time: number,
  lifecycle: Map<string, Lifecycle>,
) {
  for (const commit of commits) {
    if (commit.timestamp < time || commit.author.id !== contributorId) {
      continue;
    }

    const firstChange = commit.changes.find((change) => {
      const life = lifecycle.get(change.filePath);
      return !life || opacityForLifecycle(life, commit.timestamp) > 0;
    });

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

function previousPulseFor(commits: CommitEvent[], contributorId: string, time: number) {
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    const commit = commits[index];

    if (!commit || commit.timestamp > time || commit.author.id !== contributorId) {
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
    const age = time - commit.timestamp;

    if (age < 0 || age > beamDurationMs) {
      return [];
    }

    const ageFade = 1 - age / beamDurationMs;

    return commit.changes.map((change, index) => {
      const strength = beamStrengthFor(change.editSize);
      const diffOpacity = 0.2 + strength * 0.68;

      return {
        color: change.beamColor,
        fromContributorId: commit.author.id,
        id: `${commit.id}:${index}`,
        intensity: round(clamp(Math.max(0.2, diffOpacity * ageFade), 0.2, 0.9)),
        kind: change.kind,
        strength,
        toFilePath: change.filePath,
      };
    });
  });
}

function beamStrengthFor(editSize: number) {
  return round(clamp(Math.log2(Math.max(1, editSize) + 1) / 6.2, 0.18, 0.95));
}

function groupAnchors(sidecar: ParsedSidecar) {
  const anchors = new Map<string, Point>();
  const groups =
    sidecar.groups.length > 0
      ? sidecar.groups
      : [{ id: '', title: '', color: '', filePaths: [], pathPrefixes: [] }];
  const radius = Math.max(8, Math.sqrt(groups.length) * 9);

  groups.forEach((group, index) => {
    anchors.set(group.id, pointOnCircle(radius, angleFor(index, groups.length) - Math.PI / 2));
  });

  anchors.set('', { x: 0, y: 0 });
  return anchors;
}

function normalizeNodePositions(nodes: GraphNode[]) {
  const bounds = rawBoundsFor(nodes);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(58 / width, 39 / height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  nodes.forEach((node) => {
    node.x = round(((node.x ?? 0) - centerX) * scale);
    node.y = round(((node.y ?? 0) - centerY) * scale);
  });
}

function relaxTargetCollisions(nodes: GraphNode[]) {
  const collidableNodes = nodes.filter((node) => node.type === 'file');
  const cellSize = 1.6;
  const iterations = 28;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const grid = new Map<string, GraphNode[]>();

    collidableNodes.forEach((node) => {
      const key = gridKey(node.x ?? 0, node.y ?? 0, cellSize);
      const cell = grid.get(key) ?? [];
      cell.push(node);
      grid.set(key, cell);
    });

    collidableNodes.forEach((node) => {
      const cellX = Math.floor((node.x ?? 0) / cellSize);
      const cellY = Math.floor((node.y ?? 0) / cellSize);

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const cell = grid.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];

          cell.forEach((other) => {
            if (node.id >= other.id) {
              return;
            }

            pushNodesApart(node, other);
          });
        }
      }
    });
  }
}

function pushNodesApart(first: GraphNode, second: GraphNode) {
  const firstX = first.x ?? 0;
  const firstY = first.y ?? 0;
  const secondX = second.x ?? 0;
  const secondY = second.y ?? 0;
  const deltaX = secondX - firstX;
  const deltaY = secondY - firstY;
  const distance = Math.hypot(deltaX, deltaY);
  const desiredDistance = collisionDistance(first, second);

  if (distance >= desiredDistance) {
    return;
  }

  const angle = distance > 0.001 ? Math.atan2(deltaY, deltaX) : hashAngle(`${first.id}:${second.id}`);
  const push = (desiredDistance - distance) * 0.5;
  const pushX = Math.cos(angle) * push;
  const pushY = Math.sin(angle) * push;

  first.x = firstX - pushX;
  first.y = firstY - pushY;
  second.x = secondX + pushX;
  second.y = secondY + pushY;
}

function collisionDistance(first: GraphNode, second: GraphNode) {
  const base = first.radius + second.radius;

  if (first.type === 'file' && second.type === 'file') {
    return base + 0.5;
  }

  if (first.type === 'directory' && second.type === 'directory') {
    return base + 1.5;
  }

  return base + 0.55;
}

function centerNodePositions(nodes: GraphNode[]) {
  const bounds = rawBoundsFor(nodes);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  nodes.forEach((node) => {
    node.x = round((node.x ?? 0) - centerX);
    node.y = round((node.y ?? 0) - centerY);
  });
}

function gridKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function enforceGourceTreeSpacing(nodes: Record<string, GraphNode>, edges: GraphLink[]) {
  const directoryChildren = new Map<string, GraphNode[]>();
  const fileChildren = new Map<string, GraphNode[]>();

  edges.forEach((edge) => {
    const source = nodes[edge.sourceId];
    const target = nodes[edge.targetId];

    if (!source || !target) {
      return;
    }

    const children = target.type === 'directory' ? directoryChildren : fileChildren;
    const siblings = children.get(source.id) ?? [];
    siblings.push(target);
    children.set(source.id, siblings);
  });

  [...directoryChildren.values(), ...fileChildren.values()].forEach((children) => {
    children.sort((first, second) => first.path.localeCompare(second.path));
  });

  Object.values(nodes)
    .filter((node) => node.type === 'directory')
    .sort((first, second) => first.depth - second.depth || first.path.localeCompare(second.path))
    .forEach((parent) => {
      placeDirectoryChildren(parent, directoryChildren.get(parent.id) ?? [], nodes);
      placeFileChildren(parent, fileChildren.get(parent.id) ?? []);
    });
}

function placeDirectoryChildren(
  parent: GraphNode,
  children: GraphNode[],
  nodes: Record<string, GraphNode>,
) {
  if (children.length === 0) {
    return;
  }

  const grandparentPath = parentDirectoryPath(parent.path);
  const grandparent = grandparentPath ? nodes[dirId(grandparentPath)] : null;
  const parentNormal = grandparent
    ? Math.atan2((parent.y ?? 0) - (grandparent.y ?? 0), (parent.x ?? 0) - (grandparent.x ?? 0))
    : hashAngle(parent.path);
  const spread = children.length <= 2 ? Math.PI * 0.82 : Math.min(Math.PI * 1.8, Math.PI * 0.62 + children.length * 0.18);
  const start = parentNormal - spread / 2;

  children.forEach((child, index) => {
    const progress = children.length === 1 ? 0.5 : index / (children.length - 1);
    const angle = start + spread * progress;
    const distance = parent.radius + child.radius + 5.2 + Math.min(child.depth, 7) * 0.68;

    child.x = round((parent.x ?? 0) + Math.cos(angle) * distance);
    child.y = round((parent.y ?? 0) + Math.sin(angle) * distance);
  });
}

function placeFileChildren(parent: GraphNode, files: GraphNode[]) {
  if (files.length === 0) {
    return;
  }

  const spacing = fileNodeRadius * 2 + 0.38;
  let fileIndex = 0;
  let ring = 0;

  while (fileIndex < files.length) {
    const distance = parent.radius + 1.25 + ring * spacing;
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * distance) / spacing));
    const filesInRing = Math.min(capacity, files.length - fileIndex);
    const offset = hashAngle(`${parent.path}:${ring}`);

    for (let index = 0; index < filesInRing; index += 1) {
      const file = files[fileIndex + index];

      if (!file) {
        continue;
      }

      const angle = offset + angleFor(index, filesInRing);
      file.x = round((parent.x ?? 0) + Math.cos(angle) * distance);
      file.y = round((parent.y ?? 0) + Math.sin(angle) * distance);
    }

    fileIndex += filesInRing;
    ring += 1;
  }
}

function boundsFor(nodes: GraphNode[]): FrameBounds {
  if (nodes.length === 0) {
    return { center: { x: 0, y: 0 }, height: 1, width: 1 };
  }

  const bounds = nodes.reduce(
    (current, node) => ({
      maxX: Math.max(current.maxX, (node.x ?? 0) + node.radius),
      maxY: Math.max(current.maxY, (node.y ?? 0) + node.radius),
      minX: Math.min(current.minX, (node.x ?? 0) - node.radius),
      minY: Math.min(current.minY, (node.y ?? 0) - node.radius),
    }),
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity },
  );

  return boundsFromRaw(bounds);
}

function boundsForPoints(points: Point[]): FrameBounds {
  if (points.length === 0) {
    return { center: { x: 0, y: 0 }, height: 1, width: 1 };
  }

  const bounds = points.reduce(
    (current, point) => ({
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
    }),
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity },
  );

  return boundsFromRaw(bounds);
}

function boundsFromRaw(bounds: { maxX: number; maxY: number; minX: number; minY: number }) {
  return {
    center: {
      x: round((bounds.minX + bounds.maxX) / 2),
      y: round((bounds.minY + bounds.maxY) / 2),
    },
    height: round(Math.max(bounds.maxY - bounds.minY, 1)),
    width: round(Math.max(bounds.maxX - bounds.minX, 1)),
  };
}

function rawBoundsFor(nodes: GraphNode[]) {
  return nodes.reduce(
    (bounds, node) => ({
      maxX: Math.max(bounds.maxX, node.x ?? 0),
      maxY: Math.max(bounds.maxY, node.y ?? 0),
      minX: Math.min(bounds.minX, node.x ?? 0),
      minY: Math.min(bounds.minY, node.y ?? 0),
    }),
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity },
  );
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

function segmentsFor(path: string) {
  return path.split('/').filter(Boolean);
}

function parentDirectoryPath(path: string) {
  const segments = segmentsFor(path).slice(0, -1);
  return segments.length > 0 ? segments.join('/') : null;
}

function basename(path: string) {
  return segmentsFor(path).at(-1) ?? path;
}

function fileId(path: string) {
  return `file:${path}`;
}

function dirId(path: string) {
  return `dir:${path}`;
}

function pointFor(node: GraphNode | undefined): Point {
  return {
    x: round(node?.x ?? 0),
    y: round(node?.y ?? 0),
  };
}

function pointOnCircle(radius: number, angle: number): Point {
  return {
    x: round(Math.cos(angle) * radius),
    y: round(Math.sin(angle) * radius),
  };
}

function lerpPoint(from: Point, to: Point, progress: number): Point {
  return {
    x: round(from.x + (to.x - from.x) * progress),
    y: round(from.y + (to.y - from.y) * progress),
  };
}

function smoothstep(value: number) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function angleFor(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (Math.PI * 2 * index) / total;
}

function hashAngle(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }

  return (hash / 360) * Math.PI * 2;
}

function hashUnit(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 33 + character.charCodeAt(0)) % 10_000;
  }

  return hash / 10_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
