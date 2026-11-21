import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chompyyHome } from '../src/home.js';

// The guard itself: a test with no useTempHome still gets a throwaway home, never ~/.chompyy.
describe('tests and your real Chompyy folder', () => {
  it('a test that sets nothing up does not see the real home', () => {
    expect(chompyyHome()).not.toBe(join(homedir(), '.chompyy'));
    expect(chompyyHome()).toContain('chompyy-default-home-');
  });
});
