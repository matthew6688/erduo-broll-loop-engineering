# HeyGen 数字人接入研究

> 本文保留 Provider/API 调研细节。经过真实 VoxCPM + HeyGen + Erduo 样片验证后形成的
> 双模式生产规范、画幅策略、门禁和复盘，见
> [`PRESENTER-VIDEO-PRODUCTION-OPERATING-MODEL.md`](PRESENTER-VIDEO-PRODUCTION-OPERATING-MODEL.md)。

## 2026-08-23 Presenter-kind host canary

在 macOS Apple Silicon、Node.js 22 和 HyperFrames-first 策略下，使用同一条中文旁白与
获授权肖像完成了真实 HeyGen image presenter canary：H.264 MP4、1280×720、25 fps、
68.154 秒，唯一 AAC 音轨为 48 kHz 双声道；旁白来自本地 XTTS，使用本地 Whisper
large-v3 对齐。打开六个分布帧后，人物身份、背景与口播运动保持稳定。媒体、肖像、旁白、
SRT、API 凭据、任务 ID 与私人路径均不进入仓库。

`presenterKind=human` 复用相同的本地单视频/单音轨合同、Runtime Plan 绑定、Recipe
presenter treatment、edit-plan compiler、compositor 与 receipt。集成测试覆盖了这条完整
受控链路并断言最终唯一音轨。本次没有新拍一条真人机位素材，所以真人路径目前是受控端到端
证据，不冒充新的真实宿主媒体 canary；未来真人母片必须显式登记为 `human`，遗漏类型会被
拒绝。真人与数字人之间切换时，Recipes 与已验证静音 B-roll 可复用，但必须为新来源重新
生成 hash-bound Runtime Plan 和 edit plan。

更新时间：2026-08-23

## 结论

可以接，而且与当前流水线互补，但不应把数字人服务注册成第三个渲染后端。
用户所说的“Hypergen”结合指定参考仓库后，实际指向的是 **HeyGen**：参考仓库明确采用
“MiniMax 海外版克隆声音 + HeyGen Image-to-Video”，没有使用名为 Hypergen 的数字人
API。应把 HeyGen 设计为一个**异步外部媒体 Provider**，让它产出主持人视频；HyperFrames
仍负责 B-roll、版式、字幕和最终合成。

第一版 provider-neutral 最终合成能力已经实现：

- `create-presenter-source.mjs` 登记本地数字人母片、本人肖像/声音确认、hash 与音视频事实；
- `assemble-presenter-broll.mjs` 校验 presenter、`delivery-index.json`、逐镜合同和 edit plan；
- 数字人母片提供唯一音轨，静音 B-roll 只覆盖画面；25 fps presenter 可确定性统一到
  30 fps 或 edit plan 指定的输出规格；
- `presenter-composition-receipt.json` 绑定所有输入 hash、混剪比例、最终媒体事实和完整解码。

本次实现范围是**本地 MP4 导入与硬切合成**，不是 HeyGen/Hypergen HTTP adapter，也不包含
透明 WebM 叠加。provider 任务持久化、15 秒预览提交/恢复、Webhook 与透明 presenter
overlay 仍是后续阶段；首版 source contract 只允许在本人肖像/声音授权、SRT/肖像/旁白
hash 绑定、身份/声音/口型审批均明确后登记本地 canary 或 full-production 母片。

推荐的生产顺序是：

```text
授权素材 → MiniMax/既有录音生成规范旁白 → 15 秒数字人预览
        → 用户批准声音/脸/口型 → HeyGen 完整主持人轨
        → 现有 5-shot B-roll canary → 用户批准视觉
        → HyperFrames 合成数字人 + B-roll → 现有媒体门禁与交付
```

这样能减少真人重复出镜，同时保留当前项目最有价值的 SRT truth、逐镜可编辑 B-roll、
canary、来源追踪和机器验证。

## 产品身份已基本确认

