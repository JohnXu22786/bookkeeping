# Example conversations

Sample chat turns and the dsh tool calls the model should make (assuming the
bundle is installed as described in the README).

| User says | Expected tool call |
| --------- | ------------------ |
| 记一笔 午饭 35 | `bookkeeping_add { amount: "35", remark: "午饭" }` → category auto-detected: 餐饮 |
| 昨天打车花了 28 | `bookkeeping_add { amount: "28", remark: "打车", date: "昨天" }` → 交通 |
| 工资到账 5000 | `bookkeeping_add { amount: "5000", type: "income", category: "收入", remark: "工资" }` |
| 这周周一咖啡 18 块 | `bookkeeping_add { amount: "18", remark: "咖啡", date: "周一" }` → 餐饮 |
| 花了多少钱在餐饮上 | `bookkeeping_report { kind: "category", category: "餐饮" }` |
| 这个月一共花了多少 | `bookkeeping_report { kind: "monthly", month: "<当前月>" }` |
| 上个月交通费是多少 | `bookkeeping_report { kind: "category", category: "交通", month: "<上个月>" }` |
| 最近半年开销趋势 | `bookkeeping_report { kind: "trend", months: 6 }` |
| 看看这个月的记录 | `bookkeeping_list { month: "<当前月>" }` |
| 导出 csv | `bookkeeping_export { format: "csv" }` |
| 设置本月预算 5000 | `bookkeeping_budget { action: "set", amount: "5000" }` |
| 餐饮预算每月 1500 | `bookkeeping_budget { action: "set", amount: "1500", category: "餐饮" }` |
| 预算还剩多少 | `bookkeeping_budget { action: "check" }` |
| 把 id 12 那条删掉 | `bookkeeping_remove { id: 12 }` |
| 以后「咖啡豆」都算购物 | `bookkeeping_rules { action: "add", keyword: "咖啡豆", category: "购物" }` |

Run the same operations on the CLI to see the exact output text the tools
produce:

```sh
node dist/src/cli.js add 35 午饭
node dist/src/cli.js report category --category 餐饮
node dist/src/cli.js budget check
```
