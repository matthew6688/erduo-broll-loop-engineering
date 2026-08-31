# FengTalk 视频生产系统使用手册

更新时间：2026-08-31

这份手册面向日常使用者。你不需要会终端，也不需要理解 HyperFrames、FFmpeg 或 JSON。
平时只要在 Codex 对话中提供文稿和素材、选择视频形式，并在规定的审批节点做决定。

本系统以 `erduo-broll-loop-engineering` Skill 为唯一 B-roll 生产流程。FengTalk 的人物背景、
服装和“峰说”Logo 只属于真人/数字人画面，不得修改原始 Erduo DesignMD、主题、版式或动画。

## 1. 系统能生产什么

### 三种节目形态

| 形态 | 什么时候使用 | 人物与 B-roll 的关系 |
| --- | --- | --- |
| 纯 B-roll | 不需要真人或数字人口播 | 全片由原始 DesignMD 驱动的动画、数据、界面和素材镜头组成 |
| 真人 + B-roll | 已有剪辑好的真人口播视频 | 真人是底层 presenter source；需要解释时切换到 B-roll |
| 数字人 + B-roll | 希望减少真人出镜 | 数字人是 presenter source；B-roll 流程与真人版完全相同 |

真人和数字人不是两套剪辑系统。二者只是在输入端使用不同的 presenter source，后面的
Director、Assets、Lead、Chapter Builder、五镜 canary、字幕和最终合成都共用一套流程。

### 三种冻结版式

| 版式 | 画面 | 适用场景 |
| --- | --- | --- |
| `original` | 保持真人或数字人原视频构图；B-roll 以全屏切镜出现 | 已剪好的真人口播、常规竖屏口播 |
| `avatar-center` | 数字人居中；需要解释时切换为全屏 B-roll | 直接面对镜头的短视频 |
| `avatar-split` | 横屏中人物在右侧，左侧可显示已经验证的 9:16 B-roll；必要时切全屏横版 B-roll | YouTube 横屏、讲解型视频 |

不能临时发明第四种版式。人物是否出现、何时全屏 B-roll、何时 split，由 Director 和
Chapter Builder 在 Recipe 中决定；Parent 只能机械编译时间线，不能凭感觉手写切点。

### 支持的主要输出

| 用途 | 默认规格 | 说明 |
| --- | --- | --- |
| 抖音、视频号、Reels、Shorts | 1080×1920、30 fps | 竖屏独立生产，不从横屏裁切 |
| YouTube 常规视频 | 1920×1080、30 fps | 横屏独立生产，不拉伸竖屏成片 |
| 纯 B-roll 默认 | 1920×1080、30 fps | 每个语义镜头独立 H.264 MP4 |
| 4K | 仅明确要求时 | 不作为日常默认，避免无意义增加时间和空间 |

横屏和竖屏可以使用同一文稿、旁白和素材索引，但必须建立两个独立 production root。
已经渲染的镜头不能靠裁切冒充另一种画幅。

## 2. 开始前需要准备什么

### 必须提供

1. **完整中文口播稿**：最终要说的全部内容，不要同时提供多个互相冲突的版本。
2. **完整 SRT**：它是全片唯一时间真相。只有文稿时，先让 Agent 完成旁白和 SRT，
   你确认文字与时间后再启动视频生产。
3. **原始 DesignMD**：默认使用 Erduo 原始设计，不做 FengTalk 主题替换。
4. **视频形式**：纯 B-roll、真人或数字人。
5. **目标画幅**：9:16 或 16:9。需要两个画幅时明确说“双版本独立生产”。
6. **发布用途**：内部样片、canary 或正式发布。

### 真人模式另外提供

- 已剪辑完成的真人 MP4；
- 视频中有且只有一条最终音轨；
- 与视频完全对应的 SRT；
- 明确授权该素材用于本次 canary 或正式发布。

### 数字人模式另外提供

