# 聆 LISN

> 你的音乐,由此展开 · GitHub 免费音源聚合播放/下载器(Windows 桌面端)

聆 LISN 是一款本地音乐播放器,聚合多个免费公开音源:内置 GD 音乐台(网易/酷我)、lx-music 自定义源脚本、MusicFree 插件(酷我/酷狗/QQ/网易/咪咕)与通用 HTTP 模板音源,多源并发搜索、按序竞速解析,支持歌词、封面、下载与本地音乐库。

![icon](build/icon.png)

## 功能(v0.1.1)

- **同步歌词面板**(新增):Dock 一键展开,随播放滚动、当前行高亮、点击行跳转
- **系统媒体键 / SMTC**(新增):媒体键盘直控,系统媒体浮层显示曲名/歌手/封面
- **播放模式**(新增):列表循环 / 随机 / 单曲循环
- **聚合搜索**:多源并发,按「歌名|歌手」归一合并,分页累计
- **多源解析**:质量链自动降级(flac→320k→128k)+ 音源顺序竞速,可手动锁定音源;健康度统计可视化
- **音源即插件**:零代码 HTTP 模板 / lx-music 脚本(沙箱)/ MusicFree 插件(沙箱)即插即用,支持 GitHub 仓库在线升级与回滚
- **播放**:本地流代理(断点续传 Range 支持)、歌词同步、封面懒加载
- **下载**:串行队列防封 IP 节流,MP3 自动写入 ID3 标签与内嵌封面,歌词另存 .lrc
- **歌单**:自建歌单、搜索结果一键保存

## 开发

```bash
pnpm install
pnpm dev        # 开发模式
pnpm build      # 构建渲染/主进程
pnpm dist       # 打包 Windows portable + zip(输出到 release/)
```

> 首次打包会从 npmmirror 拉取 Electron 二进制(见 electron-builder.yml)。

## 图标

`python scripts/gen-icon.py` 重新生成 `build/icon.ico`(electron-builder 自动拾取)。

## 免责声明

本项目仅供个人学习与试听,音源均来自第三方公开接口,请于 24 小时内删除,支持正版。
