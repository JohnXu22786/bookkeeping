# dsh-bookkeeping

**[English](README.md) · 简体中文**

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的对话式记账插件。聊天即可记一笔——「记一笔 午饭 35」——随后可查询、报表、导出，并基于本地 SQLite 账本做月度预算。

本插件是一个自包含的 **dsh bundle**：npm 包，`package.json` 声明 `dsh.bundle` 清单，附带 `cordis.patch.yml` 补丁层，并导出标准插件入口（`name` / `inject` / `Config` / `apply`）。它既可作为 dsh 中供模型调用的工具，也可作为独立 CLI 使用。

## 功能

- **对话式记账** —— 模型通过 `bookkeeping_add` 入账；金额严格校验，日期支持自然语言归一化，分类自动识别。
- **SQLite 账本** —— 本地持久化，字段包含金额 / 分类 / 标签 / 日期 / 币种（金额以整数最小货币单位精确存储）。
- **分类体系** —— 内置分类（餐饮 / 交通 / 购物 / 居住 / 娱乐 / 医疗 / 学习 / 收入 / 其他）、关键词自动归类、自定义关键词→分类规则。
- **报表** —— 按日 / 月 / 分类汇总与月度趋势，支持月份、区间、分类、类型、标签过滤。
- **导出** —— CSV（RFC 4180 转义）与自包含 HTML 报表。
- **预算提醒** —— 可选月度预算（总预算或按分类），入账时即时提示接近限额（≥80%）与超支（≥100%）。
- **双入口** —— 九个可供模型调用的工具（`ctx.tools`），外加行为一致的独立 CLI。

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`（与 dsh 本身要求一致）
- 已安装 dsh（`npx @deepseek-ai/dsh`），且 `PATH` 中有 `pnpm`（用于安装插件）

## 接入 dsh

在仓库根目录先构建：

```sh
npm install
npm run build
npm pack          # 可选：生成 dsh-bookkeeping-1.0.0.tgz
```

将 bundle 安装进某个 dsh profile（目录、tgz、`github:...`、npm 包名均可）：

```sh
dsh plugin --profile bookkeeping add <dsh-bookkeeping 的路径>
# 或：dsh plugin --profile bookkeeping add ./dsh-bookkeeping-1.0.0.tgz
```

验证补丁层已生效，然后启动：

```sh
dsh --profile bookkeeping --dump-config   # 应出现 "# == dsh-bookkeeping" 层
dsh --profile bookkeeping
```

> 安装时 pnpm 可能提示 `Ignored build scripts: better-sqlite3@13.0.3`。
> 该提示可忽略：better-sqlite3 v13 已随包附带预编译二进制，无需构建。

启动后即可在对话中直接使用：

```
用户: 记一笔 午饭 35
用户: 昨天打车花了 28
用户: 花了多少钱在餐饮上？
用户: 这个月一共花了多少？
用户: 给我看下最近 10 条记录
用户: 导出 csv
用户: 设置本月预算 5000
```

## 配置

插件配置通过 Schemastery schema（`export const Config`）声明，在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- insert:
    - id: bookkeeping
      name: dsh-bookkeeping
      config:
        dataDir: /var/data/bookkeeping   # 可选，默认 ~/.dsh-bookkeeping
        currency: CNY                    # 可选，默认 CNY
        maxAmount: 1000000000000         # 可选，单笔金额上限（单位）
```

| 键          | 类型   | 默认值                | 含义                                                          |
| ----------- | ------ | --------------------- | ------------------------------------------------------------ |
| `dataDir`   | string | `~/.dsh-bookkeeping`  | `ledger.db` 与 `exports/` 目录所在位置。也支持 `DSH_BOOKKEEPING_DATA_DIR` 环境变量（显式配置优先）。 |
| `currency`  | string | `CNY`                 | 金额未带符号时的默认币种。                                     |
| `maxAmount` | number | `1_000_000_000_000`   | 单笔金额上限（单位）。                                         |

## 工具

所有工具返回 `{ summary, data }`；`summary` 是面向模型的文本，`data` 是结构化 JSON。

| 工具 | 用途 |
| ---- | ---- |
| `bookkeeping_add` | 记一笔。`amount` 必填；`category` 省略时自动归类；`type`（expense/income）、`currency`、`remark`、`tags`、`date`（自然语言）可选。 |
| `bookkeeping_list` | 列出记录（最新在前），支持 `month` / `start` / `end` / `category` / `type` / `tag` / `limit` 过滤。 |
| `bookkeeping_categorize` | 用内置关键词与自定义规则预测文本所属分类。 |
| `bookkeeping_categories` | 列出全部已知分类（内置 + 自定义规则引入）及其类型。 |
| `bookkeeping_report` | 汇总：`daily`、`monthly`、`category`、`trend`（+`months`）。过滤：`month` / `start` / `end` / `category` / `type`。 |
| `bookkeeping_export` | 将匹配的记录导出为 CSV 或 HTML 文件（写入 `<dataDir>/exports/`，导出完整匹配集合），返回绝对路径。 |
| `bookkeeping_budget` | 月度预算 `set` / `list` / `check`。`set` 传 `"0"` 删除预算。 |
| `bookkeeping_rules` | 自定义关键词→分类规则：`add` / `list` / `remove`。 |
| `bookkeeping_remove` | 按 id 删除记录（列表中显示为 `#12`）。 |

## CLI

同一账本也提供独立 CLI（无需 dsh）：

