import { expect, test, type Page } from '@playwright/test';
import { editorSource, launchDocument } from './helpers';

// Synthetic project content and credentials. The native IPC boundary is mocked;
// these tests do not establish native folder access or live-provider acceptance.
const original = '# SYNTHETIC project document\n\nSYNTHETIC original body\n';
const firstOutput = '# SYNTHETIC proposed document\n\nSYNTHETIC first output\n';
const appliedOutput = '# SYNTHETIC applied document\n\nSYNTHETIC accepted output\n';
const nextDocument = '# SYNTHETIC next document\n';

async function setup(page: Page) {
  await launchDocument(page, original, 'synthetic-project.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__projectConversation = {
      folder: {
        id: 'synthetic-folder-1', name: 'SYNTHETIC repository', truncated: false,
        files: ['README.md', 'src/service.ts', 'docs/design.md'].map(path => ({ path, name: path.split('/').at(-1), bytes: 100 })),
      },
      contents: {
        'README.md': '# SYNTHETIC repository readme',
        'src/service.ts': 'export const syntheticVersion = 1;',
        'docs/design.md': '# SYNTHETIC design',
      },
      requests: [], reads: [], released: [], attached: [], response: '# SYNTHETIC first response\n',
      pendingRead: false, readError: '', releaseRead: null, completedReads: 0,
      pendingPick: false, releasePick: null, pickCalls: 0,
    };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      const state = w.__projectConversation;
      if (command === 'pick_ai_context_folder') {
        state.pickCalls++;
        const folder = structuredClone(state.folder);
        if (state.pendingPick) return new Promise(resolve => { state.releasePick = () => resolve(folder); });
        return folder;
      }
      if (command === 'refresh_ai_context_folder') return structuredClone(state.folder);
      if (command === 'release_ai_context_folder') { state.released.push(args.folderId); return; }
      if (command === 'pick_ai_context_files') return structuredClone(state.attached);
      if (command === 'read_ai_context_folder_files') {
        state.reads.push(structuredClone(args));
        const files = args.paths.map((path: string) => ({ path: `context:${args.folderId}/${path}`, name: path, content: state.contents[path] }));
        const error = state.readError;
        if (state.pendingRead) await new Promise<void>(resolve => { state.releaseRead = resolve; });
        state.completedReads++;
        if (error) throw error;
        return files;
      }
      if (command === 'stream_ai') {
        state.requests.push(structuredClone(args.request));
        args.onEvent.onmessage({ type: 'delta', text: state.response });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      if (command === 'cancel_ai') return;
      return invoke(command, args);
    };
  });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('API endpoint', { exact: true }).fill('http://127.0.0.1:1/v1');
  await settings.getByLabel('Model name', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API key', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: 'Save securely', exact: true }).click();
  await openAssistant(page);
}

async function openAssistant(page: Page) {
  await page.getByRole('button', { name: 'AI writing assistant', exact: true }).click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
}

async function chooseFolder(page: Page) {
  await page.getByRole('button', { name: 'Choose repository or folder', exact: true }).click();
  await expect(page.locator('.project-context-heading')).toContainText('SYNTHETIC repository');
}

async function selectFile(page: Page, path: string) {
  await page.locator('.project-context-files label').filter({ hasText: path }).locator('input').check();
}

