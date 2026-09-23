import { describe, it, expect } from 'vitest';
import { deriveCaps } from './components/EnvInfo';
import type { EnvInfo } from './types';

function makeEnv(overrides: Partial<EnvInfo> = {}): EnvInfo {
  return {
    dockerOk: true,
    buildxOk: true,
    daemonOk: true,
    builderOk: true,
    builderPlatforms: [],
    dockerVersion: '24.0',
    buildxVersion: '0.12',
    hostArch: '',
    mirror: {
      imported: false,
      configExists: false,
      containersRunning: 0,
      containersTotal: 0,
      builderConfigured: false,
    },
    ...overrides,
  };
}

describe('deriveCaps', () => {
  it('detects amd64 host from builder platforms', () => {
    const caps = deriveCaps(makeEnv({ hostArch: 'amd64', builderPlatforms: ['linux/amd64'] }));
    expect(caps.hostArch).toBe('amd64');
    expect(caps.canAmd64).toBe(true);
    expect(caps.canArm64).toBe(false);
    expect(caps.qemu).toBe(false);
    expect(caps.crossArch).toBe('arm64');
  });

  it('detects arm64 host with cross-arch via qemu', () => {
    const caps = deriveCaps(makeEnv({
      hostArch: 'arm64',
      builderPlatforms: ['linux/arm64', 'linux/amd64'],
    }));
    expect(caps.hostArch).toBe('arm64');
    expect(caps.canAmd64).toBe(true);
    expect(caps.canArm64).toBe(true);
    expect(caps.qemu).toBe(true);
    expect(caps.crossArch).toBe('amd64');
  });

  it('amd64 host with arm64 platform means qemu available', () => {
    const caps = deriveCaps(makeEnv({
      hostArch: 'amd64',
      builderPlatforms: ['linux/amd64', 'linux/arm64'],
    }));
    expect(caps.qemu).toBe(true);
    expect(caps.crossArch).toBe('arm64');
  });

  it('unknown host arch requires both platforms for qemu', () => {
    const caps = deriveCaps(makeEnv({
      hostArch: '',
      builderPlatforms: ['linux/amd64'],
    }));
    expect(caps.qemu).toBe(false);
    expect(caps.crossArch).toBe('amd64/arm64');
  });

  it('unknown host with both platforms enables qemu', () => {
    const caps = deriveCaps(makeEnv({
      hostArch: '',
      builderPlatforms: ['linux/amd64', 'linux/arm64'],
    }));
    expect(caps.qemu).toBe(true);
  });

  it('empty platforms means no capabilities', () => {
    const caps = deriveCaps(makeEnv({ hostArch: 'amd64', builderPlatforms: [] }));
    expect(caps.canAmd64).toBe(false);
    expect(caps.canArm64).toBe(false);
    expect(caps.qemu).toBe(false);
  });

  it('handles platforms with variant (e.g. linux/arm/v7)', () => {
    const caps = deriveCaps(makeEnv({
      hostArch: 'amd64',
      builderPlatforms: ['linux/amd64', 'linux/arm/v7'],
    }));
    expect(caps.canAmd64).toBe(true);
    expect(caps.canArm64).toBe(false);
  });
});
