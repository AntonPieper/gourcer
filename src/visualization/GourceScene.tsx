import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  forceCollide,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type {
  FrameBeam,
  FrameBounds,
  FrameChangeLabel,
  FrameContributor,
  FrameDirectory,
  FrameEdge,
  FrameFile,
  FrameGroup,
  Point,
  TimelineFrame,
} from '../domain/timeline';

type AnimatedNodeKind = 'directory' | 'file';

type AnimatedGraphNode = SimulationNodeDatum & {
  directory?: FrameDirectory;
  file?: FrameFile;
  groupId: string | null;
  id: string;
  kind: AnimatedNodeKind;
  opacity: number;
  parentId?: string;
  path: string;
  radius: number;
  targetOpacity: number;
  targetX: number;
  targetY: number;
};

type AnimatedGraphLink = SimulationLinkDatum<AnimatedGraphNode> & {
  id: string;
  opacity: number;
  sourceId: string;
  targetId: string;
  targetOpacity: number;
};

type GroupMetadata = {
  color: string;
  fileCount: number;
  title: string;
};

const maxAnimationDeltaSeconds = 1 / 20;
const maxNodeStepPerTick = 0.95;
const graphFadeRate = 8.5;
const dayMs = 24 * 60 * 60 * 1000;

export function GourceScene({
  frame,
  onCanvasReady,
}: {
  frame: TimelineFrame;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
}) {
  return (
    <Canvas
      camera={{
        far: 1000,
        near: 0.1,
        position: [frame.bounds.center.x, frame.bounds.center.y, 100],
        zoom: 42,
      }}
      className="gource-canvas"
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => onCanvasReady(gl.domElement)}
      orthographic
    >
      <SceneContents frame={frame} />
    </Canvas>
  );
}

function SceneContents({ frame }: { frame: TimelineFrame }) {
  const animatedFrame = useAnimatedTimelineFrame(frame);

  return (
    <>
      <SceneBackground color={animatedFrame.backgroundColor} />
      <FitCamera bounds={animatedFrame.bounds} />
      <PanZoomControls />
      <ambientLight intensity={1.8} />
      <group>
        {animatedFrame.groups.map((group) => (
          <SemanticGroupMesh group={group} key={group.id} />
        ))}
        <EdgesLayer
          directories={animatedFrame.directories}
          edges={animatedFrame.edges}
          files={animatedFrame.files}
        />
        <FileNodesLayer files={animatedFrame.files} />
        <BeamsLayer
          beams={animatedFrame.beams}
          contributors={animatedFrame.contributors}
          files={animatedFrame.files}
        />
        <ChangeLabelsLayer labels={animatedFrame.changeLabels} files={animatedFrame.files} />
        {animatedFrame.contributors.map((contributor) => (
          <ContributorSprite contributor={contributor} key={contributor.id} />
        ))}
      </group>
    </>
  );
}

