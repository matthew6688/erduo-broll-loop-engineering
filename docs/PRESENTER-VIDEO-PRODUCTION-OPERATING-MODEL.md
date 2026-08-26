# 真人 / 数字人双模式视频生产方案

更新时间：2026-08-26

数字人图片、动作白名单、主持人背景与 canary 升级门禁见
[`DIGITAL-PRESENTER-VISUAL-SYSTEM.md`](DIGITAL-PRESENTER-VISUAL-SYSTEM.md)。

当前现役决定：默认 Erduo B-roll 的 DesignMD、主题、版式和动画保持不变。FengTalk 适配只发生
在 presenter source：数字人的独立背景与“峰说”Logo。人物与 B-roll 按 Recipe 的
`presenter|broll|mixed` 时间线切换。系统现在冻结三种 composition mode：`original`、
`avatar-center` 和 `avatar-split`。第三种只把已验证的 9:16 B-roll 覆盖到数字人背景的左侧留白，
不建立新的 B-roll 主题，也不让 presenter 品牌层改写 B-roll。
正常发布所需的肖像/声音授权、口型、唯一音轨、字幕、完整解码和 Skill 证据仍全部保留。

## 1. 目标与边界

本方案以 Erduo 的 SRT/DesignMD 创作闭环为主体，同时支持三种节目形态：

1. 纯 B-roll / 无主持人；
2. 真人口播 + B-roll；
3. 数字人口播 + B-roll。

真人和数字人不是两套剪辑系统。它们只是两种 `presenter source`。后续的 SRT truth、
Director、Assets、Lead、Chapter Builder、五镜头 canary、静音逐镜 B-roll、edit-plan compiler、
最终 compositor 和媒体门禁全部共用。

当前已稳定实现的是：把一条已经冻结到本地、只有一条音轨的真人或数字人 MP4 登记为
`presenterKind=human|digital`，再由最终 Recipe 的 `presenterTreatment` 决定何时显示主持人、
何时切换到 B-roll。HeyGen 仍是外部媒体 Provider，不是第三个 B-roll runtime。

## 2. 已验证能力与成熟度

| 能力 | 当前状态 | 证据边界 |
| --- | --- | --- |
| 默认 Erduo B-roll | 已验证 | 逐镜直出、六帧表、章节预览、canary、全量交付索引 |
| 数字人 + B-roll | 已完成真实生产样片 | 授权肖像、本地 VoxCPM 旁白、HeyGen 口型、三段 presenter、单音轨合成、中文字幕 |
| 真人 + B-roll | 合同与集成测试已支持 | `presenterKind=human` 复用同一编译/合成链；仍应再做一条真实真人母片 canary |
| 竖屏 9:16 | 已完成真实样片 | 1080×1920、30 fps |
| 横屏 16:9 | 引擎支持，尚未完成本方案实片 canary | Erduo 默认 profile 为 3840×2160、30 fps，也可显式使用 1920×1080 |
| 字幕 | 已纳入最终交付门禁 | 原 SRT 作为 sidecar truth；烧录字幕衍生版必须通过 SRT hash、时间、音轨连续性、响度和完整解码检查 |
| HeyGen HTTP adapter | canary adapter 已实现并有 mock 回归测试；正式生产 adapter 未完成 | 已有授权文件、余额预检、上传、幂等键、状态持久化、轮询、恢复和下载；仍缺 full-production 授权合同、Webhook/长期任务运维和真实发布回归 |

因此，对外应表述为“真人/数字人双模式剪辑与合成已成立”；不应表述为“HeyGen 全自动
Provider 已完整产品化”或“横屏已经过真实样片验收”。

## 3. 统一生产模型

```text
完整 SRT + 原始 DesignMD + 输出 profile
                 │
                 ├─ presenter=none ────────────────┐
                 ├─ presenter=human：真人母片 ─────┤
                 └─ presenter=digital              │
                    ├─ 本地录音 / 本地 VoxCPM      │
                    ├─ 本地 Whisper 对齐            │
                    └─ HeyGen 生成口型视频           │
                                                   ▼
授权与 hash 封闭 → Director Recipes → Lead 三样片 → 五镜头 canary
                                                   │
                                                   ▼
Chapter Builders → 静音逐镜 B-roll → delivery-index.json
                                                   │
                                                   ▼
机械编译 presenter edit plan → 单音轨最终合成 → 字幕衍生版 → 最终审片
```

### 不变量

