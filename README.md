# 客户教程视频自动化

本项目用于把真实后台操作截图、可批改分镜和系统配音合成为客户新手教程视频。2026-05-29 阶段主线是「稿定商品 - AI优化商品图」保姆级横屏版。

## 2026-05-29 阶段边界

- 工作目录：`/Users/gd/Desktop/主业/客户教程视频自动化`
- 2026-05-29 阶段输出目录：`/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7`
- 2026-05-29 阶段审片板：`/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7/storyboard/shooting-board.html`
- 2026-05-29 阶段本地服务：`http://127.0.0.1:3829/`
- 目标测试店：`道理门`
- 2026-05-29 阶段只做：`保姆级 / nanny / 横屏`

竖屏版、短视频干货风、正式批量发布版都不是 2026-05-29 阶段默认产物。先把保姆版分镜和视频对齐，再扩展其他版本。

## AI优化图到AI生成视频玩法视频

这条是 2026-06-10 新增的 `playbook` 旁路产线，用来做「AI优化商品图 → 确认发布 → AI批量生成视频」这种组合玩法视频。它和 2026-05-29 保姆教程分开保存，不写入、不覆盖 `2026-05-29-horizontal-v7`。

- 默认输出目录：`/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook`
- 审片板文件：`storyboard/playbook-board.html`
- 本地审片板服务：`http://127.0.0.1:3839/`
- 正式视频：`videos/ai-image-to-video-playbook-horizontal.mp4`
- 目标测试店：`道理门`

1. 创建玩法视频工作区：

```bash
cd /Users/gd/Desktop/主业/客户教程视频自动化

node scripts/create_playbook_workspace.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook
```

2. 导入已经确认可用的素材图或视频结果：

```bash
node scripts/import_playbook_asset.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook \
  --source /absolute/path/to/asset.png \
  --type generated-image \
  --title "AI优化后的主图" \
  --tags ai-image-optimize,generated-result
```

常用素材类型：`operation-screenshot`、`dropdown-open`、`before-after`、`generated-image`、`publish-confirm`、`video-result`。常用标签按镜头意图写，例如 `ai-image-optimize`、`optimized-result`、`confirm-publish`、`ai-video-entry`、`select-product`、`generate-video`、`video-result`。

3. 生成玩法脚本和审片板：

```bash
node scripts/generate_playbook_recipe.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook

node scripts/export_playbook_board.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook
```

4. 启动玩法审片台：

```bash
node scripts/playbook_server.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook \
  --port 3839
```

打开 `http://127.0.0.1:3839/` 后，可以改镜头顺序、删除镜头、换底图素材、加/删放大图、改字幕和口播。顶部 `一键生成玩法横屏视频` 会调用本地 `/api/build-video`，底层运行正式 `build_playbook_video.sh`。

生成完成后，结果区会出现：

- `打开视频`：直接用系统默认播放器打开玩法 MP4。
- `访达定位`：在 Finder 中选中生成的视频文件。
- `打开视频文件夹`：打开玩法视频的 `videos/` 输出目录。

5. 命令行兜底生成玩法视频：

```bash
./build_playbook_video.sh \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook
```

6. 如需从当前 Chrome 登录态做安全抓取骨架，先 dry-run：

```bash
CDP_BASE_URL=http://localhost:3456 \
node scripts/capture_playbook_flow.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook \
  --dry-run
```

`capture_playbook_flow.mjs` 当前只做页面识别、截图和 checkpoint，不会点击确认发布或 AI 生成视频。只有同时传 `--allow-publish`、`--allow-generate-video`，并且页面文本包含 `道理门`，才会在 manifest 里标记最终动作具备安全条件；脚本本身仍不会执行最终点击。

## 标准流程

1. 生成或更新脚本与审片板：

```bash
cd /Users/gd/Desktop/主业/客户教程视频自动化

node scripts/generate_scripts.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7

node scripts/export_shooting_board.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7
```

2. 启动审片板服务：

```bash
node scripts/storyboard_server.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7 \
  --port 3829
```

3. 在浏览器打开 `http://127.0.0.1:3829/`，逐镜批改字幕、口播、红框、鼠标、放大图和补充镜头。

如果刚改过审片板 UI，建议先打开带时间戳的地址，例如：

```text
http://127.0.0.1:3829/?v=20260602
```

本地服务会强制 no-cache；如果 Chrome 仍显示老审片台，关闭旧 tab 或强刷新后再确认。新版审片板顶部必须能看到 `一键生成保姆版横屏视频`。

4. 用户确认分镜后，优先点击审片板顶部的 `一键生成保姆版横屏视频`。

生成完成后，结果区会出现：

- `打开视频`：直接用系统默认播放器打开 MP4。
- `访达定位`：在 Finder 中选中生成的视频文件。
- `打开视频文件夹`：打开 `videos/` 输出目录。

如需命令行兜底，再生成保姆版横屏视频：

```bash
./build_storyboard_video.sh \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7 \
  --style nanny
```

5. 正式看这个文件：

```text
/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7/videos/nanny-horizontal-storyboard.mp4
```

不要把 `videos/nanny-horizontal.mp4` 当成 2026-05-29 阶段正式结果；那是旧模板链路的横屏视频。

## 审片板规则

