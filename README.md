# 流浪猫的避难所 (Stray Cat's Sanctuary)

一个用 [Hexo](https://hexo.io/zh-cn/) 搭建的个人博客，部署在 GitHub Pages，站点地址：<https://xuzhunzhi.github.io/>

## 技术栈
- Hexo（静态博客生成器）
- 自包含主题 `straycat`（EJS 模板 + CSS）
- GitHub Actions 自动构建并发布到 GitHub Pages

## 本地预览
需要本机能装 npm 依赖：
```bash
npm install
npm run server   # 默认 http://localhost:4000
```

## 写文章
在 `source/_posts/` 下新建 `.md` 文件，带 front-matter：
```markdown
---
title: 文章标题
date: 2026-08-20 00:00:00
categories: [分类]
tags: [标签]
---

正文内容（Markdown）
```

## 发布流程（可持续）
改完内容后 **`git push` 到 `main`**，GitHub Actions 会自动 `hexo generate` 并部署，约 1~2 分钟生效。

## 自定义域名
如需绑自定义域名，在 `_config.yml` 里把 `url` 改成你的域名，并在 `themes/straycat` 里加一个 `CNAME`，同时在 `Settings → Pages` 配置。