- 原始 SRT 是唯一文稿与绝对时间真相；TTS、数字人和 B-roll 不得各自改稿。
- 原始 DesignMD 是视觉真源；默认版未稳定前不得叠加品牌实验。
- 每个 B-roll shot 保持静音；最终只保留 presenter 的一条 canonical audio stream。
- Director/Builder 决定 `presenter|broll|mixed`；Parent 只能机械编译切点，不能手写时间线。
- 数字人背景和“峰说”Logo 是 presenter source 的一部分，不得进入 B-roll DesignMD。
- 更换声音、数字人媒体、SRT、DesignMD、画幅或治理锁，都要建立新的 production root。
- 人像必须保持自然彩色；永久禁止把本人肖像处理为黑白。

## 4. 标准生产步骤

### Gate A：输入和输出冻结

先确定完整 SRT、原始 DesignMD、发布用途、素材授权、主持人类型和唯一输出 profile。
短视频建议先使用 1080×1920；YouTube 横屏建议先用 1920×1080 做成本可控的 canary，正式
4K 再使用 Erduo 默认 3840×2160。profile 必须由 `create-production-profile.mjs` 生成。
Presenter 项目还必须用 `create-presentation-mode.mjs` 生成并由用户批准
`00-inputs/presentation-mode.json`；未批准的 draft 不能进入 Runtime planning。

### Gate B：声音

- 真人模式：登记剪辑完成、只有一条音轨的真人母片。
- 数字人模式：优先使用本人真实录音或本地 VoxCPM；本地 Whisper 检查内容覆盖和 SRT 对齐。
- 新声音不能直接替换旧视频音轨。音素时长变化后必须重新生成口型并重新编译时间线。

### Gate C：主持人 canary

数字人先生成 10–15 秒样片，用户分别批准身份、声音和口型。通过后才生成需要的完整片段。
主持人不默认全程出现；推荐承担开场、章节锚点和结尾，约占成片 15–25%。

### Gate D：Erduo 视觉 canary

保持完整五镜头 canary：Lead/Builder 必须打开真实预览与六帧表；技术门禁全部通过后，用户
至少选择本版 3/5，才解锁全量生产。主持人 canary 不能替代 B-roll canary。

### Gate E：全量与机械剪辑

Builder 交付静音逐镜 B-roll 和 `delivery-index.json`。`create-presenter-edit-plan.mjs` 从最终
Recipes 编译连续时间线，`assemble-presenter-broll.mjs` 按计划切换 presenter/B-roll，验证
输入 hash、SRT window、完整解码、输出 raster/fps 和唯一音轨。

### Gate F：字幕和最终审片

字幕以原 SRT 为 truth，在主合成完成后生成 sidecar 和烧录衍生版。烧录版必须重新检查：

- 是否遮住 B-roll 的主体文字；
- 数字人出现窗口和口型是否同步；
- 是否恰好一条非静音音轨；
- 全片能否完整解码；
- 字幕末尾是否超过最终媒体时长；
- 人像是否自然彩色且没有意外裁切。

其中可机械验证的项目由 `verify-presenter-delivery.mjs` 强制执行。它还要求字幕版的解码 PCM
音频与主合成完全一致，从流程上阻止无声、错音轨或字幕导出时替换音频。字幕位置、口型、
身份和审美仍由用户看片决定，自动门禁不能代替。

发布、commit 或 push 是独立批准，不由技术成功自动触发。

## 5. 竖屏与 YouTube 横屏

系统不是竖屏专用。生产 profile 接受任意正偶数宽高，官方默认正是 3840×2160 横屏。
当前竖屏样片只证明了 9:16 方案，不应直接裁切或拉伸成 YouTube 横屏。

横屏版本应建立新 production root，并重新执行 Director、Lead 和 Builder，因为以下内容必须
从构图阶段改变：

- 标题行长、字号层级和左右留白；
- 数字人的景别与左右站位；
- 信息图由纵向堆叠改为横向并列；
- 字幕安全区和 YouTube UI/电视端可读性；
- 真实素材的 crop、mask 和运动路径。

推荐维护两个明确 profile，而不是一个“自动适配”成片：

| 用途 | 建议 canary | 正式输出 |
| --- | --- | --- |
| 抖音、视频号、Reels、Shorts | 1080×1920 / 30 | 1080×1920 / 30 |
| YouTube 常规视频 | 1920×1080 / 30 | 1920×1080 或 3840×2160 / 30 |

