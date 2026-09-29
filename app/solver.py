"""CP-SAT 排班模型。

每件藏品在每个一小时时段恰处于一个展位或库房；库房不耗光照，
展位按 照度(lx) × 1h 累加剂量且不得超过剩余光照预算。
跨展位移动须经过至少一个小时库房。

目标分层：
1) 硬约束：最低展出时数、锁定、预算、每展位单件、库房中转；
2) 最大化 优先级加权的展出小时数；
3) 在加权展出小时不减少的前提下，最小化相邻时段出入库次数。
"""
from __future__ import annotations

from typing import Any

from ortools.sat.python import cp_model

TIME_LIMIT_SECONDS = 10.0
STORAGE = -1  # 库房在结果中的位置标记

# cp_model.CpSolverStatus:
#   UNKNOWN(0) MODEL_INVALID(1) FEASIBLE(2) INFEASIBLE(3)
#   OPTIMAL(4) （部分版本还有 UNBOUNDED 等，本模型为有界 0-1 规划，不会出现）
STATUS_TEXT = {
    cp_model.OPTIMAL: "已求得并证明最优方案",
    cp_model.FEASIBLE: "可行但未证明最优（10 秒限时）",
    cp_model.INFEASIBLE: "无解：约束互相冲突，无法排班",
    cp_model.UNKNOWN: "超时：限时内未找到任何可行方案",
    cp_model.MODEL_INVALID: "模型无效：输入数据存在冲突",
}


def validate_request(config: dict[str, Any]) -> None:
    """在建模前做范围/一致性校验，问题统一以 ValueError（HTTP 422）抛出。"""
    slots = config.get("slots")
    if not isinstance(slots, int) or not (1 <= slots <= 72):
        raise ValueError("时段数必须是 1～72 之间的整数。")

    booths = config.get("booths")
    if not isinstance(booths, list) or not (1 <= len(booths) <= 3):
        raise ValueError("展位数量必须为 1～3 个。")
    for j, b in enumerate(booths):
        lux = b.get("lux")
        if not isinstance(lux, int) or not (1 <= lux <= 10000):
            raise ValueError(f"展位 {j + 1} 的照度必须是 1～10000 lx 的整数。")

    items = config.get("items")
    if not isinstance(items, list) or not (1 <= len(items) <= 8):
        raise ValueError("藏品数量必须为 1～8 件。")
    for i, it in enumerate(items):
        name = str(it.get("name") or f"藏品 {i + 1}")
        budget = it.get("budget")
        priority = it.get("priority")
        min_hours = it.get("min_hours")
        if not isinstance(budget, int) or not (0 <= budget <= 720000):
            raise ValueError(f"{name} 的剩余光照预算必须是 0～720000 lx·h 的整数。")
        if not isinstance(priority, int) or not (1 <= priority <= 10):
            raise ValueError(f"{name} 的优先级必须是 1～10 的整数。")
        if not isinstance(min_hours, int) or not (0 <= min_hours <= 72):
            raise ValueError(f"{name} 的最低展出时数必须是 0～72 小时的整数。")
        if min_hours > slots:
            raise ValueError(f"{name} 的最低展出时数 {min_hours}h 超过总时段数 {slots}。")
        # 最低展出时数为正但预算连一小时最便宜的展位都付不起 —— 必然无解
        if min_hours > 0:
            cheapest = min(b["lux"] for b in booths)
            if budget < cheapest:
                raise ValueError(
                    f"{name} 需至少展出 {min_hours}h，但预算 {budget} lx·h "
                    f"低于最低展位照度 {cheapest} lx，无法展出 1 小时。"
                )

    locks = config.get("locks", [])
    if not isinstance(locks, list):
        raise ValueError("锁定记录格式不正确。")
    seen: set[tuple[int, int]] = set()
    for k, lk in enumerate(locks):
        item = lk.get("item")
        slot = lk.get("slot")
        location = lk.get("location")
        if not isinstance(item, int) or not (0 <= item < len(items)):
            raise ValueError(f"锁定 {k + 1} 的藏品编号无效。")
        if not isinstance(slot, int) or not (0 <= slot < slots):
            raise ValueError(f"锁定 {k + 1} 的时段编号无效（应为第 1～{slots} 时段）。")
        if not isinstance(location, int) or not (
            location == STORAGE or 0 <= location < len(booths)
        ):
            raise ValueError(f"锁定 {k + 1} 的位置无效（库房或展位编号）。")
        key = (item, slot)
        if key in seen:
            raise ValueError(
                f"{items[item].get('name')} 在第 {slot + 1} 时段被重复锁定。"
            )
        seen.add(key)
        # 锁定到展位但预算付不起该展位一小时 —— 必然无解
        if location != STORAGE and booths[location]["lux"] > items[item]["budget"]:
            raise ValueError(
                f"锁定冲突：{items[item].get('name')} 第 {slot + 1} 时段锁在"
                f"展位 {location + 1}（{booths[location]['lux']} lx），"
                f"但预算仅 {items[item]['budget']} lx·h。"
            )


