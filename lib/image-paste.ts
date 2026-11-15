export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PASTED_IMAGE_PIXELS = 40_000_000;
export const MAX_PASTED_IMAGE_SIDE = 32_768;

/** Validate with the same browser decoder used by the preview before writing.
 * The dimension limit bounds accepted images; decoding itself is browser-managed. */
export async function validatePastedImage(file: File): Promise<void> {
  if (!file.size || file.size > MAX_PASTED_IMAGE_BYTES) {
    throw new Error('每次最多粘贴 10 张图片，每张不超过 20 MB。');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    try {
      image.src = url;
      await image.decode();
    } catch {
      throw new Error('图片数据无效');
    }
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new Error('图片数据无效');
    }
    if (width > MAX_PASTED_IMAGE_SIDE || height > MAX_PASTED_IMAGE_SIDE
      || width * height > MAX_PASTED_IMAGE_PIXELS) {
      throw new Error('图片尺寸过大：最多 4000 万像素，单边不超过 32768 像素。');
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
