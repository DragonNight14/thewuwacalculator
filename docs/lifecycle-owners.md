# Resource lifetimes

Classes manage workers, caches, and other resources used across calls; game data records, persisted scenarios, rotation nodes, and formula inputs remain serializable plain data.

| Class | Managed resources | Lifetime |
| --- | --- | --- |
| `WorkerChannel` | Request IDs, pending replies, progress, errors, and idle teardown | One feature client |
| `EvaluationClient` | Worker transport, in-flight work, bounded report caches, and active cancellation | Evaluation module |
| `SuggestionsClient`, `RandomEchoClient`, `DataImportClient` | Feature-specific worker messages and results | Their feature modules |
| `OptimizerRunController` | Lazy pool loading and invalidating a run cancelled during import | Optimizer client module |
| `OptimizerWorkerPool` | Task workers, ordered queue, active run generation, and theory producers | Optimizer worker module |
| `OptimizerCompileSession` | Store run token and compile worker requests | Application store module |
| `GameDataSession` | Bootstrap, HMR-backed registry state, scoped kit loading, leases, and delayed release/trim | Game data module; backing registry state survives HMR as plain data |
| `ScenarioRecordRepository` | Scenario record reads, validated writes, identity reuse, and delayed cleanup | Persistence module |
| `PersistenceCoordinator` | Dirty domain notifications and flush queue | Persistence module |
| `GpuResourceSession` | One initialized payload's buffers and explicit disposal | Each target or rotation GPU runner |
| `HistoryCompactor` | Bounded history compression queue and one active worker | Application history module |
| `RotationEditorRetentionController` | Mounted editor leases and delayed heavy trace release | Rotation editor module |
