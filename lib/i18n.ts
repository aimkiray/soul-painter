// Bilingual UI strings. zh is the canonical key set — every key must exist in
// both dictionaries. Server-emitted Chinese status/error text passes through
// translateServerMessage() at the client ingestion boundary.

export type Lang = 'zh' | 'en';

export const LANG_STORAGE_KEY = 'soul-painter-lang-v1';

const zh = {
  // Toolbar
  appTitle: '灵魂画师',
  repeaterMode: '复读机',
  openSidebar: '打开聊天列表',
  closeSidebar: '关闭聊天列表',
  openSyncLogin: '打开同步登录',
  syncAccount: '同步账号：{name}',
  syncLogin: '同步登录',
  sync: '同步',
  toggleTheme: '切换主题',
  openSettings: '打开设置',
  settings: '设置',
  switchToEnglish: 'Switch to English',
  switchToChinese: '切换到中文',

  // Footer
  githubRepo: 'GitHub 仓库',
  ready: '[READY]',
  footerMode: 'MODE {mode}',
  footerInput: 'INPUT PROMPT',
  footerOutput: 'OUTPUT {output}',
  footerHotkeys: '[T]THEME [Y]SYNC [S]SETTINGS [D]DEBUG',

  // VersionTap
  modelUnlocked: '模型访问已解锁',
  tapRecorded: '版本号确认已记录 {taps}/{total}',
  unlockSyncFailed: '解锁状态同步失败',
  versionInfo: '版本信息',

  // Sidebar
  newChat: '+ 新建聊天',
  untitledChat: '新聊天',
  emptySession: '空会话',
  requestFailed: '请求失败',
  generatedCount: '生成 {n} 张图片',
  generatingSuffix: ' · 生成中',
  sessionName: '会话名称',
  sessionMenu: '会话菜单',
  chatList: '聊天列表',
  resizeSidebar: '调整会话列表宽度',
  rename: '改名',
  clear: '清空',
  confirmClear: '确认清空',
  delete: '删除',
  confirmDelete: '确认删除',
  save: '保存',
  cancel: '取消',

  // ChatInput
  customSize: '自定义...',
  phChat: '输入聊天内容...',
  phRefEdit: '描述如何使用/修改参考图...',
  phGenerate: '描述你要生成的画面内容...',
  genMode: '生成模式',
  imageModel: '图片模型',
  imageSize: '图片尺寸',
  customSizeAria: '自定义尺寸',
  sizeFormatHint: '格式如 1024x1024',
  chatModel: '聊天模型',
  effortLevel: '推理强度',
  promptLabel: '提示词',
  send: '发送',
  stop: '停止',
  addRef: '添加参考图',

  // ChatBubble
  edited: '已编辑',
  editMessage: '编辑消息',
  generating: '生成中',
  regenerating: '重新生成中',
  thinkingDone: '[ 思考过程 ]',
  thinkingLive: '[ 思考中... ]',
  imageLoadFailed: '图片加载失败',
  generatedImageAlt: '生成的图片 {n}',
  viewRaw: '[ 查看原始响应 ]',
  zoom: '放大',
  download: '下载',
  openImage: '打开',
  useAsRef: '参考',
  editResend: '编辑并重发',
  copiedMessage: '已复制消息',
  copyFailed: '复制失败',
  copyMessage: '复制消息',
  copied: '已复制',
  copy: '复制',
  confirmDeleteMessage: '确认删除消息',
  deleteMessage: '删除消息',
  regenerate: '重新生成',
  viewLarge: '查看大图',
  closeLarge: '关闭大图',
  largePreviewAlt: '大图预览',
  youLabel: '[YOU]',
  assistantLabel: '[ASSISTANT]',

  // ChatArea
  refAddFailed: '参考图添加失败',
  refAddedChatMode: '参考图已加入；切换到 IMG 模式后才会随请求发送',
  refAdded: '已加入参考图',
  waitingInput: '等待输入',
  refsReady: '参考图已就绪',
  waitingDesc: '等待描述',
  chatLog: '聊天记录',
  lastGenFailed: '上一次生成失败',
  emptyReadyChat: '会话就绪',
  emptyReadyEdit: '编辑就绪',
  emptyReadyImg: '生图就绪',
  openaiCompat: 'OpenAI 兼容',
  claudeCompat: 'Claude 兼容',
  gatedTag: '受限',

  // ImageGrid
  processing: '处理中',
  editThumb: '编辑',
  editImageN: '编辑第 {n} 张图片',
  selectedCount: '已选 {n}',
  deleteSelected: '删除选中',
  refImageN: '参考图 {n}',
  compressedBadge: '已缩小',

  // ImageEditor
  dragMoveReset: '拖拽移动 · 双击复位',
  cancelEdit: '取消编辑',
  editTools: '编辑工具',
  brush: '笔刷',
  erase: '擦除',
  brushSize: '笔刷大小',
  clearMask: '清除',

  // MarkdownRenderer
  copiedCode: '已复制代码',
  copyCodeFailed: '复制代码失败',
  copyCode: '复制代码',

  // LoginModal
  syncDone: '聊天记录已同步',
  syncUpdating: '聊天已更新，将继续后台同步',
  loggedOut: '已退出登录',
  syncLoginTitle: '同步登录',
  closeLogin: '关闭登录',
  loginIntro: '第一次输入名字和同步密钥就会自动创建账号。之后用同样的信息登录，就能同步聊天记录。',
  nameLabel: '名字',
  namePh: '例如：PLAYER_1',
  secretLabel: '同步密钥',
  secretPh: '至少 4 位',
  logout: '退出登录',
  syncing: '同步中...',
  loginAndSync: '登录并同步',
  logoutNote: '退出登录不会删除聊天记录，下次用同样的名字和同步密钥登录还能继续同步。',

  // SettingsModal
  settingsTitle: '设置',
  closeConfig: '关闭配置',

  // ConnectionSettings
  connConfig: '连接配置',
  serverToken: '服务端访问令牌',
  serverTokenPh: '由部署者提供的 SERVER_ACCESS_TOKEN',
  serverTokenRequired: '使用服务端默认 API Key 时必须填写。',
  serverTokenHint: '仅在服务端启用访问令牌时需要。',
  imageSection: '图像',
  apiKey: 'API Key',
  imageApiKey: '图像 API Key',
  emptyUseDefault: '留空使用默认 Key',
  hide: '隐藏',
  show: '显示',
  autoConnHint: '聊天会按所选模型自动使用对应连接配置。',
  srcUrl: 'URL 预填',
  srcUser: '自定义',
  srcServer: '服务端默认',
  srcNone: '未配置',
  srcInherit: '继承图像配置',

  // ModelSettings
  modelSection: '模型',
  imageModelLabel: '图片模型',
  addImageModel: '添加图片模型',
  add: '添加',
  chatModelLabel: '聊天模型',
  connUsedHint: '当前会使用 {provider} 连接配置',
  titleModel: '标题模型',
  titleModelOpenai: '标题模型（OpenAI）',
  titleModelClaude: '标题模型（Claude）',
  titleModelHint: '用于第一轮回复后自动总结聊天标题',
  titleModelHintClaude: 'Claude 格式下用于第一轮回复后自动总结聊天标题',
  addOpenaiModel: '添加 OpenAI Compatible 模型',
  addClaudeModel: '添加 Claude 模型',
  systemPrompt: '系统提示词',
  systemPromptPh: '仅聊天模式使用',

  // ImageParamSettings
  imageParams: '图像参数',
  sizeLabel: '尺寸',
  countLabel: '数量',
  countAria: '生成数量',
  qualityLabel: '质量',
  formatLabel: '格式',
  backgroundLabel: '背景',
  moderationLabel: '审核',
  moderationAria: '审核级别',
  compressionLabel: '压缩率',

  // RuntimeSettings
  runtimeSection: '运行设置',
  timeoutLabel: '请求超时（秒）',
  contextLimit: '上下文数量限制',
  contextLimitHint: '0 表示不带上下文，最多保留最近 5 轮对话',
  optStreaming: '渐进加载',
  optClearRefs: '提交后清空参考图',
  optPersistPrompt: '重启后加载上次 Prompt',

  // DataManagement
  dataSection: '数据管理',
  clearDataConfirm: '再次确认会清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存，然后刷新页面。服务端 .env 不会受影响。',
  clearDataHint: '清除本机保存的设置、聊天记录、草稿、历史、能力缓存和浏览器本地缓存。用于开发期处理不兼容更新。',
  clearing: '清除中...',
  confirmClearData: '确认清除',
  clearLocalData: '清除本地数据',

  // DebugPanel
  debugPanel: '调试面板',
  closeDebug: '关闭调试面板',

  // ErrorBoundary
  moduleCrash: '[ 模块崩溃 ]',
  unknownError: '未知错误',
  retry: '重试',

  // useRunPrompt / ChatContext client-side statuses

  // constants (model/preset labels)
} as const;

