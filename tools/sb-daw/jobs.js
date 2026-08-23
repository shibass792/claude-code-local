const fs = require('fs');
const path = require('path');

const JOB_TYPES = new Set(['record', 'bounce', 'preview', 'export']);
const JOB_STATUSES = new Set(['queued', 'running', 'done', 'error', 'cancelled']);

function defaultRoot() {
  return process.env.SHIBASS_ROOT || process.cwd();
}

function jobsPath() {
  if (process.env.SB_DAW_JOBS_PATH) {
    return process.env.SB_DAW_JOBS_PATH;
  }
  return path.join(defaultRoot(), '10_OUTPUTS', 'sb-daw', 'jobs.json');
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ioSnapshot() {
  return {
    inputs: process.env.SB_DAW_INPUTS || 'connected',
    outputs: process.env.SB_DAW_OUTPUTS || 'preview',
    controlRoom: process.env.SB_DAW_CONTROL_ROOM || 'connected',
    sampleRate: Number(process.env.SB_DAW_SAMPLE_RATE || 44100),
    bitDepth: Number(process.env.SB_DAW_BIT_DEPTH || 24),
    frameRate: Number(process.env.SB_DAW_FRAME_RATE || 30),
    recordFormat: '44.1 kHz · 24 bit',
    probed: false,
    note: 'I/O labels match the sb-daw panel. Hardware probe is not claimed here.',
  };
}

function emptyStore() {
  return {
    mock: false,
    engine: 'sb-daw',
    updatedAt: 0,
    jobs: [],
  };
}

function readStore() {
  const filePath = jobsPath();
  if (!fs.existsSync(filePath)) {
    return emptyStore();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.jobs)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const filePath = jobsPath();
  ensureParent(filePath);
  const next = {
    mock: false,
    engine: 'sb-daw',
    updatedAt: Date.now(),
    jobs: store.jobs,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function newId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function listJobs() {
  const store = readStore();
  return {
    ok: true,
    mock: false,
    engine: 'sb-daw',
    path: '/api/sb-daw/jobs/',
    io: ioSnapshot(),
    jobs: store.jobs,
    count: store.jobs.length,
  };
}

function getJob(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('job id is required');
  }
  const job = readStore().jobs.find((row) => row.id === id);
  if (!job) {
    return null;
  }
  return { ok: true, mock: false, job };
}

function createJob(input = {}) {
  const type = String(input.type || 'record');
  if (!JOB_TYPES.has(type)) {
    throw new Error(`Unsupported job type: ${type}`);
  }
  const job = {
    id: newId(),
    type,
    title: String(input.title || `${type} ${new Date().toISOString()}`),
    status: 'queued',
    sampleRate: ioSnapshot().sampleRate,
    bitDepth: ioSnapshot().bitDepth,
    frameRate: ioSnapshot().frameRate,
    outputPath: input.outputPath ? String(input.outputPath) : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mock: false,
    note: 'Queued on this PC. Cubase/Ableton must pick it up — this API does not fake a finished bounce.',
  };
  const store = readStore();
  store.jobs.unshift(job);
  writeStore(store);
  return { ok: true, mock: false, job };
}

function patchJob(id, patch = {}) {
  const store = readStore();
  const job = store.jobs.find((row) => row.id === id);
  if (!job) {
    return null;
  }
  if (patch.status) {
    if (!JOB_STATUSES.has(patch.status)) {
      throw new Error(`Unsupported status: ${patch.status}`);
    }
    job.status = patch.status;
  }
  if (patch.outputPath) {
    job.outputPath = String(patch.outputPath);
  }
  job.updatedAt = Date.now();
  writeStore(store);
  return { ok: true, mock: false, job };
}

module.exports = {
  JOB_TYPES,
  jobsPath,
  ioSnapshot,
  listJobs,
  getJob,
  createJob,
  patchJob,
};