function useAnimatedTimelineFrame(frame: TimelineFrame) {
  const { gl } = useThree();
  const [animatedFrame, setAnimatedFrame] = useState(frame);
  const nodesRef = useRef(new Map<string, AnimatedGraphNode>());
  const linksRef = useRef(new Map<string, AnimatedGraphLink>());
  const groupMetadataRef = useRef(new Map<string, GroupMetadata>());
  const latestFrameRef = useRef(frame);
  const initializedRef = useRef(false);
  const renderAccumulatorRef = useRef(0);
  const simulationRef = useRef<Simulation<AnimatedGraphNode, AnimatedGraphLink> | null>(null);
  const linkForceRef = useRef<ForceLink<AnimatedGraphNode, AnimatedGraphLink> | null>(null);

  useEffect(() => {
    const initial = !initializedRef.current;

    latestFrameRef.current = frame;
    syncAnimatedGraphState({
      frame,
      groups: groupMetadataRef.current,
      initial,
      links: linksRef.current,
      nodes: nodesRef.current,
    });
    initializedRef.current = true;

    const simulation = ensureGraphSimulation(simulationRef, linkForceRef);
    refreshGraphSimulation(simulation, linkForceRef.current, nodesRef.current, linksRef.current);

    if (initial) {
      setAnimatedFrame(
        frameFromAnimatedGraph(frame, nodesRef.current, linksRef.current, groupMetadataRef.current),
      );
    }
  }, [frame]);

  useFrame((_state, delta) => {
    const startedAt = performance.now();
    const nodes = nodesRef.current;
    const links = linksRef.current;

    if (nodes.size === 0) {
      gl.domElement.dataset.animatedNodes = '0';
      return;
    }

    renderAccumulatorRef.current += delta;

    if (renderAccumulatorRef.current < renderIntervalForNodeCount(nodes.size)) {
      return;
    }

    const dt = Math.min(renderAccumulatorRef.current, maxAnimationDeltaSeconds);
    renderAccumulatorRef.current = 0;
    const simulation = ensureGraphSimulation(simulationRef, linkForceRef);
    const previousPositions = new Map<string, Point>();

    nodes.forEach((node) => {
      previousPositions.set(node.id, { x: node.x ?? node.targetX, y: node.y ?? node.targetY });
    });

    simulation.tick(1);
    enforceAnimatedOutwardTree(nodes);

    let maxNodeStep = 0;

    nodes.forEach((node) => {
      const previous = previousPositions.get(node.id);

      if (!previous) {
        return;
      }

      const nextX = node.x ?? node.targetX;
      const nextY = node.y ?? node.targetY;
      const deltaX = nextX - previous.x;
      const deltaY = nextY - previous.y;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance > maxNodeStepPerTick) {
        const scale = maxNodeStepPerTick / distance;
        node.x = previous.x + deltaX * scale;
        node.y = previous.y + deltaY * scale;
        node.vx = (node.vx ?? 0) * 0.35;
        node.vy = (node.vy ?? 0) * 0.35;
        maxNodeStep = Math.max(maxNodeStep, maxNodeStepPerTick);
      } else {
        maxNodeStep = Math.max(maxNodeStep, distance);
      }

      node.opacity = approach(node.opacity, node.targetOpacity, dt, graphFadeRate);
    });

    links.forEach((link) => {
      const source = nodes.get(link.sourceId);
      const target = nodes.get(link.targetId);
      const nodeOpacity = Math.min(source?.opacity ?? 0, target?.opacity ?? 0);
      link.opacity = approach(link.opacity, link.targetOpacity * nodeOpacity, dt, graphFadeRate);
    });

    const removedEntities = removeInvisibleGraphEntities(nodes, links);

    if (removedEntities > 0) {
      refreshGraphSimulation(simulation, linkForceRef.current, nodes, links);
    }

    setAnimatedFrame(
      frameFromAnimatedGraph(
        latestFrameRef.current,
        nodes,
        links,
        groupMetadataRef.current,
      ),
    );

    gl.domElement.dataset.animatedNodes = String(nodes.size);
    gl.domElement.dataset.changeLabels = String(latestFrameRef.current.changeLabels.length);
    gl.domElement.dataset.directoryDots = '0';
    gl.domElement.dataset.maxNodeStep = maxNodeStep.toFixed(3);
    gl.domElement.dataset.simulationMs = (performance.now() - startedAt).toFixed(3);
  });

  return animatedFrame;
}

function syncAnimatedGraphState({
  frame,
  groups,
  initial,
  links,
  nodes,
}: {
  frame: TimelineFrame;
  groups: Map<string, GroupMetadata>;
  initial: boolean;
  links: Map<string, AnimatedGraphLink>;
  nodes: Map<string, AnimatedGraphNode>;
}) {
  frame.groups.forEach((group) => {
    groups.set(group.id, {
      color: group.color,
      fileCount: group.fileCount,
      title: group.title,
    });
  });

  const incomingNodeIds = new Set<string>();
  const parentByTarget = new Map(frame.edges.map((edge) => [edge.targetId, edge.sourceId]));

  frame.directories.forEach((directory) => {
    incomingNodeIds.add(directory.id);
    upsertAnimatedNode({
      frameNode: directory,
      initial,
      kind: 'directory',
      nodes,
      parentId: parentByTarget.get(directory.id),
    });
  });

  frame.files.forEach((file) => {
    incomingNodeIds.add(file.id);
    upsertAnimatedNode({
      frameNode: file,
      initial,
      kind: 'file',
      nodes,
      parentId: parentByTarget.get(file.id),
    });
  });

  nodes.forEach((node) => {
    if (!incomingNodeIds.has(node.id)) {
      node.targetOpacity = 0;
    }
  });

  const incomingLinkIds = new Set<string>();

  frame.edges.forEach((edge) => {
    incomingLinkIds.add(edge.id);

    const existing = links.get(edge.id);

    if (existing) {
      existing.sourceId = edge.sourceId;
      existing.targetId = edge.targetId;
      existing.targetOpacity = edge.opacity;
      return;
    }

    links.set(edge.id, {
      id: edge.id,
      opacity: initial ? edge.opacity : 0,
      source: edge.sourceId,
      sourceId: edge.sourceId,
      target: edge.targetId,
      targetId: edge.targetId,
      targetOpacity: edge.opacity,
    });
  });

  links.forEach((link) => {
    if (!incomingLinkIds.has(link.id)) {
      link.targetOpacity = 0;
    }
  });
}

