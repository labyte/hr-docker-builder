import i18n from './i18n';

/** Rust 后端错误串形如 "key" 或 "key: detail"，映射到 errors.* 语言包 */
export function errText(e: unknown): string {
  const s = String(e);
  const idx = s.indexOf(':');
  const key = (idx >= 0 ? s.slice(0, idx) : s).trim();
  const msg = idx >= 0 ? s.slice(idx + 1).trim() : '';
  return i18n.exists(`errors.${key}`) ? i18n.t(`errors.${key}`, { msg }) : s;
}

export function dirOf(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return i > 0 ? norm.slice(0, i) : '';
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

export function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return i >= 0 ? norm.slice(i + 1) : norm;
}
