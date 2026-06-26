import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSidecar, type ParsedSidecar, type RawSidecar } from './domain/sidecar';
import { buildTimelineFrame, type FrameFile, type TimelineFrame } from './domain/timeline';
import { svgToDataUri } from './domain/languages';
import { GourceScene } from './visualization/GourceScene';

const dayMs = 24 * 60 * 60 * 1000;
const sidecarUrl = `${import.meta.env.BASE_URL}sidecars/hell-ui.json`;

export function App() {
  const { error, sidecar } = useSidecar(sidecarUrl);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationTimeRef = useRef<number | null>(null);
  const speedDaysPerSecond = 3.2;

  useEffect(() => {
    if (sidecar && currentTime === null) {
      setCurrentTime(sidecar.timeline.start);
    }
  }, [currentTime, sidecar]);

  useEffect(() => {
    if (!sidecar || !isPlaying) {
      animationTimeRef.current = null;
      return;
    }

    let frameId = 0;

    const tick = (now: number) => {
      if (animationTimeRef.current === null) {
        animationTimeRef.current = now;
        frameId = requestAnimationFrame(tick);
        return;
      }

      const elapsedMs = now - animationTimeRef.current;
      const targetFrameMs = exportState.status === 'recording' ? 33 : 90;

      if (elapsedMs < targetFrameMs) {
        frameId = requestAnimationFrame(tick);
        return;
      }

      animationTimeRef.current = now;
      const deltaSeconds = Math.min(elapsedMs / 1000, 0.25);

      setCurrentTime((time) => {
        const current = time ?? sidecar.timeline.start;

        const nextTime = current + deltaSeconds * speedDaysPerSecond * dayMs;

        if (nextTime >= sidecar.timeline.end) {
          return exportState.status === 'recording'
            ? sidecar.timeline.end
            : sidecar.timeline.start;
        }

        return nextTime;
      });

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [exportState.status, isPlaying, sidecar]);

  useEffect(() => {
    if (
      sidecar &&
      currentTime !== null &&
      currentTime >= sidecar.timeline.end &&
      exportState.status === 'recording'
    ) {
      stopRecording(recorderRef.current);
      recorderRef.current = null;
      setIsPlaying(false);
    }
  }, [currentTime, exportState.status, sidecar]);

  const frame = useMemo<TimelineFrame | null>(() => {
    if (!sidecar || currentTime === null) {
      return null;
    }

    return buildTimelineFrame(sidecar, currentTime, {
      beamDurationHours: speedDaysPerSecond * 24,
      legendWindowDays: 10,
    });
  }, [currentTime, sidecar]);

  const beginExport = useCallback(() => {
    if (!canvas || !sidecar) {
      setExportState({ message: 'Canvas is not ready yet.', status: 'error' });
      return;
    }

    if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') {
      setExportState({ message: 'Video export is not supported in this browser.', status: 'error' });
      return;
    }

    chunksRef.current = [];
    const stream = canvas.captureStream(60);
    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gourcer-${new Date().toISOString().slice(0, 10)}.webm`;
      link.click();
      URL.revokeObjectURL(url);
      setExportState({ message: 'WebM export complete.', status: 'complete' });
    });

    setCurrentTime(sidecar.timeline.start);
    setIsPlaying(true);
    setExportState({ status: 'recording' });
    recorder.start(1000);
  }, [canvas, sidecar]);

  if (error) {
    return (
      <main className="app-shell app-shell--centered">
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!sidecar || !frame) {
    return (
      <main className="app-shell app-shell--centered">
        <p>Loading hell-ui history...</p>
      </main>
    );
  }

  return (
    <main className="app-shell" style={{ background: frame.backgroundColor }}>
      <GourceScene frame={frame} onCanvasReady={setCanvas} />
      <TimelineHud
        exportState={exportState}
        frame={frame}
        isPlaying={isPlaying}
        onExport={beginExport}
        onPlayingChange={setIsPlaying}
        onReset={() => setCurrentTime(sidecar.timeline.start)}
        onTimeChange={setCurrentTime}
        sidecar={sidecar}
      />
      <div
        aria-hidden="true"
        className="graph-debug"
        data-bounds-height={frame.bounds.height}
        data-bounds-width={frame.bounds.width}
        data-current-time={frame.time}
        data-directories={frame.directories.length}
        data-edges={frame.edges.length}
        data-files={frame.files.length}
        data-min-file-clearance={minimumFileClearance(frame.files)}
        data-min-file-spacing={minimumFileDistance(frame.files)}
        data-testid="graph-debug"
      />
    </main>
  );
}

type ExportState =
  | { message?: string; status: 'complete' | 'error' | 'idle' }
  | { status: 'recording' };

function TimelineHud({
  exportState,
  frame,
  isPlaying,
  onExport,
  onPlayingChange,
  onReset,
  onTimeChange,
  sidecar,
}: {
  exportState: ExportState;
  frame: TimelineFrame;
  isPlaying: boolean;
  onExport: () => void;
  onPlayingChange: (value: boolean) => void;
  onReset: () => void;
  onTimeChange: (value: number) => void;
  sidecar: ParsedSidecar;
}) {
  return (
    <div className="hud" data-testid="timeline-hud">
      <header className="topbar">
        <div>
          <p className="eyebrow">hell-ui history</p>
          <h1>Gourcer</h1>
        </div>
        <div className="date-readout">
          <time dateTime={new Date(frame.time).toISOString()}>{formatDate(frame.time)}</time>
          <span>{Math.round(frame.progress * 100)}%</span>
        </div>
      </header>

      <aside className="legend" aria-label="Languages used near current time">
        {frame.languages.slice(0, 8).map((language) => (
          <div className="legend-item" key={`${language.name}:${language.fileCount}`}>
            <img alt="" height="24" src={svgToDataUri(language.icon)} width="24" />
            <span className="legend-color" style={{ background: language.color }} />
            <span>{language.name}</span>
            <strong>{language.fileCount}</strong>
          </div>
        ))}
      </aside>

      <section className="caption-strip" aria-live="polite">
        {frame.captions.map((caption) => (
          <p key={caption}>{caption}</p>
        ))}
      </section>

      <section className="controls" aria-label="Timeline controls">
        <button
          aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
          className="icon-button"
          onClick={() => onPlayingChange(!isPlaying)}
          title={isPlaying ? 'Pause' : 'Play'}
          type="button"
        >
          {isPlaying ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        </button>
        <button
          aria-label="Restart timeline"
          className="icon-button"
          onClick={onReset}
          title="Restart"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={18} />
        </button>
        <input
          aria-label="Scrub timeline"
          max={sidecar.timeline.end}
          min={sidecar.timeline.start}
          onChange={(event) => onTimeChange(Number(event.currentTarget.value))}
          step={60 * 60 * 1000}
          type="range"
          value={frame.time}
        />
        <button
          aria-label="Export WebM video"
          className="icon-button"
          disabled={exportState.status === 'recording'}
          onClick={onExport}
          title="Export WebM"
          type="button"
        >
          <Download aria-hidden="true" size={18} />
        </button>
        <output aria-live="polite">
          {exportState.status === 'recording'
            ? 'Recording'
            : 'message' in exportState
              ? exportState.message
              : ''}
        </output>
      </section>
    </div>
  );
}

function useSidecar(url: string) {
  const [sidecar, setSidecar] = useState<ParsedSidecar | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load sidecar data (${response.status}).`);
        }

        return response.json() as Promise<RawSidecar>;
      })
      .then((rawSidecar) => {
        if (isActive) {
          setSidecar(parseSidecar(rawSidecar));
        }
      })
      .catch((caughtError: unknown) => {
        if (isActive) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unable to load sidecar data.');
        }
      });

    return () => {
      isActive = false;
    };
  }, [url]);

  return { error, sidecar };
}

function preferredMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function stopRecording(recorder: MediaRecorder | null) {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
}

function formatDate(time: number) {
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(time);
}

function minimumFileDistance(files: FrameFile[]) {
  return minimumFileMetric(files, (first, second, distance) => distance);
}

function minimumFileClearance(files: FrameFile[]) {
  return minimumFileMetric(
    files,
    (first, second, distance) => distance - first.radius - second.radius,
  );
}

function minimumFileMetric(
  files: FrameFile[],
  metric: (first: FrameFile, second: FrameFile, distance: number) => number,
) {
  let minimum = Infinity;

  for (let firstIndex = 0; firstIndex < files.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < files.length; secondIndex += 1) {
      const first = files[firstIndex];
      const second = files[secondIndex];

      if (!first || !second) {
        continue;
      }

      const distance = Math.hypot(
        first.position.x - second.position.x,
        first.position.y - second.position.y,
      );
      minimum = Math.min(minimum, metric(first, second, distance));
    }
  }

  return Number.isFinite(minimum) ? Math.round(minimum * 1000) / 1000 : 0;
}