def solve_schedule(config: dict[str, Any]) -> dict[str, Any]:
    """构建并求解模型，返回前端可直接渲染的结果字典。"""
    validate_request(config)
    T = config["slots"]
    booths = config["booths"]
    items = config["items"]
    locks = config.get("locks", [])
    B = len(booths)
    N = len(items)
    lux = [b["lux"] for b in booths]
    priority = [it["priority"] for it in items]
    budget = [it["budget"] for it in items]
    min_hours = [it["min_hours"] for it in items]

    lock_map: dict[tuple[int, int], int] = {
        (lk["item"], lk["slot"]): lk["location"] for lk in locks
    }

    model = cp_model.CpModel()

    # x[i, t, p]：藏品 i 在时段 t 位于位置 p（p=0..B-1 展位，p=B 库房）
    x: dict[tuple[int, int, int], cp_model.IntVar] = {}
    for i in range(N):
        for t in range(T):
            for p in range(B + 1):
                x[i, t, p] = model.new_bool_var(f"x_{i}_{t}_{p}")

    # 每件每时段恰在一个位置
    for i in range(N):
        for t in range(T):
            model.add(sum(x[i, t, p] for p in range(B + 1)) == 1)

    # 每个单件展位每时段至多一件
    for j in range(B):
        for t in range(T):
            model.add(sum(x[i, t, j] for i in range(N)) <= 1)

    # 锁定
    for (i, t), loc in lock_map.items():
        p = B if loc == STORAGE else loc
        model.add(x[i, t, p] == 1)

    # 跨展位移动须间隔至少一小时库房：
    # 相邻时段若处于两个不同展位，则中间（即 t+1）必须在库房。
    for i in range(N):
        for t in range(T - 1):
            for j in range(B):
                for k in range(B):
                    if k == j:
                        continue
                    model.add(x[i, t, j] + x[i, t + 1, k] <= 1)

    # 光照预算（库房 p=B 照度为 0）
    for i in range(N):
        dose_terms = [
            lux[j] * x[i, t, j] for t in range(T) for j in range(B)
        ]
        model.add(sum(dose_terms) <= budget[i])

    # 最低展出时数（硬约束）
    exhibit = []
    for i in range(N):
        e = model.new_int_var(0, T, f"exhibit_{i}")
        model.add(e == sum(x[i, t, j] for t in range(T) for j in range(B)))
        model.add(e >= min_hours[i])
        exhibit.append(e)

    # 出入库次数：相邻时段“在库房/在展位”状态发生切换即计一次
    transitions = []
    for i in range(N):
        for t in range(T - 1):
            y = model.new_bool_var(f"switch_{i}_{t}")
            # y = 1 时强制 x[i,t,B]+x[i,t+1,B] = 1（一个库房一个展位）；
            # 两个都在库房(=2)/两个都在展位(=0)时 y 只能为 0。
            model.add(x[i, t, B] + x[i, t + 1, B] + y >= 1)
            model.add(x[i, t, B] + x[i, t + 1, B] - y <= 1)
            transitions.append(y)

    weighted_hours = sum(priority[i] * exhibit[i] for i in range(N))
    total_transitions = sum(transitions)

    # 分层目标：加权展出小时的权重严格大于出入库次数的最大可能值
    scale = N * max(T - 1, 1) + 1
    model.maximize(scale * weighted_hours - total_transitions)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = TIME_LIMIT_SECONDS
    solver.parameters.num_search_workers = 8
    try:
        status = solver.solve(model)
    except Exception as exc:  # 建模/求解器异常一律按未知失败上报
        return {
            "status": cp_model.UNKNOWN,
            "status_code": cp_model.UNKNOWN,
            "status_text": "求解器运行失败，请检查输入。",
            "error": str(exc),
            "config": config,
        }

    result: dict[str, Any] = {
        "status_code": int(status),
        "status_text": STATUS_TEXT.get(status, "求解器返回未知状态。"),
        "wall_time": round(solver.wall_time, 3),
        "config": config,
    }

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        result["status"] = (
            "infeasible" if status == cp_model.INFEASIBLE else "unknown"
        )
        return result

    # ---- 提取方案 ----
    assignment: list[list[int]] = []
    item_stats = []
    total_weighted = 0
    total_switch = 0

    for i in range(N):
        row: list[int] = []
        per_slot_dose: list[int] = []
        for t in range(T):
            loc = STORAGE
            for j in range(B):
                if solver.boolean_value(x[i, t, j]):
                    loc = j
                    break
            row.append(loc)
            per_slot_dose.append(lux[loc] if loc != STORAGE else 0)
        assignment.append(row)

        dose = sum(per_slot_dose)
        hours = sum(1 for v in row if v != STORAGE)
        switches = sum(
            1 for t in range(1, T)
            if (row[t] == STORAGE) != (row[t - 1] == STORAGE)
        )
        total_weighted += priority[i] * hours
        total_switch += switches

        # 分段（同一位置的连续时段合并），供时间轴渲染
        segments = []
        t = 0
        while t < T:
            p = row[t]
            end = t + 1
            seg_dose = per_slot_dose[t]
            while end < T and row[end] == p:
                seg_dose += per_slot_dose[end]
                end += 1
            segments.append(
                {"location": p, "start": t, "end": end - 1, "dose": seg_dose}
            )
            t = end

        item_stats.append(
            {
                "name": items[i].get("name") or f"藏品 {i + 1}",
                "hours": hours,
                "min_hours": min_hours[i],
                "priority": priority[i],
                "dose": dose,
                "budget": budget[i],
                "remaining": budget[i] - dose,
                "transitions": switches,
                "segments": segments,
            }
        )

    # 展位视角：每格 0..N-1 藏品索引，空（库房/他处）为 -1；库房视角：每格内存放的藏品
    booth_slots = [
        [next((i for i in range(N) if assignment[i][t] == j), STORAGE)
         for t in range(T)]
        for j in range(B)
    ]
    storage_slots = [
        [i for i in range(N) if assignment[i][t] == STORAGE] for t in range(T)
    ]

    result.update(
        {
            "status": "optimal" if status == cp_model.OPTIMAL else "feasible",
            "assignment": assignment,
            "booth_slots": booth_slots,
            "storage_slots": storage_slots,
            "items": item_stats,
            "weighted_hours": total_weighted,
            "transitions": total_switch,
            "objective_value": int(solver.objective_value),
            "objective_bound": int(solver.best_objective_bound),
        }
    )
    return result