export type MsgKey = keyof typeof zh;

const en: Record<MsgKey, string> = {
  appTitle: 'SOUL PAINTER',
  repeaterMode: 'REPEATER',
  openSidebar: 'Open chat list',
  closeSidebar: 'Close chat list',
  openSyncLogin: 'Open sync login',
  syncAccount: 'Sync account: {name}',
  syncLogin: 'Sync login',
  sync: 'SYNC',
  toggleTheme: 'Cycle theme',
  openSettings: 'Open settings',
  settings: 'SETTINGS',
  switchToEnglish: 'Switch to English',
  switchToChinese: '切换到中文',

  githubRepo: 'GitHub repository',
  ready: '[READY]',
  footerMode: 'MODE {mode}',
  footerInput: 'INPUT PROMPT',
  footerOutput: 'OUTPUT {output}',
  footerHotkeys: '[T]THEME [Y]SYNC [S]SETTINGS [D]DEBUG',

  modelUnlocked: 'Model access unlocked',
  tapRecorded: 'Version tap recorded {taps}/{total}',
  unlockSyncFailed: 'Failed to sync unlock state',
  versionInfo: 'Version info',

  newChat: '+ New chat',
  untitledChat: 'New chat',
  emptySession: 'Empty session',
  requestFailed: 'Request failed',
  generatedCount: 'Generated {n} image(s)',
  generatingSuffix: ' · generating',
  sessionName: 'Session name',
  sessionMenu: 'Session menu',
  chatList: 'Chat list',
  resizeSidebar: 'Resize chat list',
  rename: 'Rename',
  clear: 'Clear',
  confirmClear: 'Confirm clear',
  delete: 'Delete',
  confirmDelete: 'Confirm delete',
  save: 'Save',
  cancel: 'Cancel',

  customSize: 'Custom...',
  phChat: 'Type a message...',
  phRefEdit: 'Describe how to use or edit the reference images...',
  phGenerate: 'Describe the image to generate...',
  genMode: 'Generation mode',
  imageModel: 'Image model',
  imageSize: 'Image size',
  customSizeAria: 'Custom size',
  sizeFormatHint: 'Format like 1024x1024',
  chatModel: 'Chat model',
  effortLevel: 'Reasoning effort',
  promptLabel: 'Prompt',
  send: 'Send',
  stop: 'Stop',
  addRef: 'Add reference images',

  edited: 'edited',
  editMessage: 'Edit message',
  generating: 'Generating',
  regenerating: 'Regenerating',
  thinkingDone: '[ THINKING ]',
  thinkingLive: '[ THINKING... ]',
  imageLoadFailed: 'Image failed to load',
  generatedImageAlt: 'Generated image {n}',
  viewRaw: '[ VIEW RAW RESPONSE ]',
  zoom: 'Zoom',
  download: 'Download',
  openImage: 'Open',
  useAsRef: 'Ref',
  editResend: 'Edit & resend',
  copiedMessage: 'Message copied',
  copyFailed: 'Copy failed',
  copyMessage: 'Copy message',
  copied: 'Copied',
  copy: 'Copy',
  confirmDeleteMessage: 'Confirm delete message',
  deleteMessage: 'Delete message',
  regenerate: 'Regenerate',
  viewLarge: 'View full size',
  closeLarge: 'Close large view',
  largePreviewAlt: 'Large preview',
  youLabel: '[YOU]',
  assistantLabel: '[ASSISTANT]',

  refAddFailed: 'Failed to add reference image',
  refAddedChatMode: 'Reference added; it is sent only after switching to IMG mode',
  refAdded: 'Reference added',
  waitingInput: 'Waiting for input',
  refsReady: 'Reference images ready',
  waitingDesc: 'Waiting for a prompt',
  chatLog: 'Chat log',
  lastGenFailed: 'Last generation failed',
  emptyReadyChat: 'Chat ready',
  emptyReadyEdit: 'Edit ready',
  emptyReadyImg: 'Img ready',
  openaiCompat: 'OpenAI Compatible',
  claudeCompat: 'Claude Compatible',
  gatedTag: 'gated',

  processing: 'Processing',
  editThumb: 'Edit',
  editImageN: 'Edit image {n}',
  selectedCount: '{n} selected',
  deleteSelected: 'Delete selected',
  refImageN: 'Reference {n}',
  compressedBadge: 'Downscaled',

  dragMoveReset: 'Drag to move · double-click to reset',
  cancelEdit: 'Cancel edit',
  editTools: 'Edit tools',
  brush: 'Brush',
  erase: 'Erase',
  brushSize: 'Brush size',
  clearMask: 'Clear',

  copiedCode: 'Code copied',
  copyCodeFailed: 'Copy failed',
  copyCode: 'Copy code',

  syncDone: 'Chat history synced',
  syncUpdating: 'Chats updated; background sync continues',
  loggedOut: 'Logged out',
  syncLoginTitle: 'Sync login',
  closeLogin: 'Close login',
  loginIntro: 'Enter a name and sync secret for the first time to create an account automatically. Log in with the same credentials later to keep syncing chat history.',
  nameLabel: 'Name',
  namePh: 'e.g. PLAYER_1',
  secretLabel: 'Sync secret',
  secretPh: 'At least 4 characters',
  logout: 'Log out',
  syncing: 'Syncing...',
  loginAndSync: 'Log in & sync',
  logoutNote: 'Logging out never deletes chat history. Log in again with the same name and secret to resume syncing.',

  settingsTitle: 'Settings',
  closeConfig: 'Close settings',

  connConfig: 'Connection',
  serverToken: 'Server access token',
  serverTokenPh: 'SERVER_ACCESS_TOKEN provided by the deployer',
  serverTokenRequired: 'Required when using the server default API key.',
  serverTokenHint: 'Only needed when the server enforces an access token.',
  imageSection: 'Image',
  apiKey: 'API Key',
  imageApiKey: 'Image API Key',
  emptyUseDefault: 'Leave empty to use the default key',
  hide: 'Hide',
  show: 'Show',
  autoConnHint: 'Chat automatically uses the connection matching the selected model.',
  srcUrl: 'URL preset',
  srcUser: 'Custom',
  srcServer: 'Server default',
  srcNone: 'Not configured',
  srcInherit: 'Inherit image config',

  modelSection: 'Models',
  imageModelLabel: 'Image model',
  addImageModel: 'Add image model',
  add: 'Add',
  chatModelLabel: 'Chat model',
  connUsedHint: 'Using the {provider} connection',
  titleModel: 'Title model',
  titleModelOpenai: 'Title model (OpenAI)',
  titleModelClaude: 'Title model (Claude)',
  titleModelHint: 'Summarizes the chat title after the first reply',
  titleModelHintClaude: 'Summarizes the chat title after the first reply (Claude format)',
  addOpenaiModel: 'Add OpenAI Compatible model',
  addClaudeModel: 'Add Claude model',
  systemPrompt: 'System prompt',
  systemPromptPh: 'Chat mode only',

  imageParams: 'Image params',
  sizeLabel: 'Size',
  countLabel: 'Count',
  countAria: 'Image count',
  qualityLabel: 'Quality',
  formatLabel: 'Format',
  backgroundLabel: 'Background',
  moderationLabel: 'Moderation',
  moderationAria: 'Moderation level',
  compressionLabel: 'Compression',

  runtimeSection: 'Runtime',
  timeoutLabel: 'Request timeout (s)',
  contextLimit: 'Context message limit',
  contextLimitHint: '0 sends no context; keeps at most the last 5 exchanges',
  optStreaming: 'Progressive loading',
  optClearRefs: 'Clear references on submit',
  optPersistPrompt: 'Restore last prompt on launch',

  dataSection: 'Data',
  clearDataConfirm: 'Confirm again to clear local settings, chats, drafts, history, capability caches and browser caches, then reload. The server .env is unaffected.',
  clearDataHint: 'Clears local settings, chats, drafts, history, capability caches and browser caches. For development-time incompatible updates.',
  clearing: 'Clearing...',
  confirmClearData: 'Confirm clear',
  clearLocalData: 'Clear local data',

  debugPanel: 'Debug panel',
  closeDebug: 'Close debug panel',

  moduleCrash: '[ MODULE CRASHED ]',
  unknownError: 'Unknown error',
  retry: 'Retry',


};

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

