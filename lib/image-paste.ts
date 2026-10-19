/** Capture files synchronously: clipboard data is unavailable after the paste event. */
export function clipboardImageFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files);
  const candidates = files.length ? files : Array.from(data.items)
    .filter((item) => item.kind === 'file').flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
  return candidates.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name));
}

export function imageMarkdown(relativePath: string, name: string): string {
  const label = name.replace(/\.[^.]+$/, '').replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');
  const path = relativePath.split('/').map((part) => encodeURIComponent(part).replace(/[()]/g, (char) => char === '(' ? '%28' : '%29')).join('/');
  return `![${label}](${path})`;
}