- 获授权的本人彩色肖像或已经批准的数字人图片；
- 本人真实录音，或批准用于本次视频的 VoxCPM 声音；
- 选择已经批准的数字人背景、服装和“峰说”Logo 版本；
- 明确肖像、声音和发布用途授权；
- 先批准 10–15 秒的身份、声音和口型 canary。

本人及数字人必须保持自然彩色和自然肤色，永久禁止黑白、灰度和双色印刷处理。数字人
背景可以出现“峰说”，但不默认出现域名、二维码或联系方式。

### 可选素材

- 产品截图、报告页面、图表、照片、视频素材；
- Logo 原文件和字体授权；
- 最多两份真正相关的视觉参考；
- 必须出现或禁止出现的内容清单。

提供素材不等于把截图放进普通卡片。素材必须真正参与裁切、标注、遮罩、路径、层级、
状态或运动；不适合的素材可以不用，但 Agent 必须说明原因。

## 3. 最简单的开工方式

把文件附在对话中，然后发送：

```text
严格使用 erduo-broll-loop-engineering 生产这条视频。

视频形式：数字人 + B-roll
版式：avatar-split
画幅：16:9，1920×1080，30fps
用途：先做可发布 canary，不启动全片

原始 SRT、原始 DesignMD、人物素材、旁白和参考素材都已附上。
先冻结输入和 FengTalk governance，再给我视觉镜头计划、三类 Lead 样片计划和五镜 canary 计划。
没有我的明确批准，不得开始渲染；五镜 canary 没有至少 3/5 获得我的选择，不得启动全片。
人物背景只适配数字人，不得修改原始 B-roll DesignMD。
```

纯 B-roll 时把“数字人 + B-roll”和人物相关内容改为：

```text
视频形式：纯 B-roll。不要生成或合成人物。
```

真人模式改为：

```text
视频形式：真人 + B-roll，使用我附上的已剪真人母片和对应 SRT。
保持真人原构图，使用 original 模式。
```

## 4. 完整生产流程与审批点

### Gate 0：一次性环境检查

首次安装、仓库更新或运行时身份变化时，Agent 检查 Node、FFmpeg、浏览器、固定版
HyperFrames 和 Skill 注册。日常每条视频只做轻量 preflight，不重复深度安装。

当前生产 HyperFrames 固定为 `0.7.104`。不要为了“更新”而直接升级；版本迁移必须在隔离
runtime 中重新跑完整五镜 canary。

你应看到：环境可用，或一个具体阻塞原因。不能用“自动换后端”掩盖失败。

### Gate 1：输入冻结

Agent 创建新的 production root，登记并 hash 绑定：

- 原始 SRT 和原始 DesignMD；
- 输出画幅、帧率和格式；
- FengTalk 品牌真源、允许的 Logo、颜色和禁止项；
- Skill 使用合同；
- 真人/数字人 source、授权和唯一音轨；
- 获批的 `original`、`avatar-center` 或 `avatar-split` 模式。

你需要确认：文稿、画幅、人物、背景、用途和版式是否正确。任何一项改变都应建立新的
production root，不能覆盖旧版本继续向下跑。

### Gate 2：视觉镜头计划

Director 阅读完整 SRT 和 DesignMD，将内容拆成语义镜头和章节。正常镜头约 5–12 秒，
Builder 通常负责连续 5–8 镜，而不是“一句话一个 Agent”。

在渲染前，你应先看到一份可理解的视觉计划，至少包含：

- 每个章节要解决什么表达任务；
- 每个镜头的时间窗、核心信息和画面关系；
- 动画如何建立、行动、变化、收束和留出阅读时间；
- 使用原生图形、真实素材、搜索素材还是生成素材；
- 真人/数字人出现的任务和预计比例；
- 哪五镜作为 canary，为什么能覆盖主要风险；
- 横屏中哪些时段为人物居中、split 或全屏 B-roll。

你可以这样反馈：

