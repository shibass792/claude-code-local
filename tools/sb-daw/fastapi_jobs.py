"""FastAPI / Starlette router for /api/sb-daw/jobs/ on port 8788."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Optional

try:
    from fastapi import APIRouter, HTTPException
    from pydantic import BaseModel, Field
except ImportError as exc:  # pragma: no cover - only used on the 8788 host
    raise ImportError("fastapi_jobs requires fastapi on the Synth Studio host") from exc

router = APIRouter(tags=["sb-daw"])

JOB_TYPES = {"record", "bounce", "preview", "export"}
JOB_STATUSES = {"queued", "running", "done", "error", "cancelled"}


def jobs_path() -> Path:
    if os.environ.get("SB_DAW_JOBS_PATH"):
        return Path(os.environ["SB_DAW_JOBS_PATH"])
    root = Path(os.environ.get("SHIBASS_ROOT", os.getcwd()))
    return root / "10_OUTPUTS" / "sb-daw" / "jobs.json"


def io_snapshot() -> dict[str, Any]:
    return {
        "inputs": os.environ.get("SB_DAW_INPUTS", "connected"),
        "outputs": os.environ.get("SB_DAW_OUTPUTS", "preview"),
        "controlRoom": os.environ.get("SB_DAW_CONTROL_ROOM", "connected"),
        "sampleRate": int(os.environ.get("SB_DAW_SAMPLE_RATE", "44100")),
        "bitDepth": int(os.environ.get("SB_DAW_BIT_DEPTH", "24")),
        "frameRate": int(os.environ.get("SB_DAW_FRAME_RATE", "30")),
        "recordFormat": "44.1 kHz · 24 bit",
        "probed": False,
        "note": "I/O labels match the sb-daw panel. Hardware probe is not claimed here.",
    }


def read_store() -> dict[str, Any]:
    path = jobs_path()
    if not path.exists():
        return {"mock": False, "engine": "sb-daw", "jobs": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"mock": False, "engine": "sb-daw", "jobs": []}
    if not isinstance(data.get("jobs"), list):
        return {"mock": False, "engine": "sb-daw", "jobs": []}
    return data


def write_store(store: dict[str, Any]) -> None:
    path = jobs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mock": False,
        "engine": "sb-daw",
        "updatedAt": int(time.time() * 1000),
        "jobs": store.get("jobs", []),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


class JobCreate(BaseModel):
    type: str = Field(default="record")
    title: Optional[str] = None
    outputPath: Optional[str] = None


class JobPatch(BaseModel):
    status: Optional[str] = None
    outputPath: Optional[str] = None


@router.get("/api/sb-daw/jobs/")
@router.get("/api/sb-daw/jobs")
def list_jobs() -> dict[str, Any]:
    store = read_store()
    return {
        "ok": True,
        "mock": False,
        "engine": "sb-daw",
        "path": "/api/sb-daw/jobs/",
        "io": io_snapshot(),
        "jobs": store.get("jobs", []),
        "count": len(store.get("jobs", [])),
    }


@router.post("/api/sb-daw/jobs/")
@router.post("/api/sb-daw/jobs")
def create_job(body: JobCreate) -> dict[str, Any]:
    if body.type not in JOB_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported job type: {body.type}")
    job = {
        "id": f"job_{int(time.time() * 1000)}",
        "type": body.type,
        "title": body.title or f"{body.type} {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        "status": "queued",
        "sampleRate": io_snapshot()["sampleRate"],
        "bitDepth": io_snapshot()["bitDepth"],
        "frameRate": io_snapshot()["frameRate"],
        "outputPath": body.outputPath,
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
        "mock": False,
        "note": "Queued on this PC. Cubase/Ableton must pick it up.",
    }
    store = read_store()
    jobs = list(store.get("jobs", []))
    jobs.insert(0, job)
    store["jobs"] = jobs
    write_store(store)
    return {"ok": True, "mock": False, "job": job}


@router.get("/api/sb-daw/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    store = read_store()
    job = next((row for row in store.get("jobs", []) if row.get("id") == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "mock": False, "job": job}


@router.post("/api/sb-daw/jobs/{job_id}")
def patch_job(job_id: str, body: JobPatch) -> dict[str, Any]:
    store = read_store()
    jobs = list(store.get("jobs", []))
    job = next((row for row in jobs if row.get("id") == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if body.status:
        if body.status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unsupported status: {body.status}")
        job["status"] = body.status
    if body.outputPath:
        job["outputPath"] = body.outputPath
    job["updatedAt"] = int(time.time() * 1000)
    store["jobs"] = jobs
    write_store(store)
    return {"ok": True, "mock": False, "job": job}


def install(app: Any) -> None:
    app.include_router(router)
