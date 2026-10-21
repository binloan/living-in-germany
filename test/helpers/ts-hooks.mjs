// Module hooks for the tests: the sources import each other without a file extension (Vite resolves those), Node does not.
export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    try { return await nextResolve(`${specifier}.ts`, context); } catch { /* not a TypeScript file: fall through */ }
  }
  return nextResolve(specifier, context);
}