```sh
node dist/src/cli.js add 35 午饭                 # 记一笔
node dist/src/cli.js add "¥500" 工资 --type income --date 昨天
node dist/src/cli.js list --month 2026-08        # 查询
node dist/src/cli.js report category --month 2026-08
node dist/src/cli.js report trend --months 6
node dist/src/cli.js export csv --out ./out
node dist/src/cli.js budget set 5000             # 本月总预算
node dist/src/cli.js budget set 1500 --category 餐饮
node dist/src/cli.js rules add 咖啡豆 购物
node dist/src/cli.js remove 12
```

`node dist/src/cli.js --help` 查看完整参考。退出码：`0` 成功，`1` 领域错误（金额/日期非法等），`2` 用法错误。数据位于 `~/.dsh-bookkeeping`（可用 `--data-dir` 或 `DSH_BOOKKEEPING_DATA_DIR` 覆盖）。

## 数据存储

数据目录下单个 SQLite 数据库（`ledger.db`），WAL 模式。表：

- `entries` —— `id`、`amount_cents`（整数最小单位，恒 > 0）、`currency`、`type`（`expense`/`income`）、`category`、`remark`、`tags`（JSON 数组）、`date`（`YYYY-MM-DD`）、`created_at`
- `category_rules` —— 自定义 `keyword` → `category` 规则（优先于内置关键词）
- `budgets` —— `(month, category)` 限额；category `'*'` 表示总预算
- `meta` —— 预留的元数据表

导出文件写入 `<dataDir>/exports/ledger-<时间戳>.csv|html`。

## 金额与日期

**金额。** 支持 `35`、`35.5`、`¥35`、`35元`、`$35.99`、`1,234.56` 等写法。符号决定币种（`¥`/`￥`→CNY，`$`→USD，`€`→EUR，`£`→GBP，`₩`→KRW；后缀 `元`/`块`→CNY，`円`→JPY）。显式 `currency` 参数可覆盖默认币种，但不得与符号冲突。以下输入会被拒绝：零、负数、非数字文本、千分位格式错误、超出币种小数位精度（CNY/USD 等 2 位，JPY/KRW 0 位）、超过 `maxAmount` 的金额。

**日期。** 支持 `YYYY-MM-DD`、`2026/8/17`、`2026.8.17`、`2026年8月17日`、`8/17`、`8月17日`、`3月`；相对词 `今天/今日/昨天/昨日/前天/明天/明日/后天` 与 `today/yesterday/tomorrow`；星期 `周X`/`星期X`/`礼拜X`（映射到当前周一起始的自然周内）、`上周X`、`下周X`、裸 `上周`/`下周`；偏移 `N天前/N天后`、`N周前/后`、`N个月前/后`；月份 `上个月/本月/这个月/下个月`（日期按目标月天数截断）。无法解析的日期会报错并列出支持格式。年份范围 1900–2100。

## 分类

内置分类与关键词自动归类：餐饮、交通、购物、居住、娱乐、医疗、学习、收入、其他（兜底）。匹配为不区分大小写的子串匹配；**最长**关键词优先，同长时自定义规则优先，均不匹配时归入其他。自定义规则持久化在数据库中，例如 `rules add 咖啡豆 购物` 之后，任何包含「咖啡豆」的备注都会归为购物。

## 报表与预算

- `daily` —— 每日收支；`monthly` —— 每月收支与净额（收入 − 支出）；`category` —— 分类汇总（含占比，按金额降序）；`trend` —— 最近 N 个月月度趋势（空月补零）。
- 起止边界支持 `YYYY-MM` 或 `YYYY-MM-DD`（月份边界自动展开为该月首日/末日）。`type` 默认两者（`all`），可传 `expense`/`income` 收窄。
- 预算按月（`YYYY-MM`），可设总预算或分类预算。记录支出时立即检查：≥80% 提示接近限额，≥100% 提示超支。收入不消耗预算。`budget set … 0` 删除预算。总览式 `budget check` 会报告当月全部预算（总预算与各分类预算）。

## 开发

```sh
npm install
npm run build     # tsc -> dist/
npm test          # tsc + node --test
```

结构：`src/money.ts`（金额解析/格式化）、`src/dateutil.ts`（自然语言日期）、`src/categories.ts`（内置分类与自动归类）、`src/store.ts`（SQLite）、`src/ledger.ts`（领域服务）、`src/report.ts` / `src/budget.ts` / `src/export.ts`（汇总、预算、导出）、`src/format.ts`（共享文本）、`src/tools.ts`（dsh 工具）、`src/cli.ts`（CLI）、`src/index.ts`（bundle 入口）。测试位于 `test/`，与模块一一对应。

## Bundle 结构

```
package.json        dsh: { bundle: { patch: "./cordis.patch.yml" } }，type: module，exports，bin
cordis.patch.yml    插入插件行的补丁层（id: bookkeeping, name: dsh-bookkeeping）
dist/src/index.js   入口：export const name / inject / Config / apply(ctx, config)
dist/src/cli.js     独立 CLI（bin: dsh-bookkeeping）
```

## 限制

- 不做汇率换算——每条记录保留自己的币种；汇总假设单一币种（混币时按最小单位数值相加，预算按默认币种显示支出合计）。
- `bookkeeping_list` 的合计仅覆盖当前页；完整合计请用 `bookkeeping_report`。
- `周X` 固定解析到当前周一起始的自然周内（含未来的星期几），此为约定行为。
- 预算以账本默认币种计。
- 数据按设计仅本地存储，不是多用户服务。

## License

[MIT](./LICENSE)
