# Signal · AI 日报

少一点噪声，多一点新知。一个使用免费数据源、每日更新的 AI 资讯发现站，支持 GitHub Pages 静态部署和 Cloudflare 前后端部署。

**在线访问（主站）：https://signal-ai-news.stock-backend-wkl.workers.dev**

旧地址 https://2432448868.github.io/AI-News/ 随账号改名已失效（GitHub Pages 不做旧域名跳转）；新 Pages 地址 https://KellonWww.github.io/AI-News/ 为迁移提示页，自动跳转到主站。
代码仓库：https://github.com/KellonWww/AI-News

2026-10-03 首次 Actions 部署通过，7/7 免费来源同步成功，首发线上快照 164 条。

## 功能

- AI 动态、开源项目、Agent Skills、模型动态、实用技巧、趣味应用和开发者技术热点。
- 关键词搜索、分类/时间组合筛选、最新/热度排序、分批加载。
- `Ctrl+F` / Mac `⌘F` 打开居中站内搜索，即时筛选；回车查看结果，`Esc` 或点击遮罩关闭；`/` 聚焦列表搜索框。
- 日间/夜间玻璃阅览室：雾面浮动导航、透明侧栏与弹窗，正文保持实色易读；支持响应式、减少动效偏好、键盘导航与本地收藏。
- 主题按钮直切日光/夜航，圆形扩散换肤与日月图标动效；下拉可选主题或跟随系统，支持方向键、Esc、偏好记忆与减少动效降级。
- 来源状态、真实时间、过期快照提示、部分失败降级、原文可追溯。
- 原文标题与描述不强制翻译，不需要付费 LLM、搜索或翻译 API。

## 精选与资源库

- 首页一期最多 10 条：最多 7 条近期动态 + 3 条新建工具，各区每来源最多 2 条，并按条目 URL 去重；其中技术热点最多 3 条，避免挤掉全部 AI 动态。
- 动态只采用近 7 天可核实的文章/讨论发布日期；仓库推送、页面修改与采集时间不作为新闻发布日期。
- 工具只采用近 30 天创建的项目、Skills、模型页面与应用，新建优先；模型页面创建不等于模型正式发布。
- 没有合格内容时展示空态，不用旧内容填充；下方完整资源库保留搜索、分类、收藏和排序。
- 卡片保留来源原始简介，补充面向读者的核查提示，不生成未经验证的能力、费用或效果承诺。
- 每日归档与编者按沿用同一精选规则；编者按只基于动态，不将工具名包装成发布事件。
- 这是一版可解释的规则筛选，不等同人工实测推荐。是否提升用户兴趣仍需用真实点击、收藏和回访验证；本次未新增行为追踪。

## 本地运行

要求 Node.js 24 与 npm。

```bash
npm ci
npm run dev
```

仓库自带真实采集快照，无需连通第三方源即可预览。

```bash
npm run collect         # 采集免费 API/RSS，刷新 public/data/feed.json
npm run check           # 格式检查 + 数据测试 + 类型检查 + 生产构建
npx playwright install chromium
npm run test:e2e         # 桌面/移动、无障碍与 Pages 子路径验收
npm run preview         # 预览 dist；先运行 npm run build
```

## 发布到 GitHub Pages

GitHub Pages 地址（https://KellonWww.github.io/AI-News/）现为**迁移提示页**：
`.github/workflows/deploy.yml` 在 push main 时把 `redirect/index.html` 部署上去，提示访客前往 Cloudflare 主站；不再采集数据，也没有定时任务。

- 在仓库 Settings → Pages → Build and deployment 中选择 **GitHub Actions** 后，push 即自动部署跳转页。
- 若 fork 后想恢复完整的采集 + 静态站流水线，参考 2026-10-05 之前的历史版本（旧 deploy.yml 与 scripts/collect.mjs）。
- 前端不会直接调用 GitHub/Hugging Face API，不会把 token 发给访客。

## 更新与免费边界

主站数据全部由 Cloudflare Worker Cron 每小时滚动更新（见下文 Cloudflare 章节）；GitHub Pages 仅部署静态跳转页，无采集、无后端、无付费服务。

GitHub 的免费调度不是强 SLA：任务可能延迟或丢弃；政策和免费额度以 GitHub 官方说明为准，不要改成付费 runner 或额外付费服务。

## 数据来源

