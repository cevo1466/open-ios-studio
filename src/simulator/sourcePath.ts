/** Match compiler paths to workspace-relative editor paths on both POSIX and Windows. */
export function sourcePath(workspace: string, file: string | null | undefined): string | null {
  if (!file) return null;
  const normalize = (path: string) => path.replace(/^\\\\\?\\UNC\\/, '//').replace(/^\\\\\?\\/, '').replaceAll('\\', '/');
  const root = normalize(workspace).replace(/\/$/, '');
  const path = normalize(file);
  const windows = /^[A-Za-z]:\//.test(root) || root.startsWith('//');
  const starts = windows ? path.toLowerCase().startsWith(root.toLowerCase() + '/') : path.startsWith(root + '/');
  return starts ? path.slice(root.length + 1) : path;
}
