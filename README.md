# 藏品光照轮换台 · Collection Light Rotation

面向博物馆策展人员的**藏品照度排班工具**：设置一小时时段、展位照度、每件藏品的剩余光照预算 / 优先级 / 最低展出时数及锁定，由 **OR-Tools CP-SAT** 在 10 秒内求解轮换排班，原生 JavaScript 展示展位时间轴与逐件剂量，排班可存入 SQLite，刷新 / 重启后仍可查看。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python 3.12 · FastAPI · Uvicorn |
| 求解 | OR-Tools CP-SAT（约束规划，`max_time_in_seconds = 10`） |
| 持久化 | SQLite（标准库 `sqlite3`，Docker 卷 `/data`） |
| 前端 | 原生 HTML / CSS / JavaScript（无框架、无构建） |
| 部署 | Docker / Docker Compose 一键启动 |

## 一键启动（推荐）

```bash
docker compose up --build
```

启动后在浏览器打开：

> **http://localhost:8000**

停止：`Ctrl+C`（后台运行用 `docker compose up -d --build`，`docker compose down` 停止）。
SQLite 数据保存在 Docker 卷 `rotation-data` 中，容器重建后排班记录仍然保留。

## 本地直接运行（可选）

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./data/rotation.db uvicorn app.main:app --host 0.0.0.0 --port 8000
```

浏览器访问 **http://localhost:8000** ；接口文档见 http://localhost:8000/docs 。

## 输入规则

- **时段**：1 ～ 72 个连续的一小时时段（即 1 ～ 72 小时）。
- **展位**：1 ～ 3 个单件展位（同一时段每个展位至多 1 件藏品），照度 1 ～ 10000 lx。
- **藏品**：1 ～ 8 件，每件包含
  - 剩余光照预算：0 ～ 720000 lx·h；
  - 优先级：1 ～ 10（越大越优先展出）；
  - 最低展出时数：0 ～ 72 小时（**硬约束**，必须满足）。
- **锁定**：可把任意藏品的任意时段锁定到指定展位或库房（不耗光照）；同一藏品同一时段至多一条锁定。

## 排班规则（模型）

1. 每件藏品在每个时段**恰好**处于一个展位或库房；
2. 库房不耗光照；展位剂量按 `照度(lx) × 1h` 累加，**累计不得超过剩余预算**；
3. **跨展位移动必须经过至少 1 小时库房**（相邻时段不允许从一个展位直接到另一个展位）；
4. 先保证最低展出时数与全部锁定，然后按以下顺序优化：
   1. 最大化 `Σ 优先级 × 展出小时数`；
   2. 在加权展出小时不减少的前提下，最小化相邻时段出入库次数（库房↔展位的状态切换）。

## 求解状态说明

页面与接口严格区分四种结果：

| 状态 | 含义 |
| --- | --- |
| **已求得并证明最优** | 10 秒内证明加权展出小时最大、出入库次数最少 |
| **可行但未证明最优** | 10 秒限时内找到可行方案，但未能证明最优（大规模时常见，方案可直接使用） |
| **无解** | 约束互相冲突（如最低时数超容量、锁定冲突、预算付不起锁定展位等），会给出中文原因 |
| **超时未找到方案** | 10 秒内未找到任何可行方案，建议放宽锁定 / 最低时数后重试 |

## 页面功能

- **展位时间轴**：每个展位一行，色块按藏品区分，悬停查看藏品、时段、展段剂量；
- **库房行**：逐小时显示当前在库的藏品色点；
- **逐件轨迹**：每件藏品一行，展位 / 库房连续段一目了然；
- **逐件剂量与余额**：展出时数（含最低时数）、累计剂量、预算、剩余预算、预算用量百分比、出入库次数；
- **保存与查看**：为方案命名存入 SQLite，刷新页面或重启服务后可在底部列表「查看」或「删除」。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/solve` | 提交配置并求解，返回状态、时间轴与逐件指标 |
| GET | `/api/schedules` | 已保存排班列表 |
| POST | `/api/schedules` | 保存一次可行 / 最优排班 |
| GET | `/api/schedules/{id}` | 读取某排班（含配置与完整结果） |
| DELETE | `/api/schedules/{id}` | 删除排班 |
| GET | `/api/health` | 健康检查 |

`POST /api/solve` 请求示例：

```json
{
  "slots": 24,
  "booths": [{ "lux": 500 }, { "lux": 1500 }, { "lux": 3000 }],
  "items": [
    { "name": "《青绿山水图》", "budget": 120000, "priority": 10, "min_hours": 8 }
  ],
  "locks": [{ "item": 0, "slot": 0, "location": 1 }]
}
```

锁定中 `location`：`-1` 表示库房，`0/1/2` 表示对应展位；`item`、`slot` 均从 0 开始。

## 目录结构

```
.
├── app/
│   ├── main.py        # FastAPI 路由（求解 / 保存 CRUD / 静态页）
│   ├── solver.py      # CP-SAT 模型：约束、分层目标、状态映射
│   └── database.py    # SQLite 建表与存取
├── static/
│   ├── index.html     # 单页界面
│   ├── styles.css
│   └── app.js         # 原生 JS：编辑器、时间轴、剂量表、保存列表
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```