- 批改状态默认是 `通过`，可以改为 `需修改`、`重拍`、`删除`、`待确认`。
- 鼠标必须放在目标右下方或旁边，不能遮住按钮文字。
- 红框要比目标控件略大，让客户一眼知道看哪里。
- 字幕直接叠在视频截图上，不做占空间的独立字幕板。
- 下拉、勾选、弹窗必须单独给镜头；客户要看到展开后的真实界面。
- 放大图可以像底图一样从已生产素材里新增和替换，也可以拖动、缩放；支持 `完整显示 / 局部展示`，局部模式下拖动图内画面可调整显示区域；右上角 `×` 是删除放大图，不是折叠或变缩略。
- 不需要的镜头点 `删除此镜头`，或把批改状态改成 `删除`；生成视频时会跳过这一镜。
- 删除镜头必须以当前审片板保存状态为准。如果 Chrome 开着多个审片板 tab，生成链路会优先读 localStorage，再用 `review-overrides.json` 兜底，避免旧 tab 把删除状态覆盖回通过。
- 如果需要多一个镜头，用 `在此前插入一镜` 或 `在此后插入一镜`，不要硬改最终视频帧。
- 每一镜都可以用 `拖动排序` 上下拖动；拖完会保存到 `review-overrides.json` 的 `sceneOrder`，刷新页面和重新生成视频都会沿用新顺序。
- `给AI的改稿意见` 用来写“口播短一点 / 解释这个设置的作用 / 不要说测试店”等台词调整要求，不直接进视频；底层字段仍是 `reviewNote`，旧内容不会丢。
- `生成客户版台词` 优先使用本地 OpenAI 兼容 API，根据画面要求和 `给AI的改稿意见` 生成字幕、口播草稿；没有配置 API key 时才退回本地话术模板。生成后仍以用户审片板内容为准。
- 审片板顶部的 `一键生成保姆版横屏视频` 会调用本地服务 `/api/build-video`，等同于运行正式 `build_storyboard_video.sh --style nanny`，输出 `videos/nanny-horizontal-storyboard.mp4`。

## 本地服务接口

- `GET /api/health`：检查审片板服务、当前输出目录、重拍和出片状态。
- `POST /api/save-scene`：保存单镜头批改、红框、鼠标、底图、放大图和台词。
- `POST /api/save-order`：保存 `拖动排序` 后的镜头顺序。
- `POST /api/generate-copy`：按 `给AI的改稿意见` 生成客户版字幕和口播。
- `POST /api/insert-scene`：在当前镜头前后插入补充镜头。
- `POST /api/recapture-scene`：按当前画面要求重拍或匹配已有真实截图。
- `POST /api/build-video`：一键生成保姆版横屏视频；底层执行正式 `build_storyboard_video.sh --style nanny`。
- `GET /api/build-status`：查看当前记录的视频生成状态。
- `POST /api/open-build-target`：打开或定位当前生成的视频、视频文件夹、输出目录、manifest 或日志；只能访问当前教程输出目录内的文件。

`scripts/storyboard_server.mjs` 必须给 HTML、静态资源和 API 响应加 no-cache 响应头，避免用户点开仍是旧审片台。

## 安全边界

- 可以在测试店 `道理门` 演示生成效果图。
- 不自动发布、不自动替换商品图、不自动充值。
- 不输出 cookie、token、后台调试信息。
- 如果页面没有商品、店铺不对或下拉没有展开，优先标为重拍或补充镜头。

## 关键文件

- `build_all.sh`：旧全量流水线，包含抓取、脚本、旧模板帧、配音和合成。
- `build_storyboard_video.sh`：2026-05-29 阶段正式出片入口，只支持 `--style nanny`，会读取当前浏览器审片板布局。
- `scripts/storyboard_server.mjs`：审片板本地服务，负责保存批改、插入镜头、按要求重拍、生成台词和一键生成保姆版横屏视频。
- `scripts/export_shooting_board.mjs`：生成可编辑审片板。
- `scripts/export_storyboard_layout.mjs`：从当前 Chrome 审片板导出 localStorage 布局；如果同时开了多个审片板 tab，优先抓带 `.scene-drag-handle` 和 `/api/save-order` 的新版页面，避免导出旧 tab。
- `scripts/render_storyboard_frames.mjs`：按审片板布局渲染横屏帧；layout 里有但基础脚本没有的功能点镜头也必须进入最终视频，且渲染前先清空旧帧目录。
- `scripts/list_voiceover_jobs.mjs`：输出配音任务；字幕保持 `SKU图`、`AI优化`，但系统配音文本会转换成 `S K U 图`、`A I 优化`。
- `voiceover.sh`：生成 macOS `say` 配音；每次生成前清空对应 style 的旧音频，避免删除镜头后旧 m4a 残留。
- `lib/storyboard-copywriter.mjs`：客户版台词生成器，优先走 `TUTORIAL_COPY_API_BASE` / `TUTORIAL_COPY_API_KEY` / `TUTORIAL_COPY_MODEL`，失败时本地模板兜底。
- `compose_video.swift`：用 AVFoundation 合成 MP4；会先生成一条和视频同长的连续音轨，中间写真实静音，避免口播短于镜头时长时音画不同步。

更多审片板说明见 `docs/storyboard-review-workflow.md`。
