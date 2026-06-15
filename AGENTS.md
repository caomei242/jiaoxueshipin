# Codex Project Notes

## 项目定位

- 本项目固定为本地客户教程视频自动化工作区：`/Users/gd/Desktop/主业/客户教程视频自动化`。
- 输出目录固定落在 `/Users/gd/Desktop/主业/客户教程视频/` 下，不要混入 `/Users/gd/Desktop/主业--草莓客户管理系统`。
- 2026-05-29 阶段主线是「稿定商品 - AI优化商品图」教程，阶段输出目录是 `/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7`。
- 2026-05-29 阶段目标测试店是 `道理门`；如果截图里不是 `道理门`，不要把该镜头当成可交付素材。

## 默认产物口径

- 默认只做 `保姆级 / nanny / 横屏`。
- 用户没有明确要求时，不生成短视频干货风、竖屏版或多版本批量结果。
- 2026-05-29 阶段正式视频文件是 `videos/nanny-horizontal-storyboard.mp4`。
- `videos/nanny-horizontal.mp4` 属于旧模板链路，不能当作审片板修订后的正式结果。
- 多教程并行时，优先从多 Tab Hub 进入；Hub 默认端口为 `3849`，本机地址 `http://127.0.0.1:3849/`。Hub 顶层只分 `功能点分组` 和 `玩法组合`：`AI图片`、`AI视频` 等属于功能点分组下的二级分组，玩法组合下可以持续新增多个玩法卡片。Hub 只负责教程目录、入口、当前教程生成和打开产物；具体红框、鼠标、字幕、放大图和镜头批改仍由各子功能审片台负责。新增教程或玩法必须先写入 `configs/tutorials.json`，并使用独立输出目录，不能混入旧 `2026-05-29-horizontal-v7`。
- Hub 里的 `待采集` 教程不能做成死路；即使暂时不能一键出片，也必须提供 `开始制作保姆教程` 或等价入口，用来创建独立输出目录、采集清单、口播草稿和制作板。只有真实截图、正式审片台和分镜素材齐备后，才开放 `一键生成当前教程`。

## AI优化图到AI生成视频玩法视频

- AI优化图到AI生成视频玩法视频属于 playbook 旁路产线；不得写入或覆盖 2026-05-29-horizontal-v7 的 storyboard、frames、audio、manifests 或 videos。单功能保姆教程继续使用原 storyboard-preview 链路。
- playbook 默认输出目录是 `/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook`，正式视频是 `videos/ai-image-to-video-playbook-horizontal.mp4`。
- playbook 只服务组合玩法包装：先用 AI优化商品图优化老商品信息，再确认发布到测试店商品，最后进入 AI生成视频批量生成视频；不要把它当作单功能保姆教程替代品。
- playbook 素材入口是 `manifests/assets.json`，通过 `scripts/import_playbook_asset.mjs` 导入真实操作截图、AI 优化结果图、发布确认截图和视频结果；垃圾图、无关图和非 `道理门` 测试店图不要标为可交付素材。
- playbook 审片板由 `scripts/export_playbook_board.mjs` 输出，服务由 `scripts/playbook_server.mjs --port 3839` 启动；顶部必须保留 `一键生成玩法横屏视频`，避免用户每次都要喊 Codex 生成。
- playbook 一键生成完成后必须提供 `打开视频`、`访达定位`、`打开视频文件夹`，不能只让用户看到一串路径；打开接口只能访问当前 playbook 输出目录内的文件。
- playbook 配音也必须把 `SKU` 转成 `S K U`、`AI` 转成 `A I` 后再交给 macOS `say`，避免客户视频里读错。
- `scripts/capture_playbook_flow.mjs` 当前是安全抓取骨架：默认只识别当前 Chrome 里的稿定商品页面、截图、写 `manifests/capture.json` 和 checkpoint，不自动点击确认发布、AI 生成视频或充值。
- 只有同时传 `--allow-publish` 和 `--allow-generate-video`，并且页面文本包含测试店 `道理门`，且不是 `--dry-run`，capture manifest 里才允许标记 final actions 安全；即使标记安全，当前骨架也不能真的发布或生成。
- capture manifest 不得落 cookie、token、secret、debug query、URL hash 或浏览器调试敏感信息；写入 URL 时只保留 protocol、host 和 pathname。

## 正确流水线

