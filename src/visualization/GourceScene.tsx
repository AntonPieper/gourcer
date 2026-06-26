import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type {
  FrameBeam,
  FrameBounds,
  FrameContributor,
  FrameDirectory,
  FrameEdge,
  FrameFile,
  FrameGroup,
  Point,
  TimelineFrame,
} from '../domain/timeline';

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
  return (
    <>
      <SceneBackground color={frame.backgroundColor} />
      <FitCamera bounds={frame.bounds} />
      <PanZoomControls />
      <ambientLight intensity={1.8} />
      <group>
        {frame.groups.map((group) => (
          <SemanticGroupMesh group={group} key={group.id} />
        ))}
        <EdgesLayer directories={frame.directories} edges={frame.edges} files={frame.files} />
        <DirectoryNodesLayer directories={frame.directories} />
        <FileNodesLayer files={frame.files} />
        {frame.beams.map((beam) => (
          <BeamMesh
            beam={beam}
            contributors={frame.contributors}
            files={frame.files}
            key={beam.id}
          />
        ))}
        {frame.contributors.map((contributor) => (
          <ContributorSprite contributor={contributor} key={contributor.id} />
        ))}
      </group>
    </>
  );
}

function SceneBackground({ color }: { color: string }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(color);
  }, [color, scene]);

  return null;
}

function FitCamera({ bounds }: { bounds: FrameBounds }) {
  const { camera, size } = useThree();
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) {
      return;
    }

    const key = `${bounds.width}:${bounds.height}:${size.width}:${size.height}`;

    if (fittedKey.current === key) {
      return;
    }

    const isNarrow = size.width < 720;
    const horizontalCoverage = isNarrow ? 0.5 : 0.72;
    const verticalCoverage = isNarrow ? 0.36 : 0.58;
    const horizontalZoom = (size.width * horizontalCoverage) / Math.max(bounds.width, 1);
    const verticalZoom = (size.height * verticalCoverage) / Math.max(bounds.height, 1);
    camera.position.set(bounds.center.x, bounds.center.y, 100);
    camera.zoom = Math.min(horizontalZoom, verticalZoom);
    camera.updateProjectionMatrix();
    fittedKey.current = key;
  }, [bounds, camera, size.height, size.width]);

  return null;
}

function PanZoomControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<MapControls | null>(null);

  useEffect(() => {
    const controls = new MapControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.enableRotate = false;
    controls.maxZoom = 160;
    controls.minZoom = 8;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    return () => {
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
  const material = usePulseMaterial(group.color, 0.18);
  const geometry = useMemo(
    () => roundedRectGeometry(group.shape.width, group.shape.height, group.shape.radius),
    [group.shape.height, group.shape.radius, group.shape.width],
  );

  return (
    <group position={[group.shape.center.x, group.shape.center.y, -0.55]}>
      <mesh geometry={geometry}>
        <primitive attach="material" object={material} />
      </mesh>
      <TextSprite
        color="#f8fbff"
        position={[0, group.shape.height / 2 + 0.28, 0.12]}
        scale={[Math.min(group.shape.width * 0.34, 3.2), 0.38, 1]}
        text={group.title}
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
    });

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return buffer;
  }, [directories, edges, files]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#91a4bd" opacity={0.28} transparent />
    </lineSegments>
  );
}

function DirectoryNodesLayer({ directories }: { directories: FrameDirectory[] }) {
  const { geometry, material } = usePointsLayer(
    directories,
    () => '#9fb3c8',
    (directory) => 8 + Math.max(0, 4 - directory.depth),
    -0.02,
  );

  return <points geometry={geometry} material={material} />;
}

function FileNodesLayer({ files }: { files: FrameFile[] }) {
  const { geometry, material } = usePointsLayer(
    files,
    (file) => file.language.color,
    () => 4.4,
    0.08,
  );

  return <points geometry={geometry} material={material} />;
}

function usePointsLayer<T extends { opacity: number; position: Point }>(
  nodes: T[],
  colorFor: (node: T) => string,
  sizeFor: (node: T) => number,
  z: number,
) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(nodes.length * 3);
    const colors = new Float32Array(nodes.length * 3);
    const opacities = new Float32Array(nodes.length);
    const sizes = new Float32Array(nodes.length);
    const color = new THREE.Color();

    nodes.forEach((node, index) => {
      positions[index * 3] = node.position.x;
      positions[index * 3 + 1] = node.position.y;
      positions[index * 3 + 2] = z;
      color.set(colorFor(node));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      opacities[index] = node.opacity;
      sizes[index] = sizeFor(node);
    });

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    buffer.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    buffer.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return buffer;
  }, [colorFor, nodes, sizeFor, z]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        transparent: true,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aOpacity;
          attribute float aSize;
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            vColor = aColor;
            vOpacity = aOpacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;

          void main() {
            vec2 centered = gl_PointCoord - vec2(0.5);
            float distanceToCenter = length(centered);
            float alpha = smoothstep(0.5, 0.22, distanceToCenter) * vOpacity;
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
      }),
    [],
  );

  return { geometry, material };
}

function ContributorSprite({ contributor }: { contributor: FrameContributor }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const material = useAvatarMaterial(contributor.avatarUrl);

  useFrame((_state, delta) => {
    const sprite = spriteRef.current;

    if (!sprite) {
      return;
    }

    sprite.position.lerp(vectorFromPoint(contributor.position, 0.9), 1 - Math.exp(-delta * 5.2));
    sprite.material.opacity +=
      (contributor.opacity - sprite.material.opacity) * (1 - Math.exp(-delta * 7));
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

function BeamMesh({
  beam,
  contributors,
  files,
}: {
  beam: FrameBeam;
  contributors: FrameContributor[];
  files: FrameFile[];
}) {
  const contributor = contributors.find((item) => item.id === beam.fromContributorId);
  const file = files.find((item) => item.path === beam.toFilePath);
  const material = useBeamMaterial(beam.color, beam.intensity * beam.strength * 0.58);
  const geometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), []);

  if (!contributor || !file) {
    return null;
  }

  const from = vectorFromPoint(contributor.position, 0.52);
  const to = vectorFromPoint(file.position, 0.24);
  const direction = to.clone().sub(from);
  const length = direction.length();
  const midpoint = from.clone().add(to).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );

  return (
    <mesh
      geometry={geometry}
      position={midpoint}
      quaternion={quaternion}
      scale={[beam.width * 0.82, length, beam.width * 0.82]}
    >
      <primitive attach="material" object={material} />
    </mesh>
  );
}

function TextSprite({
  color,
  position,
  scale,
  text,
}: {
  color: string;
  position: [number, number, number];
  scale: [number, number, number];
  text: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '700 46px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowBlur = 12;
    context.shadowColor = 'rgba(0,0,0,0.75)';
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.needsUpdate = true;
    return canvasTexture;
  }, [color, text]);

  if (!texture) {
    return null;
  }

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} transparent />
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
    [color, opacity],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uColor!.value.set(color);
  });

  return material;
}

function useBeamMaterial(color: string, intensity: number) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        transparent: true,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying float vPulse;
          uniform float uTime;

          void main() {
            vPulse = 0.72 + 0.28 * sin(uTime * 22.0 + position.y * 16.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying float vPulse;

          void main() {
            gl_FragColor = vec4(uColor, clamp(uIntensity * vPulse, 0.0, 0.95));
          }
        `,
      }),
    [color, intensity],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uIntensity!.value = intensity;
    material.uniforms.uColor!.value.set(color);
  });

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

  return useMemo(
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