export function t(lang: Lang, key: MsgKey, vars?: Record<string, string | number>): string {
  let text = DICTS[lang][key] ?? zh[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      // Function replacement: a string arg would interpret $-sequences in the
      // VALUE ($&, $', $1...) — e.g. a model name or message containing them.
      text = text.replaceAll(`{${name}}`, () => String(value));
    }
  }
  return text;
}

// --- Server-produced messages -------------------------------------------
// server-runner / API routes emit Chinese status and error text. Map the
// stable, user-facing ones to English at the ingestion boundary; unknown
// strings (e.g. upstream provider errors) pass through untouched.

const SERVER_MESSAGES: Array<[RegExp, string]> = [
  // --- run lifecycle ---
  [/^生成完成 (\d+) 张(?:图片?)?$/, 'Generated $1 image(s)'],
  [/^正在回复\.{0,3}$/, 'Replying...'],
  [/^回复完成$/, 'Reply completed'],
  [/^任务完成$/, 'Task completed'],
  [/^已取消$/, 'Canceled'],
  [/^已取消 (\d+) 个任务，(\d+) 个任务仍在运行$/, 'Canceled $1 task(s); $2 still running'],
  [/^正在取消后台任务\.{0,3}$/, 'Canceling background task...'],
  [/^取消失败，后台任务仍在运行$/, 'Cancel failed; the task is still running'],
  [/^任务已取消$/, 'Task canceled'],
  [/^用户已取消本次请求。?$/, 'Request canceled.'],
  [/^任务进行中，无法删除$/, 'Task in progress; cannot delete'],

  // --- retries / timeouts ---
  [/^\[RETRY (\d+)\/(\d+)\] 上游限流，(\d+)s 后再次请求$/, '[RETRY $1/$2] upstream rate-limited; retrying in $3s'],
  [/^\[RETRY (\d+)\/(\d+)\] 上游服务器错误，(\d+)s 后再次请求$/, '[RETRY $1/$2] upstream server error; retrying in $3s'],
  [/^\[RETRY (\d+)\/(\d+)\] 请求超时，(\d+)s 后再次请求$/, '[RETRY $1/$2] request timed out; retrying in $3s'],
  [/^\[RETRY (\d+)\/(\d+)\] 请求失败，(\d+)s 后再次请求$/, '[RETRY $1/$2] request failed; retrying in $3s'],
  [/^请求超时 \((\d+)s\)。可在设置中调大超时秒数。$/, 'Request timed out ($1s). Increase the timeout in Settings.'],
  [/^请求失败，已自动重试 (\d+) 次仍未成功。$/, 'Request failed after $1 automatic retries.'],
  [/^上游未返回有效结果$/, 'Upstream returned no usable result'],

  // --- background task plumbing ---
  [/^后台任务请求失败$/, 'Background task request failed'],
  [/^后台任务事件订阅失败$/, 'Failed to subscribe to task events'],
  [/^后台任务运行中\.{0,3}$/, 'Background task running...'],
  [/^后台任务已提交\.{0,3}$/, 'Background task submitted...'],
  [/^后台任务提交中\.{0,3}$/, 'Submitting background task...'],
  [/^后台任务提交超时，正在等待后台结果$/, 'Submission timed out; awaiting background result'],
  [/^后台任务提交失败$/, 'Background task submission failed'],
  [/^后台任务同步失败$/, 'Background task sync failed'],
  [/^后台任务记录已丢失，?请重新发送。?$/, 'Task record lost; resend the request.'],
  [/^后台任务记录已丢失$/, 'Task record lost'],
  [/^后台任务未成功提交，?请重新发送。?$/, 'Task was not submitted; resend the request.'],
  [/^后台任务未成功提交$/, 'Task was not submitted'],
  [/^后台任务因服务进程重启已中断，请重新发送。$/, 'Background task interrupted by a server restart; resend.'],
  [/^找不到可重新生成的原始消息，请重新发送。?$/, 'Original message not found; resend the request.'],

  // --- /api/runs errors ---
  [/^任务创建过于频繁，请稍后再试$/, 'Too many tasks; try again later'],
  [/^任务查询过于频繁，请稍后再试$/, 'Too many queries; try again later'],
  [/^任务数据过大$/, 'Task payload too large'],
  [/^任务数据格式错误$/, 'Invalid task payload'],
  [/^任务参数不完整$/, 'Incomplete task parameters'],
  [/^任务 ID 已存在$/, 'Task ID already exists'],
  [/^任务不存在$/, 'Task not found'],
  [/^无权访问任务$/, 'No access to this task'],
  [/^请使用 POST 查询后台任务状态$/, 'Use POST to query task status'],

  // --- request / config errors ---
  [/^请求失败$/, 'Request failed'],
  [/^上游限流$/, 'Upstream rate-limited'],
  [/^上游服务器错误$/, 'Upstream server error'],
  [/^请求超时$/, 'Request timed out'],
  [/^响应为空$/, 'Empty response'],
  [/^响应中未找到图片$/, 'No image found in the response'],
  [/^图片数据格式无效$/, 'Invalid image data format'],
  [/^参考图来源无效$/, 'Invalid reference image source'],
  [/^图片数据无效$/, 'Invalid image data'],
  [/^图片 URL 无效$/, 'Invalid image URL'],
  [/^不支持的图片 URL 协议$/, 'Unsupported image URL protocol'],
  [/^图片 URL 不允许携带凭据$/, 'Image URL credentials not allowed'],
  [/^图片 URL 主机不允许访问$/, 'Image URL host not allowed'],
  [/^图片重定向次数过多$/, 'Too many image redirects'],
  [/^图片重定向无效$/, 'Invalid image redirect'],
  [/^图片 URL 获取失败$/, 'Failed to fetch image URL'],
  [/^不支持的图片类型$/, 'Unsupported image type'],
  [/^图片过大$/, 'Image is too large'],
  [/^图片响应为空$/, 'Image response is empty'],
  [/^图片 URL 获取超时$/, 'Image URL fetch timed out'],
  [/^未提供图片来源$/, 'No image source provided'],
  [/^远程参考图获取失败，请确认图片链接可公开访问，或改用本地上传$/, 'Remote reference image fetch failed; check the link is publicly reachable or upload locally.'],
  [/^上游响应过大$/, 'Upstream response too large'],
  [/^参考图加载失败，请重新上传后重试。?$/, 'Failed to load reference images; re-upload and retry.'],
  [/^参考图会话无效，请重新上传参考图$/, 'Reference session invalid; re-upload the images.'],
  [/^未配置 API Key。.*$/, 'No API key configured. Add one in Settings or set a server default in .env.'],
  [/^Base URL 无效或未配置。.*$/, 'Base URL missing or invalid. Only http/https is allowed.'],
  [/^自定义 .*Base URL 必须同时提供 API Key。$/, 'A custom Base URL requires an API key.'],

  // --- SSRF guards ---
  [/^为防止 SSRF，不允许访问本机或本地域名。$/, 'SSRF protection: local hostnames are not allowed.'],
  [/^为防止 SSRF，不允许访问内网或保留 IP。$/, 'SSRF protection: private/reserved IPs are not allowed.'],
  [/^无法解析 Base URL 的主机名。$/, 'Cannot resolve the Base URL hostname.'],
  [/^为防止 SSRF，不允许访问解析到内网或保留 IP 的主机。$/, 'SSRF protection: hostnames resolving to private/reserved IPs are not allowed.'],

  // --- server access ---
  [/^服务端默认 API Key 已禁用，请配置 SERVER_ACCESS_TOKEN。$/, 'Server default API key disabled; configure SERVER_ACCESS_TOKEN.'],
  [/^缺少或无效的服务端访问令牌。$/, 'Missing or invalid server access token.'],

  // --- stream / upstream ---
  [/^流式响应返回错误事件.*$/, 'Stream returned an error event'],
  [/^流式响应数据格式错误次数过多$/, 'Stream data malformed too many times'],
  [/^上游返回错误.*$/, 'Upstream returned an error'],

  // --- error hints (appended as their own line by buildErrorHint) ---
  [/^参考图总大小过大，请删除不必要的参考图或换用更小的图片后重试$/, 'Reference images too large; remove some or retry with smaller ones.'],
  [/^当前 API 渠道没有这个模型的可用通道。.*$/, 'No channel for this model on the current API route; switch Base URL/API Key in Settings or pick another model.'],
  [/^API Key 无效或未配置，请在设置中填写或检查 \.env$/, 'API key invalid or missing; add it in Settings or check .env.'],
  [/^请求参数有误，请检查 Base URL 格式$/, 'Invalid request parameters; check the Base URL format.'],
  [/^接口不存在，请确认 Base URL 是否支持 OpenAI 兼容 API$/, 'Endpoint not found; confirm the Base URL supports the OpenAI-compatible API.'],
  [/^访问被拒绝，请检查 API Key 权限或 Base URL 渠道状态$/, 'Access denied; check the API key permissions or the Base URL channel.'],
  [/^上游限流，请稍后重试或降低请求频率$/, 'Upstream rate-limited; retry later or lower the request rate.'],
  [/^上游服务器错误，请稍后重试或检查服务状态$/, 'Upstream server error; retry later or check the service status.'],
  [/^请检查 API Key 和 Base URL 配置$/, 'Check the API Key and Base URL configuration.'],

  // --- chat sync ---
  [/^聊天记录已同步$/, 'Chat history synced'],
  [/^同步数据过大$/, 'Sync payload too large'],
  [/^同步数据格式错误$/, 'Invalid sync payload'],
  [/^请输入玩家名和至少 4 位同步密钥$/, 'Enter a name and a sync secret of at least 4 characters'],
  [/^玩家名或同步密钥错误$/, 'Incorrect name or sync secret'],
  [/^用户名大小写冲突，请使用最初创建时的名字大小写登录$/, 'Username case mismatch; sign in with the original casing'],
  [/^新账号同步密钥至少需要 6 位$/, 'New accounts need a sync secret of at least 6 characters'],
  [/^账号创建过于频繁，请稍后再试$/, 'Too many accounts; try again later'],
  [/^会话数量已达上限（(\d+)），请删除旧会话后再同步$/, 'Session limit ($1) reached; delete old sessions and sync again'],
  [/^单会话消息数量已达上限（(\d+)），无法继续同步$/, 'Message limit ($1) per session reached; cannot continue syncing'],
  [/^部分聊天图片迁移失败，请稍后重新同步$/, 'Some chat images failed to migrate; sync again later'],
  [/^同步失败，请稍后重试$/, 'Sync failed; try again later'],

  // --- model gate ---
  [/^模型今天在午睡，熟悉这里的人知道怎么把它叫醒。$/, 'The model is napping; regulars know how to wake it.'],
  [/^访问口令暂时失踪了，看看标题栏，也许它留了暗号。$/, 'The passphrase went missing; check the title bar for a clue.'],
  [/^服务器说需要一点熟人确认，完成后再继续。$/, 'The server wants a familiar confirmation first.'],
  [/^模型把门轻轻带上了，先完成标题栏的小确认。$/, 'The model closed the door; finish the small confirmation in the title bar.'],
  [/^今天的接入姿势不太传统，确认身份后再继续。$/, "Today's handshake is unconventional; confirm yourself to continue."],
  [/^模型正在装酷，完成熟人小动作后它才愿意上班。$/, 'The model is playing cool; do the regular gesture to get it working.'],

  // --- misc ---
  [/^（尚未请求）$/, '(no request yet)'],
];

// Error strings are composed multi-line (message + hint), so translate
// line-by-line: each line gets its own shot at the table.
export function translateServerMessage(lang: Lang, text: string): string {
  if (lang === 'zh' || !text) return text;
  return text.split('\n').map((line) => {
    for (const [pattern, template] of SERVER_MESSAGES) {
      if (pattern.test(line)) return line.replace(pattern, template);
    }
    return line;
  }).join('\n');
}

// Size preset labels carry Chinese descriptors (原图比例/竖/横/自动) that are
// ornamental — swap them for English suffixes in the en UI.
export function localizeSizeLabel(lang: Lang, label: string): string {
  if (lang === 'zh') return label;
  return label
    .replace('原图比例', 'Original')
    .replace('自动', 'auto')
    .replace('默认', 'default')
    .replace('竖', 'portrait')
    .replace('横', 'landscape');
}

// For class components and other non-hook contexts — reads the stored choice.
export function currentLang(): Lang {
  try {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return stored === 'en' || stored === 'zh' ? stored : 'en';
  } catch {
    return 'en';
  }
}
