/**
 * @fides-anima/fpp-enforcement-core — harness-agnostic enforcement engines
 * for the Freedom Preserving Protocol.
 */

export const PACKAGE_NAME = "@fides-anima/fpp-enforcement-core" as const;
export const PACKAGE_VERSION = "1.0.3" as const;

export {
  CLASSIFICATION_IDS,
  classifyToolCall,
  normalizeOpenClawToolName,
  type ClassificationId,
  type ClassificationResult,
  type Decision,
} from "./risk-classifier.js";

export {
  buildActionDescriptor,
  extractApplyPatchTargets,
  type EnforcementActionDescriptor,
  type ToolCallLike,
} from "./action-descriptor.js";

export {
  consumeStewardOperatorCoverage,
  isOperatorMandateId,
  lookupStewardOperatorCoverage,
  operatorAuthorizationIdFromMandateId,
  type StewardCoverageEvidence,
  type StewardCoverageLookup,
} from "./steward-coverage.js";

export {
  isReversibleClassification,
  requiresRecoveryProof,
} from "./reversibility.js";

export {
  createWorkspaceTrashRecovery,
  measureTreeBytes,
  type RecoveryProof,
  type RecoveryProvider,
  type RecoveryRequest,
  type WorkspaceTrashRecoveryOptions,
} from "./recovery.js";

export {
  createWorkspaceContainmentResolver,
  normalizePathSeparators,
  realpathDeep,
  type ContainmentResolver,
  type ContainmentVerdict,
  type WorkspaceContainmentOptions,
} from "./workspace-containment.js";

export {
  FileLockTimeoutError,
  lockPathFor,
  withFileLock,
  writeFileAtomic,
  type FileLockOptions,
} from "./file-lock.js";

export {
  DEFAULT_CONFIG,
  diagnoseConfigSafety,
  mergeConfig,
  mergeConfigWithDiagnostics,
  type ConfigDiagnostic,
  type ConfigDiagnosticSeverity,
  type DispositionMode,
  type FppPluginConfig,
  type MergeConfigResult,
  CONSERVATIVE_STRICT_APPROVAL_ON,
} from "./config.js";

export {
  assertConfigPathAllowed,
  type AssertConfigPathOptions,
} from "./config-path.js";

export {
  resolveDisposition,
  type DispositionResult,
  type LiveMandateCoverage,
  type ResolveDispositionInput,
} from "./disposition-engine.js";

export {
  MandateStore,
  type MandateDiagnostic,
  type MandateLedgerEntry,
  type MandateStoreFile,
  type MandateStoreOptions,
} from "./mandate-store.js";

export {
  EmergencyOverrideStore,
  isIssuerKeyBound,
  type AdmitOptions,
  type AdmitResult,
  type EmergencyCoverageResult,
  type EmergencyOverrideLedgerEntry,
  type EmergencyOverrideRejectReason,
  type EmergencyOverrideStoreFile,
  type EmergencyOverrideStoreOptions,
  type FindEmergencyCoverageOptions,
  type StewardKeyBindings,
} from "./emergency-override-store.js";

export {
  appendEnforcementEntry,
  appendMandateIntegrityDiagnostic,
  AuditCorruptionError,
  MANDATE_INTEGRITY_CLASSIFICATION,
  type EnforcementEvent,
  type EnforcementOutcome,
} from "./audit-log.js";

export {
  ReceiptStore,
  digestActionParams,
  ALLOWED_ORPHAN_OUTCOMES,
  type AllowedOrphanOutcome,
  type PendingReceiptRecord,
  type ReceiptStoreOptions,
} from "./receipt-store.js";

export {
  loadReceiptSigner,
  signReceiptPayload,
  verifyReceiptSignature,
  type ReceiptSigner,
  type SignedReceipt,
} from "./receipt-signer.js";

export {
  appendSignedReceipt,
  ReceiptLogCorruptionError,
  verifyReceiptLog,
  collectReceiptLeaves,
  createReceiptProof,
  createReceiptInclusionEvidence,
  RECEIPT_LOG_KIND,
  type ReceiptLogEntry,
  type ReceiptLogVerifyReport,
  type ReceiptMerkleProof,
} from "./receipt-log.js";

export {
  StagedActionLedger,
  type RegisterStagedInput,
  type StagedActionRecord,
  type StagedActionStatus,
} from "./staged-actions.js";
export { EmergencyReviewLedger } from "./emergency-review.js";

export {
  DEFAULT_PACKAGE_BUILD,
  buildRuntimeManifest,
  computeClassifierRulesetHash,
  computeEffectiveConfigHash,
  computePackageBuildHash,
  type PackageBuildInput,
  type RuntimeManifest,
} from "./runtime-manifest.js";

export {
  computeCoverageMetrics,
  capsuleCoverageFromMetrics,
  COVERAGE_METRIC_VERSION,
  type CoverageMetrics,
  type CoverageInput,
  type CompletenessLabel,
} from "./coverage-metrics.js";

export {
  createEnforcementRuntime,
  legacyDecisionFromDisposition,
  TransitionReceiptPersistenceError,
  type EnforcementRuntime,
  type EnforcementRuntimeOptions,
  type FppApprovalDecision,
  type FppApprovalRequest,
  type FppBeforeToolCallResult,
  type FppRuntimeAdapter,
  type FppToolCallContext,
  type FppToolCallEvent,
  type FppWorkspacePaths,
  type TransitionReceiptPersistenceRecord,
  type TransitionReceiptReconciliationResult,
} from "./runtime-adapter.js";