function upsertAnimatedNode({
  frameNode,
  initial,
  kind,
  nodes,
  parentId,
}: {
  frameNode: FrameDirectory | FrameFile;
  initial: boolean;
  kind: AnimatedNodeKind;
  nodes: Map<string, AnimatedGraphNode>;
  parentId: string | undefined;
}) {
  const existing = nodes.get(frameNode.id);

  if (existing) {
    existing.directory = kind === 'directory' ? (frameNode as FrameDirectory) : undefined;
    existing.file = kind === 'file' ? (frameNode as FrameFile) : undefined;
    existing.groupId = frameNode.groupId;
    existing.kind = kind;
    existing.parentId = parentId;
    existing.path = frameNode.path;
    existing.radius = frameNode.radius;
    existing.targetOpacity = frameNode.opacity;
    existing.targetX = frameNode.position.x;
    existing.targetY = frameNode.position.y;
    return;
  }

  const parent = parentId ? nodes.get(parentId) : null;
  const start = initial
    ? frameNode.position
    : parent
      ? pointFromAnimatedNode(parent)
      : startPointForNewRoot(frameNode, nodes);

  nodes.set(frameNode.id, {
    directory: kind === 'directory' ? (frameNode as FrameDirectory) : undefined,
    file: kind === 'file' ? (frameNode as FrameFile) : undefined,
    groupId: frameNode.groupId,
    id: frameNode.id,
    kind,
    opacity: initial ? frameNode.opacity : 0,
    parentId,
    path: frameNode.path,
    radius: frameNode.radius,
    targetOpacity: frameNode.opacity,
    targetX: frameNode.position.x,
    targetY: frameNode.position.y,
    vx: 0,
    vy: 0,
    x: start.x,
    y: start.y,
  });
}

function ensureGraphSimulation(
  simulationRef: MutableRefObject<Simulation<AnimatedGraphNode, AnimatedGraphLink> | null>,
  linkForceRef: MutableRefObject<ForceLink<AnimatedGraphNode, AnimatedGraphLink> | null>,
) {
  if (simulationRef.current && linkForceRef.current) {
    return simulationRef.current;
  }

  const linkForce = forceLink<AnimatedGraphNode, AnimatedGraphLink>()
    .id((node) => node.id)
    .distance((link) => (link.targetId.startsWith('dir:') ? 6.8 : 1.55))
    .strength((link) => (link.targetId.startsWith('dir:') ? 0.08 : 0.035));

  const simulation = forceSimulation<AnimatedGraphNode>()
    .alphaDecay(0.035)
    .force('link', linkForce)
    .force(
      'collide',
      forceCollide<AnimatedGraphNode>()
        .radius((node) => node.radius + (node.kind === 'directory' ? 1.15 : 0.22))
        .strength(0.86)
        .iterations(1),
    )
    .force(
      'x',
      forceX<AnimatedGraphNode>((node) => node.targetX).strength((node) =>
        node.kind === 'directory' ? 0.06 : 0.04,
      ),
    )
    .force(
      'y',
      forceY<AnimatedGraphNode>((node) => node.targetY).strength((node) =>
        node.kind === 'directory' ? 0.06 : 0.04,
      ),
    )
    .stop();

  simulationRef.current = simulation;
  linkForceRef.current = linkForce;
  return simulation;
}

function refreshGraphSimulation(
  simulation: Simulation<AnimatedGraphNode, AnimatedGraphLink>,
  linkForce: ForceLink<AnimatedGraphNode, AnimatedGraphLink> | null,
  nodes: Map<string, AnimatedGraphNode>,
  links: Map<string, AnimatedGraphLink>,
) {
  simulation.nodes(Array.from(nodes.values()));
  linkForce?.links(
    Array.from(links.values())
      .filter(
        (link) =>
          nodes.has(link.sourceId) &&
          nodes.has(link.targetId) &&
          (link.opacity > 0.01 || link.targetOpacity > 0.001),
      )
      .map((link) => ({
        ...link,
        source: link.sourceId,
        target: link.targetId,
      })),
  );
  simulation.alpha(Math.max(simulation.alpha(), 0.34));
}