```text
镜头计划方向批准，但请修改以下内容后再进入样片：
1. 开头 5 秒保留数字人提出判断；
2. 数据对比改成全屏 B-roll；
3. 结尾回到数字人；
4. 不修改原始 DesignMD，不增加域名。
```

你的“批准计划”只允许进入样片，不等于批准全片。

### Gate 3：Lead 三类样片

Lead 先完成三个代表镜头：

1. 原生图形/文字；
2. 真实或生成素材融合；
3. 信息密集的界面、流程或数据镜头。

Lead 必须自己打开短预览和六格图、修复可见问题，然后才能交给你。你重点看：

- 是否仍是原始 DesignMD 的排版和动画语言；
- 信息层级是否清楚；
- 素材是否真正参与画面，而不是塞进模板卡片；
- 动画是否在讲因果，而不是只有装饰循环；
- 三个样片是否明显不同，而不是同一骨架换文字。

### Gate 4：五镜纯 B-roll Canary

Presenter layout 不能跳过纯 B-roll canary。系统先只生产五个代表镜头，并机械验证：

- 5/5 独立直出并完整解码；
- 每镜有当前 Skill sidecar、媒体 hash、六格图和 Builder 看片回执；
- 至少三种不同构图；
- 原则上至少两镜使用真实或生成素材；
- 文字来自 SRT、Recipe、DesignMD 词汇或固定界面；
- 没有裁切、碰撞、空容器、错误累积、黑帧或不可读结果；
- 动画有真实发展、收束和阅读停留；
- 已闭合的实际创作开始到首次 canary 以 45 分钟为效率目标；超出时记录 `over-target`、超出时长和最长阶段，但质量干净的生产必须继续跑完。只有素材、技术、视觉、看片或审批失败才停止；人工审批、暂停和跨会话等待单独记录，不混入生产速度。

你必须逐镜做决定。建议回复：

```text
五镜 canary 结果：
- shot-01：选择本版
- shot-02：选择本版
- shot-03：返修，数据结果出现太早
- shot-04：选择本版
- shot-05：返修，素材只是静态卡片

目前 3/5 选择本版。只返修 03 和 05，返修后再给我看；不要重做已经通过的镜头。
```

只有技术门通过且你至少选择本版 3/5，系统才可以展开全片。

### Gate 5：人物 Canary（真人/数字人项目）

数字人先用同一段 10–15 秒旁白验证：

- 人脸身份、自然彩色肤色和服装；
- 声音是否正确；
- 口型、停顿和时长是否同步；
- 背景和“峰说”Logo 是否稳定、清楚但不抢人；
- 手部、头部、眼神和背景是否漂移；
- 是否只有一条最终音轨。

声音一旦变化，旧口型不能复用；必须重新生成数字人媒体、Runtime Plan 和 edit plan。
真人模式也要确认真人母片、SRT 和音轨完全对应。

人物 canary 和 B-roll canary 是两个独立审批。人物通过不能替代五镜 B-roll 审批，反之亦然。

### Gate 6：Presenter 合成计划

只有纯 B-roll canary 获批后，系统才根据最终 Recipes 编译人物时间线：

- `presenter`：只显示人物；
- `broll`：全屏 B-roll；
- `mixed`：人物为底，批准的窗口显示 full 或 split B-roll。

你应看到人物出现比例、每个切换时间窗和版式，而不是只收到一个已经渲染的成片。短视频
通常让人物承担开头、章节锚点和结尾，建议约 15–30%；B-roll 承担 70–85% 的信息解释。

### Gate 7：全片生产

系统按章节继续生产剩余镜头。已经验证且绑定完全一致的镜头应机械复用，不得为了更新
Plan 身份重复渲染。每个 Assignment 最多两次实际渲染；第三次必须回到 Recipe 或 Plan，
不能盲目循环。

你不需要逐个处理低级渲染错误。原 Builder 应修复自己的字体、素材、布局、动作和阅读问题，
Parent 只负责机械检查、收据和装配。

### Gate 8：完整动态预览

