import assert from 'node:assert/strict';
import { test } from 'node:test';
import { english, modelErrorTemplates } from '../lib/translations.ts';
import { setLocale, t, uiMessage } from '../lib/i18n.ts';

const endpoint = 'https://api.example.test/synthetic/%E4%BF%9D%E5%AD%98/chat/completions';
const detail = 'Synthetic upstream: 保存{0}\n已打开 synthetic.md。请求地址：https://upstream.example.test/。服务返回：取消';
const cause = 'Synthetic cause: 保存{1}。底层原因：取消';
function check(zh, en) {
  setLocale('en');
  assert.equal(uiMessage(zh), en);
  assert.equal(uiMessage(en), en);
  setLocale('zh-CN');
  assert.equal(uiMessage(zh), zh);
  assert.equal(uiMessage(en), zh);
  setLocale('en');
}

test('HTTP backend errors localize only the known envelope and retain arbitrary upstream detail', () => {
  for (const [status, summary] of [
    [400, '请求格式或参数不受模型服务支持'], [401, 'API 密钥无效或未获得授权'],
    [402, '模型账户余额或付费状态异常'], [403, '模型服务拒绝访问当前模型或资源'],
    [404, 'API 路径或模型不存在'], [405, 'API 路径不接受当前请求方法'],
    [408, '模型服务处理请求超时'], [409, '模型服务拒绝了冲突的请求'],
    [422, '模型服务无法处理请求参数'], [429, '请求过于频繁、额度不足或已达到限额'],
    [502, '上游模型服务暂时不可用'], [418, '上游模型服务拒绝了本次请求'],
  ]) {
    const zh = summary + '（HTTP ' + status + '）。请求地址：' + endpoint;
    const en = english[summary] + ' (HTTP ' + status + '). Request URL: ' + endpoint;
    check(zh, en);
    check(zh + '。服务返回：' + detail, en + '. Service response: ' + detail);
  }
});

test('network and interrupted-stream envelopes preserve endpoint and root cause', () => {
  for (const summary of [
    'TLS 握手或证书校验失败，请检查服务证书链或企业代理证书',
    '模型服务拒绝连接，请确认服务已启动且 API 端口正确',
    '模型服务所在网络不可达，请检查网络、VPN 或代理',
    '模型服务域名解析失败，请检查 API 地址或 DNS',
    '代理连接失败，请检查代理地址、认证与放行规则',
    '连接被模型服务或中间代理意外断开',
    '连接模型服务超时，请检查 API 地址、网络、VPN 或代理',
    '等待模型服务响应超时，请稍后重试或缩小处理内容',
    '无法与模型服务建立 TCP 连接，请检查地址、端口、网络或代理',
    '模型请求构造失败，请检查 API 地址与请求配置',
    '模型请求或响应数据传输失败', '模型响应解码失败', '发送模型请求失败',
  ]) {
    const zh = summary + '。请求地址：' + endpoint;
    const en = english[summary].replace(/\.$/, '') + '. Request URL: ' + endpoint;
    check(zh, en);
    check(zh + '。底层原因：' + cause, en + '. Root cause: ' + cause);
    check('模型流式响应意外中断。' + zh, 'The model stream was interrupted. ' + en);
    check('模型流式响应意外中断。' + zh + '。底层原因：' + cause, 'The model stream was interrupted. ' + en + '. Root cause: ' + cause);
  }
});

test('DNS and address-policy errors localize their envelope without changing diagnostics', () => {
  const dnsCause = 'Synthetic DNS: 保存。请求地址：https://upstream.example.test/';
  check('无法解析 API 主机名 synthetic.example.test：' + dnsCause + '。请求地址：' + endpoint,
    'Could not resolve API hostname synthetic.example.test: ' + dnsCause + '. Request URL: ' + endpoint);
  for (const summary of [
    'API 主机名没有可用的网络地址', 'API 地址解析到了不可用的网络地址',
    'HTTP API 地址仅允许本机、私有网络或链路本地目标', 'API 地址缺少有效端口', 'API 地址缺少有效的主机名或 IP',
  ]) {
    check(summary + '。请求地址：' + endpoint, english[summary] + '. Request URL: ' + endpoint);
  }
});

test('redirect and nonstreaming response errors retain status, content type and endpoint', () => {
  check('API 地址返回了重定向（HTTP 307）；为保护密钥，应用不会自动跟随。请填写最终 API 地址。请求地址：' + endpoint,
    'The API endpoint redirected (HTTP 307). To protect your key, the app will not follow redirects. Enter the final API endpoint. Request URL: ' + endpoint);
  check('模型服务返回了无法识别的内容（Content-Type: 未提供）。请检查 API 地址与服务类型。请求地址：' + endpoint,
    'The model service returned unrecognized content without a Content-Type header. Check the API endpoint and service type. Request URL: ' + endpoint);
  for (const contentType of [
    'text/plain; synthetic="保存{0}"',
    'text/plain). Check the API endpoint and service type. Request URL: synthetic-marker',
    'not provided',
  ]) {
    check('模型服务返回了无法识别的内容（Content-Type: ' + contentType + '）。请检查 API 地址与服务类型。请求地址：' + endpoint,
      'The model service returned unrecognized content (Content-Type: ' + contentType + '). Check the API endpoint and service type. Request URL: ' + endpoint);
  }
  check('模型服务返回了空内容或不兼容的响应格式。请检查服务类型与模型接口。请求地址：' + endpoint,
    'The model service returned empty content or an incompatible response format. Check the service type and model API. Request URL: ' + endpoint);
});

test('static streaming and transport failures have English translations', () => {
  for (const [zh, en] of [
    ['无法向编辑器传递模型推理', 'Could not deliver model reasoning to the editor'],
    ['无法向编辑器传递模型响应', 'Could not deliver the model response to the editor'],
    ['模型响应超过大小限制', 'The model response exceeds the size limit'],
    ['无法完成模型响应', 'Could not complete the model response'],
    ['模型输出超过 8 MB 限制', 'The model output exceeds the 8 MB limit'],
    ['模型返回了无效的 UTF-8 数据', 'The model returned invalid UTF-8 data'],
    ['模型响应提前结束，请重试', 'The model response ended early. Please retry.'],
    ['请求标识重复', 'Duplicate request ID'],
  ]) check(zh, en);
});

test('unknown upstream errors and interpolated document text are not recursively translated', () => {
  setLocale('en');
  const unknown = 'Synthetic upstream 保存。请求地址：' + endpoint + '。服务返回：取消';
  assert.equal(uiMessage(unknown), unknown);
  const unknownHttp = 'Synthetic summary（HTTP 429）。请求地址：' + endpoint;
  assert.equal(uiMessage(unknownHttp), unknownHttp);
  const unknownStream = '模型流式响应意外中断。Synthetic summary。请求地址：' + endpoint;
  assert.equal(uiMessage(unknownStream), unknownStream);
  const knownError = '请求过于频繁、额度不足或已达到限额（HTTP 429）。请求地址：' + endpoint;
  assert.equal(t('已打开 {0}', knownError), 'Opened ' + knownError);
  assert.equal(uiMessage('已打开 ' + knownError), 'Opened ' + knownError);
});

test('model error templates preserve every opaque placeholder', () => {
  const slots = (text) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
  for (const [zh, en] of Object.entries(modelErrorTemplates)) assert.deepEqual(slots(en), slots(zh), zh);
});
