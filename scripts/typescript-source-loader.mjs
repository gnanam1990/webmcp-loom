/**
 * Lets Node's built-in TypeScript stripping execute repository source whose
 * ESM imports use production `.js` specifiers. It is only a local benchmark
 * convenience; builds and tests keep using the normal TypeScript/Vite paths.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
