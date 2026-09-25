import type { Issue, Project } from '@easyhub/types';

const before = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

export const initialProjects: Project[] = [
  {
    id: 'mytool', name: 'MyTool', owner: '你', archived: false, branchProtectionEnabled: true, description: '一个简单的 Windows 小工具',
    visibility: 'private', localPath: 'C:\\Users\\Demo\\Documents\\MyTool',
    updatedAt: before(2), health: 'saved', changedFiles: [], downloaded: true,
    color: 'lilac', initials: 'M',
    readme: '# MyTool\n\n一个让日常工作更轻松的 Windows 小工具。\n\n## 功能\n\n- 快速整理常用文件\n- 简洁的窗口操作\n- 支持深色模式',
    releases: [],
    history: [
      { id: 'v-my-1', message: '修复启动问题', author: '你', createdAt: before(2), changedFiles: ['src/main.ts', 'src/window.ts', 'src/styles.css'], additions: 120, deletions: 18 },
      { id: 'v-my-2', message: '增加深色模式', author: '你', createdAt: before(20), changedFiles: ['src/theme.ts', 'src/styles.css'], additions: 86, deletions: 12 },
      { id: 'v-my-3', message: '创建项目', author: '你', createdAt: before(72), changedFiles: ['README.md', 'src/main.ts'], additions: 240, deletions: 0 },
    ],
  },
  {
    id: 'minecraft', name: 'Minecraft Mod', owner: '你', archived: false, branchProtectionEnabled: true, description: '为冒险添加一点新乐趣',
    visibility: 'public', localPath: 'C:\\Users\\Demo\\Documents\\MinecraftMod',
    updatedAt: before(7), health: 'changes', downloaded: true,
    changedFiles: [
      { path: 'src/main.ts', kind: 'modified' },
      { path: 'assets/icon.png', kind: 'added' },
      { path: 'src/App.tsx', kind: 'modified' },
      { path: 'src/old.ts', kind: 'deleted' },
      { path: 'src/config.ts', kind: 'modified' },
    ],
    color: 'peach', initials: 'M',
    readme: '# Minecraft Mod\n\n一个为冒险加入新工具和场景的小项目。\n\n## 目前包含\n\n- 新的探索道具\n- 可自定义的游戏体验',
    releases: [],
    history: [
      { id: 'v-mc-1', message: '调整物品图标', author: '你', createdAt: before(7), changedFiles: ['assets/items.png'], additions: 20, deletions: 4 },
      { id: 'v-mc-2', message: '创建项目', author: '你', createdAt: before(120), changedFiles: ['README.md', 'src/main.ts'], additions: 210, deletions: 0 },
    ],
  },
  {
    id: 'website', name: '个人网站', owner: '你', archived: false, branchProtectionEnabled: true, description: '记录作品和一些生活碎片',
    visibility: 'public', localPath: 'C:\\Users\\Demo\\Documents\\PersonalSite',
    updatedAt: before(15), health: 'remote', changedFiles: [], downloaded: true,
    color: 'mint', initials: '网',
    readme: '# 个人网站\n\n你好，欢迎来到我的个人网站。\n\n这里会放一些作品、笔记和生活记录。',
    releases: [],
    history: [
      { id: 'v-web-1', message: '更新首页照片', author: '你', createdAt: before(15), changedFiles: ['public/cover.jpg', 'src/home.tsx'], additions: 28, deletions: 14 },
      { id: 'v-web-2', message: '创建项目', author: '你', createdAt: before(240), changedFiles: ['README.md', 'index.html'], additions: 130, deletions: 0 },
    ],
  },
  {
    id: 'notes', name: '旅行笔记', owner: '你', archived: false, branchProtectionEnabled: true, description: '存在 GitHub 上的灵感与回忆',
    visibility: 'private', updatedAt: before(48), health: 'saved', changedFiles: [], downloaded: false,
    color: 'sky', initials: '旅',
    readme: '# 旅行笔记\n\n记录每次出发时的新发现。',
    releases: [],
    history: [
      { id: 'v-note-1', message: '整理秋天的照片', author: '你', createdAt: before(48), changedFiles: ['README.md', 'photos/autumn.jpg'], additions: 35, deletions: 2 },
    ],
  },
];

export const initialIssues: Issue[] = [
  { id: 'issue-1', projectId: 'mytool', title: '窗口缩小时按钮会重叠', body: '把窗口缩小到比较窄时，右下角的两个按钮会挤在一起。希望它们能自动换行。', author: '小林', createdAt: before(3), state: 'open', comments: [{ id: 'comment-1', author: '你', body: '谢谢反馈，我会在下个版本处理。', createdAt: before(2) }] },
  { id: 'issue-2', projectId: 'mytool', title: '可以增加快捷键吗？', body: '希望常用操作可以直接通过快捷键完成。', author: 'Alex', createdAt: before(26), state: 'open', comments: [] },
  { id: 'issue-3', projectId: 'mytool', title: '安装后第一次启动较慢', body: '第一次打开要等待十几秒，之后就正常了。', author: 'Mia', createdAt: before(80), state: 'open', comments: [] },
  { id: 'issue-4', projectId: 'minecraft', title: '新道具的图标没有显示', body: '更新后背包里有一个道具显示为透明。', author: 'PlayerOne', createdAt: before(5), state: 'open', comments: [] },
];
