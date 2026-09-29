"""藏品光照轮换台 —— FastAPI 入口。"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import database
from .solver import solve_schedule


class Lock(BaseModel):
    item: int = Field(ge=0, le=7)
    slot: int = Field(ge=0, le=71)
    # -1 表示库房，0..2 表示展位索引
    location: int = Field(ge=-1, le=2)


class Booth(BaseModel):
    lux: int = Field(ge=1, le=10000)


class Item(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    budget: int = Field(ge=0, le=720000)
    priority: int = Field(ge=1, le=10)
    min_hours: int = Field(ge=0, le=72)


class SolveRequest(BaseModel):
    slots: int = Field(ge=1, le=72)
    booths: list[Booth] = Field(min_length=1, max_length=3)
    items: list[Item] = Field(min_length=1, max_length=8)
    locks: list[Lock] = Field(default_factory=list)


class SaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    config: dict[str, Any]
    result: dict[str, Any]
    status: Literal["optimal", "feasible"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="藏品光照轮换台", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/solve")
def solve(req: SolveRequest) -> dict[str, Any]:
    config = req.model_dump()
    try:
        return solve_schedule(config)
    except ValueError as exc:
        # 建模前校验失败 —— 422 并附带中文原因
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/schedules")
def save_schedule(req: SaveRequest) -> dict[str, Any]:
    schedule_id = database.insert_schedule(
        req.name,
        json.dumps(req.config, ensure_ascii=False),
        json.dumps(req.result, ensure_ascii=False),
        req.status,
    )
    return {"id": schedule_id}


@app.get("/api/schedules")
def list_schedules() -> list[dict[str, Any]]:
    return [dict(row) for row in database.list_schedules()]


@app.get("/api/schedules/{schedule_id}")
def get_schedule(schedule_id: int) -> dict[str, Any]:
    row = database.get_schedule(schedule_id)
    if row is None:
        raise HTTPException(status_code=404, detail="排班不存在")
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "created_at": row["created_at"],
        "config": json.loads(row["config"]),
        "result": json.loads(row["result"]),
    }


@app.delete("/api/schedules/{schedule_id}")
def remove_schedule(schedule_id: int) -> dict[str, str]:
    if not database.delete_schedule(schedule_id):
        raise HTTPException(status_code=404, detail="排班不存在")
    return {"status": "deleted"}


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount(
    "/",
    StaticFiles(directory=str(STATIC_DIR), html=True),
    name="static",
)
