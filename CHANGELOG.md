# 更新记录

## 0.1.6 — 2026-10-25

- 修复音频代理把整条流限制为 20 秒的问题；超时只作用于等待响应头，读取停滞单独检测。
- 修复拖动进度后的 Range 续传起点、断开后遗留连接与计时器、本地文件名含 `%` 时无法播放；换源时按播放时间恢复，避免拼接不同音频文件的字节。
- 搜索与分页隔离过期请求，推荐搜索不再污染分页缓存；封面最多四个并发并批量更新，歌词和封面请求合并并缓存。
- 修复随机播放、快速切歌/本地播放/暂停与自动恢复之间的竞态、切音质丢队列，以及播放开始后四秒内真实断流无法恢复。
- 进度刷新限制在进度组件内，歌词仅在换行时更新；歌曲行复用并延迟解码封面，屏幕外行跳过布局绘制。
- 修复自建/每日歌单切换的 Hooks 错误、歌单播放队列误用搜索结果、本地歌词被跳过，以及主窗口重载后桌面歌词无法继续同步。
- 修复字体资源打包路径和单项音源测试脚本路径；界面版本号从 package.json 读取。

验证：49 项离线逻辑/本机 HTTP 回归、8 项生产渲染界面回归、TypeScript 检查和生产构建。界面回归模拟音频事件，未替代真实声卡及在线音源验证。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs --test scripts/registry.test.ts scripts/mediaServer.test.ts src/utils/playerState.test.ts
node node_modules/electron-vite/bin/electron-vite.js build
node scripts/ui-regression.mjs
```

界面回归默认使用本机 Chrome 和独立临时配置，只访问本地服务；可用环境变量 `LISN_TEST_CHROME` 指定浏览器路径。测试不读取应用的真实设置、歌单或下载目录。