全片只从验证后的独立 shot 文件装配。你重点判断：

- 开头是否迅速进入问题；
- B-roll 是否与口播同步而不是抢话；
- 人物、split 和全屏 B-roll 的切换是否自然；
- 全片构图、密度和节奏是否重复；
- 数据与结论是否有足够阅读时间；
- 结尾是否完整而不是突然停止。

技术通过不等于审美批准。你明确说“批准完整预览”后，才进入正式交付。

### Gate 9：字幕、最终像素审查与交付

最终文件必须完整解码，并保证：

- 恰好一条 canonical audio；
- 字幕与原始 SRT 一致，且不超出媒体时长；
- 字幕没有遮住主要 B-roll 文字和人物；
- 数字人口型与声音同步；
- 没有黑帧、空画面、错误裁切或人像黑白化；
- 每个镜头边界、人物切换、字幕区间和最后一秒都已抽帧查看；
- 每个交付视频都有绑定自身媒体 hash 的 Skill 使用 sidecar。

## 5. 最终会收到什么

标准交付包括：

| 交付物 | 用途 |
| --- | --- |
| 独立 shot MP4 | 可单独替换、复用或重新剪辑 |
| 每镜可编辑源码 | 后续修改文字、素材和动画 |
| 每镜六格图与章节预览 | 复核镜头发展和阅读停留 |
| `delivery-index.json` | 镜头顺序、时间、来源和媒体身份 |
| 完整动态 preview | 最终审美审批 |
| 可选 Master MP4 | 从已验证 shot 重新装配，不复制预览冒充 |
| Presenter 合成版 | 真人或数字人与 B-roll 的最终单音轨版本 |
| SRT 和字幕版 | sidecar 字幕及需要时的烧录字幕版本 |
| Skill 使用 sidecar 与验证 receipt | 证明视频确实按本 Skill 生产 |
| 最终像素审查记录 | 记录实际交付 MP4 的通过或失败结论 |

## 6. 如何提出修改而不破坏稳定性

### 可以定点修改

- 某一镜文字太小、出现太早或停留不足；
- 某一镜素材裁切、标注或动画有问题；
- 某个人物窗口应改为 full 或 split；
- 字幕位置与主体冲突；
- 某一段人物口型失败，需要重新生成该 presenter 段。

请提供 `镜头/时间点 + 可见问题 + 期望结果`，例如：

```text
00:23.4–00:27.1 的 shot-08：三个国家的数据在结果出现前叠在一起。
请由原 Builder 只修改这一镜，让旧状态退出后再显示最终比较；其他镜头不要动。
```

### 必须新建 production root

- 改完整文稿或 SRT 时间；
- 更换声音、人物视频或数字人图片；
- 更换原始 DesignMD、品牌真源或 Logo；
- 从竖屏改横屏，或反过来；
- 改发布用途、授权范围或 presentation mode；
- 升级 HyperFrames 或改变运行时可执行文件。

### 永久不要这样做

- 同时修改 DesignMD、品牌色、人物、声音、字幕和 layout；
- 未看视觉计划就直接渲染全片；
- 用一张截图或技术分数代替动态预览；
- 为赶交付跳过五镜 canary 或伪造 Skill 使用记录；
- 把旧视频补一个 sidecar 冒充按当前 Skill 生产；
- 从 Master 二次切割镜头，冒充逐镜直出；
- 把数字人背景或 FengTalk 配色扩散到 B-roll 主题。

## 7. 常见问题

### 我只有中文文稿，没有 SRT，可以开始吗？

可以先做前置准备，但不能直接进入正式 B-roll。先冻结旁白，生成并审核完整 SRT；SRT 获批后
再建立 production root。

### 数字人必须全程出现吗？

不需要。人物只在提出观点、章节转折和结尾等有明确任务的位置出现。B-roll 承担主要解释。

### 能同时做横屏和竖屏吗？

可以，但必须是两个独立生产根和两套构图 canary，不是同一个视频自动裁切。