1. 先通过真实页面截图、脚本和 `scripts/export_shooting_board.mjs` 生成 `storyboard/shooting-board.html`。
2. 让用户在审片板批改镜头；批改内容包括画面要求、字幕、口播、红框、鼠标、放大图、插入镜头和删除镜头。
3. 出片前必须从当前 Chrome 打开的审片板导出 `storyboard/browser-layout.json`，不能只读磁盘 HTML。
4. 正式出片用 `./build_storyboard_video.sh --output <output-dir> --style nanny`。
5. 审片板顶部必须保留 `一键生成保姆版横屏视频`，按钮调用 `/api/build-video`，底层仍跑正式 `build_storyboard_video.sh --style nanny`。
6. 一键生成成功后，审片板必须显示 `打开视频`、`访达定位`、`打开视频文件夹` 三个按钮；用户不能只看到一串文件路径还要自己复制查找。
7. 检查 manifest 的 `renderer` 必须是 `storyboard-preview`。
8. `scripts/render_storyboard_frames.mjs` 必须以 `storyboard/browser-layout.json` 为最终镜头来源；即使某个 `sceneKey` 不在基础 `tutorial-scripts.json` 里，也要用 layout 里的截图、标题、字幕、口播合成镜头，不能过滤掉功能点图、生成结果、跳过或确认发布这类后补镜头。
9. 渲染 `frames/storyboard-nanny-horizontal/` 前必须先清空旧帧，避免历史生成残留 `scene-15.png` 之类的旧文件误导验收。

## 审片板服务与缓存规则

- 审片板固定本地服务是 `http://127.0.0.1:3829/`；如果用户说点开的审片台还是老的，先检查本地服务和 Chrome tab，不要直接重做分镜。
- `scripts/storyboard_server.mjs` 对 HTML、静态资源和 API 响应必须带 `Cache-Control: no-store, no-cache, must-revalidate`、`Pragma: no-cache` 和 `Expires: 0`，避免 Chrome 继续展示旧审片板。
- 修改 `scripts/export_shooting_board.mjs` 或审片板 UI 后，必须重新运行 `node scripts/export_shooting_board.mjs --output <output-dir>`，再重启 `scripts/storyboard_server.mjs`。
- 验证新版审片板时，优先打开带时间戳的地址，例如 `http://127.0.0.1:3829/?v=20260602`；页面必须能看到 `一键生成保姆版横屏视频`、`拖动排序`、`添加红框`、`添加鼠标`、`在此前插入一镜`、`删除此镜头`、`完整显示 / 局部展示`。
- 如果 Chrome 同时保留旧 `file://.../shooting-board.html` 或旧 `127.0.0.1:3829` tab，必须关闭旧 tab 或用强刷新确认当前 tab 是新版；出片布局仍以当前新版审片板为准。

## 审片板交互规则

- 批改状态默认是 `通过`，支持 `需修改`、`重拍`、`删除`、`待确认`。
- 鼠标要清楚可见，放在目标右下方或旁边，不能挡住文字。
- 鼠标样式要小而干净，不加多余红点。
- 红框要框住真实操作区域，可拖拽和缩放，大小以客户一眼看懂为准。
- 审片板必须允许手动添加红框和鼠标；自动识别不到焦点时，用户仍然能自己加、拖动和缩放。
- 每一镜底图必须支持从已生产素材里选择，包括真实操作截图、已生成效果图和功能点对比图；用户换底图后，出片链路必须同步使用该底图。
- 放大图必须像底图一样支持从已生产素材里新增和替换；用户换放大图后，`zoomImage` 要同步写入审片状态、浏览器布局和最终视频。
- 放大图必须支持 `完整显示 / 局部展示` 两种模式；局部展示写入 `zoomMode=crop` 和 `zoomCropPosition`，最终帧按同样裁切展示。
- 放大图可拖动、缩放；放大图右上角 `×` 的语义是删除该大图，删除后写入 `zoomDeleted`，最终视频也不能再渲染它。
- 不要把删除放大图做成缩略、折叠或 `显示放大图` 恢复按钮。
- 不需要的镜头必须能通过 `删除此镜头` 或批改状态 `删除` 标记为 `reviewStatus=remove`；最终视频同步跳过。
- 删除状态必须以当前审片板 localStorage 和 `review-overrides.json` 为准。Chrome 同时开着多个审片板 tab 时，不允许旧 tab 的控件值把已删除镜头从 `remove` 覆盖回 `pass`。
- 字幕直接叠在真实截图上，不使用大面积独立字幕板。
- 下拉框、勾选框、弹窗、位置 1 到 5 这类客户必须看见的动作，要单独插入补充镜头。
- 插入补充镜头必须同时支持 `在此前插入一镜` 和 `在此后插入一镜`；前插写 `beforeSceneKey`，后插写 `afterSceneKey`，最终出片顺序必须同步。
- 每一镜必须支持通过 `拖动排序` 上下拖动整张镜头卡；拖动后写入 `review-overrides.json` 的 `sceneOrder.<style>`，刷新页面、重新导出分镜和重新生成视频都必须沿用该顺序。
- `给AI的改稿意见` 是用户写给台词生成器看的调整要求，不直接进视频；底层字段仍用 `reviewNote`，保持旧批改兼容。
- 如果用户改了画面要求或 `给AI的改稿意见`，优先让 `生成客户版台词` 同步生成字幕和口播草稿，再由用户微调。该功能优先走本地 OpenAI 兼容 API，环境变量为 `TUTORIAL_COPY_API_BASE`、`TUTORIAL_COPY_API_KEY`、`TUTORIAL_COPY_MODEL`；代码和文档里不要硬编码 API key。

