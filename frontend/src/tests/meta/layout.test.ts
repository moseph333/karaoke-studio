/**
 * The frontend tests' layout: every test file lives in a feature folder under src/tests.
 */

import { describe, it, expect } from 'vitest';

// Read like designTokenGuard: the test tsconfig has no Node types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const testsDir: string = fs.existsSync(path.resolve(cwd, 'src/tests'))
  ? path.resolve(cwd, 'src/tests')
  : path.resolve(cwd, 'frontend/src/tests');

describe('test layout', () => {
  it('keeps no test file at the root of src/tests', () => {
    const atRoot = (fs.readdirSync(testsDir) as string[]).filter((name) =>
      /\.(test|spec)\.tsx?$/.test(name)
    );
    expect(atRoot).toEqual([]);
  });
});