async function generate(page: Page, instruction: string, response = firstOutput) {
  const oldText = await editorSource(page);
  await page.evaluate(response => { (window as any).__projectConversation.response = response; }, JSON.stringify({ edits: [{ oldText, newText: response }] }));
  await page.locator('.assistant-action').filter({ hasText: 'Custom instruction' }).click();
  await page.getByLabel('Tell AI what you need', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
}

async function readyProposal(page: Page) {
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeEnabled();
}

async function request(page: Page, index: number) {
  return page.evaluate(index => (window as any).__projectConversation.requests[index], index);
}

async function externalOpen(page: Page) {
  await page.evaluate(content => {
    const state = (window as any).__acceptance;
    const document = { path: '/acceptance/synthetic-next.md', name: 'synthetic-next.md', content };
    state.disk[document.path] = content;
    state.emit('local-opened', { kind: 'file', document });
  }, nextDocument);
  await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toHaveValue('synthetic-next');
}

test('project files are read fresh on follow-up and conversation records proposed, applied and discarded outputs', async ({ page, browserName }) => {
  await setup(page);
  await chooseFolder(page);
  await page.getByRole('searchbox', { name: 'Search context files', exact: true }).fill('service');
  await expect(page.locator('.project-context-files label')).toHaveCount(1);
  await selectFile(page, 'src/service.ts');
  await expect(page.locator('.assistant-context-files footer')).toContainText('Selected 1/12 files');
  await generate(page, 'SYNTHETIC create project documentation');
  await readyProposal(page);
  expect((await request(page, 0)).history).toEqual([]);
  expect((await request(page, 0)).prompt).toContain('export const syntheticVersion = 1;');
  expect((await request(page, 0)).prompt).toContain('name="src/service.ts"');
  expect((await request(page, 0)).prompt).not.toContain('SYNTHETIC repository readme');
  await page.getByRole('button', { name: 'Continue conversation', exact: true }).click();
  expect(await editorSource(page)).toBe(original);
  const turns = page.locator('.ai-conversation-turns > li');
  await expect(turns).toHaveCount(1);
  await expect(turns.first()).toContainText('Not applied');
  await expect(page.getByLabel('Tell AI what you need', { exact: true })).toHaveValue('');
  await page.locator('.assistant-scroll').evaluate(element => {
    const compose = element.querySelector('.assistant-compose')!;
    element.scrollTop += compose.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  await page.screenshot({ path: `outputs/project-conversation-${browserName}.png` });

  await page.evaluate(() => { (window as any).__projectConversation.contents['src/service.ts'] = 'export const syntheticVersion = 2;'; });
  await generate(page, 'SYNTHETIC add the new service version', appliedOutput);
  await readyProposal(page);
  const second = await request(page, 1);
  expect(second.history.map((message: any) => message.role)).toEqual(['user', 'assistant']);
  expect(second.history[0].content).toContain('Do not assume it was applied');
  expect(second.history[1].content).toBe(firstOutput);
  expect(second.prompt).toContain(original);
  expect(second.prompt).toContain('syntheticVersion = 2');
  expect(second.prompt).not.toContain('syntheticVersion = 1');
  await page.getByRole('button', { name: 'Accept and replace', exact: true }).click();
  expect(await editorSource(page)).toBe(appliedOutput);
  await openAssistant(page);
  await expect(turns.nth(1)).toContainText('Applied');

  await generate(page, 'SYNTHETIC discard this rewrite', '# SYNTHETIC discarded output\n');
  await readyProposal(page);
  const third = await request(page, 2);
  expect(third.history[2].content).toContain('was applied at that time');
  expect(third.prompt).toContain(appliedOutput);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await openAssistant(page);
  await expect(turns.nth(2)).toContainText('Discarded');
  await generate(page, 'SYNTHETIC retry after rejected rewrite');
  await readyProposal(page);
  expect((await request(page, 3)).history[4].content).toContain('was discarded');
  await page.getByRole('button', { name: 'Continue conversation', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(turns).toHaveCount(0);
  expect(await editorSource(page)).toBe(appliedOutput);
  await generate(page, 'SYNTHETIC isolated new conversation');
  await readyProposal(page);
  expect((await request(page, 4)).history).toEqual([]);
  expect((await request(page, 4)).prompt).toContain('syntheticVersion = 2');
});

test('failed project file reads prevent model calls and allow retry with the selected files', async ({ page }) => {
  await setup(page);
  await chooseFolder(page);
  await selectFile(page, 'README.md');
  await page.evaluate(() => { (window as any).__projectConversation.readError = '上下文文件必须使用 UTF-8 编码'; });
  await generate(page, 'SYNTHETIC request with unreadable reference');
  await expect(page.locator('.diff-error')).toHaveText('Context files must use UTF-8 encoding');
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__projectConversation.requests.length)).toBe(0);
  expect(await editorSource(page)).toBe(original);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await openAssistant(page);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  await expect(page.locator('.project-context-selected')).toContainText('README.md');
  await page.evaluate(() => { (window as any).__projectConversation.readError = ''; });
  await generate(page, 'SYNTHETIC retry with readable reference');
  await readyProposal(page);
  expect((await request(page, 0)).prompt).toContain('SYNTHETIC repository readme');
  expect((await request(page, 0)).history).toEqual([]);
});

test('switching documents clears project and conversation and ignores a pending reference read', async ({ page }) => {
  await setup(page);
  await chooseFolder(page);
  await selectFile(page, 'README.md');
  await generate(page, 'SYNTHETIC initial completed request');
  await readyProposal(page);
  await page.getByRole('button', { name: 'Continue conversation', exact: true }).click();
  await page.evaluate(() => { (window as any).__projectConversation.pendingRead = true; });
  await generate(page, 'SYNTHETIC request abandoned during file read');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__projectConversation.releaseRead)).toBe('function');
  await externalOpen(page);
  await openAssistant(page);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  await expect(page.locator('.project-context-heading')).toHaveCount(0);
  await page.evaluate(async () => {
    (window as any).__projectConversation.releaseRead();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => (window as any).__projectConversation.requests.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__projectConversation.released)).toContain('synthetic-folder-1');
  await expect(page.locator('.diff-modal')).toHaveCount(0);
  expect(await editorSource(page)).toBe(nextDocument);
  await generate(page, 'SYNTHETIC fresh document request');
  await readyProposal(page);
  expect((await request(page, 1)).history).toEqual([]);
  expect((await request(page, 1)).prompt).not.toContain('SYNTHETIC repository readme');
});

test('a late folder picker cannot attach its authorization to a replacement document', async ({ page }) => {
  await setup(page);
  await chooseFolder(page);
  await selectFile(page, 'README.md');
  await page.evaluate(() => {
    const state = (window as any).__projectConversation;
    state.pendingPick = true;
    state.folder.id = 'synthetic-folder-2';
  });
  await page.getByRole('button', { name: 'Change context folder', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__projectConversation.releasePick)).toBe('function');
  await externalOpen(page);
  await page.evaluate(async () => {
    (window as any).__projectConversation.releasePick();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('.project-context-heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose repository or folder', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__projectConversation.released)).toEqual(['synthetic-folder-1', 'synthetic-folder-2']);
  expect(await editorSource(page)).toBe(nextDocument);
});

test('refresh removes unavailable selected files and cancelled folder replacement preserves the remaining selection', async ({ page }) => {
  await setup(page);
  await chooseFolder(page);
  await selectFile(page, 'README.md');
  await selectFile(page, 'src/service.ts');
  await page.evaluate(() => {
    const state = (window as any).__projectConversation;
    state.folder.files = state.folder.files.filter((file: any) => file.path !== 'src/service.ts');
    state.folder.truncated = true;
  });
  await page.getByRole('button', { name: 'Refresh context file list', exact: true }).click();
  await expect(page.locator('.project-context-selected button')).toHaveCount(1);
  await expect(page.locator('.project-context-selected')).toContainText('README.md');
  await expect(page.locator('.project-context-warning')).toContainText('folder scan is incomplete');
  await page.evaluate(() => { (window as any).__projectConversation.folder = null; });
  await page.getByRole('button', { name: 'Change context folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change context folder', exact: true })).toBeEnabled();
  await expect(page.locator('.project-context-selected button')).toHaveCount(1);
  await generate(page, 'SYNTHETIC request after refresh');
  await readyProposal(page);
  expect((await request(page, 0)).prompt).toContain('SYNTHETIC repository readme');
  expect((await request(page, 0)).prompt).not.toContain('syntheticVersion');
});

test('project selections and attached references share one file capacity', async ({ page }) => {
  await setup(page);
  await chooseFolder(page);
  await selectFile(page, 'README.md');
  await page.evaluate(() => {
    (window as any).__projectConversation.attached = Array.from({ length: 12 }, (_, index) => ({
      path: `/synthetic-attachment/${index}.txt`, name: `synthetic-${index}.txt`, content: `SYNTHETIC reference ${index}`,
    }));
  });
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.locator('.toast.error')).toHaveText('Keep up to 12 context files. Remove existing files before adding more.');
  await expect(page.locator('.assistant-context-list > div')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__projectConversation.attached.pop(); });
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.locator('.assistant-context-list > div')).toHaveCount(11);
  await expect(page.locator('.assistant-context-files footer')).toContainText('Selected 12/12 files');
  await expect(page.locator('.project-context-files label').filter({ hasText: 'src/service.ts' }).locator('input')).toBeDisabled();
  await generate(page, 'SYNTHETIC request at context capacity');
  await readyProposal(page);
  expect((await request(page, 0)).prompt).toContain('SYNTHETIC repository readme');
  expect((await request(page, 0)).prompt).toContain('SYNTHETIC reference 10');
  expect((await request(page, 0)).prompt).not.toContain('SYNTHETIC reference 11');
});