function removeInvisibleGraphEntities(
  nodes: Map<string, AnimatedGraphNode>,
  links: Map<string, AnimatedGraphLink>,
) {
  let removedEntities = 0;

  nodes.forEach((node, id) => {
    if (node.targetOpacity <= 0.001 && node.opacity <= 0.01) {
      nodes.delete(id);
      removedEntities += 1;
    }
  });

  links.forEach((link, id) => {
    if (
      link.opacity <= 0.01 &&
      link.targetOpacity <= 0.001
    ) {
      links.delete(id);
      removedEntities += 1;
    }
  });

  return removedEntities;
}

function enforceAnimatedOutwardTree(nodes: Map<string, AnimatedGraphNode>) {
  const root = nodes.get('dir:');

  if (!root) {
    return;
  }

  const rootPoint = pointFromAnimatedNode(root);
  const sortedNodes = Array.from(nodes.values())
    .filter((node) => node.parentId)
    .sort((first, second) => first.path.length - second.path.length);

  sortedNodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : null;

    if (!parent) {
      return;
    }

    const parentDistance = distanceBetween(rootPoint, pointFromAnimatedNode(parent));
    const nodePoint = pointFromAnimatedNode(node);
    const nodeDistance = distanceBetween(rootPoint, nodePoint);
    const minimumDistance = parentDistance + (node.kind === 'directory' ? 1.1 : 0.34);

    if (nodeDistance >= minimumDistance) {
      return;
    }

    const targetAngle = Math.atan2(node.targetY - rootPoint.y, node.targetX - rootPoint.x);
    const currentAngle =
      nodeDistance > 0.001
        ? Math.atan2(nodePoint.y - rootPoint.y, nodePoint.x - rootPoint.x)
        : targetAngle;
    const angle = Number.isFinite(currentAngle) ? currentAngle : targetAngle;

    node.x = rootPoint.x + Math.cos(angle) * minimumDistance;
    node.y = rootPoint.y + Math.sin(angle) * minimumDistance;
    node.vx = (node.vx ?? 0) * 0.45;
    node.vy = (node.vy ?? 0) * 0.45;
  });
}

function frameFromAnimatedGraph(
  frame: TimelineFrame,
  nodes: Map<string, AnimatedGraphNode>,
  links: Map<string, AnimatedGraphLink>,
  groups: Map<string, GroupMetadata>,
): TimelineFrame {
  const visibleNodes = Array.from(nodes.values()).filter(
    (node) => node.opacity > 0.01 || node.targetOpacity > 0.01,
  );
  const directories = visibleNodes
    .filter((node) => node.kind === 'directory' && node.directory)
    .map((node) => ({
      ...node.directory!,
      opacity: clamp01(node.opacity),
      position: pointFromAnimatedNode(node),
      radius: node.radius,
    }))
    .sort((first, second) => first.path.localeCompare(second.path));
  const files = visibleNodes
    .filter((node) => node.kind === 'file' && node.file)
    .map((node) => ({
      ...node.file!,
      opacity: clamp01(node.opacity),
      position: pointFromAnimatedNode(node),
      radius: node.radius,
    }))
    .sort((first, second) => first.path.localeCompare(second.path));
  const visibleById = new Map(visibleNodes.map((node) => [node.id, node]));
  const edges = Array.from(links.values())
    .map((link) => {
      const source = visibleById.get(link.sourceId);
      const target = visibleById.get(link.targetId);

      if (!source || !target) {
        return null;
      }

      const opacity = clamp01(link.opacity);

      if (opacity <= 0.01) {
        return null;
      }

      return {
        id: link.id,
        opacity,
        sourceId: link.sourceId,
        targetId: link.targetId,
      };
    })
    .filter(isPresent);
  const filesByPath = new Map(files.map((file) => [file.path, file]));

  return {
    ...frame,
    bounds: boundsForAnimatedNodes(visibleNodes) ?? frame.bounds,
    contributors: contributorsForAnimatedFiles(frame.contributors, filesByPath, frame.time),
    directories,
    edges,
    files,
    groups: groupsForAnimatedNodes(visibleNodes, groups),
  };
}

function contributorsForAnimatedFiles(
  contributors: FrameContributor[],
  filesByPath: Map<string, FrameFile>,
  time: number,
) {
  return contributors.map((contributor, index) => {
    const targetFile = contributor.targetPath ? filesByPath.get(contributor.targetPath) : null;

    if (!targetFile) {
      return contributor;
    }

    const angle = stableAngle(`${contributor.id}:${targetFile.path}`) + time / (dayMs * 5.5);
    const distance = targetFile.radius + 0.78 + (index % 3) * 0.16;

    return {
      ...contributor,
      position: {
        x: targetFile.position.x + Math.cos(angle) * distance,
        y: targetFile.position.y + Math.sin(angle) * distance,
      },
    };
  });
}