| 来源                | 免费方式              | 说明                                            |
| ------------------- | --------------------- | ----------------------------------------------- |
| GitHub              | Repository Search API | 近 30 天新建 LLM 仓库，累计 stars 排序          |
| GitHub Demos        | Repository Search API | 近 30 天新建的 Gradio demo 项目，排除框架本体   |
| GitHub Skills       | Repository Search API | 近 30 天新建 agent-skills 仓库，非通用编程技能榜            |
| GitHub Demos        | Repository Search API | 新建 Gradio 应用项目，补充趣味案例              |
| Hugging Face Models | Hub 公共 API          | 来源热门模型榜；创建/修改时间不等于正式发布日期 |
| Hugging Face Spaces | Hub 公共 API          | 来源热门 AI demo；可用性取决于作者              |
| Hugging Face Blog   | 官方 RSS              | 新闻、教程、模型动态                            |
| GitHub Blog         | 官方 AI & ML RSS      | AI 编码与实践                                   |
| 开源中国 | 公开 RSS | 中文技术资讯，过滤明显推广与非技术内容 |
| Hacker News | 官方 Firebase API | 前 12 个热门帖子详情，过滤非技术内容；分数仅代表站内积分 |
| Lobsters | 公开 JSON | 技术讨论，排除标为 satire 的讽刺内容 |
| V2EX 技术频道 | 公开 Atom | 中文开发者讨论，过滤标题中明显求助、招聘与推广 |
| DEV Community | 公开 RSS | 开发者技术文章，标注社区作者经验，不当作官方结论 |
| 美团技术团队 | 官方 RSS | 架构与工程实践；源缺逐篇发布日期时仅进资源库、不进近期精选 |

技术热点复用已有 `dev` 分类，不改数据库结构。规则覆盖语言/框架、工具、开源、数据库、基础设施、工程实践及安全，不局限 AI 或漏洞。
社区条目保留“社区讨论”标记，HN/Lobsters 直达讨论页，日期为帖子创建时间，**不代表原文发布或事件发生时间**；跨站讨论页不会强行合并。
标签/关键词仅用于初筛，不保证识别全部推广、旧闻或错误观点；版本、安全与重大变更需在原站核对官方公告。
本地实采校验：四源筛出 66 条技术候选，两套采集器归一化一致；验证未写线上数据库。
证据：`~/.agents/evidence/AI-News/technical-source-smoke-20261024.json`
2026-10-24 增补源实抓：DEV Community 10 条、美团技术团队 9 条；JS/Python 归一化一致。美团 RSS 未提供逐篇发布日期，保留空值，不使用频道日期、更新时间或 URL 路径代替。
证据：`~/.agents/evidence/AI-News/additional-tech-sources-20261024.json`
HN 每次最多 13 个请求（榜单 + 12 个详情），含重试最多 39 次；任一详情网络失败则整源保留旧快照，不以残缺结果覆盖。


采集限制：每源至多 30 条，总量至多 500 条；响应体至多 2MB；15 秒超时与最多 3 次尝试。
- HTTP 429/403 当轮不重试，同域全部端点至少冷却 24 小时；更长 Retry-After 按源站要求等待。403/429 写日志告警并展示源错误，旧数据保留；不绕过验证码、登录、付费墙或限流。
- 云端冷却保存在 D1 `meta`，静态采集保存在 `.cache/source-cooldowns.json`（独立运行环境不共享）；其他临时错误仍最多尝试 3 次。
- 云端 cron/手动同步共享 D1 原子租约：30 分钟过期、单次执行最多 14 分钟；并发手动请求返回 409。鉴权通过的手动同步全局每 15 分钟最多一次，超限返回 429，均带 Retry-After。
- 告警指 Worker/采集日志和来源状态面板，不包含邮件或推送通知；冷却与锁无需新建表，运行时使用已有 `meta`。
“热度参考”是各来源排名的归一化，不是跨站真实热度或今日新增 stars。
只展示短摘要/仓库描述、署名与原文，不转载正文，不安装或执行任何远端项目/Skills。
外部项目是否收费、是否安全，需要读者在原站确认。

## 故障排查与回滚

- 某分类为空：打开“关于与来源”，查看对应源是否采集失败；不使用假新闻补位。
- HF 本机不通：初次开发环境已观察到直连超时；GitHub 来源正常。按来源隔离失败，交由 runner 实测网络。
- 采集限流：本机可选设置自有 GITHUB_TOKEN 环境变量，仅需要公共只读访问；绝不提交 token。
- 所有源失败：查看 Actions 日志；恢复网络后手动运行；原部署保持不变。
- 需要回退代码：由维护者恢复已知正常版本后运行工作流；不做自动 Git 写入。
- 急需发布已有快照：手动运行并勾选 use_snapshot；页面仍显示快照真实旧时间。
- 本地缓存：.cache/feed.json 可删除以回退仓库快照；不得删除 public/data/feed.json 后直接离线发布。

## 工程结构

```text
src/                    界面、主题与共享数据规则
backend/                Python Worker（API、采集、OAuth，Cloudflare 端）
migrations/             D1 数据库建表语句
scripts/                免费采集器与 D1 首灌脚本
public/data/feed.json   真实数据种子快照
.github/workflows/      定时更新/部署与 PR 验证
tests/                  数据边界、Python 后端与浏览器验收
docs/requirements/ai-news/ 需求、选型、评审、实现与验收记录
```

## 依据

- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/rest/search/search#search-repositories
- https://huggingface.co/docs/hub/api

当前主站部署在 Cloudflare；GitHub Pages 地址仅提供迁移跳转。