SRT、旁白、授权、素材索引和部分叙事设计可以复用；已经渲染的竖屏 shot 和最终 edit plan
不能直接复用。

## 6. 水印判断

当前样片的可见 HeyGen 水印来自生成端，不是 Erduo 或字幕合成器添加。HeyGen 官方说明：

- 默认生成会带 HeyGen 标识；Web 免费方案不能关闭；
- Creator/Pro/Business 等付费 Web 方案包含 watermark removal，但生成前仍要关闭 watermark；
- API Key 的 Pay-As-You-Go wallet 与 Web/OAuth subscription 是两套独立计费身份。

本次部分片段使用 Web/OAuth entitlement，另一个片段使用 API wallet；已有 wallet 余额只说明
可以付费调用 API，不等于 Web 账号已经取得并启用“无水印导出”。现有水印已经烧进源视频，
不能靠最终剪辑合法、干净地移除。正式发布前应在 HeyGen 账户确认无水印 entitlement 和
生成选项，再用相同旁白片段重新生成三段 presenter；Erduo 的 B-roll 和 edit plan 逻辑无需
重做，但 presenter source、Runtime Plan 和 composition receipt 必须按新媒体 hash 重建。

官方参考：

- [HeyGen：移除水印](https://help.heygen.com/en/articles/11057301-how-to-remove-the-heygen-watermark)
- [HeyGen：API Pay-As-You-Go 与 OAuth/API Key 的计费差异](https://developers.heygen.com/docs/pricing)
- [HeyGen：付费 Web 方案能力](https://help.heygen.com/en/articles/15125761-heygen-credit-based-pricing-plans-explained)

若已确认付费方案并关闭水印后仍有可见标识，应按 HeyGen 官方建议联系其支持，而不是在
本地做画面修补。

## 7. 本次反思

### 做对的部分

- 最终回到原版 DesignMD，停止同时试验品牌主题和布局。
- 把数字人定义为 presenter source，没有侵入 HyperFrames 的 B-roll runtime。
- 使用本地 VoxCPM 和 Whisper，避免不必要的外部 TTS/转写费用。
- 新声音触发新的口型和时间线计算，没有复用旧嘴型。
- presenter 只在任务需要的位置出现，B-roll 仍承担主要信息表达。
- 通过 hash-bound Runtime Plan、逐镜合同、canary、六帧表、唯一音轨和完整解码闭环。

### 之前浪费时间的原因

- 同时改变 DesignMD、品牌色、边牧、人物、声音、口型、字幕和剪辑，无法定位回归来源。
- 在默认基线未稳定前做品牌化，导致排版与视觉问题被误认为数字人集成问题。
- 只确认视频文件存在，没有把“有且只有一条非静音音轨”作为早期硬门禁。
- 更换语音后曾试图复用旧数字人视频，忽略了音素时长决定口型和时间线。
- 没有一开始把“主持人只在有任务时出现”写成 Recipe 级约束。

### 永久修正规则

1. 先完成原版、带声、无品牌改造的稳定基线。
2. 每次只改变一个维度，并新建 production root；新旧版本做同窗 canary。
3. 声音变化必须触发口型、presenter media hash、Runtime Plan 和 edit plan 全链重建。
4. 每次交付强制检查一条音轨、响度、完整解码、字幕和 presenter 窗口。
5. 品牌化只能在基线稳定后小步加入，先做 3–5 镜头 canary，不直接重做全片。
6. 本人肖像永久保持自然彩色。

## 8. 下一阶段产品化顺序

1. **P0：Presenter 背景基线**——只批准数字人独立背景和“峰说”Logo；不得改 B-roll DesignMD。
2. **P0：无水印账户 canary**——重新生成需要的 presenter 片段，确认正式发布质量。
3. **P0：字幕安全区证据**——补字幕与主体文字碰撞证据。
4. **P1：YouTube 横屏 canary**——同一 SRT 重新执行横屏 Director、Lead 与五镜头 canary，不从竖屏裁切。
5. **P1：真人实片 canary**——用一条真实真人母片验证 `presenterKind=human` 的完整交付。
6. **P1：HeyGen 正式生产 adapter**——在现有 canary adapter 上补 full-production 授权、Webhook/长期任务运维、费用确认和真实发布回归。

这套顺序的目标是把“偶尔能生成一条视频”变成“输入明确、审批明确、输出可预期、失败可定位、
真人与数字人可切换、竖屏与横屏可分别复现”的生产系统。
