import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { relativeFileLinks } from '../lib/relative-file-links.ts';
import { previewHtmlSanitize } from '../lib/preview-html.ts';
import { previewLineBreaks } from '../lib/markdown-preview.ts';

const expected = (html) => html.replace(/href="([^"]*)"/g, (_, href) => `href="${encodeURI(decodeURI(href))}"`);

function render(markdown, options = {}) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, relativeFileLinks, previewLineBreaks],
    rehypePlugins: [rehypeRaw, previewHtmlSanitize],
    ...options,
  }, markdown));
}

test('preview recovers local attachment paths with spaces, parentheses and formatted labels', () => {
  assert.equal(render('[报表](./附件/测试 报表.xlsx)'), expected('<p><a href="./附件/测试%20报表.xlsx">报表</a></p>'));
  assert.equal(render('[**年度报表**](../附件/测试 报表(最终 (2)).xlsx "打开报表")'),
    expected('<p><a href="../附件/测试%20报表(最终%20(2)).xlsx" title="打开报表"><strong>年度报表</strong></a></p>'));
  assert.equal(render('[报表](.\\附件\\测试 报表.xlsx)'), expected('<p><a href="./附件/测试%20报表.xlsx">报表</a></p>'));
  assert.equal(render('[报表](./file name.pdf \'Title with ) bracket\')'),
    '<p><a href="./file%20name.pdf" title="Title with ) bracket">报表</a></p>');
  assert.equal(render('[括号文件名](./附件/说明 (最终).txt)'),
    expected('<p><a href="./附件/说明%20(最终).txt">括号文件名</a></p>'));
  assert.equal(render('[完成](./附件/100% 完成.xlsx)'),
    expected('<p><a href="./附件/100%25%20完成.xlsx">完成</a></p>'));
});

test('surrounding decoded text, adjacent links and multiline container prefixes stay intact', () => {
  assert.equal(render('A &amp; B \\* [报表](./测试 报表.xlsx) 后 [说明](./测试 文档.docx)！'),
    expected('<p>A &amp; B * <a href="./测试%20报表.xlsx">报表</a> 后 <a href="./测试%20文档.docx">说明</a>！</p>'));
  assert.equal(render('> 开始\n> [报表](./测试 报表.xlsx)\n> 结束'),
    expected('<blockquote>\n<p>开始<br/>\n<a href="./测试%20报表.xlsx">报表</a><br/>\n结束</p>\n</blockquote>'));
  assert.equal(render('- 前文\n  [报表](./测试 报表.xlsx) 后文'),
    expected('<ul>\n<li>前文<br/>\n<a href="./测试%20报表.xlsx">报表</a> 后文</li>\n</ul>'));
});

test('existing standard links, image syntax, escapes, code and HTML are unchanged', () => {
  const protectedExamples = [
    '[标准](<./测试 报表.xlsx>)', '[标准](./测试%20报表.xlsx)',
    '![图片](./测试 图片.png)', '[引用][file]\n\n[file]: ./report.xlsx',
    '\\[报表](./测试 报表.xlsx)', '`[报表](./测试 报表.xlsx)`',
    '```text\n[报表](./测试 报表.xlsx)\n```',
    '<a href="./other.xlsx">[报表](./测试 报表.xlsx)</a>',
    '<code>[报表](./测试 报表.xlsx)</code>',
  ];
  for (const source of protectedExamples) {
    const baseline = render(source, { remarkPlugins: [remarkGfm, previewLineBreaks] });
    assert.equal(render(source), baseline, source);
  }
});

test('recovery does not extend remote, absolute or executable attachment links', () => {
  for (const path of ['https://example.com/file name.xlsx', '/tmp/file name.xlsx', '\\\\server\\file name.xlsx', 'C:\\folder\\file name.xlsx', './file name.exe', './file name.sh', './file name.desktop', './file name.xlsx.exe', '%2Ftmp/file name.xlsx', 'javascript:alert file.xlsx']) {
    const source = `[file](${path})`;
    assert.equal(render(source), render(source, { remarkPlugins: [remarkGfm, previewLineBreaks] }), path);
  }
});

test('protected code cannot swallow later links and destinations decode entities only once', () => {
  assert.equal(render('`[code](` [报表](./file name.xlsx)'),
    '<p><code>[code](</code> <a href="./file%20name.xlsx">报表</a></p>');
  assert.equal(render('\\![报表](./file name.xlsx)'), '<p>!<a href="./file%20name.xlsx">报表</a></p>');
  assert.equal(render('[报表](./A &amp;amp; B.xlsx)'), '<p><a href="./A%20&amp;amp;%20B.xlsx">报表</a></p>');
  assert.equal(render('[报表](./A \\&copy; B.xlsx)'), '<p><a href="./A%20&amp;copy;%20B.xlsx">报表</a></p>');
  assert.match(render('<div>HTML block</div>\n\n[报表](./file name.xlsx)'), /<a href="\.\/file%20name\.xlsx">报表<\/a>/);
});

test('recovery keeps later Mermaid source positions at their original offsets', () => {
  for (const ending of ['\n', '\r\n']) {
    const source = ['[**报表**](./附件/测试 (最终).xlsx)', '', '```mermaid', 'flowchart TD', '  A --> B', '```'].join(ending);
    let position;
    const output = render(source, { components: { code({ node, children, ...props }) {
      position = node.position;
      return createElement('code', props, children);
    } } });
    assert.match(output, /<a href=/);
    assert.equal(position.start.offset, source.indexOf('```mermaid'));
    assert.equal(position.end.offset, source.length);
    assert.equal(source.slice(position.start.offset, position.end.offset), source.slice(source.indexOf('```mermaid')));
  }
});

test('long unmatched bracket runs remain literal without pathological rescanning', () => {
  const source = '['.repeat(20_000) + ' text ' + '\\'.repeat(20_000);
  assert.doesNotMatch(render(source), /<a[ >]/);
});
