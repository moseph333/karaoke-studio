/**
 * Reads files of the frontend package (index.html, the stylesheet, public/) as text, for
 * tests that check what ships rather than what a component renders.
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
