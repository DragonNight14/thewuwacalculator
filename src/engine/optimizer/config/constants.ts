/*
  Author: Runor Ewhro
  description: defines optimizer execution limits for workers, adaptive batch
               sizing, GPU frames, progress cadence, and result pruning.
*/

export const TARGET_GPU_JOB = 20_000_000
export const ROT_GPU_JOB = 10_000_000
// generated rotation inventory jobs grow toward this per-job wall-time target.
export const ROT_GPU_JOB_TARGET_MS = 400

// detect available cpu cores in the browser and leave one free when possible
const detectedCores =
    typeof navigator !== 'undefined'
        ? (navigator.hardwareConcurrency ?? 4)
        : 4

const cpuWorkerTarget = Math.max(1, detectedCores - 1)

export const GPU_WORKERS = 1
export const CPU_WORKERS = Math.min(6, cpuWorkerTarget)

// cap cpu job size after scaling it by worker count.
const cpuJobTarget = 25_000 + CPU_WORKERS * 5_000
export const CPU_JOB_SIZE = Math.min(75_000, cpuJobTarget)
export const CPU_THEORY_JOB = 2_048
export const CPU_THEORY_JOB_MAX = 100_000
export const GPU_THEORY_JOB = 1_000_000

export const OPT_WG_SIZE = 64
export const CYCLES_PER_CALL = 16

export const LEGACY_BATCH_CYCLES = 1
export const GPU_PIPELINE_DEPTH = 2
export const GPU_SUBMISSION_COMBOS = 65_536
// target scoring emits every candidate for exact ranking. larger target-only
// frames amortize submission and readback latency without changing rotation's
// smaller replay frames.
export const TARGET_GPU_SUBMISSION_COMBOS = 1_048_576
// the first frame of a run scores alone to set the top-k floor
export const TARGET_GPU_PRIME_COMBOS = 65_536
export const NATIVE_GPU_JOB_INITIAL = 32_768
export const NATIVE_GPU_JOB_MIN = 1_024
export const NATIVE_GPU_JOB_MAX = 262_144
export const GPU_JOB_TARGET_MS = 100
export const CPU_JOB_TARGET_MS = 40
export const ADAPTIVE_BATCH_SMOOTHING = 0.5
export const ADAPTIVE_BATCH_MAX_GROWTH = 2
export const ADAPTIVE_BATCH_MIN_RATIO = 0.5
export const CPU_THEORY_JOB_MIN = 256
export const THEORY_BUFFER_BYTES = 64 * 1024 * 1024
export const THEORY_LOW_MEMORY_BUFFER_BYTES = 16 * 1024 * 1024
export const LOW_MEMORY_BATCH_DIVISOR = 2
export const MAX_DISPATCH_WORKGROUPS = 65_535
export const REDUCTION_WORKGROUP_SIZE = 256
export const GPU_RESULT_LIMIT = 65_536
export const GPU_JOB_RESULT_OVERSAMPLE = 1
export const GPU_COLLECT_RESULT_OVERSAMPLE = 2
export const GPU_DECODE_OVERSAMPLE = 8
// candidates read back with the append count before falling back to a full
// copy; inventory frames above the run's top-k floor rarely exceed it
export const GPU_APPEND_INLINE = 65_536
// one keep bit per scoring workgroup of a full target frame
export const TARGET_TILE_WORDS = Math.ceil(TARGET_GPU_SUBMISSION_COMBOS / (OPT_WG_SIZE * CYCLES_PER_CALL) / 32)
// target candidate buffers start with a u32 append count, padding and the
// tile keep bits
export const GPU_APPEND_HEADER = 8 + TARGET_TILE_WORDS * 4
export const SHADER_PIPELINE_CACHE_LIMIT = 4
export const THEORY_BOUND_MIN_BRANCH = 4_096
export const WORKER_TASK_TIMEOUT_MS = 300_000
export const PROGRESS_INTERVAL_MS = 80
export const CPU_PROGRESS_CHECK_COMBOS = 32
export const PROGRESS_RATE_MIN_MS = 1_500
export const PROGRESS_RATE_WINDOW_MS = 8_000
export const RESULT_PRUNE_MULTIPLIER = 8
export const RESULT_PRUNE_MIN_ENTRIES = 256

// per-workgroup reduction fan-in. must stay synchronized with REDUCE_K in
// target.wgsl, rotation.wgsl, and reduceCandidates.wgsl.
export const GPU_REDUCE_K = 8

// combo-mode flag passed to the batch shaders (COMBO_MODE_BATCH).
export const GPU_COMBO_MODE_BATCH = 3

// upper bound on candidates read back to the cpu before the gpu reduce pass
// runs. a smaller ceiling keeps transient gpu/cpu staging allocations bounded;
// the reduction is intentionally lossy once a batch exceeds this size.
export const GPU_BATCH_MAX_READBACK = 1 << 18


export const WORKER_COUNT = {
  cpu: CPU_WORKERS,
  gpu: GPU_WORKERS,
} as const

export const OPT_LOGGING = false

// below this threshold, parallel overhead may outweigh the benefit
export const MIN_PAR_COMBOS = 20_000
