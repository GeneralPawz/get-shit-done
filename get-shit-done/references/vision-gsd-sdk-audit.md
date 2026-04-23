# GSD SDK Query Subcommand Audit — Read-only vs Mutating (D-12 Deliverable)

This document classifies every subcommand registered in `sdk/src/query/index.ts` as either read-only or mutating. Its primary purpose is to feed the Tier 2 Bash allowlist for `/gsd-envision` vision sessions — the allowlist's `gsd-sdk query` entries are derived exclusively from the read-only set listed here. Scope covers every handler registered in `createRegistry()` in `sdk/src/query/index.ts`; canonical source is the `QUERY_MUTATION_COMMANDS` Set constant in that same file.

---

## Mutating Subcommands

Commands that perform durable writes to disk, git, or global profile store. Source: `QUERY_MUTATION_COMMANDS` in `sdk/src/query/index.ts`.

### state.*

- **`state.update`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateUpdate handler).
- **`state.patch`** — Mutating. Source: sdk/src/query/state-mutation.ts (statePatch handler).
- **`state.begin-phase`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateBeginPhase handler).
- **`state.advance-plan`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateAdvancePlan handler).
- **`state.record-metric`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateRecordMetric handler).
- **`state.update-progress`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateUpdateProgress handler).
- **`state.add-decision`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateAddDecision handler).
- **`state.add-blocker`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateAddBlocker handler).
- **`state.resolve-blocker`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateResolveBlocker handler).
- **`state.record-session`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateRecordSession handler).
- **`state.planned-phase`** — Mutating. Source: sdk/src/query/state-mutation.ts (statePlannedPhase handler).
- **`state.signal-waiting`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateSignalWaiting handler).
- **`state.signal-resume`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateSignalResume handler).
- **`state.sync`** — Mutating. Source: sdk/src/query/state-mutation.ts (stateSync handler).
- **`state.prune`** — Mutating. Source: sdk/src/query/state-mutation.ts (statePrune handler).

### frontmatter.*

- **`frontmatter.set`** — Mutating. Source: sdk/src/query/frontmatter-mutation.ts (frontmatterSet handler).
- **`frontmatter.merge`** — Mutating. Source: sdk/src/query/frontmatter-mutation.ts (frontmatterMerge handler).
- **`frontmatter.validate`** — Mutating. Source: sdk/src/query/frontmatter-mutation.ts (frontmatterValidate handler).

### config-*

- **`config-set`** — Mutating. Source: sdk/src/query/config-mutation.ts (configSet handler).
- **`config-set-model-profile`** — Mutating. Source: sdk/src/query/config-mutation.ts (configSetModelProfile handler).
- **`config-new-project`** — Mutating. Source: sdk/src/query/config-mutation.ts (configNewProject handler).
- **`config-ensure-section`** — Mutating. Source: sdk/src/query/config-mutation.ts (configEnsureSection handler).

### commit*

- **`commit`** — Mutating. Source: sdk/src/query/commit.ts (commit handler).
- **`check-commit`** — Mutating. Source: sdk/src/query/commit.ts (checkCommit handler).
- **`commit-to-subrepo`** — Mutating. Source: sdk/src/query/commit.ts (commitToSubrepo handler).

### template.*

- **`template.fill`** — Mutating. Source: sdk/src/query/template.ts (templateFill handler).
- **`template.select`** — Mutating. Source: sdk/src/query/template.ts (templateSelect handler).

### validate.*

- **`validate.health`** — Mutating. Source: sdk/src/query/validate.ts (validateHealth handler).

### phase.* / phases.*

- **`phase.add`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseAdd handler).
- **`phase.add-batch`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseAddBatch handler).
- **`phase.insert`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseInsert handler).
- **`phase.remove`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseRemove handler).
- **`phase.complete`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseComplete handler).
- **`phase.scaffold`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phaseScaffold handler).
- **`phases.clear`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phasesClear handler).
- **`phases.archive`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (phasesArchive handler).

### roadmap.*

- **`roadmap.update-plan-progress`** — Mutating. Source: sdk/src/query/roadmap-update-plan-progress.ts (roadmapUpdatePlanProgress handler).
- **`roadmap.annotate-dependencies`** — Mutating. Source: sdk/src/query/roadmap.ts (roadmapAnnotateDependencies handler).

