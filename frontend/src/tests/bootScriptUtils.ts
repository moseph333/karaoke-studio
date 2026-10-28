/**
 * Helpers that execute the real zero-FOUC boot script embedded in index.html,
 * so theme boot tests exercise the shipped script instead of a hand-copied clone.
 *
 * Node built-ins are loaded through a runtime require shim (as in other suites) because
 * the app tsconfig intentionally ships without Node type declarations.
 */

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
}

interface NodePath {
  resolve(...segments: string[]): string;
}

const nodeRequire = eval('require') as (mod: string) => unknown;
const fs = nodeRequire('fs') as NodeFs;
const path = nodeRequire('path') as NodePath;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

export function resolveFrontendFile(relativePath: string): string {
  const direct = path.resolve(cwd, relativePath);
  return fs.existsSync(direct) ? direct : path.resolve(cwd, 'frontend', relativePath);
}

export function readFrontendFile(relativePath: string): string {
  return fs.readFileSync(resolveFrontendFile(relativePath), 'utf8');
}

export function readIndexHtml(): string {
  return readFrontendFile('index.html');
}

/** Returns the body of the first inline (src-less) <script> in index.html. */
export function extractBootScript(html: string = readIndexHtml()): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Inline boot script not found in index.html');
  return match[1];
}

/** Executes the shipped boot script against the current jsdom document. */
export function runIndexHtmlBootScript(): void {
  new Function(extractBootScript())();
}