### B-roll 支持图片、截图和视频吗？

支持。它们必须有真实表达作用，例如作为数据证据、界面状态、裁切路径、注释对象或动画主体，
不能只是贴进一个通用框里。

### 为什么先做五镜而不是直接全片？

五镜用最低成本暴露 DesignMD、素材、构图、动画、运行时和人物 layout 的主要风险。方向不对时
只返修五镜，不让全片形成沉没成本。

### 技术测试通过是否代表视频好看？

不代表。自动门禁只证明文件、时间、音轨、文字来源、解码和部分可见缺陷。样片、canary 和
完整动态预览仍必须由你判断。

### 系统会自动发布到四个渠道吗？

不会。这个仓库负责生产和验证视频，不会自动向平台发布。四渠道标题、正文、封面、上传、
平台合规和发布后复盘属于上层 FengTalk 内容发布流程，需要单独授权。

### 为什么有些 HeyGen 视频有水印？

水印来自生成端账户或导出权限，不是 B-roll 合成器添加。正式发布前必须先确认 HeyGen 的
无水印 entitlement，并重新生成 presenter source；不能在本地非法修补已经烧入的视频。

## 8. 发布与复盘交接

视频系统完成的是“可发布媒体包”，不是自动发布。交给发布流程时至少带上：

- 最终横版或竖版 MP4；
- 对应 SRT；
- 封面候选和标题方向；
- 使用素材及授权摘要；
- 最终验证 receipt；
- 目标平台和预计发布时间。

发布后复盘建议记录：

- 前 3 秒、10 秒和整体留存；
- 完播率、平均观看时长和重复观看；
- 评论中被理解或误解的观点；
- 数字人出现窗口与掉点的关系；
- 哪类 B-roll 提升理解，哪类造成信息负担；
- 下一集只改变哪一个变量。

复盘结论只能影响下一条新 production 的 Director brief 或素材策略，不能回写并篡改已经交付
视频的历史证据。

## 9. 每次生产的最终检查清单

### 开工前

- [ ] 完整文稿和 SRT 已确认。
- [ ] 原始 DesignMD 已确认，没有 FengTalk B-roll 主题替换。
- [ ] 画幅、帧率、用途和视频形式已确认。
- [ ] 真人/数字人素材及肖像、声音、发布授权已确认。
- [ ] 人物为自然彩色；背景不使用域名或二维码。
- [ ] 新 production root 已建立，没有覆盖旧版本。

### 渲染前

- [ ] 已看到并批准视觉镜头计划。
- [ ] 已看到三类 Lead 样片计划。
- [ ] 五镜 canary 的选择与风险覆盖清楚。
- [ ] 没有未经批准的新主题、版式或品牌元素。
- [ ] Presenter 项目已批准三种冻结模式之一。

### 扩产前

- [ ] 五镜 B-roll 5/5 技术门通过。
- [ ] 已逐镜观看六格图和短预览。
- [ ] 至少 3/5 选择本版。
- [ ] 数字人身份、声音和口型 canary 已独立批准。
- [ ] 不变镜头将复用，不重复渲染。

### 交付前

- [ ] 完整动态预览已由用户批准。
- [ ] 最终 MP4 完整解码且只有一条正确音轨。
- [ ] 字幕与 SRT 一致、可读且没有遮挡。
- [ ] 人物、split 和全屏 B-roll 过渡自然。
- [ ] 开头、全部边界、字幕区间和最后一秒已抽帧查看。
- [ ] 所有视频有当前 Skill sidecar 和媒体 hash 绑定。
- [ ] 发布仍等待单独明确授权。

## 10. 给 Agent 的恢复提示词

新会话中可以直接发送：