function groupsForAnimatedNodes(
  nodes: AnimatedGraphNode[],
  metadata: Map<string, GroupMetadata>,
) {
  const nodesByGroup = new Map<string, AnimatedGraphNode[]>();

  nodes.forEach((node) => {
    if (!node.groupId || node.opacity <= 0.01) {
      return;
    }

    const groupNodes = nodesByGroup.get(node.groupId) ?? [];
    groupNodes.push(node);
    nodesByGroup.set(node.groupId, groupNodes);
  });

  return Array.from(nodesByGroup.entries())
    .map(([groupId, groupNodes]) => {
      const bounds = boundsForPoints(groupNodes.map(pointFromAnimatedNode));
      const groupMetadata = metadata.get(groupId);
      const padding = 0.82 + Math.sqrt(groupNodes.length) * 0.035;
      const width = Math.max(1.6, bounds.width + padding * 2);
      const height = Math.max(1.1, bounds.height + padding * 2);

      return {
        color: groupMetadata?.color ?? '#203650',
        fileCount:
          groupMetadata?.fileCount ??
          groupNodes.filter((node) => node.kind === 'file').length,
        id: groupId,
        opacity: clamp01(Math.max(...groupNodes.map((node) => node.opacity))),
        shape: {
          center: bounds.center,
          height,
          radius: Math.min(width, height) * 0.18,
          width,
        },
        title: groupMetadata?.title ?? groupId,
      };
    })
    .sort((first, second) => first.title.localeCompare(second.title));
}

function boundsForAnimatedNodes(nodes: AnimatedGraphNode[]) {
  const visible = nodes.filter((node) => node.opacity > 0.01);

  if (visible.length === 0) {
    return null;
  }

  const bounds = visible.reduce(
    (current, node) => {
      const point = pointFromAnimatedNode(node);

      return {
        maxX: Math.max(current.maxX, point.x + node.radius),
        maxY: Math.max(current.maxY, point.y + node.radius),
        minX: Math.min(current.minX, point.x - node.radius),
        minY: Math.min(current.minY, point.y - node.radius),
      };
    },
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity },
  );

  return boundsFromExtents(bounds);
}

function startPointForNewRoot(
  frameNode: FrameDirectory | FrameFile,
  nodes: Map<string, AnimatedGraphNode>,
) {
  const sameGroup = Array.from(nodes.values()).find(
    (node) => node.groupId === frameNode.groupId && node.opacity > 0.05,
  );

  if (sameGroup) {
    return pointFromAnimatedNode(sameGroup);
  }

  return frameNode.position;
}

function pointFromAnimatedNode(node: AnimatedGraphNode): Point {
  return {
    x: node.x ?? node.targetX,
    y: node.y ?? node.targetY,
  };
}

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function approach(current: number, target: number, dt: number, rate: number) {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

function renderIntervalForNodeCount(nodeCount: number) {
  if (nodeCount > 1_400) {
    return 1 / 10;
  }

  if (nodeCount > 900) {
    return 1 / 16;
  }

  return 1 / 30;
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

  return boundsFromExtents(bounds);
}

function boundsFromExtents(bounds: {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}): FrameBounds {
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    height: Math.max(bounds.maxY - bounds.minY, 1),
    width: Math.max(bounds.maxX - bounds.minX, 1),
  };
}

function stableAngle(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }

  return (hash / 360) * Math.PI * 2;
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function SceneBackground({ color }: { color: string }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(color);
  }, [color, scene]);

  return null;
}

