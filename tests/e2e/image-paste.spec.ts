import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { launchDocument, mod, savedSource } from './helpers';

const png = [...readFileSync(new URL('../fixtures/assets/中文 图标.png', import.meta.url))];
// Synthetic 16×16 green square with a dark center, encoded by Chromium canvas.
// WebKit can decode WebP but cannot encode this fixture via canvas.toBlob.
const webp = [...Buffer.from('UklGRkQCAABXRUJQVlA4WAoAAAAgAAAADwAADwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggVgAAAFACAJ0BKhAAEAABQCYlsAJ0fwVv/oAHwAA7AAD+2mV/6Wk//Sp9//6ZQRrcQpRrkr3/1TKxjnrIqlf/6piux35vyCf/9UyrP751vBP6yNlCPv/0MAAA', 'base64')];

// Only file IPC is substituted. Clipboard files, image decoding, CodeMirror
// position mapping, history and the rendered image use the real browser.
async function imageStorage(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    const state = w.__acceptance;
    state.imageWrites = [];
    state.pauseImage = false;
    state.fileUrls = [];
    state.revokedFileUrls = [];
    const createUrl = URL.createObjectURL.bind(URL);
    const revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value: Blob | MediaSource) => {
      const url = createUrl(value);
      if (value instanceof File) state.fileUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      if (state.fileUrls.includes(url)) state.revokedFileUrls.push(url);
      revokeUrl(url);
    };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'save_pasted_image') {
        state.calls.push({ command, args });
        if (state.pauseImage) await new Promise<void>(resolve => { state.releaseImage = resolve; });
        const extension = args.name.split('.').at(-1);
        const relativePath = `images/paste-${state.imageWrites.length + 1}.${extension}`;
        state.imageWrites.push({ ...args, relativePath });
        return { relativePath, name: relativePath.split('/').at(-1) };
      }
      if (command === 'read_local_image') {
        const stored = state.imageWrites.find((item: any) => item.relativePath === args.source);
        if (stored) return { bytes: [...atob(stored.data)].map(c => c.charCodeAt(0)), mime: 'image/' + (stored.name.endsWith('.jpg') ? 'jpeg' : stored.name.split('.').at(-1)) };
      }
      return original(command, args);
    };
  });
}

