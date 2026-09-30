import { describe, it, expect } from 'vitest';
import { t, translateServerMessage, localizeSizeLabel, currentLang } from '@/lib/i18n';

// Every zh string the server/run pipeline can surface to users should map to
// English. Add new entries here when server-side messages change.
const EMITTED_MESSAGES = [
  '生成完成 3 张图片',
  '生成完成 3 张',
  '上游未返回有效结果',
  '正在回复...',
  '回复完成',
  '任务完成',
  '已取消',
  '已取消 2 个任务，3 个任务仍在运行',
  '正在取消后台任务...',
  '取消失败，后台任务仍在运行',
  '任务已取消',
  '用户已取消本次请求。',
  '任务进行中，无法删除',
  '[RETRY 1/2] 上游限流，4s 后再次请求',
  '[RETRY 2/2] 上游服务器错误，8s 后再次请求',
  '[RETRY 1/2] 请求超时，8s 后再次请求',
  '[RETRY 1/2] 请求失败，4s 后再次请求',
  '请求超时 (600s)。可在设置中调大超时秒数。',
  '请求失败，已自动重试 2 次仍未成功。',
  '后台任务请求失败',
  '后台任务事件订阅失败',
  '后台任务运行中...',
  '后台任务已提交...',
  '后台任务提交中...',
  '后台任务提交超时，正在等待后台结果',
  '后台任务提交失败',
  '后台任务同步失败',
  '后台任务记录已丢失，请重新发送。',
  '后台任务记录已丢失',
  '后台任务未成功提交，请重新发送。',
  '后台任务未成功提交',
  '后台任务因服务进程重启已中断，请重新发送。',
  '找不到可重新生成的原始消息，请重新发送。',
  '任务创建过于频繁，请稍后再试',
  '任务查询过于频繁，请稍后再试',
  '任务数据过大',
  '任务数据格式错误',
  '任务参数不完整',
  '任务 ID 已存在',
  '任务不存在',
  '无权访问任务',
  '请使用 POST 查询后台任务状态',
  '请求失败',
  '响应为空',
  '响应中未找到图片',
  '图片数据格式无效',
  '参考图来源无效',
  '参考图加载失败，请重新上传后重试。',
  '参考图会话无效，请重新上传参考图',
  '未配置 API Key。请在设置中填写，或在服务端 .env 中设置默认 API Key。',
  'Base URL 无效或未配置。仅允许 http/https 协议。',
  '自定义 Chat Base URL 必须同时提供 API Key。',
  '自定义 Claude Base URL 必须同时提供 API Key。',
  '为防止 SSRF，不允许访问本机或本地域名。',
  '为防止 SSRF，不允许访问内网或保留 IP。',
  '无法解析 Base URL 的主机名。',
  '为防止 SSRF，不允许访问解析到内网或保留 IP 的主机。',
  '服务端默认 API Key 已禁用，请配置 SERVER_ACCESS_TOKEN。',
  '缺少或无效的服务端访问令牌。',
  '流式响应返回错误事件',
  '流式响应返回错误事件：{"error":"boom"}',
  '上游返回错误',
  '上游返回错误: rate limited',
  '参考图总大小过大，请删除不必要的参考图或换用更小的图片后重试',
  '当前 API 渠道没有这个模型的可用通道。请在设置中切换对应的 Base URL/API Key，或更换可用模型。',
  'API Key 无效或未配置，请在设置中填写或检查 .env',
  '请求参数有误，请检查 Base URL 格式',
  '接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API',
  '上游服务器错误，请稍后重试或检查服务状态',
  '请检查 API Key 和 Base URL 配置',
  '聊天记录已同步',
  '同步数据过大',
  '同步数据格式错误',
  '请输入玩家名和至少 4 位同步密钥',
  '玩家名或同步密钥错误',
  '用户名大小写冲突，请使用最初创建时的名字大小写登录',
  '新账号同步密钥至少需要 6 位',
  '账号创建过于频繁，请稍后再试',
  '会话数量已达上限（200），请删除旧会话后再同步',
  '单会话消息数量已达上限（2000），无法继续同步',
  '部分聊天图片迁移失败，请稍后重新同步',
  '同步失败，请稍后重试',
  '模型今天在午睡，熟悉这里的人知道怎么把它叫醒。',
  '访问口令暂时失踪了，看看标题栏，也许它留了暗号。',
  '服务器说需要一点熟人确认，完成后再继续。',
  '模型把门轻轻带上了，先完成标题栏的小确认。',
  '今天的接入姿势不太传统，确认身份后再继续。',
  '模型正在装酷，完成熟人小动作后它才愿意上班。',
  '（尚未请求）',
  '图片数据无效',
  '图片 URL 无效',
  '不支持的图片 URL 协议',
  '图片 URL 不允许携带凭据',
  '图片 URL 主机不允许访问',
  '图片重定向次数过多',
  '图片重定向无效',
  '图片 URL 获取失败',
  '不支持的图片类型',
  '图片过大',
  '图片响应为空',
  '图片 URL 获取超时',
  '未提供图片来源',
  '远程参考图获取失败，请确认图片链接可公开访问，或改用本地上传',
  '上游响应过大',
];

describe('translateServerMessage', () => {
  it('returns zh text untouched in zh mode', () => {
    for (const text of EMITTED_MESSAGES) {
      expect(translateServerMessage('zh', text)).toBe(text);
    }
  });

  it('translates every emitted server message to English', () => {
    for (const text of EMITTED_MESSAGES) {
      const out = translateServerMessage('en', text);
      expect(out, `untranslated: ${text}`).not.toMatch(/[一-鿿]/);
      expect(out).not.toBe(text);
    }
  });

  it('translates composed multi-line errors line by line', () => {
    const text = '响应为空\n请检查 API Key 和 Base URL 配置';
    const out = translateServerMessage('en', text);
    expect(out).toBe('Empty response\nCheck the API Key and Base URL configuration.');
  });

  it('passes through unknown (upstream provider) messages unchanged', () => {
    expect(translateServerMessage('en', 'model overloaded')).toBe('model overloaded');
  });
});

describe('localizeSizeLabel', () => {
  it('keeps zh labels untouched', () => {
    expect(localizeSizeLabel('zh', '1024×1536 · 2:3 竖')).toBe('1024×1536 · 2:3 竖');
  });

  it('translates all descriptors to English', () => {
    expect(localizeSizeLabel('en', '原图比例 · 自动')).toBe('Original · auto');
    expect(localizeSizeLabel('en', 'auto · 默认')).toBe('auto · default');
    expect(localizeSizeLabel('en', '1024×1536 · 2:3 竖')).toBe('1024×1536 · 2:3 portrait');
    expect(localizeSizeLabel('en', '1536×1024 · 3:2 横')).toBe('1536×1024 · 3:2 landscape');
  });
});

describe('default language', () => {
  it('falls back to English when no preference is stored', () => {
    expect(currentLang()).toBe('en');
  });
});

describe('t()', () => {
  it('interpolates {var} placeholders', () => {
    expect(t('en', 'selectedCount', { n: 3 })).toBe('3 selected');
    expect(t('zh', 'selectedCount', { n: 3 })).toBe('已选 3');
  });

  it('does not interpret $-sequences inside replacement values', () => {
    // A string replaceAll would expand $& / $' / $1 in the VALUE — e.g. a
    // model name or pasted text — corrupting the output.
    expect(t('en', 'syncAccount', { name: 'a$&b' })).toBe('Sync account: a$&b');
    expect(t('en', 'selectedCount', { n: "$'$1" })).toBe("$'$1 selected");
  });
});