## 浏览器布局导出规则

- 出片前导出 `storyboard/browser-layout.json` 时，必须以用户当前正在看的审片板为准。
- 如果 Chrome 同时开着多个 `127.0.0.1:3829` 审片板 tab，导出脚本要优先选择包含新版审片板控件的页面，例如存在 `.scene-drag-handle` 且页面包含 `/api/save-order` 的 tab；不要默认抓旧的根地址 tab。
- `browser-layout.json` 的镜头顺序必须来自页面 DOM 顺序；如果用户拖动过镜头，最终视频必须按拖动后的顺序渲染。
- `browser-layout.json` 的镜头数必须和最终 manifest 镜头数一致，除非镜头明确标记为 `reviewStatus=remove`。
- `scripts/export_storyboard_layout.mjs` 读取同一镜头字段时，优先使用 localStorage 里的用户最新保存值，再读 DOM 控件值；渲染时再用 `review-overrides.json` 兜底删除状态。

## 配音与音画同步规则

- 字幕和口播稿保持客户能读懂的正常写法，例如 `SKU图`、`AI优化商品图`；但生成系统配音前，`scripts/list_voiceover_jobs.mjs` 必须把 `SKU` 转成 `S K U`，把 `AI` 转成 `A I`，避免 macOS 中文声音误读。
- `voiceover.sh` 每次生成某个 style 的配音前必须清空对应 `audio/<style>/`，避免删除镜头后残留旧的 `scene-13.m4a`、`scene-19.m4a` 干扰排查。
- `compose_video.swift` 必须先生成一条和视频同长的连续音频轨：按每个镜头的起点写入口播，中间写入真实静音，再合进 MP4。不能只把各段 m4a 按顺序插入，否则空白会被压缩，后半段音画会不同步。
- 验收音画同步时，除了看 MP4 总时长，还要用 `afinfo videos/nanny-horizontal-storyboard.mp4` 检查音频轨 `estimated duration`，应接近 `mdls -name kMDItemDurationSeconds` 的视频总时长。

## 操作与安全边界

- 可以在测试店 `道理门` 里大胆演示生成效果图。
- 不自动发布、不自动替换商品图、不自动充值。
- 不输出 cookie、token、后台调试信息。
- 如果目标店、平台、店铺下拉、商品列表或生成结果不对，标为 `重拍` 或插入补充镜头，不要硬凑。

## 验收清单

- `storyboard/browser-layout.json` 的镜头数与审片板保姆级镜头一致。
- `manifests/nanny-horizontal-storyboard.json` 存在且 renderer 为 `storyboard-preview`。
- 审片板一键生成结果区能直接打开或定位 `videos/nanny-horizontal-storyboard.mp4`。
- `frames/storyboard-nanny-horizontal/` 里随机帧能看到用户批改后的红框、鼠标、字幕和放大图状态。
- 删除放大图的镜头在最终帧和视频里不再显示大图。
- MP4 能播放，分辨率为 1920x1080，视频总时长和音频轨时长基本一致。
