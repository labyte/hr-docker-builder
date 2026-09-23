import { describe, it, expect, vi } from 'vitest';
import { errText, dirOf, joinPath, baseName } from './utils';

vi.mock('./i18n', () => ({
  default: {
    exists: (key: string) => key === 'errors.docker_missing' || key === 'errors.builder_create_failed',
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'errors.docker_missing') return 'Docker not found';
      if (key === 'errors.builder_create_failed') return `Failed: ${opts?.msg ?? ''}`;
      return key;
    },
  },
}));

describe('errText', () => {
  it('maps known key to i18n string', () => {
    expect(errText('docker_missing')).toBe('Docker not found');
  });

  it('passes detail after colon as msg', () => {
    expect(errText('builder_create_failed: timeout')).toBe('Failed: timeout');
  });

  it('returns raw string for unknown key', () => {
    expect(errText('some_unknown_error')).toBe('some_unknown_error');
  });

  it('handles non-string input', () => {
    expect(errText(42)).toBe('42');
    expect(errText(null)).toBe('null');
    expect(errText(undefined)).toBe('undefined');
  });

  it('handles key with colon but no i18n match', () => {
    const result = errText('project_not_found:p123');
    expect(result).toBe('project_not_found:p123');
  });
});

describe('dirOf', () => {
  it('extracts directory from unix path', () => {
    expect(dirOf('/home/user/file.txt')).toBe('/home/user');
  });

  it('extracts directory from windows path', () => {
    expect(dirOf('C:\\Users\\test\\file.txt')).toBe('C:\\Users\\test');
  });

  it('returns empty for bare filename', () => {
    expect(dirOf('file.txt')).toBe('');
  });

  it('strips trailing slashes then extracts parent', () => {
    expect(dirOf('/home/user/')).toBe('/home');
  });

  it('handles mixed separators', () => {
    expect(dirOf('/home/user\\file.txt')).toBe('/home/user');
  });
});

describe('joinPath', () => {
  it('joins with forward slash for unix-style dir', () => {
    expect(joinPath('/home/user', 'file.txt')).toBe('/home/user/file.txt');
  });

  it('joins with backslash for windows-style dir', () => {
    expect(joinPath('C:\\Users\\test', 'file.txt')).toBe('C:\\Users\\test\\file.txt');
  });

  it('returns name when dir is empty', () => {
    expect(joinPath('', 'file.txt')).toBe('file.txt');
  });

  it('strips trailing slash from dir before joining', () => {
    expect(joinPath('/home/user/', 'file.txt')).toBe('/home/user/file.txt');
    expect(joinPath('C:\\Users\\', 'file.txt')).toBe('C:\\Users\\file.txt');
  });
});

describe('baseName', () => {
  it('extracts filename from unix path', () => {
    expect(baseName('/home/user/file.txt')).toBe('file.txt');
  });

  it('extracts filename from windows path', () => {
    expect(baseName('C:\\Users\\test\\file.txt')).toBe('file.txt');
  });

  it('returns input when no separator', () => {
    expect(baseName('file.txt')).toBe('file.txt');
  });

  it('strips trailing slashes before extracting', () => {
    expect(baseName('/home/user/')).toBe('user');
  });

  it('handles root path', () => {
    expect(baseName('/')).toBe('');
  });
});
