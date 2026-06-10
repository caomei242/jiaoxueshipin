# 审片板到视频工作流

本文档记录 2026-05-29 收敛后的保姆级横屏教程视频流程。目标是让后续助手不用重读长对话，也能继续维护「截图分镜 - 用户批改 - 按批改出片」这条链路。

## 一句话原则

最终视频必须和用户正在看的审片板一致。用户在审片板里改过的字幕、口播、鼠标、红框、放大图、删除状态和插入镜头，都必须进入最终视频。

2026-06-02 起，镜头顺序也属于审片结果：用户通过 `拖动排序` 上下移动镜头后，最终视频必须按拖动后的 DOM 顺序出片。

## 审片板字段

- `画面要求`：告诉重拍或渲染时这一镜必须出现什么，例如下拉是否展开、目标店是否正确、鼠标放哪里。
- `屏幕文字`：视频画面上的短字幕。
- `口播`：系统配音使用的文本。
- `给AI的改稿意见`：告诉 AI 这一镜的字幕和口播要怎么改，不直接进视频；底层字段仍是 `reviewNote`，旧批改内容会继续保留。
- `批改状态`：默认通过；`删除` 会从最终视频里移除该镜。
- `删除此镜头`：一键把该镜标记为 `reviewStatus=remove`，生成视频时跳过；如需恢复，可把批改状态改回 `通过`。
- `拖动排序`：按住后上下拖动整张镜头卡，顺序会写入 `review-overrides.json` 的 `sceneOrder.<style>`。

删除状态是硬边界。导出 `browser-layout.json` 时必须优先读取当前审片板 localStorage 中的 `reviewStatus`，再读 DOM 控件值；渲染时还要用 `review-overrides.json` 兜底。这样 Chrome 同时开多个审片板 tab 时，旧 tab 的 `通过` 不会把用户刚删掉的镜头带回最终视频。

## 可编辑画面元素

- 红框：用于指示客户要看的控件或区域，支持拖动和缩放。
- 鼠标：用于表现操作位置，必须放在目标右下方或旁边，不能挡住文字。
- 放大图：用于展示下拉框、弹窗、生成效果等关键细节，支持从已生产素材里新增/替换，也支持拖动、缩放、完整显示和局部展示。
- 放大图局部展示：写入 `zoomMode=crop` 和 `zoomCropPosition`；用户拖动图内画面后，导出的 `browser-layout.json` 和最终帧必须按同样局部裁切。
- 放大图删除：点击 `×` 后应写入 `zoomDeleted`，并从 DOM、导出的 `browser-layout.json`、最终帧和最终视频中移除。

## 台词生成

审片板里的 `生成客户版台词` 代码在 `lib/storyboard-copywriter.mjs`。2026-06-01 起，它优先使用本地 OpenAI 兼容 API；没有配置 API key 或接口失败时，退回本地模板话术。

API 环境变量：

- `TUTORIAL_COPY_API_BASE`：默认 `http://127.0.0.1:63990/v1`。
- `TUTORIAL_COPY_API_KEY`：本地 API key，只能通过环境变量注入，不能写进代码或文档。
- `TUTORIAL_COPY_MODEL`：默认 `gpt-5.4-mini`。

它根据镜头 ID、画面要求、屏幕文字、口播和 `给AI的改稿意见`，生成一版更适合客户听的短字幕和口播草稿。

生成原则：

- 口播面向客户，避免“给客户看清楚”“这一镜要拍”这类内部拍摄话。
- 优先说“这里点哪里、选择什么、为什么要确认”。
- 生成后仍以审片板中用户手改内容为准。
- 字幕保持客户可读写法，例如 `SKU图`、`AI优化商品图`；生成 macOS `say` 配音前再由 `scripts/list_voiceover_jobs.mjs` 把 `SKU` 转为 `S K U`、`AI` 转为 `A I`，避免系统声音误读。

## 补充镜头

需要补充镜头的典型情况：