```text
继续 FengTalk 视频生产。先读取项目中的：
1. docs/FENGTALK-VIDEO-PRODUCTION-USER-GUIDE.md
2. erduo-broll-loop-engineering/SKILL.md
3. 当前 production root 的输入、governance、Runtime Plan、receipts 和最后状态

严格从现有状态继续，不重做已通过镜头，不修改原始 DesignMD，不补造历史 Skill 证据。
先告诉我当前处于哪个 Gate、已经通过什么、下一项需要我批准什么；没有批准不要继续渲染。
```

## 11. 当前能力边界

截至 2026-08-31：

- 默认 Erduo B-roll 和 9:16 数字人样片已经有真实生产证据；
- 真人与数字人共用的合成合同、唯一音轨和字幕门禁已有自动化测试；
- `original`、`avatar-center`、`avatar-split` 三种版式已经冻结；
- 仓库尚未记录一条绑定当前 Skill、可正式发布的 16:9 数字人 canary；
- HeyGen adapter 已覆盖 canary 和恢复逻辑，但尚不是完整正式生产 Provider；
- Windows、剪映/CapCut 实机导入和跨后端视觉一致性仍未验证；
- HyperFrames 生产版本保持 `0.7.104`，不进行原地升级。

因此，下一项最有价值的验证是：用真实中文 SRT、原始 DesignMD 和已批准数字人 source，
跑一条可发布的 1920×1080 `avatar-split` 五镜 canary，而不是继续增加新主题或新布局。

## 12. 动画究竟由谁提供

B-roll 动画不是某个在线动画 API 返回的成片。正常生产由本机固定版 `HyperFrames 0.7.104`
在浏览器中渲染，FFmpeg/FFprobe 负责编码、解码检查、六格图和最终装配。Director、Lead 和
Chapter Builder 根据原始 DesignMD 与每镜 Recipe 编写具体动画；因此动画质量主要取决于镜头
设计、Builder 实现和可见证据审查，而不是更换云服务。

其他服务的边界如下：

| 来源 | 在系统中的职责 | 不负责什么 |
| --- | --- | --- |
| HyperFrames 0.7.104 | 本地 B-roll 动画运行时 | 数字人口型、语音和发布 |
| 本仓库 Craft Catalog | 提供文字、流程、数据、图解、素材融合等语义动画方法 | 不是可直接渲染的组件库 |
| Shotcraft 卡片 | Director/Builder 的渐进式镜头知识 | 不自动生成动画，也不应手改同步镜像 |
| HeyGen | 受限的数字人 presenter canary | 不生成 B-roll |
| VoxCPM / Whisper | 本地声音生成与语音识别/对齐 | 不设计镜头 |
| Pexels 或获授权本地素材 | 可选照片和视频素材 | 不替代 Recipe、来源和版权门禁 |
| Remotion | 明确规划或 canary 选择时的备选动画后端 | 不能在 HyperFrames 失败后偷偷切换 |

### 后面如何增加新动画

按复用程度只走三条路：

1. 只为当前镜头服务：写进该镜 Recipe 和 Builder 源码，不增加公共组件。
2. 多个镜头共享一种表达方法：先增加 runtime-neutral Craft Catalog 条目，仍由 Builder 按镜实现。
3. 确实反复复用同一份可执行实现：建立 `animation-extension` manifest，固定实现文件和哈希，
   保留原 DesignMD，经过 check、preview 和真实 canary 后才能从 `candidate` 升级。

可执行扩展必须使用
[`animation-extension.schema.json`](../erduo-broll-loop-engineering/references/runtime/animation-extension.schema.json)
和 [`validate-animation-extension.mjs`](../erduo-broll-loop-engineering/scripts/validate-animation-extension.mjs)。
模板位于
[`animation-extension-template.json`](../erduo-broll-loop-engineering/references/animation-extension-template.json)。
`candidate` 默认不可进入正式生产；`canary-approved` 和 `reusable` 必须绑定真实 canary receipt。
任何版本、源码、preview 或 receipt 漂移都会失败。该入口固定
`designMdPolicy=preserve-original`，不能借“增加动画”修改默认主题。

## 13. 生产时长与瓶颈埋点