### requirements.*

- **`requirements.mark-complete`** — Mutating. Source: sdk/src/query/roadmap.ts (requirementsMarkComplete handler).

### todo.*

- **`todo.complete`** — Mutating. Source: sdk/src/query/progress.ts (todoComplete handler).

### milestone.*

- **`milestone.complete`** — Mutating. Source: sdk/src/query/phase-lifecycle.ts (milestoneComplete handler).

### workstream.*

- **`workstream.create`** — Mutating. Source: sdk/src/query/workstream.ts (workstreamCreate handler).
- **`workstream.set`** — Mutating. Source: sdk/src/query/workstream.ts (workstreamSet handler).
- **`workstream.complete`** — Mutating. Source: sdk/src/query/workstream.ts (workstreamComplete handler).
- **`workstream.progress`** — Mutating. Source: sdk/src/query/workstream.ts (workstreamProgress handler).

### docs-init

- **`docs-init`** — Mutating. Source: sdk/src/query/docs-init.ts (docsInit handler).

### learnings.*

- **`learnings.copy`** — Mutating. Source: sdk/src/query/profile.ts (learningsCopy handler).
- **`learnings.prune`** — Mutating. Source: sdk/src/query/profile.ts (learningsPrune handler).
- **`learnings.delete`** — Mutating. Source: sdk/src/query/profile.ts (learningsDelete handler).

### intel.*

- **`intel.snapshot`** — Mutating. Source: sdk/src/query/intel.ts (intelSnapshot handler).
- **`intel.patch-meta`** — Mutating. Source: sdk/src/query/intel.ts (intelPatchMeta handler).

### write-profile / generate-*

- **`write-profile`** — Mutating. Source: sdk/src/query/profile-output.ts (writeProfile handler).
- **`generate-claude-profile`** — Mutating. Source: sdk/src/query/profile-output.ts (generateClaudeProfile handler).
- **`generate-dev-preferences`** — Mutating. Source: sdk/src/query/profile-output.ts (generateDevPreferences handler).
- **`generate-claude-md`** — Mutating. Source: sdk/src/query/profile-output.ts (generateClaudeMd handler).

---

## Read-Only Subcommands

Commands that read state, configuration, or filesystem without performing durable writes. Source: registered handlers in `createRegistry()` minus `QUERY_MUTATION_COMMANDS`.

### State reads

- **`state.load`** — Read-only. Source: sdk/src/query/state-mutation.ts (stateLoad re-export via state.ts).
- **`state.json`** — Read-only. Source: sdk/src/query/state.ts (stateJson handler).
- **`state.get`** — Read-only. Source: sdk/src/query/state.ts (stateGet handler).
- **`state.snapshot`** — Read-only. Source: sdk/src/query/state.ts (stateSnapshot handler).
- **`state-project-load`** — Read-only. Source: sdk/src/query/state-project-load.ts (stateProjectLoad handler).

### Config reads

- **`config.get`** — Read-only. Source: sdk/src/query/config-query.ts (configGet handler).
- **`config.path`** — Read-only. Source: sdk/src/query/config-query.ts (configPath handler).
- **`resolve-model`** — Read-only. Source: sdk/src/query/config-query.ts (resolveModel handler).

### Phase reads

- **`find-phase`** — Read-only. Source: sdk/src/query/phase.ts (findPhase handler).
- **`phase-plan-index`** — Read-only. Source: sdk/src/query/phase.ts (phasePlanIndex handler).
- **`phases.list`** — Read-only. Source: sdk/src/query/phase-lifecycle.ts (phasesList handler).
- **`phase.next-decimal`** — Read-only. Source: sdk/src/query/phase-lifecycle.ts (phaseNextDecimal handler).
- **`phase.list-plans`** — Read-only. Source: sdk/src/query/phase-list-queries.ts (phaseListPlans handler).
- **`phase.list-artifacts`** — Read-only. Source: sdk/src/query/phase-list-queries.ts (phaseListArtifacts handler).
- **`plan.task-structure`** — Read-only. Source: sdk/src/query/plan-task-structure.ts (planTaskStructure handler).
- **`requirements.extract-from-plans`** — Read-only. Source: sdk/src/query/requirements-extract-from-plans.ts (requirementsExtractFromPlans handler).

