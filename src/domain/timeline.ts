import md5 from 'blueimp-md5';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type {
  ChangeKind,
  CommitEvent,
  FileNode,
  ParsedSidecar,
  RawGraphLayout,
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

type GraphNode = SimulationNodeDatum & {
  depth: number;
  groupId: string | null;
  id: string;
  name: string;
  path: string;
  radius: number;
  type: GraphNodeType;
};

type GraphLink = SimulationLinkDatum<GraphNode> & {
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

type Lifecycle = {
  createdAt: number;
  deletedAt: number | null;
};

const graphCache = new WeakMap<ParsedSidecar, GraphCache>();
const lifecycleCache = new WeakMap<ParsedSidecar, Map<string, Lifecycle>>();
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const fileFadeMs = 36 * hourMs;
const fileNodeRadius = 0.24;
const directoryNodeRadius = 0.18;
const collisionPadding = 0.05;

export function buildTimelineFrame(
  sidecar: ParsedSidecar,
  time: number,
  options: TimelineFrameOptions = {},
): TimelineFrame {
  const progress = timelineProgress(sidecar, time);
  const graph = graphFor(sidecar);
  const lifecycle = lifecycleFor(sidecar);
  const legendWindowMs = (options.legendWindowDays ?? 7) * dayMs;
  const beamDurationMs = (options.beamDurationHours ?? 18) * hourMs;
  const files = activeFilesAt(sidecar, graph, lifecycle, time);
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

function graphFor(sidecar: ParsedSidecar): GraphCache {
  const cached = graphCache.get(sidecar);

  if (cached) {
    return cached;
  }

  if (sidecar.layout) {
    const graph = graphFromRawLayout(sidecar.layout);
    graphCache.set(sidecar, graph);
    return graph;
  }

  const graph = computeGraphLayout(sidecar);
  graphCache.set(sidecar, graph);
  return graph;
}

export function createRepositoryGraphLayout(sidecar: ParsedSidecar): RawGraphLayout {
  const graph = computeGraphLayout(sidecar);

  return {
    bounds: graph.bounds,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
    })),
    nodes: Object.values(graph.nodes).map((node) => ({
      depth: node.depth,
      groupId: node.groupId,
      id: node.id,
      name: node.name,
      path: node.path,
      radius: node.radius,
      type: node.type,
      x: round(node.x ?? 0),
      y: round(node.y ?? 0),
    })),
  };
}

function graphFromRawLayout(layout: RawGraphLayout): GraphCache {
  const nodes = layout.nodes.map(
    (node): GraphNode => ({
      depth: node.depth,
      groupId: node.groupId,
      id: node.id,
      name: node.name,
      path: node.path,
      radius: node.radius ?? (node.type === 'directory' ? directoryNodeRadius : fileNodeRadius),
      type: node.type,
      x: node.x,
      y: node.y,
    }),
  );

  return {
    bounds: layout.bounds,
    directories: Object.fromEntries(
      nodes
        .filter((node) => node.type === 'directory')
        .map((node) => [node.path, node]),
    ),
    edges: layout.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      sourceId: edge.sourceId,
      target: edge.targetId,
      targetId: edge.targetId,
    })),
    files: Object.fromEntries(
      nodes.filter((node) => node.type === 'file').map((node) => [node.path, node]),
    ),
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

function computeGraphLayout(sidecar: ParsedSidecar): GraphCache {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphLink>();
  const anchors = groupAnchors(sidecar);

  Object.values(sidecar.files).forEach((file) => {
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
  const simulation = forceSimulation<GraphNode>(nodeList)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(edgeList)
        .id((node) => node.id)
        .distance((edge) => linkDistance(edge))
        .strength((edge) => linkStrength(edge)),
    )
    .force(
      'charge',
      forceManyBody<GraphNode>()
        .distanceMax(10)
        .strength((node) => (node.type === 'directory' ? -72 : -18)),
    )
    .force(
      'collide',
      forceCollide<GraphNode>()
        .radius((node) => node.radius + collisionPadding)
        .iterations(4),
    )
    .force(
      'x',
      forceX<GraphNode>((node) => (anchors.get(node.groupId ?? '')?.x ?? 0) + node.depth * 0.26).strength(0.032),
    )
    .force(
      'y',
      forceY<GraphNode>((node) => anchors.get(node.groupId ?? '')?.y ?? 0).strength(0.032),
    )
    .force('center', forceCenter(0, 0))
    .stop();

  for (let index = 0; index < 420; index += 1) {
    simulation.tick();
  }

  normalizeNodePositions(nodeList);
  relaxCollisions(nodeList, 220);

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
    edges.set(id, { id, sourceId, targetId, source: sourceId, target: targetId });
  }
}

