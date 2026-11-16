import { defineConfig } from 'tsup';

/** Comandos de administración que se ejecutan dentro del contenedor web (p. ej. crear-admin). */
export default defineConfig({
  entry: { 'crear-admin': 'src/cli/crear-admin.ts' },
  outDir: 'cli',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  clean: true,
  // Se empaqueta todo salvo el módulo nativo de Argon2 (dependencia de la web, ya incluida en la
  // imagen de Next). tsup deja fuera las dependencias del package.json salvo las de noExternal.
  noExternal: [/^@driven\//, /^drizzle-orm/, /^pg$/, /^zod/],
  external: ['pg-native'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