- 平台下拉要展开，客户要看到抖音、淘宝、快手、京东、微信小店、小红书。
- 店铺下拉要展开，客户要看到 `道理门` 和勾选框。
- 图片位置下拉要展开，客户要看到主图位置 1 到 5。
- 需要专门解释 `SKU图`、`保留品牌logo`、`主图1支持卖点`。
- 生成后要展示真实效果图或生成记录入口。

补充镜头支持两种插入位置：

- `在此前插入一镜`：写入 `beforeSceneKey`，生成视频时排在当前镜头前面。
- `在此后插入一镜`：写入 `afterSceneKey`，生成视频时排在当前镜头后面。

插入镜头后，`scripts/export_shooting_board.mjs` 必须避免重复插入同一个 `sceneKey`。如果 `tutorial-scripts.json` 已经包含该补充镜头，就不要从 `review-overrides.json` 再补一遍。

## 镜头排序

- 每个镜头卡片必须有 `拖动排序` 手柄。
- 拖动结束后，页面 localStorage 和 `review-overrides.json` 都要保存当前 `sceneKey` 顺序。
- `scripts/export_shooting_board.mjs` 重新生成审片板时，要读取 `sceneOrder` 并按保存顺序展示，未出现在 `sceneOrder` 的新镜头追加到后面。
- `scripts/apply_storyboard_review.mjs` 应用批改时，要在插入镜头和删除镜头处理完之后再应用 `sceneOrder`，然后重新计算 index、start、end 和总时长。
- `scripts/export_storyboard_layout.mjs` 导出的 `browser-layout.json` 必须按页面 DOM 顺序输出 scenes；`scripts/render_storyboard_frames.mjs` 再按该顺序渲染视频帧。
- `scripts/render_storyboard_frames.mjs` 不得只渲染基础脚本里已有的 `sceneKey`。如果 `browser-layout.json` 里出现功能点图、生成结果、跳过或确认发布这类后补镜头，要用 layout 里的截图、标题、字幕和口播合成镜头。
- `frames/storyboard-nanny-horizontal/` 每次渲染前必须清空，避免旧帧残留导致验收误判。
- 如果 Chrome 同时开着多个审片板 tab，布局导出要优先选择带 `.scene-drag-handle` 且页面包含 `/api/save-order` 的新版页面，避免抓到旧 tab。

## 本地服务路由

- `GET /api/health`：确认服务可用、输出目录正确，并返回重拍 / 出片状态。
- `GET /api/build-status`：查看当前记录的一键出片结果。
- `POST /api/save-scene`：保存单镜头批改字段和可视元素。
- `POST /api/save-order`：保存拖动后的镜头顺序。
- `POST /api/generate-copy`：生成客户版字幕和口播。
- `POST /api/insert-scene`：插入补充镜头。
- `POST /api/recapture-scene`：按要求重拍或匹配已有真实截图。
- `POST /api/build-video`：一键生成保姆版横屏视频。该接口只支持 `style=nanny`，会拒绝并发生成，底层仍执行 `build_storyboard_video.sh --style nanny`。
- `POST /api/open-build-target`：打开或定位当前生成的视频、视频文件夹、输出目录、manifest 或日志；只允许打开当前教程输出目录内的文件。

## 审片板刷新与缓存

2026-06-02 起，审片板本地服务必须对 HTML、静态资源和 API 响应禁用缓存。`scripts/storyboard_server.mjs` 应返回：

- `Cache-Control: no-store, no-cache, must-revalidate`
- `Pragma: no-cache`
- `Expires: 0`

如果用户反馈“点开审片台还是老的”，按这个顺序排查：

1. 访问 `http://127.0.0.1:3829/?v=<timestamp>`，避免旧 tab 或旧地址缓存。
2. 确认页面顶部存在 `一键生成保姆版横屏视频`。
3. 确认镜头卡存在 `拖动排序`、`添加红框`、`添加鼠标`、`在此前插入一镜`、`删除此镜头`、`完整显示 / 局部展示`。
4. 如果页面还是旧的，重新运行 `node scripts/export_shooting_board.mjs --output <output-dir>`，再重启 `scripts/storyboard_server.mjs`。
5. 关闭旧 `file://.../shooting-board.html` 或旧 `127.0.0.1:3829` tab 后再用 Chrome / Computer Use 截图确认。