> 故障保留例外：失败来源沿用上次成功快照，文章可能超过 30 天；保留原始日期并标记来源失败，不伪装成新内容。

本机已安装 Chrome 时，可在 Git Bash 使用：

```bash
PLAYWRIGHT_EXECUTABLE_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe' npm run test:e2e
```

测试脚本基于 Chromium 手机尺寸模拟，并非真实 iOS Safari 验证。

## Cloudflare 前后端部署

[完整实战教程（含实际截图）](docs/cloudflare/README.md)覆盖本地运行、设备授权、发布和日常维护。

2026-10-04 后端已重写为 Python Worker：采集（现为 18 源）、文章数据与用户系统全部落在 Cloudflare D1，由 Worker Cron 每小时滚动更新 1 源（北京时间 15:05 起到次日 08:05 轮完全部 18 源，适配免费版 CPU 限额，按完整循环结束触发归档，调度与源站可能延迟）；手动触发走 `POST /api/sync`。
2026-10-06 二期上线：每轮完整来源收尾时（计划约 08:05；手动同步或游标偏移可能改变时刻）自动存当日头版快照 → Workers AI（`@cf/qwen/qwen3-30b-a3b-fp8`，可用 `AI_EDITOR_MODEL` 覆盖）写中文编者按 → 发日报邮件（含关注命中段；北京周一附上周回顾），三步各自容错，任一失败不影响采集。
GitHub Pages 地址已改为迁移提示页，数据获取与用户系统全部由 Cloudflare 承担。

### D1 数据表（migrations/，共 10 张）

| 表                | 作用                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`            | 运行时键值对：`generated_at` 快照生成时间、`collect_cursor` 源轮转游标、`sync_status` 最近一次采集结果 JSON、`editor_note` 当日 AI 编者按（JSON，失败即清空）                                                            |
| `sources`         | 18 个数据源档案：名称、主页、`ok/error` 状态、最后成功时间、条数、失败原因；"关于与来源"面板直接读它                                                                                                                   |
| `items`           | 文章/仓库主表：`id`=sha256(规范 URL) 前 20 位、标题、原文链接、摘要、所属源、发布/更新/采集时间、排序时间戳 `item_ts`、热度分 `rank_score`、指标（stars/downloads/likes）及上一轮值 `metric_prev`（涨星排序用）、是否中国相关、检索预拼文本；全局上限 500 条 |
| `item_categories` | 条目↔分类关联，7 个枚举值（news/projects/skills/models/tips/apps/dev）                                                                                                                                                 |
| `item_tags`       | 条目↔标签关联；入库时由 `backend/topics.py` 规则富化，每条至多 16 个                                                                                                                                                   |
| `users`           | GitHub 登录用户：`github_id` 主键、login、昵称                                                                                                                                                                         |
| `sessions`        | 登录会话：token 哈希、CSRF 令牌、过期时间（7 天）、限流窗口与计数；每账号最多 8 个                                                                                                                                     |
| `favorites`       | 云端收藏（用户↔条目）                                                                                                                                                                                                  |
| `followed_tags`   | 关注的标签（用户↔标签）                                                                                                                                                                                                |
| `daily_snapshots` | 每天头版存档（0003）：北京日期主键、生成时间、头版 JSON（统计+要目+榜）；cycle wrap 时覆盖写当日，供 `/api/archive` 与周一邮件周报回溯                                                                              |

### 运行结果怎么看 / 日志在哪

| 方式           | 内容                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 站内面板       | 首页"N / 18 来源已同步"；"关于与来源"看每源状态、条数、最后成功时间与失败原因                                                                                                  |
| `/api/health`  | 免登录总览：快照时间、总条数、健康源数、最近一次采集明细（`sync` 字段）                                                                                                        |
| `/api/sources` | 免登录逐源状态                                                                                                                                                                 |
| `/api/archive` | 往期头版：无参列近 90 天，`?date=YYYY-MM-DD` 取单期全文                                                                                                                       |
| `/api/stats`   | 统计聚合：近 30 天每日条数、分类分布、标签 top10、源健康                                                                                                                      |
| `/rss`         | 全站 RSS 2.0（`/rss.xml` 同内容），最近 50 条，5 分钟公共缓存                                                                                                                 |
| CF 面板日志    | 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → `signal-ai-news` → **Logs**；Observability 已开启，cron 每次执行的记录与采集报错都在，可按时间过滤 |
| 手动刷新       | `POST /api/sync` 带 `x-admin-token` 请求头（密钥存本地 `.secrets.local.txt`，不入仓库）                                                                                        |

## 用户系统

新增 GitHub OAuth 登录、个人昵称、云端收藏和标签关注；云端收藏与关注标签需要登录，数据存 Cloudflare D1；旧 Pages 地址为迁移提示页。
[用户系统说明与配置教程](docs/accounts/README.md)。2026-10-04 已配置 OAuth 密钥并完成真实 GitHub 登录验收，账号系统上线。
