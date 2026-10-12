import type { en } from './en'
type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> }

export const zhCN = {
  app: { title: 'Job Agent Browser', loadingWorkspace: '正在加载工作区…' },
  navigation: {
    pages: { home: '主页', find: '寻找工作', resume: '定制简历', interview: '面试准备', applications: '申请记录', inbox: '收件箱', profile: '个人资料', browser: '浏览器', ai: '询问 AI', settings: '设置' },
    back: '后退', home: '主页', forward: '前进', goHome: '回到主页', goBack: '返回', goForward: '前进',
    pageNavigation: '页面导航', openSettings: '打开设置', workspaceNavigation: '工作区导航',
    sections: { search: '求职', manage: '管理', tools: '工具' }
  },
  home: {
    brand: 'Job Browser', heading: '你想做什么？', subtitle: '在一个工作区中完成求职所需的一切。', footer: '专注于整个求职过程的工作区。', comingSoon: '{{label}} — 即将推出',
    cards: { find: '搜索和浏览工作机会', resume: '为特定职位调整简历', interview: '为特定职位准备面试', applications: '通过列表或日历跟踪申请', inbox: '招聘邮件和申请进展', profile: '简历、经历和偏好', browser: '自由浏览网页', ai: '结合你的求职上下文工作', settings: 'AI、浏览器和应用偏好' }
  },
  features: {
    comingSoon: '即将推出', notImplemented: '此功能尚未实现。',
    descriptions: { find: '搜索和浏览工作机会。', resume: '为特定职位调整简历。', interview: '为特定职位准备面试。', applications: '通过列表或日历跟踪申请。', inbox: '求职邮件将通过你配置的网页邮箱打开。', profile: '管理简历、经历和偏好。', ai: '结合你的求职上下文工作。', settings: '配置 AI、浏览器和应用偏好。' }
  },
  browser: {
    tabs: '浏览器标签页', closeTab: '关闭标签页', closeNamedTab: '关闭 {{title}}', newTab: '新建标签页', addressLabel: '搜索或输入网址', addressPlaceholder: '搜索或输入网址…', emptyHeading: '开始探索', emptyDescription: '在上方搜索内容或输入网址。'
  },
  inbox: { exit: '退出', configure: '连接你的邮箱', configureHelp: '在设置中选择网页邮箱服务商和地址，即可在此打开邮箱。', loadFailed: '无法打开邮箱' },
  settings: {
    subtitle: '打造适合你的工作区。偏好设置保存在此设备上。',
    general: '通用', generalDescription: '选择工作区的显示语言。', language: '语言', appearance: '外观', light: '浅色', lightHelp: '当前提供浅色外观。',
    ai: 'AI 服务', aiDescription: '管理此设备上的 OpenAI API 密钥。', provider: '服务商', apiKey: 'API 密钥', keyPlaceholder: '输入新的 API 密钥', keyHelp: '通过操作系统加密。此处不会显示已保存的密钥。',
    configured: '已保存密钥', notConfigured: '尚未保存密钥', aiPlanned: 'AI 执行功能即将推出。保存密钥不会发送 API 请求或验证密钥。', encryptionUnavailable: '此设备无法使用安全的密钥存储。',
    mailbox: '邮箱', mailboxDescription: '从收件箱直接打开网页邮箱。', mailProvider: '邮箱服务商', none: '未配置', custom: '自定义网页邮箱', mailURL: '网页邮箱地址', mailHelp: '使用 HTTPS 地址，且网址中不得包含用户名或密码。', mailInvalid: '请输入有效的 HTTPS 网页邮箱地址，且不得包含登录凭据。',
    save: '保存更改', saveKey: '保存密钥', replaceKey: '替换密钥', deleteKey: '删除密钥', saving: '正在保存…', saved: '更改已保存。', keySaved: '密钥已安全保存。', keyDeleted: '密钥已删除。', deleteTitle: '删除已保存的 API 密钥？', deleteDescription: '你可以稍后添加新的密钥。', cancel: '取消',
    unsaved: '有未保存的更改', loading: '正在加载设置…', loadFailed: '无法加载设置。', saveFailed: '无法保存更改。之前的设置仍然保留。', retry: '重试', discardTitle: '放弃更改并离开？', discardDescription: '未保存的设置将被丢弃。', discard: '放弃更改', stay: '继续编辑', local: '保存在本地', localDescription: '偏好设置和加密密钥保存在此设备上。网站登录由浏览器单独管理。'
  },
  errors: {
    unknownPage: '未知的应用页面。', providersUnavailable: '应用服务不可用。', actionFailed: '无法完成此操作。', storageTitle: '存储不可用', storageMessage: '无法打开本地数据或设置。已保存的文件未被重置。', navigationInput: '导航输入必须为文本。', visibilityInput: '浏览器可见性必须为布尔值。', presentationInput: '浏览器展示必须指定标签页和目标。', tabIdInput: '标签页 ID 必须为文本。', browserNotReady: '浏览器尚未就绪。', untrustedSender: '不可信的 IPC 发送方。', emptyAddress: '请输入网址或搜索词。', unsupportedProtocol: '只能打开 HTTP 和 HTTPS 页面。', invalidAddress: '请输入有效的网址。', tabUnavailable: '标签页已不可用。', loadFailed: '无法加载此页面。请检查网址和网络连接。', historySyncFailed: '无法同步浏览器历史记录。'
  }
} satisfies Translation<typeof en>
