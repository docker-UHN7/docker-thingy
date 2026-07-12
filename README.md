# Docker Project Explorer

A desktop app (Electron Forge + React + TypeScript) for exploring Docker Compose projects, Dockerfiles, and live container/runtime state — with a focus on safe, read-heavy workflows first.

## Features

- Visual graph of Compose services, networks, and volumes (`@xyflow/react` + `elkjs` + `d3-force`)
- Built-in YAML/Dockerfile editor with syntax highlighting (CodeMirror)
- Live Docker state via the Docker CLI/daemon (`dockerode`)
- Demo projects included under [`demo-projects/`](demo-projects) for trying the app without a real setup

## Prerequisites

- Node.js 22.13+ and npm 11+ (see `engines` in `package.json`)
- Docker CLI available on the machine for runtime features

## Getting started

```bash
npm install
npm start
```

`npm start` launches the Electron Forge dev app (main + preload + renderer via Webpack).

## Scripts

| Command             | Description                                  |
| -------------------- | --------------------------------------------- |
| `npm start`           | Run the app in development (Electron Forge)   |
| `npm run dev`         | Alternate dev entry point (`scripts/dev.js`)  |
| `npm run headless`    | Run the headless entry point (`src/headless.ts`) |
| `npm run package`     | Package the app without creating installers   |
| `npm run make`        | Build platform installers/distributables      |
| `npm test`            | Run the test suite once (Vitest)              |
| `npm run test:watch`  | Run tests in watch mode                       |
| `npm run typecheck`   | Type-check with `tsc --noEmit`                |
| `npm run check`       | Typecheck + tests (use before committing)     |

## Project structure

```
src/
  main/       # Electron main process
  preload.ts  # Preload bridge
  renderer/   # React UI (renderer process)
  shared/     # Code shared between main and renderer
  types/      # Shared TypeScript types
demo-projects/  # Sample Docker/Compose setups for manual testing
resources/      # App icons and static assets
scripts/        # Dev/build helper scripts
tests/          # Test suites
```

## Contributing

Before opening a PR, run:

```bash
npm run check
```

## License

MIT — see [LICENSE](LICENSE).