### Roadmap reads

- **`roadmap.analyze`** — Read-only. Source: sdk/src/query/roadmap.ts (roadmapAnalyze handler).
- **`roadmap.get-phase`** — Read-only. Source: sdk/src/query/roadmap.ts (roadmapGetPhase handler).

### Progress reads

- **`progress.json`** — Read-only. Source: sdk/src/query/progress.ts (progressJson handler).
- **`progress.bar`** — Read-only. Source: sdk/src/query/progress.ts (progressBar handler).
- **`progress.table`** — Read-only. Source: sdk/src/query/progress.ts (progressTable handler).
- **`todo.match-phase`** — Read-only. Source: sdk/src/query/progress.ts (todoMatchPhase handler).
- **`stats.json`** — Read-only. Source: sdk/src/query/progress.ts (statsJson handler).
- **`stats.table`** — Read-only. Source: sdk/src/query/progress.ts (statsTable handler).
- **`list-todos`** — Read-only. Source: sdk/src/query/progress.ts (listTodos handler).

### Frontmatter reads

- **`frontmatter.get`** — Read-only. Source: sdk/src/query/frontmatter.ts (frontmatterGet handler).

### Verification reads

- **`verify.plan-structure`** — Read-only. Source: sdk/src/query/verify.ts (verifyPlanStructure handler).
- **`verify.phase-completeness`** — Read-only. Source: sdk/src/query/verify.ts (verifyPhaseCompleteness handler).
- **`verify.artifacts`** — Read-only. Source: sdk/src/query/verify.ts (verifyArtifacts handler).
- **`verify.commits`** — Read-only. Source: sdk/src/query/verify.ts (verifyCommits handler).
- **`verify.references`** — Read-only. Source: sdk/src/query/verify.ts (verifyReferences handler).
- **`verify.summary`** — Read-only. Source: sdk/src/query/verify.ts (verifySummary handler).
- **`verify.path-exists`** — Read-only. Source: sdk/src/query/verify.ts (verifyPathExists handler).
- **`verify.key-links`** — Read-only. Source: sdk/src/query/validate.ts (verifyKeyLinks handler).
- **`verify.schema-drift`** — Read-only. Source: sdk/src/query/verify.ts (verifySchemaDrift handler).
- **`validate.consistency`** — Read-only. Source: sdk/src/query/validate.ts (validateConsistency handler).
- **`validate.agents`** — Read-only. Source: sdk/src/query/validate.ts (validateAgents handler).

### Workstream reads

- **`workstream.get`** — Read-only. Source: sdk/src/query/workstream.ts (workstreamGet handler).
- **`workstream.list`** — Read-only. Source: sdk/src/query/workstream.ts (workstreamList handler).
- **`workstream.status`** — Read-only. Source: sdk/src/query/workstream.ts (workstreamStatus handler).

### Intel reads

- **`intel.status`** — Read-only. Source: sdk/src/query/intel.ts (intelStatus handler).
- **`intel.diff`** — Read-only. Source: sdk/src/query/intel.ts (intelDiff handler).
- **`intel.validate`** — Read-only. Source: sdk/src/query/intel.ts (intelValidate handler).
- **`intel.query`** — Read-only. Source: sdk/src/query/intel.ts (intelQuery handler).
- **`intel.extract-exports`** — Read-only. Source: sdk/src/query/intel.ts (intelExtractExports handler).
- **`intel.update`** — Read-only. Source: sdk/src/query/intel.ts (intelUpdate handler).

### Learnings reads

- **`learnings.list`** — Read-only. Source: sdk/src/query/profile.ts (learningsListHandler handler).
- **`learnings.query`** — Read-only. Source: sdk/src/query/profile.ts (learningsQuery handler).

### Generic reads

