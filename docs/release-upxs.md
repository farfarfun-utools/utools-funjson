# JSON工坊 FunJSON v0.1.0

首个正式版本：离线 JSON 五视图工作台。

## 主要功能

- **五视图 JSON 工作台**：编辑（CodeMirror 6）、树形、3 级递归嵌套表格（列排序/列筛选/展开折叠/CSV·TSV·Markdown·JSON 导出）、栏列（Miller Columns）与差异对比（支持忽略键序的语义对比）一键切换；
- **JSON 家族全格式支持**：原生解析、高亮与格式化 JSON / JSONC / JSON5 / NDJSON，支持多标签页、缩进识别、键排序、字符串转义/反转义与历史版本快照回溯；
- **RFC 9535 JSONPath & 智能检视条**：编辑器内置可折叠 JSONPath 查询栏与 6 组精选示例，光标停留自动识别并预览时间戳、颜色色块、Base64、URL、Unicode 及内嵌 JSON 字符串；
- **4 合 1 JSON 工具箱**：JSON 修复（离线 `jsonrepair` + 可选 uTools AI / OpenAI 兼容接口）、9 语言类型生成（TypeScript / Go / Java / Rust / Python / Kotlin / Swift / C# / JSON Schema）、JSONPath 查询实验室、键名风格批量转换（6 种命名风格 + 忽略键白名单）；
- **AI / MCP 工具**：向 uTools 注册 `format_json`、`query_jsonpath`、`json_to_types` 三个离线工具。