function FitCamera({ bounds }: { bounds: FrameBounds }) {
  const { camera, gl, size } = useThree();
  const fittedKey = useRef<string | null>(null);
  const fittingRef = useRef(true);
  const targetRef = useRef({
    x: bounds.center.x,
    y: bounds.center.y,
    zoom: 42,
  });

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) {
      return;
    }

    const key = [
      Math.round(bounds.center.x * 2) / 2,
      Math.round(bounds.center.y * 2) / 2,
      Math.round(bounds.width * 2) / 2,
      Math.round(bounds.height * 2) / 2,
      size.width,
      size.height,
    ].join(':');

    if (fittedKey.current === key) {
      return;
    }

    const isNarrow = size.width < 720;
    const horizontalCoverage = isNarrow ? 0.5 : 0.72;
    const verticalCoverage = isNarrow ? 0.36 : 0.58;
    const horizontalZoom = (size.width * horizontalCoverage) / Math.max(bounds.width, 1);
    const verticalZoom = (size.height * verticalCoverage) / Math.max(bounds.height, 1);
    targetRef.current = {
      x: bounds.center.x,
      y: bounds.center.y,
      zoom: Math.min(horizontalZoom, verticalZoom),
    };
    fittingRef.current = true;
    fittedKey.current = key;
  }, [bounds, camera, size.height, size.width]);

  useFrame((_state, delta) => {
    if (gl.domElement.dataset.userCamera === 'true') {
      fittingRef.current = false;
      return;
    }

    if (!fittingRef.current || !(camera instanceof THREE.OrthographicCamera)) {
      return;
    }

    const target = targetRef.current;
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 3.6);

    camera.position.x += (target.x - camera.position.x) * ease;
    camera.position.y += (target.y - camera.position.y) * ease;
    camera.position.z = 100;
    camera.zoom += (target.zoom - camera.zoom) * ease;
    camera.updateProjectionMatrix();

    if (
      Math.hypot(target.x - camera.position.x, target.y - camera.position.y) < 0.02 &&
      Math.abs(target.zoom - camera.zoom) < 0.02
    ) {
      fittingRef.current = false;
    }
  });

  return null;
}

function PanZoomControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<MapControls | null>(null);

  useEffect(() => {
    const controls = new MapControls(camera, gl.domElement);
    const markUserCamera = () => {
      gl.domElement.dataset.userCamera = 'true';
    };

    controls.enableDamping = true;
    controls.enableRotate = false;
    controls.maxZoom = 160;
    controls.minZoom = 8;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.screenSpacePanning = true;
    controls.addEventListener('start', markUserCamera);
    controlsRef.current = controls;

    return () => {
      controls.removeEventListener('start', markUserCamera);
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl.domElement]);

  useFrame(({ camera }) => {
    controlsRef.current?.update();
    gl.domElement.dataset.cameraX = camera.position.x.toFixed(3);
    gl.domElement.dataset.cameraY = camera.position.y.toFixed(3);
    gl.domElement.dataset.zoom =
      camera instanceof THREE.OrthographicCamera ? camera.zoom.toFixed(3) : '0';
    camera.updateMatrixWorld();
  });

  return null;
}

function SemanticGroupMesh({ group }: { group: FrameGroup }) {
  const material = usePulseMaterial(group.color, group.opacity * 0.18);
  const geometry = useMemo(
    () => roundedRectGeometry(group.shape.width, group.shape.height, group.shape.radius),
    [group.shape.height, group.shape.radius, group.shape.width],
  );
  useDisposeGeometry(geometry);

  return (
    <group position={[group.shape.center.x, group.shape.center.y, -0.55]}>
      <mesh geometry={geometry}>
        <primitive attach="material" object={material} />
      </mesh>
      <TextSprite
        color="#f8fbff"
        opacity={group.opacity}
        position={[0, group.shape.height / 2 + 0.28, 0.12]}
        text={group.title}
        worldHeight={0.42}
      />
    </group>
  );
}

function EdgesLayer({
  directories,
  edges,
  files,
}: {
  directories: FrameDirectory[];
  edges: FrameEdge[];
  files: FrameFile[];
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const opacities: number[] = [];
    const nodes = new Map<string, Point>();

    directories.forEach((directory) => nodes.set(directory.id, directory.position));
    files.forEach((file) => nodes.set(file.id, file.position));

    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);

      if (!source || !target) {
        return;
      }

      positions.push(source.x, source.y, -0.12, target.x, target.y, -0.12);
      opacities.push(edge.opacity * 0.28, edge.opacity * 0.28);
    });

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    buffer.setAttribute('aOpacity', new THREE.Float32BufferAttribute(opacities, 1));
    return buffer;
  }, [directories, edges, files]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        transparent: true,
        uniforms: {
          uColor: { value: new THREE.Color('#91a4bd') },
        },
        vertexShader: `
          attribute float aOpacity;
          varying float vOpacity;

          void main() {
            vOpacity = aOpacity;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vOpacity;

          void main() {
            gl_FragColor = vec4(uColor, vOpacity);
          }
        `,
      }),
    [],
  );

  useDisposeGeometry(geometry);

  return (
    <lineSegments geometry={geometry}>
      <primitive attach="material" object={material} />
    </lineSegments>
  );
}

function FileNodesLayer({ files }: { files: FrameFile[] }) {
  const { geometry, material } = useCircleLayer(
    files,
    (file) => file.language.color,
    0.08,
    0.96,
  );

  return <mesh frustumCulled={false} geometry={geometry} material={material} />;
}