- **`generate-slug`** — Read-only. Source: sdk/src/query/utils.ts (generateSlug handler).
- **`current-timestamp`** — Read-only. Source: sdk/src/query/utils.ts (currentTimestamp handler).
- **`summary.extract`** — Read-only. Source: sdk/src/query/summary.ts (summaryExtract handler).
- **`history.digest`** — Read-only. Source: sdk/src/query/summary.ts (historyDigest handler).
- **`uat.render-checkpoint`** — Read-only. Source: sdk/src/query/uat.ts (uatRenderCheckpoint handler).
- **`audit.uat`** — Read-only. Source: sdk/src/query/uat.ts (auditUat handler).
- **`audit.open`** — Read-only. Source: sdk/src/query/audit-open.ts (auditOpen handler).
- **`detect-custom-files`** — Read-only. Source: sdk/src/query/detect-custom-files.ts (detectCustomFiles handler).
- **`config-gates`** — Read-only. Source: sdk/src/query/config-gates.ts (checkConfigGates handler).
- **`check-auto-mode`** — Read-only. Source: sdk/src/query/check-auto-mode.ts (checkAutoMode handler).
- **`phase.ready`** — Read-only. Source: sdk/src/query/phase-ready.ts (checkPhaseReady handler).
- **`route-next-action`** — Read-only. Source: sdk/src/query/route-next-action.ts (routeNextAction handler).
- **`detect-phase-type`** — Read-only. Source: sdk/src/query/detect-phase-type.ts (detectPhaseType handler).
- **`check-completion`** — Read-only. Source: sdk/src/query/check-completion.ts (checkCompletion handler).
- **`check-gates`** — Read-only. Source: sdk/src/query/check-gates.ts (checkGates handler).
- **`check-verification-status`** — Read-only. Source: sdk/src/query/check-verification-status.ts (checkVerificationStatus handler).
- **`check-ship-ready`** — Read-only. Source: sdk/src/query/check-ship-ready.ts (checkShipReady handler).
- **`websearch`** — Read-only. Source: sdk/src/query/websearch.ts (websearch handler).
- **`skills.list`** — Read-only. Source: sdk/src/query/skills.ts (skillsList handler).
- **`skill-manifest`** — Read-only. Source: sdk/src/query/skill-manifest.ts (skillManifest handler).
- **`extract-messages`** — Read-only. Source: sdk/src/query/profile.ts (extractMessages handler).
- **`scan-sessions`** — Read-only. Source: sdk/src/query/profile.ts (scanSessions handler).
- **`profile.sample`** — Read-only. Source: sdk/src/query/profile.ts (profileSample handler).
- **`profile.questionnaire`** — Read-only. Source: sdk/src/query/profile.ts (profileQuestionnaire handler).

### Composition (read-only bootstraps)

- **`init.execute-phase`** — Read-only. Source: sdk/src/query/init.ts (initExecutePhase handler).
- **`init.plan-phase`** — Read-only. Source: sdk/src/query/init.ts (initPlanPhase handler).
- **`init.new-project`** — Read-only. Source: sdk/src/query/init-complex.ts (initNewProject handler).
- **`init.new-milestone`** — Read-only. Source: sdk/src/query/init.ts (initNewMilestone handler).
- **`init.quick`** — Read-only. Source: sdk/src/query/init.ts (initQuick handler).
- **`init.resume`** — Read-only. Source: sdk/src/query/init.ts (initResume handler).
- **`init.verify-work`** — Read-only. Source: sdk/src/query/init.ts (initVerifyWork handler).
- **`init.phase-op`** — Read-only. Source: sdk/src/query/init.ts (initPhaseOp handler).
- **`init.todos`** — Read-only. Source: sdk/src/query/init.ts (initTodos handler).
- **`init.milestone-op`** — Read-only. Source: sdk/src/query/init.ts (initMilestoneOp handler).
- **`init.map-codebase`** — Read-only. Source: sdk/src/query/init.ts (initMapCodebase handler).
- **`init.new-workspace`** — Read-only. Source: sdk/src/query/init.ts (initNewWorkspace handler).
- **`init.list-workspaces`** — Read-only. Source: sdk/src/query/init.ts (initListWorkspaces handler).
- **`init.remove-workspace`** — Read-only. Source: sdk/src/query/init.ts (initRemoveWorkspace handler).
- **`init.ingest-docs`** — Read-only. Source: sdk/src/query/init.ts (initIngestDocs handler).
- **`init.progress`** — Read-only. Source: sdk/src/query/init-complex.ts (initProgress handler).
- **`init.manager`** — Read-only. Source: sdk/src/query/init-complex.ts (initManager handler).
- **`agent-skills`** — Read-only. Source: sdk/src/query/skills.ts (agentSkills handler).

---

## Classification Methodology

