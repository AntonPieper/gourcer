# Gourcer

Gourcer is a browser-native Gource-style repository history visualizer. It uses
Three.js, shader materials, a generated sidecar dataset, real-time language
legends, captions, contributor Gravatar sprites, timeline scrubbing, and WebM
canvas export.

The committed sample sidecar is generated from `/Users/apieper/dev/hell-ui`:

```bash
pnpm run sidecar:hell-ui
```

## Local Development

```bash
pnpm install
pnpm run start
```

## Validation

```bash
pnpm run lint
pnpm run test
pnpm run build
pnpm run ci:e2e
```

GitHub Pages is published from `.github/workflows/pages.yml`.
