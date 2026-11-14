# 设计系统

语言 [English](design-system.md) · [简体中文](design-system.zh-CN.md)

Astryx 0.7.7 是桌面渲染端的通用 UI 系统。Phase 1 保留页面结构与顺序、文案和交互。Phase 2 计划进行页面重排与文案优化。

## 组件归属

页面和业务组件直接导入 Astryx。通过 Astryx 组件属性和语义 Token 设置外观，通过局部 CSS 排布布局。知识库目录树和 CodeMirror 编辑器等专用 UI 由所属业务模块管理。旧 JAB 组件库及其生成的皮肤已移除。

[渲染入口](../src/renderer/main.tsx) 依次加载重置样式、组件 CSS 与 Neutral 主题 CSS。[主题提供者](../src/app/theme.tsx) 应用 Electron 主进程提供的主题快照，并在收到快照前跟随系统。

## 原生界面

[SideNav](../src/app/WorkspaceSidebar.tsx) 始终只显示图标，提供提示和当前页选中态，设置固定在底部。[共享几何](../src/shared/geometry.ts) 定义 72px 侧栏宽度及 Browser 顶部控件高度。[浏览器管理器](../src/platform/browser/browserManager.ts) 将两个原生网页表面都放在侧栏右边缘。

Electron 管理 [Smart Paste 横幅](../src/platform/banner/bannerView.ts)、[历史导航指示器](../src/platform/browser/historyIndicator.ts)和[原生提示](../src/platform/browser/navigationTooltip.ts)。这些独立文档使用 [Neutral 调色板](../src/platform/electron/nativeTheme.css)，并保留各自的事件与安全边界。

## 验证

运行类型、质量、单元测试和 Electron 冒烟测试。

```sh
npm run typecheck
npm run quality
npm test
npm run test:smoke
```