**Mutation set source:** The `QUERY_MUTATION_COMMANDS` Set constant at `sdk/src/query/index.ts` (lines 125–156 as of commit 8b590ea) is the single authoritative source. It explicitly lists every command that performs durable writes to disk, git, or global profile store. This constant is also used by the SDK's event emission system to fire mutation events after successful dispatch.

**Read-only set derivation:** Any handler registered in `createRegistry()` that is NOT in `QUERY_MUTATION_COMMANDS` is classified read-only. No guessing or inference — the mutation set is explicit and the read-only set is the complement.

**Normalization:** The registry accepts both dotted form (`state.update`) and space-delimited form (`state update`) for most commands. `QUERY_MUTATION_COMMANDS` lists the canonical dotted form; some space-form aliases are also included explicitly (e.g., `state planned-phase`, `state signal-waiting`). Downstream allowlist regex MUST match both forms via `state[. ]...` where relevant — see §Allowlist Feeds below.

---

## Allowlist Feeds

Mapping from read-only subcommand groups to regex entries in `vision-bash-allowlist.json`. Each group maps to one anchored pattern:

- **State reads** (`state.load`, `state.json`, `state.get`, `state.snapshot`) → `^gsd-sdk query state[. ](load|json|get|snapshot)( .*)?$`
- **state-project-load** → `^gsd-sdk query state-project-load( .*)?$`
- **Config reads** (`config.get`, `config.path`) → `^gsd-sdk query config[. ](get|path)( .*)?$`
- **resolve-model** → `^gsd-sdk query resolve-model( .*)?$`
- **Phase reads** (`find-phase`, `phase-plan-index`, `phases.list`, `phase.next-decimal`, `phase.list-plans`, `phase.list-artifacts`, `plan.task-structure`, `requirements.extract-from-plans`) → `^gsd-sdk query (find-phase|phase-plan-index|phases[. ]list|phase[. ]next-decimal|phase[. ]list-plans|phase[. ]list-artifacts|plan[. ]task-structure|requirements[. ]extract-from-plans)( .*)?$`
- **Roadmap reads** (`roadmap.analyze`, `roadmap.get-phase`) → `^gsd-sdk query roadmap[. ](analyze|get-phase)( .*)?$`
- **Progress reads** (`progress.json`, `progress.bar`, `progress.table`, `todo.match-phase`, `stats.json`, `stats.table`, `list-todos`) → `^gsd-sdk query (progress[. ]json|progress[. ]bar|progress[. ]table|stats[. ]json|stats[. ]table|todo[. ]match-phase|list-todos)( .*)?$`
- **frontmatter.get** → `^gsd-sdk query frontmatter[. ]get( .*)?$`
- **Verify reads** → `^gsd-sdk query verify[. ](plan-structure|phase-completeness|artifacts|commits|references|summary|path-exists|key-links|schema-drift)( .*)?$`
- **Validate reads** (`validate.consistency`, `validate.agents`) → `^gsd-sdk query validate[. ](consistency|agents)( .*)?$`
- **Workstream reads** → `^gsd-sdk query workstream[. ](get|list|status)( .*)?$`
- **Intel reads** → `^gsd-sdk query intel[. ](status|diff|validate|query|extract-exports|update)( .*)?$`
- **Learnings reads** → `^gsd-sdk query learnings[. ](list|query)( .*)?$`
- **Generic reads** (generate-slug, current-timestamp, summary.extract, etc.) → `^gsd-sdk query (generate-slug|current-timestamp|summary[. ]extract|history[. ]digest|uat[. ]render-checkpoint|audit[. ](uat|open)|detect-custom-files|config-gates|check-(auto-mode|completion|gates|verification-status|ship-ready)|phase[. ]ready|route-next-action|detect-phase-type|websearch|skills[. ]list|skill-manifest|extract-messages|scan-sessions|profile[. ](sample|questionnaire))( .*)?$`
- **init.* composition** → `^gsd-sdk query init[. ](execute-phase|plan-phase|new-project|new-milestone|quick|resume|verify-work|phase-op|todos|milestone-op|map-codebase|new-workspace|list-workspaces|remove-workspace|ingest-docs|progress|manager)( .*)?$`
- **agent-skills** → `^gsd-sdk query agent-skills( .*)?$`
