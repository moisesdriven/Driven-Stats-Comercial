import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/migrar.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Los paquetes del monorepo se distribuyen como TypeScript: se empaquetan dentro del worker.
  noExternal: [/^@driven\//],
});