function activeFilesAt(
  sidecar: ParsedSidecar,
  graph: GraphCache,
  lifecycle: Map<string, Lifecycle>,
  time: number,
): FrameFile[] {
  return Object.values(sidecar.files)
    .map((file) => {
      const node = graph.files[file.path];
      const life = lifecycle.get(file.path);
      const opacity = life ? opacityForLifecycle(life, time) : 0;

      if (!node || opacity <= 0.01) {
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
    .filter(isPresent)
    .sort((a, b) => a.path.localeCompare(b.path));
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
  const nodesByGroup = new Map<string, Point[]>();

  [...files, ...directories].forEach((node) => {
    if (!node.groupId) {
      return;
    }

    const points = nodesByGroup.get(node.groupId) ?? [];
    points.push(node.position);
    nodesByGroup.set(node.groupId, points);
  });

  return sidecar.groups
    .map((group) => {
      const points =
        nodesByGroup.get(group.id) ??
        group.filePaths
          .map((path) => graph.files[path])
          .filter(isPresent)
          .map(pointFor);

      if (points.length === 0) {
        return null;
      }

      const bounds = boundsForPoints(points);
      const padding = 0.75 + Math.sqrt(points.length) * 0.025;
      const width = round(Math.max(1.6, bounds.width + padding * 2));
      const height = round(Math.max(1.1, bounds.height + padding * 2));

      return {
        color: group.color,
        fileCount: group.filePaths.length,
        id: group.id,
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
  const radius = Math.max(4.2, Math.sqrt(groups.length) * 5.8);

  groups.forEach((group, index) => {
    anchors.set(group.id, pointOnCircle(radius, angleFor(index, groups.length) - Math.PI / 2));
  });

  anchors.set('', { x: 0, y: 0 });
  return anchors;
}

function linkDistance(edge: GraphLink) {
  const source = edge.source as GraphNode;
  const target = edge.target as GraphNode;
  return source.radius + target.radius + (target.type === 'file' ? 0.48 : 0.78);
}

function linkStrength(edge: GraphLink) {
  const target = edge.target as GraphNode;
  return target.type === 'file' ? 0.32 : 0.62;
}

function normalizeNodePositions(nodes: GraphNode[]) {
  const bounds = rawBoundsFor(nodes);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(42 / width, 25 / height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  nodes.forEach((node) => {
    node.x = round(((node.x ?? 0) - centerX) * scale);
    node.y = round(((node.y ?? 0) - centerY) * scale);
  });
}

function relaxCollisions(nodes: GraphNode[], iterations: number) {
  const targets = new Map(
    nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]),
  );
  const simulation = forceSimulation<GraphNode>(nodes)
    .force(
      'collide',
      forceCollide<GraphNode>()
        .radius((node) => node.radius + collisionPadding)
        .iterations(8),
    )
    .force(
      'x',
      forceX<GraphNode>((node) => targets.get(node.id)?.x ?? 0).strength(0.012),
    )
    .force(
      'y',
      forceY<GraphNode>((node) => targets.get(node.id)?.y ?? 0).strength(0.012),
    )
    .stop();

  for (let index = 0; index < iterations; index += 1) {
    simulation.tick();
  }

  for (let iteration = 0; iteration < Math.min(16, iterations); iteration += 1) {
    let moved = false;

    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
        const first = nodes[firstIndex];
        const second = nodes[secondIndex];

        if (!first || !second) {
          continue;
        }

        const dx = (second.x ?? 0) - (first.x ?? 0);
        const dy = (second.y ?? 0) - (first.y ?? 0);
        const distance = Math.hypot(dx, dy) || 0.0001;
        const minimumDistance = first.radius + second.radius + collisionPadding;

        if (distance >= minimumDistance) {
          continue;
        }

        const push = (minimumDistance - distance) / 2;
        const ux = dx / distance;
        const uy = dy / distance;

        first.x = (first.x ?? 0) - ux * push;
        first.y = (first.y ?? 0) - uy * push;
        second.x = (second.x ?? 0) + ux * push;
        second.y = (second.y ?? 0) + uy * push;
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  nodes.forEach((node) => {
    node.x = round(node.x ?? 0);
    node.y = round(node.y ?? 0);
  });
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