async function pasteFiles(page: Page, files: { bytes: number[]; name: string; type: string }[]) {
  await page.locator('.cm-content').evaluate((editor, files) => {
    const clipboard = new DataTransfer();
    for (const file of files) clipboard.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, files);
}

async function start(page: Page, unsaved = false) {
  await launchDocument(page, '# Original\n', 'acceptance.md', 'ready', 'system', { unsaved });
  await imageStorage(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
}

for (const file of [
  { bytes: [137, 80, 78, 71, 13, 10, 26, 10], name: 'truncated.png', type: 'image/png' },
  { bytes: [255, 216, 255], name: 'truncated.jpg', type: 'image/jpeg' },
  { bytes: [...Buffer.from('RIFFxxxxWEBP')], name: 'truncated.webp', type: 'image/webp' },
]) {
  test(`image paste: ${file.name} is rejected before file IPC or a document edit`, async ({ page }) => {
    await start(page);
    await pasteFiles(page, [file]);
    await expect(page.locator('.toast')).toContainText(/图片.*(无效|损坏|解码)/);
    expect(await page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_pasted_image'))).toEqual([]);
    expect(await page.evaluate(() => {
      const state = (window as any).__acceptance;
      return state.fileUrls.length === 1 && state.revokedFileUrls[0] === state.fileUrls[0];
    })).toBe(true);
    expect(await savedSource(page)).toBe('# Original\n');
  });
}

// Encode small, visibly synthetic rasters with the real browser. There are no
// downloaded photos or private clipboard contents in these fixtures.
async function raster(page: Page, format: 'png' | 'jpg' | 'webp') {
  if (format === 'png') return png;
  if (format === 'webp') return webp;
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3c8'; context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#123'; context.fillRect(4, 4, 8, 8);
    const type = 'image/jpeg';
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type));
    if (!blob || blob.type !== type) throw new Error('Browser did not encode the requested fixture format');
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
}

for (const format of ['png', 'jpg', 'webp'] as const) {
  test(`image paste: real ${format} bytes render and undo removes only the reference`, async ({ page }) => {
    await start(page);
    const bytes = await raster(page, format);
    await pasteFiles(page, [{ bytes, name: `合成[图片].${format}`, type: format === 'jpg' ? 'image/jpeg' : `image/${format}` }]);
    const expected = '# Original\n![合成\\[图片\\]](images/paste-1.' + format + ')';
    await expect(page.locator('.toast')).toContainText('已插入 1 张图片');
    expect(await savedSource(page)).toBe(expected);
    const image = page.locator('.preview-pane img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => (window as any).__acceptance.imageWrites[0].data)).toBe(Buffer.from(bytes).toString('base64'));
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+z`);
    expect(await savedSource(page)).toBe('# Original\n');
    expect(await page.evaluate(() => (window as any).__acceptance.imageWrites.length)).toBe(1);
  });
}

async function pauseDecode(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      w.__acceptance.decodeStarted = true;
      await new Promise<void>(resolve => { w.__acceptance.releaseDecode = resolve; });
      try { return await original.call(this); }
      finally { w.__acceptance.decodeFinished = true; }
    };
  });
}

test('image paste: cancelling the unsaved-document save writes no image or reference', async ({ page }) => {
  await start(page, true);
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = true; });
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__acceptance.imageWrites)).toEqual([]);
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = false; });
  expect(await savedSource(page)).toBe('# Original\n');
});

test('image paste: an unsaved document is saved before writing the relative image', async ({ page }) => {
  await start(page, true);
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect(page.locator('.toast')).toContainText('已插入 1 张图片');
  const state = await page.evaluate(() => {
    const state = (window as any).__acceptance;
    return { calls: state.calls.filter((call: any) => ['save_local_markdown', 'save_pasted_image'].includes(call.command)).map((call: any) => call.command), write: state.imageWrites[0], saved: state.saved[0] };
  });
  expect(state.calls).toEqual(['save_local_markdown', 'save_pasted_image']);
  expect(state.write.documentPath).toBe(state.saved.path);
  expect(state.saved.content).toBe('# Original\n');
  expect(await savedSource(page)).toBe('# Original\n![synthetic](images/paste-1.png)');
});

test('image paste: replacing the selected range during decode cancels without orphan files', async ({ page }) => {
  await start(page);
  await page.keyboard.press(`${mod}+a`);
  await pauseDecode(page);
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.decodeStarted)).toBe(true);
  await page.keyboard.insertText('# Replacement\n');
  await page.evaluate(() => (window as any).__acceptance.releaseDecode());
  await expect(page.locator('.toast')).toContainText('粘贴位置或文档已变化');
  expect(await page.evaluate(() => (window as any).__acceptance.imageWrites)).toEqual([]);
  expect(await savedSource(page)).toBe('# Replacement\n');
});

async function openNext(page: Page) {
  await page.evaluate(() => {
    const state = (window as any).__acceptance;
    state.nextFile = { path: '/acceptance/next.md', name: 'next.md', content: '# Next\n' };
    state.disk[state.nextFile.path] = state.nextFile.content;
  });
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('next');
}

test('image paste: a document switch during decoding starts no obsolete image write', async ({ page }) => {
  await start(page);
  await pauseDecode(page);
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.decodeStarted)).toBe(true);
  await openNext(page);
  await page.evaluate(() => (window as any).__acceptance.releaseDecode());
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.decodeFinished)).toBe(true);
  expect(await savedSource(page)).toBe('# Next\n');
  expect(await page.evaluate(() => (window as any).__acceptance.imageWrites)).toEqual([]);
});

test('image paste: edits before a pending insertion map its position and preserve separate undo', async ({ page }) => {
  await start(page);
  await pauseDecode(page);
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.decodeStarted)).toBe(true);
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.insertText('PREFIX\n');
  await page.evaluate(() => (window as any).__acceptance.releaseDecode());
  await expect(page.locator('.toast')).toContainText('已插入 1 张图片');
  expect(await savedSource(page)).toBe('PREFIX\n# Original\n![synthetic](images/paste-1.png)');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+z`);
  expect(await savedSource(page)).toBe('PREFIX\n# Original\n');
});

test('image paste: an already started write cannot insert into a different document', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { (window as any).__acceptance.pauseImage = true; });
  await pasteFiles(page, [{ bytes: png, name: 'synthetic.png', type: 'image/png' }]);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__acceptance.releaseImage)).toBe('function');
  await openNext(page);
  await page.evaluate(() => (window as any).__acceptance.releaseImage());
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.imageWrites.length)).toBe(1);
  expect(await savedSource(page)).toBe('# Next\n');
  expect(await page.evaluate(() => (window as any).__acceptance.imageWrites[0].documentPath)).toBe('/acceptance/acceptance.md');
});

test('image paste: empty, over-20-MB and more-than-ten files never reach file IPC', async ({ page }) => {
  await start(page);
  for (const mode of ['empty', 'large', 'many']) {
    await page.locator('.cm-content').evaluate((editor, mode) => {
      const clipboard = new DataTransfer();
      const size = mode === 'empty' ? 0 : mode === 'large' ? 20 * 1024 * 1024 + 1 : 8;
      for (let n = 0; n < (mode === 'many' ? 11 : 1); n++) clipboard.items.add(new File([new Uint8Array(size)], `synthetic-${n}.png`, { type: 'image/png' }));
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, mode);
    await expect(page.locator('.toast')).toContainText('每次最多粘贴 10 张图片，每张不超过 20 MB');
    expect(await page.evaluate(() => (window as any).__acceptance.imageWrites)).toEqual([]);
    expect(await savedSource(page)).toBe('# Original\n');
  }
});

// Valid, solid-black grayscale PNGs exercise the real decoder at the dimension
// boundaries without a large checked-in image or a mocked naturalWidth.
function blackPng(width: number, height: number) {
  function chunk(type: string, data: Buffer) {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8;
  return [...Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))), chunk('IEND', Buffer.alloc(0)),
  ])];
}

for (const [width, height] of [[8000, 5001], [1, 32769]]) {
  test(`image paste: decoded ${width}×${height} PNG exceeds the accepted dimensions`, async ({ page }) => {
    await start(page);
    const bytes = blackPng(width, height);
    expect(bytes.length).toBeLessThan(20 * 1024 * 1024);
    await pasteFiles(page, [{ bytes, name: 'synthetic-dimension-limit.png', type: 'image/png' }]);
    await expect(page.locator('.toast')).toContainText('图片尺寸过大');
    expect(await page.evaluate(() => (window as any).__acceptance.imageWrites)).toEqual([]);
    expect(await savedSource(page)).toBe('# Original\n');
  });
}
