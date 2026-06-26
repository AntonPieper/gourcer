import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type {
  FrameBeam,
  FrameContributor,
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
      camera={{ fov: 46, position: [0, 0, 23] }}
      className="gource-canvas"
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => onCanvasReady(gl.domElement)}
    >
      <SceneContents frame={frame} />
    </Canvas>
  );
}

function SceneContents({ frame }: { frame: TimelineFrame }) {
  return (
    <>
      <SceneBackground color={frame.backgroundColor} />
      <ambientLight intensity={1.6} />
      <group>
        {frame.groups.map((group) => (
          <SemanticGroupMesh group={group} key={group.id} />
        ))}
        {frame.files.map((file) => (
          <FileNodeMesh file={file} key={file.path} />
        ))}
        {frame.beams.map((beam) => (
          <BeamMesh beam={beam} files={frame.files} contributors={frame.contributors} key={beam.id} />
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

function SemanticGroupMesh({ group }: { group: FrameGroup }) {
  const material = usePulseMaterial(group.color, 0.28);
  const geometry = useMemo(
    () => roundedRectGeometry(group.shape.width, group.shape.height, group.shape.radius),
    [group.shape.height, group.shape.radius, group.shape.width],
  );

  return (
    <group position={[group.shape.center.x, group.shape.center.y, -0.45]}>
      <mesh geometry={geometry}>
        <primitive attach="material" object={material} />
      </mesh>
      <TextSprite
        color="#f8fbff"
        position={[0, group.shape.height / 2 + 0.34, 0.08]}
        scale={[group.shape.width * 0.42, 0.48, 1]}
        text={group.title}
      />
    </group>
  );
}

function FileNodeMesh({ file }: { file: FrameFile }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;

    if (!mesh) {
      return;
    }

    mesh.position.lerp(vectorFromPoint(file.position, 0.1), 1 - Math.exp(-delta * 8));
  });

  return (
    <mesh ref={meshRef} position={[file.position.x, file.position.y, 0.1]}>
      <circleGeometry args={[0.12, 28]} />
      <meshBasicMaterial color={file.language.color} />
    </mesh>
  );
}

function ContributorSprite({ contributor }: { contributor: FrameContributor }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const material = useAvatarMaterial(contributor.avatarUrl);

  useFrame((_state, delta) => {
    const sprite = spriteRef.current;

    if (!sprite) {
      return;
    }

    sprite.position.lerp(vectorFromPoint(contributor.position, 0.9), 1 - Math.exp(-delta * 4.5));
    sprite.material.opacity +=
      (contributor.opacity - sprite.material.opacity) * (1 - Math.exp(-delta * 6));
    sprite.material.needsUpdate = true;
  });

  return (
    <sprite
      ref={spriteRef}
      material={material}
      position={[contributor.position.x, contributor.position.y, 0.9]}
      scale={[0.72, 0.72, 1]}
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
  const material = useBeamMaterial(beam.color, beam.intensity);
  const geometry = useMemo(() => {
    const from = vectorFromPoint(contributor?.position ?? { x: 0, y: 0 }, 0.65);
    const to = vectorFromPoint(file?.position ?? { x: 0, y: 0 }, 0.35);
    return new THREE.BufferGeometry().setFromPoints([from, to]);
  }, [contributor?.position, file?.position]);
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  if (!contributor || !file) {
    return null;
  }

  return <primitive object={line} />;
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
            float edge = smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
            float pulse = 0.08 * sin(uTime * 1.7 + vUv.y * 8.0);
            gl_FragColor = vec4(uColor + pulse, uOpacity * edge);
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
            vPulse = 0.65 + 0.35 * sin(uTime * 18.0 + position.x * 4.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying float vPulse;

          void main() {
            gl_FragColor = vec4(uColor, uIntensity * vPulse);
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
    () =>
      new THREE.SpriteMaterial({
        color: texture ? '#ffffff' : '#9fb3c8',
        map: texture ?? undefined,
        opacity: 0,
        transparent: true,
      }),
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

  return new THREE.ShapeGeometry(shape, 32);
}

function vectorFromPoint(point: Point, z: number) {
  return new THREE.Vector3(point.x, point.y, z);
}