function useCircleLayer<T extends { opacity: number; position: Point; radius: number }>(
  nodes: T[],
  colorFor: (node: T) => string,
  z: number,
  opacityScale: number,
) {
  const geometry = useMemo(() => {
    const base = new THREE.CircleGeometry(1, 28);
    const buffer = new THREE.InstancedBufferGeometry();
    const offsets = new Float32Array(nodes.length * 3);
    const colors = new Float32Array(nodes.length * 3);
    const opacities = new Float32Array(nodes.length);
    const radii = new Float32Array(nodes.length);
    const color = new THREE.Color();

    buffer.index = base.index;
    buffer.setAttribute('position', base.getAttribute('position'));

    nodes.forEach((node, index) => {
      offsets[index * 3] = node.position.x;
      offsets[index * 3 + 1] = node.position.y;
      offsets[index * 3 + 2] = z;
      color.set(colorFor(node));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      opacities[index] = node.opacity * opacityScale;
      radii[index] = node.radius;
    });

    buffer.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    buffer.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    buffer.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
    buffer.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radii, 1));
    buffer.instanceCount = nodes.length;
    return buffer;
  }, [colorFor, nodes, opacityScale, z]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        side: THREE.DoubleSide,
        transparent: true,
        vertexShader: `
          attribute vec3 aColor;
          attribute vec3 aOffset;
          attribute float aOpacity;
          attribute float aRadius;
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            vColor = aColor;
            vOpacity = aOpacity;
            vec3 worldPosition = aOffset + vec3(position.xy * aRadius, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            gl_FragColor = vec4(vColor, vOpacity);
          }
        `,
      }),
    [],
  );
  useDisposeGeometry(geometry);

  return { geometry, material };
}

function ContributorSprite({ contributor }: { contributor: FrameContributor }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const velocityRef = useRef(new THREE.Vector3());
  const material = useAvatarMaterial(contributor.avatarUrl);

  useFrame((_state, delta) => {
    const sprite = spriteRef.current;

    if (!sprite) {
      return;
    }

    const dt = Math.min(delta, 0.05);
    const target = vectorFromPoint(contributor.position, 0.9);
    const displacement = target.sub(sprite.position);
    const velocity = velocityRef.current;

    velocity.addScaledVector(displacement, 18 * dt);
    velocity.multiplyScalar(Math.exp(-6.4 * dt));
    sprite.position.addScaledVector(velocity, dt * 8);
    sprite.material.opacity +=
      (contributor.opacity - sprite.material.opacity) * (1 - Math.exp(-dt * 7));
    sprite.material.needsUpdate = true;
  });

  return (
    <sprite
      ref={spriteRef}
      material={material}
      position={[contributor.position.x, contributor.position.y, 0.9]}
      scale={[0.74, 0.74, 1]}
    />
  );
}