- 指定参考仓库 [`rachel-digital-human-production`](https://github.com/Jingyi-Wu-Richael/rachel-digital-human-production/tree/a20258b8eb38eb370cf3402fb4414754b4c44c2a)
  的 README 和 [`SKILL.md`](https://github.com/Jingyi-Wu-Richael/rachel-digital-human-production/blob/a20258b8eb38eb370cf3402fb4414754b4c44c2a/SKILL.md)
  明确写的是 MiniMax + **HeyGen**；环境变量也是 `MINIMAX_API_KEY` 与
  `HEYGEN_API_KEY`。
- 公开检索到的同名 HyperGen 产品不是数字人口播 SaaS：例如
  [HyperGen diffusion framework](https://hyper.julian.sc/) 是本地扩散模型训练/推理框架。
- HeyGen 官方开发者站明确提供 Digital Twin、Photo Avatar、Image/Audio-to-Video、
  Voice、Lipsync 和 Webhook 等 API。[HeyGen Developer](https://developers.heygen.com/)

因此，后续实现可以使用 provider 名 `heygen`；文档里可保留一句兼容说明：用户口头说的
“Hypergen”在本项目中按 HeyGen 解释。若用户另有一个私有的 Hypergen 服务，则需要其
API 文档后再增加独立 adapter。

## 参考仓库实际提供了什么

参考仓库是一个**生产工作流 Skill，不是可直接导入的 SDK**。它只有一份流程说明、两份
Python 小工具和若干检查表：

- [`preflight_assets.py`](https://github.com/Jingyi-Wu-Richael/rachel-digital-human-production/blob/a20258b8eb38eb370cf3402fb4414754b4c44c2a/scripts/preflight_assets.py)
  检查脚本、头像、声音样本的存在性、扩展名、大小和声音时长；
- [`init_job_state.py`](https://github.com/Jingyi-Wu-Richael/rachel-digital-human-production/blob/a20258b8eb38eb370cf3402fb4414754b4c44c2a/scripts/init_job_state.py)
  初始化 `work/job-state.json`，保存 MiniMax `voice_id`、HeyGen `asset_id/video_id`
  和审批状态；
- 没有 MiniMax/HeyGen HTTP client、Webhook handler、下载器、重试器或合成代码；这些
  仍需在本仓库实现并测试；
- 它最值得复用的不是代码，而是两个规则：**所有付费完整生成前先做 15 秒预览**，以及
  **外部任务 ID 必须持久化，超时后恢复查询，不能重复提交付费任务**。

## 官方 API 合同

### MiniMax：可选的声音层

参考流程使用 MiniMax 克隆声音。官方流程是先调用 `/v1/files/upload` 上传样本，再调用
`POST /v1/voice_clone` 创建 `voice_id`，最后用 T2A 生成旁白。官方要求声音样本为
MP3/M4A/WAV、10 秒至 5 分钟、最大 20 MB；未在 7 天内使用的克隆声音可能被删除。
[MiniMax Voice Clone guide](https://platform.minimax.io/docs/guides/speech-voice-clone),
[Voice Clone API](https://platform.minimax.io/docs/api-reference/voice-cloning-clone)

T2A 使用 Bearer 认证，`text` 小于 10,000 字符，可指定 `speech-2.8-hd` 等模型、停顿、
发音和音频设置。[MiniMax T2A HTTP](https://platform.minimax.io/docs/api-reference/speech-t2a-http)

这层应保持**可插拔**：用户已有真人录音、已批准的 TTS 或未来换声音供应商时，都可以
直接提供规范旁白文件，不应强制克隆声音。

### HeyGen：图像/数字人到口播视频

核心接口为 `POST https://api.heygen.com/v3/videos`，使用 `x-api-key`：

- `type: "image"` + `image`：直接让单人肖像说话，不需要先训练 Avatar；
- `type: "avatar"` + `avatar_id`：使用 Studio Avatar、Photo Avatar 或 Digital Twin；
- 声音输入二选一：`script + voice_id`，或外部音频 `audio_url/audio_asset_id`；外部音频
  与 `script` 互斥，视频时长跟随音频；
- 参考仓库的 MiniMax 路线应使用 `audio_asset_id`，避免 HeyGen 再次合成声音；
- 支持 `720p/1080p/4k`、多种画幅、背景、字幕、`motion_prompt`、
  `callback_url/callback_id`。[HeyGen Audio to Video](https://developers.heygen.com/audio-to-video),
  [Create Video API](https://developers.heygen.com/reference/create-video)

媒体先通过 `POST /v3/assets` 上传，返回可复用 `asset_id`；官方 API 可管理图片、音频、
视频和 PDF。[HeyGen Assets](https://developers.heygen.com/assets)

若需要把数字人叠加在 B-roll/信息图上，优先请求 `output_format: "webm"`。WebM 可携带
alpha；MP4 不可。透明输出要求 Avatar 支持 matting，且 WebM 请求不能同时设置背景。
[HeyGen Transparent Background Videos](https://developers.heygen.com/transparent-background-videos)

### 异步任务、重试与 Webhook

创建视频返回 `video_id`，初始状态示例为 `waiting`；查询
`GET /v3/videos/{video_id}` 时会进入 `pending/processing/completed/failed`，成功后返回
临时 `video_url`。也可注册 Webhook 并订阅 `avatar_video.success` 与
`avatar_video.fail`。成功事件包含 `video_id`、下载 URL 和 `callback_id`；下载链接会
过期，应立即落盘，过期后重新查询视频而不是重新付费生成。
[HeyGen Webhook events](https://developers.heygen.com/docs/webhook-events)

生产 adapter 应：

1. 每次 mutation 使用持久化的 `Idempotency-Key`；官方在 24 小时内重放同一路径同一
   key 的原响应，在请求仍处理中时返回 409 `request_in_progress`；
2. 在发请求前写 `submitted` intent，收到响应后立刻保存 `video_id`；
3. 同时支持轮询和 Webhook，Webhook 必须校验 endpoint signing secret，并快速返回 2xx；
4. 将 `waiting` 与 `pending` 都视为排队态；超时只标为 `unknown/polling_timeout`，不能
   自动重提；
5. 只保存 provider ID、非敏感状态、输入 hash 和本地输出路径，不保存 API key、完整
   header 或预签名 URL。

`Idempotency-Key` 语义见
[Create Video API](https://developers.heygen.com/reference/create-video)，Webhook 签名与事件
处理见 [Webhook events](https://developers.heygen.com/docs/webhook-events)。

## 对当前仓库的映射

| 当前概念 | 数字人适配 | 原因 |
| --- | --- | --- |
| HyperFrames/Remotion runtime | 保持不变 | HeyGen 是媒体 Provider，不是本地逐镜渲染 runtime |
| 原始 SRT `truth` | 继续作为唯一口播/时间真相 | 防止 TTS、Avatar 和 B-roll 各自改稿 |
| `02-assets` | 增加授权头像、声音样本、旁白、数字人媒体及 provenance | 数字人输出是受授权约束的共享媒体 |
| `materialRoute` | 第一版仍可用 `provided`/`mixed` | HeyGen 输出冻结到本地后再交给 Builder；不要让 Builder 直接发付费请求 |
| 15 秒预览 | 新增“身份/声音/口型 gate” | 在完整付费生成前发现脸、牙齿、口型、声音问题 |
| 现有 5-shot canary | 保留“B-roll/设计 gate” | 两种审批检查不同风险，不能互相替代 |
| 逐镜 H.264 | 继续保持静音 B-roll | 当前逐镜验证明确要求无音轨；旁白/数字人应在最终合成层加入 |
| `delivery-index.json` | 保持静音 B-roll 顺序真相；另写 presenter composition receipt | 让最终媒体可追踪，同时不改变逐镜合同或泄露隐私素材/临时 URL |

### 推荐分层

```text
Parent orchestration
├─ voice provider (optional): MiniMax / provided narration
├─ presenter provider: HeyGen
│  ├─ portrait/avatar + consent
│  ├─ 15s preview job
│  └─ approved full presenter job
├─ existing B-roll pipeline
│  ├─ Director / Assets / Lead / Builders
│  └─ silent direct-shot renders + existing audits
└─ final compositor
   ├─ presenter base or transparent overlay
   ├─ B-roll shots / text / graphics
   └─ one canonical narration audio track
```

数字人不应由 Director 或 Chapter Builder 直接调用。Parent 负责付费任务、身份、恢复、
下载与媒体事实；Assets 只登记已经冻结到本地的数字人素材和授权信息；Builder 读取本地
媒体，仍只运行 Parent 给出的标准渲染命令。

### 当前合同的关键限制

当前项目虽然有 `preserve-source` 音频 profile，但直接 shot 验证路径仍硬性要求每镜
`audioStreams === 0`。第一版不应放宽它：保留静音逐镜 B-roll，另设 canonical narration
和 presenter track，并在最终 assembly 时一次性合成音轨。否则需要同时改 media schema、
shot contract、preview assembly、FFprobe 门禁、时长容差和所有相关测试，风险明显更高。

### 建议新增的 provider-neutral 状态（概念）

```json
{
  "schemaVersion": 1,
  "provider": "heygen",
  "inputIdentity": {
    "srtSha256": "...",
    "portraitSha256": "...",
    "narrationSha256": "..."
  },
  "authorization": {
    "portraitConfirmed": true,
    "voiceConfirmed": true,
    "publishingUseConfirmed": true,
    "confirmedAt": "ISO-8601"
  },
  "preview": {
    "idempotencyKey": "...",
    "assetIds": ["..."],
    "videoId": "...",
    "status": "completed",
    "localPath": "...",
    "approved": true
  },
  "final": {
    "idempotencyKey": "...",
    "videoId": "...",
    "status": "processing",
    "localPath": null
  }
}
```

真实文件应位于生产目录并默认排除发布；不记录 `video_url`、API key、声音样本正文或
授权视频。输入 hash 变化后，不得复用旧 asset/job/approval。

## Avatar、Voice、Lip-sync 能力边界

- 最低摩擦 MVP：单张授权肖像 + 已有旁白，走 `type: image`；无需先训练 Avatar，适合
  验证价值，但动作一致性和跨集稳定性要通过 canary 实测。
- 长期栏目：使用私有 Digital Twin/Photo Avatar look。私有 Avatar 用于视频生成前必须
  完成 consent；官方 consent URL 24 小时过期且只允许一次成功提交。
  [Create Avatar Consent](https://developers.heygen.com/reference/create-avatar-consent)
- 声音：可以使用 HeyGen voice，也可以像参考仓库一样使用 MiniMax 生成的外部音频。
  外部音频更容易把旁白文件作为唯一音频真相，也便于复用和审计。
- Lip-sync：HeyGen 根据外部音频驱动 Avatar/Image；如果已有真人/数字人视频只需换音轨，
  HeyGen 另有 Lipsync API，但这不是首版必需路径。
- 透明合成：Digital Twin/Studio Avatar 若支持 matting，可输出 alpha WebM；Image-to-Video
  是否满足期望透明合成必须用真实账号/素材 canary 验证，不能假设所有肖像路线都可用。

## 商业、授权和隐私约束

- HeyGen 条款禁止上传未经本人同意的个人图像，并要求不得以误导方式分发 AI 输出；法律
  要求时应主动披露 AI 生成。免费计划输出仅限个人、非商业及内部评估，不能用于广告、
  客户工作或商业化。[HeyGen Terms](https://www.heygen.com/terms)
- 私有 Avatar 有产品级 consent gate，但这不能替代项目自己的授权记录。声音克隆、肖像、
  文稿、品牌和发布用途应分别确认；授权撤回后应能定位并删除对应本地与 provider 资产。
- HeyGen 表示数据托管/处理位于美国 AWS，传输使用 TLS 1.2+、静态数据 AES-256；企业
  客户数据默认不用于训练，非企业客户需要主动 opt out。对敏感客户素材，不应把“不会
  训练”默认扩展到所有套餐。[HeyGen Security](https://www.heygen.com/security)
- 隐私政策说明 HeyGen 在按客户指示处理输入、生成输出和托管内容时可作为 processor；
  删除后备份保留约 30 天，并称收到删除请求后通常在 72 小时内采取删除措施。
  [HeyGen Privacy](https://www.heygen.com/privacy)
- 商用前必须确认实际 API 套餐、用量、并发和输出许可。价格与能力会变化；不要把金额写
  死在代码。参考仓库也明确要求用户自带账号、billing、权限和 API key。

## Credential and provider assessment — 2026-08-22

本节只根据第一方文档和用户提供的**凭据类别**判断可行性。未调用任何 API，未验证、
打印、保存或转述任何密钥，也未产生付费任务。

### 已提供的类别与立即可做范围

用户当前提供的是：

- APIMart Bearer API key 与 `https://api.apimart.ai/v1` base URL；
- HeyGen API key 与官方 quick-start 文档入口。

这些类别足以让未来 adapter 进行两家服务的 Bearer/`x-api-key` 认证，但**不足以立即生成
数字人预览**。当前没有 MiniMax key、HeyGen `avatar_id`/`voice_id`、已授权肖像、旁白
音频或 Webhook URL，也没有可据以确认费用和能力 entitlement 的账户事实。文档链接只是
说明材料，不是授权或凭据。

| 目标 | 当前凭据类别是否足够 | 仍缺什么 |
| --- | --- | --- |
| APIMart 通用 TTS | 技术上可认证，但不进入主路径 | 本地已有多种 TTS，避免增加外部音频依赖与费用 |
| APIMart Whisper 转写 | 技术上可认证，但不进入主路径 | 使用本地 Whisper 做旁白/SRT 对齐；原始 SRT 仍是 truth |
| APIMart Seedance 2.0 短视频 | 认证类别足够，生产条件不足 | 已授权素材、真人 H5 认证/审核或虚拟素材审核、生成参数、余额与付费批准 |
| HeyGen 单图 + 外部音频预览 | HeyGen key 可完成认证；当前不能生成 | 授权肖像、15 秒旁白、发布用途确认、API wallet/feature access |
| HeyGen 单图 + HeyGen voice | 当前不能生成 | 授权肖像、脚本、可用 `voice_id` 或默认 voice、wallet/feature access |
| HeyGen Digital Twin 预览 | 当前不能生成 | 已批准私有 look 的 `avatar_id`、consent、voice 或外部音频、wallet/entitlement |
| 参考仓库原样的 MiniMax 克隆路线 | 不足 | `MINIMAX_API_KEY`、授权声音样本、脚本、克隆与 TTS 付费批准 |

HeyGen 官方说明 API key 使用 `x-api-key` 并从独立 API wallet 计费，余额可通过官方的
账户信息 endpoint 查看；拥有 key 不等于 wallet 有余额或账号具备所选 Avatar/engine。
[HeyGen self-serve API pricing](https://developers.heygen.com/docs/pricing)

### APIMart 能承担的角色

APIMart 是统一网关，不是 HeyGen API 的兼容代理。其相关第一方合同如下：

1. **通用 TTS**：`POST /v1/audio/speech` 目前文档化的模型是
   `gpt-4o-mini-tts`，输入最多 4096 字符，提供 `alloy/echo/fable/onyx/nova/shimmer`
   六个预设声音，可输出 WAV、Opus、AAC、FLAC 或 PCM，响应为同步二进制音频。
   [APIMart TTS](https://docs.apimart.ai/en/api-reference/audios/tts)
2. **转写**：`POST /v1/audio/transcriptions` 使用 `whisper-1`，支持 25 MB 以内音频、
   99 种语言，以及 JSON/text/SRT/VTT/verbose JSON 输出。它可在缺少 SRT 时帮助生成候选
   转写，但不能替代本项目经用户确认的原始 SRT truth。
   [APIMart Whisper-1](https://docs.apimart.ai/en/api-reference/audios/whisper-1)
3. **Seedance 2.0 视频**：`POST /v1/videos/generations` 支持
   `doubao-seedance-2.0`、`-fast`、`-face`、`-fast-face`；时长 4–15 秒，可文生/图生
   视频、引用图片/视频/音频并可生成声音。参考音频最多 3 个、总长不超过 15 秒，且必须
   与参考图片或视频一起使用；官方称同一 seed 只会生成“相似”结果，不保证完全一致。
   [APIMart Seedance 2.0](https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2-0/generation)
4. **真人素材**：`POST /v1/seedance2/real-avatar` 先创建真人 H5 身份验证，再查询
   `group_id`，最后提交真人素材审核；通过后得到 `asset://...` 用于 `-face` 模型。
   [APIMart real-person avatar assets](https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2-0/real-avatar)
5. **虚拟素材**：`POST /v1/seedance2/private-avatar` 可提交 Image/Video/Audio，单次最多
   20 个，异步审核后得到 `asset://...`。这里的 “private avatar” 是私域素材组，并不等同
   于 HeyGen 的经训练 Digital Twin 合同。
   [APIMart virtual avatar assets](https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2-0/private-avatar)
6. **异步任务**：视频/素材任务返回 `task_id`，通过 `GET /v1/tasks/{task_id}` 查询
   `pending/processing/completed/failed/cancelled`；结果 URL 有过期元数据，应及时下载到
   本地。[APIMart task status](https://docs.apimart.ai/en/api-reference/tasks/status)

在已检索的 APIMart 第一方文档中，**没有找到声音克隆 endpoint**。因此：

- APIMart `gpt-4o-mini-tts` 技术上可生成普通声音，但本机已有多种 TTS，不应把它加入
  本项目主路径；
- 它不能替代参考仓库要求的 MiniMax voice clone；
- APIMart `whisper-1` 是转写工具，不是声音生成或克隆工具；主路径使用本地 Whisper
  完成旁白与 SRT 的对齐和候选转写；
- Seedance `audio_urls` 被描述为“参考音频”，不是 HeyGen `audio_asset_id` 那种视频时长
  跟随完整旁白并明确承诺 lip-sync 的驱动合同。

### APIMart 能否替代 HeyGen

当前答案是：**不能作为等价替代，只能作为短视频/素材生成补充**。

APIMart Seedance 2.0 的优势是同一个 key 可生成 4–15 秒短视频、引用已审核真人/虚拟素材、
做动作迁移或带声音的生成内容。这很适合作为：

- 15 秒创意探索或 B-roll material route；
- 非确定性的短人像 cutaway；
- 章节过场、动作参考或背景视频。

但 APIMart 当前文档没有承诺以下 HeyGen 合同：

- 任意长度预录旁白驱动、输出时长严格跟随旁白；
- 长篇稳定 Digital Twin presenter track；
- 明确的逐字 lip-sync 结果；
- `script + voice_id` 与 `audio_asset_id` 两种可互换驱动；
- matting Avatar 的透明 alpha WebM；
- 侧车字幕、Avatar engine capability、专用成功/失败 Webhook；
- 创建 mutation 的 24 小时 idempotency replay。

尤其是 Seedance 输出最长 15 秒，参考音频总长也最多 15 秒，并且同 seed 不保证完全一致；
若把一条长口播拆成大量生成段，会增加人物连续性、口型、动作跳变、时长拼接和费用风险。
所以它不应成为第一版 presenter provider。

APIMart 的隐私政策说明平台会处理并保存 API key、请求日志、prompt/input 和生成输出；其
条款还要求用户同时遵守底层模型提供方规则。真人肖像、声音和客户脚本不能因为走统一
网关就被视为风险降低。[APIMart Privacy](https://apimart.ai/privacy),
[APIMart Terms](https://apimart.ai/zh/terms)

### HeyGen 官方预览链路再核验

对于本项目可控性最高的 15 秒预览，建议不用 Video Agent 自动改稿，而是直接调用
`POST /v3/videos`：

1. 使用同一个 HeyGen API key 调 `POST /v3/assets` 上传授权肖像和 15 秒音频，分别取得
   `asset_id`；不需要第二种 asset credential。
2. 提交 `type: "image"` + `image: {type:"asset_id", asset_id:...}` +
   `audio_asset_id`。外部音频与 `script` 互斥；选择外部音频时不需要 HeyGen
   `voice_id`，视频时长跟随音频。
3. 保存返回的 `video_id`，轮询 `GET /v3/videos/{video_id}` 的
   `pending/processing/completed/failed`，或在将来有公网 HTTPS endpoint 后使用 Webhook。
4. `completed` 后立即下载 `video_url` 到生产目录、FFprobe 并完整解码；预签名 URL 过期
   时用 `video_id` 重新查询，不能重新提交付费生成。

以上合同见 [HeyGen Assets](https://developers.heygen.com/assets)、
[HeyGen Audio to Video](https://developers.heygen.com/audio-to-video)、
[Create Video](https://developers.heygen.com/reference/create-video) 与
[Get Video](https://developers.heygen.com/reference/get-video)。

当前没有 Webhook URL **不阻塞一次预览**，因为官方支持轮询；生产批量化时再注册 HTTPS
endpoint，保存创建时只显示一次的 signing secret，并验证事件签名。
[HeyGen Webhook endpoint](https://developers.heygen.com/reference/create-webhook-endpoint)

若改走 Digital Twin，则仅有 HeyGen API key 不够：官方要求先取得私有
`digital_twin` look 的 `avatar_id`，并选择可用的 `voice_id` 或提供外部音频；私有 Avatar
还受 consent/engine capability 约束。[HeyGen Digital Twin](https://developers.heygen.com/generate-avatar-video),
[HeyGen Avatar Consent](https://developers.heygen.com/reference/create-avatar-consent)

### 更新后的 Provider 决策

```text
canonical narration
├─ provided recording                         首选：最少供应商
├─ local TTS                                  首选：本地已有多种声音能力
└─ MiniMax voice clone                        可选：仅在需要授权声音克隆时

alignment / candidate transcription
└─ local Whisper                              首选：不向第三方发送旁白

presenter track
└─ HeyGen image/avatar + external audio       第一版唯一建议路径

short generative material
└─ APIMart Seedance 2.0 / other video models  可选 B-roll/短视频 Provider；不是主路径依赖
```

安全的下一步不是试 key，而是先取得授权肖像、约 15 秒定稿旁白与明确付费批准；然后先用
本地录音或本地 TTS 生成旁白，用本地 Whisper 检查它与 SRT 的对齐，再通过 HeyGen 单图
+ 外部音频生成一个 720p canary。APIMart 不参与这条主路径；需要额外生成 B-roll 或短人像
素材时，Seedance 才作为显式 opt-in Provider 单独做 canary，且不能混入 HeyGen 身份/口型
验收结论。

## 分阶段实施建议

1. **MVP adapter**：只支持 provided narration + HeyGen `type:image`，完成 preflight、
   状态机、idempotency、轮询、下载、全解码和 15 秒审批；不做声音克隆。
2. **合成适配**：支持 presenter MP4 作为底层，或 matting Avatar 的透明 WebM 作为叠加
   层；现有 B-roll shot 继续静音，最终一次性 mux 规范旁白。
3. **Digital Twin**：增加 Avatar 创建/查询、consent receipt、look/engine 能力检查和
   删除路径。
4. **可选 MiniMax voice provider**：加入 voice sample preflight、clone/T2A、发音测试、
   音频 hash 与费用 gate；不与 HeyGen adapter 耦合。
5. **Webhook/批量**：部署可验签 Webhook 后再启用批量；没有公网 endpoint 时继续轮询。

每一阶段都应以 fixture/mock contract test 为主；只有用户提供账号、授权素材和明确批准
付费调用后，才运行真实 API canary。

## 剩余歧义与需要用户决定的事项

1. “Hypergen”是否就是 HeyGen：指定仓库已经强烈确认，但若用户掌握另一私有产品链接，
   仍需以该 API 文档为准。
2. 目标是单张肖像快速口播，还是需要长期稳定的 Digital Twin；二者成本、授权和透明
   合成能力不同。
3. 声音用已有录音、MiniMax 克隆、还是 HeyGen voice；这决定是否需要第二家供应商和
   第二套敏感数据处理。
4. 数字人是全程底层主持人、只在章节开合出现，还是透明叠加在 B-roll 上；这决定最终
   compositor 与美术合同。
5. 是否需要中文、横竖双画幅、批量、商业发布和删除 SLA；这些必须进入 production
   profile/授权 gate，而不能留作隐含默认值。