## 正式出片命令

审片板顶部的 `一键生成保姆版横屏视频` 会调用本地服务 `/api/build-video`，底层仍执行下面这条正式命令。用户改完分镜后，优先点这个按钮生成，不需要再让助手手动跑。

生成成功后，审片板必须提供三个结果按钮：`打开视频`、`访达定位`、`打开视频文件夹`。用户应该能直接打开或找到 `videos/nanny-horizontal-storyboard.mp4`，不能只显示纯文本路径。

```bash
cd /Users/gd/Desktop/主业/客户教程视频自动化

./build_storyboard_video.sh \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7 \
  --style nanny
```

这条命令会依次执行：

1. 生成脚本草稿。
2. 导出审片板。
3. 应用审片板文字批改。
4. 从当前 Chrome 审片板导出 `storyboard/browser-layout.json`。
5. 按审片板布局渲染 `frames/storyboard-nanny-horizontal/`。
6. 生成配音并同步音频时长。
7. 用 Swift/AVFoundation 合成 `videos/nanny-horizontal-storyboard.mp4`。

配音目录会在每次生成某个 style 前清空，避免删除镜头后旧的 `scene-13.m4a`、`scene-19.m4a` 残留。合成 MP4 时，`compose_video.swift` 会先生成一条和视频同长的连续音频轨，按每个镜头起点写入口播，中间补真实静音，再合进 MP4；不要退回“逐段插入 m4a”的做法，否则空白会被压缩，后半段音画会不同步。

## 常见返工点

- 截图不是 `道理门` 测试店。
- 鼠标挡住按钮文字。
- 红框太小或框错区域。
- 下拉没有展开，客户看不到选项。
- 放大图只裁到空白或裁掉关键内容。
- 字幕和口播太啰嗦。
- 用了旧 `videos/nanny-horizontal.mp4`，导致视频和审片板对不上。
- 点击放大图 `×` 后变成缩略恢复入口，而不是删除。
- Chrome 开了多个审片板 tab，导出布局时抓到旧页面，导致镜头数或顺序和用户正在看的页面不一致。
- 本地服务没有禁用缓存，导致用户点开仍是旧审片台。
- 视频总时长和音频轨时长不一致，通常是静音间隔被压缩；用 `afinfo` 检查最终 MP4 的 audio estimated duration。

## 最小验收

```bash
node --check scripts/export_shooting_board.mjs
node --check scripts/export_storyboard_layout.mjs
node --check scripts/render_storyboard_frames.mjs
bash -n build_storyboard_video.sh
```

然后检查：

- 审片板 HTML 里不出现 `显示放大图`。
- 审片板 HTML 里出现 `一键生成保姆版横屏视频`。
- 审片板 HTML 里出现 `打开视频`、`访达定位` 和 `打开视频文件夹`。
- 审片板 HTML 里每个镜头都有 `拖动排序`，并且 `review-overrides.json` 的 `sceneOrder.nanny` 与页面镜头数一致。
- 审片板 HTML 里每个镜头都有 `放大图（可选已生成图）`，选择后写入 `zoomImage`，导出布局和最终视频同步使用。
- 放大图切到 `局部展示` 后，`storyboard/browser-layout.json` 必须出现 `zoomMode: "crop"` 和 `zoomCropPosition`。
- `storyboard/browser-layout.json` 对删除过的放大图记录 `zoomDeleted: true`。
- `manifests/nanny-horizontal-storyboard.json` 的 renderer 为 `storyboard-preview`。
- `manifests/nanny-horizontal-storyboard.json` 的镜头数必须等于 `browser-layout.json` 里未删除的保姆版镜头数。
- `frames/storyboard-nanny-horizontal/` 的 `scene-*.png` 数量必须等于 manifest 镜头数。
- `videos/nanny-horizontal-storyboard.mp4` 可播放，分辨率 1920x1080。
- `afinfo videos/nanny-horizontal-storyboard.mp4` 的 audio estimated duration 应接近 `mdls -name kMDItemDurationSeconds videos/nanny-horizontal-storyboard.mp4` 的视频总时长。