每个 production root 使用追加写入的 `production-events.ndjson`。事件只记录结构化阶段、phase、
unit、操作字节、失败和重试，不记录对话正文或私人 session 路径。自动化命令负责闭合自身 span；
Director、Assets、Lead/Builder 首次创作和用户审批等待由 Parent 在调用边界记录。

标准 phase 包括创意、素材冻结、Assignment Preflight、逐镜渲染、完整解码/六格图、文字/运动
审计、数字人生成、Presenter edit plan、合成、字幕、像素审查、人工等待和最终交付。指标汇总
同时保留每个 span 和按 phase 的总墙钟耗时，所以能区分“机器渲染慢”与“第一次创作/等待慢”。

三个检查点分别生成不可覆盖快照：

```bash
npm run metrics:collect -- --production-root /absolute/production-root --milestone canary
npm run metrics:collect -- --production-root /absolute/production-root --milestone full-preview
npm run metrics:collect -- --production-root /absolute/production-root --milestone final
```

输出为 `production-metrics-canary.json`、`production-metrics-full-preview.json` 和
`production-metrics-final.json`。同名文件已存在时命令失败，不能覆盖历史事实。没有可靠宿主 Token
数据时明确写 `unknown`，不做估算。

每份快照还包含 `observabilityCoverage`。它按纯 B-roll 或 Presenter 项目列出
`requiredPhases`、`observedPhases` 和 `missingPhases`；只有缺失列表为空才是 `complete`。
`incomplete` 不是视频质量失败，而是“这份数据不足以支持效率结论”，不得据此修改渲染框架。

Agent 调用和人工审批没有子进程可以自动包裹，因此 Parent 必须在真实边界追加同一 span 的
开始/结束事件。例如 Lead 首次创作使用 `creative-authoring`，Assets 使用 `asset-freeze`，向用户
展示 canary 到收到决定之间使用 `user-review-wait`，字幕制作使用 `subtitles`，最终逐边界截图
看片使用 `pixel-review`。命令示例：

```bash
npm run metrics:record -- --events /absolute/production-root/production-events.ndjson \
  --type stage-start --stage lead-builder --phase creative-authoring --span lead-U001 --unit U001

npm run metrics:record -- --events /absolute/production-root/production-events.ndjson \
  --type stage-end --stage lead-builder --phase creative-authoring --span lead-U001 --unit U001 --status passed
```

Parent 必须复用完全相同的 `--span`、`--stage`、`--phase` 和 `--unit`。失败也要写闭合的
`stage-end --status failed`；不能删除失败事件来美化数据。

当前机械五镜基线中位数为 47.813 秒。既有实验证明并发渲染慢 10.2%，合并解码/六格图慢
88.7%，因此两项都不是优化方向。下一条真实视频应重点观察 Lead/Builder 首次创作、preflight
返修和人工 handoff 等待；没有新指标证据时停止继续改渲染器。

Lead/Builder 保存首版 HyperFrames 源码后，系统会先做秒级静态合同检查，一次返回 composition
root、timeline、字体声明和 sourceRoot 资源路径问题；这些错误不会启动官方浏览器，也不会消耗
两次真实渲染额度。静态检查通过后，官方浏览器 visual preflight 和真实视频运动审计仍照常运行。

## 14. 每条真实视频结束后的效率复盘

交付后只回答四个问题：

1. `phaseSummary` 中耗时最高的三个 phase 是什么？
2. 哪些失败或 retry 属于输入问题、创作问题、preflight 问题或工具问题？
3. canary 到 full-preview、full-preview 到 final 新增了多少时间和空间？
4. 哪一项改进能作用于后续所有视频，并且不改变原 DesignMD、质量门禁和画质？

如果答案只是“精修这一条视频”或收益没有可重复证据，不修改框架。任何提速改动先建立 checkout
point，在隔离 performance sandbox 跑三次，并与冻结基线比较画质和墙钟时间后再决定保留。