function BeamsLayer({
  beams,
  contributors,
  files,
}: {
  beams: FrameBeam[];
  contributors: FrameContributor[];
  files: FrameFile[];
}) {
  const geometry = useMemo(() => {
    const contributorsById = new Map(contributors.map((contributor) => [contributor.id, contributor]));
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const positions: number[] = [];
    const colors: number[] = [];
    const opacities: number[] = [];
    const color = new THREE.Color();

    beams.forEach((beam) => {
      const contributor = contributorsById.get(beam.fromContributorId);
      const file = filesByPath.get(beam.toFilePath);

      if (!contributor || !file) {
        return;
      }

      const vertices = triangleBeamVertices(contributor.position, file.position, file.radius);

      if (!vertices) {
        return;
      }

      color.set(beam.color);
      positions.push(...vertices);

      for (let index = 0; index < 3; index += 1) {
        colors.push(color.r, color.g, color.b);
        opacities.push(clamp01(beam.intensity));
      }
    });

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    buffer.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    buffer.setAttribute('aOpacity', new THREE.Float32BufferAttribute(opacities, 1));
    return buffer;
  }, [beams, contributors, files]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        side: THREE.DoubleSide,
        transparent: true,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aOpacity;
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            vColor = aColor;
            vOpacity = aOpacity;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            gl_FragColor = vec4(vColor, clamp(vOpacity, 0.0, 0.9));
          }
        `,
      }),
    [],
  );

  useDisposeGeometry(geometry);
  useEffect(() => () => material.dispose(), [material]);

  return <mesh geometry={geometry} material={material} />;
}

function triangleBeamVertices(fromPoint: Point, toPoint: Point, baseRadius: number) {
  const from = vectorFromPoint(fromPoint, 0.42);
  const to = vectorFromPoint(toPoint, 0.42);
  const direction = new THREE.Vector2(to.x - from.x, to.y - from.y);
  const length = direction.length();

  if (length <= 0.001) {
    return null;
  }

  const perpendicular = new THREE.Vector2(-direction.y / length, direction.x / length);
  const baseA = new THREE.Vector3(
    to.x + perpendicular.x * baseRadius,
    to.y + perpendicular.y * baseRadius,
    to.z,
  );
  const baseB = new THREE.Vector3(
    to.x - perpendicular.x * baseRadius,
    to.y - perpendicular.y * baseRadius,
    to.z,
  );

  return [from.x, from.y, from.z, baseA.x, baseA.y, baseA.z, baseB.x, baseB.y, baseB.z];
}

function ChangeLabelsLayer({
  files,
  labels,
}: {
  files: FrameFile[];
  labels: FrameChangeLabel[];
}) {
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  return (
    <>
      {labels.map((label, index) => {
        const file = filesByPath.get(label.toFilePath);

        if (!file) {
          return null;
        }

        const opacity = label.opacity * file.opacity;

        if (opacity <= 0.03) {
          return null;
        }

        const angle = stableAngle(label.id);
        const offset = file.radius + 0.42 + (index % 3) * 0.14;

        return (
          <TextSprite
            color="#f8fbff"
            key={label.id}
            opacity={opacity}
            position={[
              file.position.x + Math.cos(angle) * offset,
              file.position.y + Math.sin(angle) * offset,
              1.2,
            ]}
            shadowColor={label.color}
            text={label.text}
            worldHeight={1.7}
          />
        );
      })}
    </>
  );
}

function TextSprite({
  color,
  opacity = 1,
  position,
  shadowColor = 'rgba(0,0,0,0.75)',
  text,
  worldHeight,
}: {
  color: string;
  opacity?: number;
  position: [number, number, number];
  shadowColor?: string;
  text: string;
  worldHeight: number;
}) {
  const textureInfo = useMemo(() => {
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');

    if (!measureContext) {
      return null;
    }

    const fontSize = 46;
    const font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    measureContext.font = font;
    const textWidth = Math.ceil(measureContext.measureText(text).width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(128, Math.ceil(textWidth + 72));
    canvas.height = 104;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowBlur = 16;
    context.shadowColor = shadowColor;
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.needsUpdate = true;
    return {
      aspect: canvas.width / canvas.height,
      texture: canvasTexture,
    };
  }, [color, shadowColor, text]);

  useEffect(
    () => () => {
      textureInfo?.texture.dispose();
    },
    [textureInfo],
  );

  if (!textureInfo) {
    return null;
  }

  return (
    <sprite
      position={position}
      scale={[worldHeight * textureInfo.aspect, worldHeight, 1]}
    >
      <spriteMaterial
        depthTest={false}
        map={textureInfo.texture}
        opacity={opacity}
        transparent
      />
    </sprite>
  );
}

function usePulseMaterial(color: string, opacity: number) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        transparent: true,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: opacity },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uTime;
          varying vec2 vUv;

          void main() {
            float glow = 0.78 + 0.22 * sin(uTime * 1.6 + vUv.y * 7.0);
            gl_FragColor = vec4(uColor * glow, uOpacity);
          }
        `,
      }),
    [],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uColor!.value.set(color);
    material.uniforms.uOpacity!.value = opacity;
  });

  useEffect(() => () => material.dispose(), [material]);

  return material;
}

function useAvatarMaterial(url: string) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let isActive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (loadedTexture) => {
        if (isActive) {
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          setTexture(loadedTexture);
        }
      },
      undefined,
      () => {
        if (isActive) {
          setTexture(null);
        }
      },
    );

    return () => {
      isActive = false;
    };
  }, [url]);

  const material = useMemo(
    () => {
      const parameters: THREE.SpriteMaterialParameters = {
        color: texture ? '#ffffff' : '#9fb3c8',
        opacity: 0,
        transparent: true,
      };

      if (texture) {
        parameters.map = texture;
      }

      return new THREE.SpriteMaterial(parameters);
    },
    [texture],
  );

  useEffect(() => () => material.dispose(), [material]);

  return material;
}

function roundedRectGeometry(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  return new THREE.ShapeGeometry(shape, 16);
}

function vectorFromPoint(point: Point, z: number) {
  return new THREE.Vector3(point.x, point.y, z);
}

function useDisposeGeometry(geometry: THREE.BufferGeometry) {
  useEffect(() => () => geometry.dispose(), [geometry]);
}
