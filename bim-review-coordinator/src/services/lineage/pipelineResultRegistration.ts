// bim-review-coordinator/src/services/lineage/pipelineResultRegistration.ts
//
// Result registration application service（rvt-ifc-usdc-lineage task 3.3 收尾刀）。
//
// PR #686 把 `PipelineResultStore.registerResult()` 落地卻**零生產呼叫點**：
// 「result manifest 從 MinIO 讀進來 → 驗證 → 變 AVAILABLE」這條線完全沒接。本檔就是
// 那條線的 application seam —— composition root 建構它、task 4.1／4.5 的 attempt
// 完成路徑呼叫它。
//
// **邊界**（刻意不做的事）：
//   * 不開任何 HTTP route、不定 streaming wire contract（屬 task 4.1／4.5）。
//   * 不重做 replay 冪等與 different-digest conflict —— 那是
//     `PipelineResultStore.registerResult()` 的語意，store error 原樣向上拋，
//     不在本層翻譯成第二套詞彙（會變成兩個會漂移的權威）。
//   * 不碰 `ObjectStorePort`、不碰 legacy `/api/external/ifc-ready*`。
//   * referenced artifacts 只做 **head-level** 觀測（存在性＋ETag＋size）；全量流式
//     sha256 深驗的成本裁決屬後續 slice（詳 `observeReferencedArtifacts` 的誠實注記）。
//
// **權威分工**：
//   * manifest（MinIO 實讀 bytes）擁有 identity、`attempt_outcome`、`result_prefix`；
//   * attempt 文件（`tests/contracts/pipeline_job_attempt.json` 的 `$defs/attempt`，
//     owner 為 bim-streaming-server）擁有 `attempt_number` 與 `completed_at` ——
//     manifest 契約沒有這兩個欄位，所以只能由呼叫端交進來，不得由 manifest 硬湊；
//   * `publication_state` 由本服務**導出**為 `AVAILABLE`：它的定義就是「formal result
//     的 bytes 已可在不可變 locator 上讀到並通過完整性驗證」，而那正是抵達這一行的前提。
import type { StructLogger } from "../../lib/structLog.js";
import type { MinioLocator } from "./minioLocator.js";
import {
  locatorExpectation,
  observeReferencedArtifacts,
  readPipelineResultManifest,
  type PipelineResultManifest,
  type PipelineResultManifestReadDeps,
} from "./pipelineResultManifest.js";
import type {
  PipelineResultStore,
  RegisterPipelineResultInput,
  RegisterPipelineResultOutcome,
} from "./pipelineResultStore.js";

const LOG_COMPONENT = "pipeline-result-registration";

/**
 * 呼叫端對這份 result 的期望 identity。
 *
 * 全部五欄都會與 manifest **逐欄**比對：manifest 是實讀事實，期望值是派工脈絡，
 * 兩者不符代表這份 manifest 不是這個 attempt 的結果，必須在寫進 store 之前擋掉。
 */
export interface ExpectedPipelineResultIdentity {
  result_id: string;
  attempt_id: string;
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
}

/** attempt 文件（streaming-owned）帶來、manifest 契約沒有的兩個欄位。 */
export interface PipelineResultAttemptContext {
  /** `$defs/attempt.attempt_number`（>= 1）。 */
  attempt_number: number;
  /** `$defs/attempt.completed_at`；已完成的 attempt 才會有 result manifest。 */
  completed_at: string;
}

export interface RegisterPipelineResultFromManifestInput {
  /** governed result-manifest locator（claim 入口；MinIO 實讀才是權威）。 */
  manifest_locator: MinioLocator;
  expected_identity: ExpectedPipelineResultIdentity;
  attempt: PipelineResultAttemptContext;
  /** 呼叫端時鐘；store 從不讀 wall time。 */
  now: string;
  /** publication／attempt 的 correlation id，會進 first-activation audit。 */
  correlation_id: string;
}

export interface RegisterPipelineResultFromManifestOutcome {
  /** `PipelineResultStore.registerResult()` 的原樣結果（含 replay 與 activation）。 */
  registration: RegisterPipelineResultOutcome;
  /** 已通過契約驗證的 manifest（呼叫端不必為了 publication 再讀一次 MinIO）。 */
  manifest: PipelineResultManifest;
  /** 實讀 bytes 的 SHA-256，即寫進 store 的 `result_manifest_digest`。 */
  observed_manifest_sha256: string;
}

/**
 * manifest 的 identity 與呼叫端期望不符。
 *
 * 與 `PipelineResultManifestReadError` 分開：讀取／完整性失敗說的是「這份 bytes 有問題」，
 * 這個說的是「這份 bytes 沒問題，但它不是你要的那個 result」。兩者的處置完全不同
 * （前者重試或告警，後者是派工脈絡錯了）。
 */
export class PipelineResultIdentityMismatchError extends Error {
  readonly code = "result_manifest_identity_mismatch";

  constructor(
    readonly field: keyof ExpectedPipelineResultIdentity,
    readonly expected: string,
    readonly observed: string,
  ) {
    super(
      `result manifest ${field} ${observed} does not match the expected ${expected}`,
    );
    this.name = "PipelineResultIdentityMismatchError";
  }
}

export interface PipelineResultRegistrationDeps extends PipelineResultManifestReadDeps {
  results: PipelineResultStore;
  structLog?: StructLogger;
}

export interface PipelineResultRegistrationService {
  registerFromManifest(
    input: RegisterPipelineResultFromManifestInput,
  ): Promise<RegisterPipelineResultFromManifestOutcome>;
}

/** identity 逐欄比對；第一個不符即擲錯（欄位順序固定，錯誤可預期）。 */
function assertIdentityMatches(
  manifest: PipelineResultManifest,
  expected: ExpectedPipelineResultIdentity,
): void {
  const pairs: Array<[keyof ExpectedPipelineResultIdentity, string]> = [
    ["result_id", manifest.result_id],
    ["attempt_id", manifest.attempt_id],
    ["pipeline_job_id", manifest.pipeline_job_id],
    ["source_bundle_id", manifest.source_bundle_id],
    ["external_model_version_id", manifest.external_model_version_id],
  ];
  for (const [field, observed] of pairs) {
    if (observed !== expected[field]) {
      throw new PipelineResultIdentityMismatchError(field, expected[field], observed);
    }
  }
}

/**
 * 建立 result registration service。
 *
 * deps 只有兩個 seam：governed MinIO 讀取面與 result store。刻意不注入時鐘 ——
 * `now` 由呼叫端隨每次註冊交進來，與 store 的「從不讀 wall time」同一紀律。
 */
export function createPipelineResultRegistrationService(
  deps: PipelineResultRegistrationDeps,
): PipelineResultRegistrationService {
  return {
    async registerFromManifest(
      input: RegisterPipelineResultFromManifestInput,
    ): Promise<RegisterPipelineResultFromManifestOutcome> {
      // 1. locator 自洽 → HEAD → 有界讀 → digest 重算 → 契約解析。
      //    任何一關失敗都是 typed `PipelineResultManifestReadError`，原樣向上拋。
      const read = await readPipelineResultManifest(
        locatorExpectation(input.manifest_locator),
        { objects: deps.objects },
      );

      // 2. identity 逐欄比對（manifest 合格 ≠ 這份 manifest 屬於這個 attempt）。
      assertIdentityMatches(read.manifest, input.expected_identity);

      // 3. referenced artifacts 的 head-level 實體觀測（design.md §5）。
      //    少了這一步，「manifest 完好但 USDC 已被刪／改寫」的 result 會被誤判為 AVAILABLE。
      //    必須在 `registerResult()` **之前**：一旦進 store 就是不可變的 formal result。
      await observeReferencedArtifacts(read.manifest, { objects: deps.objects });

      // 4. 組 store 輸入。identity／outcome／prefix 一律取 manifest 實讀值；
      //    attempt_number 與 completed_at 取 attempt 文件；digest 取實讀 SHA-256。
      //    `result_prefix` 與 `result_manifest_ref` 的 attempt-scoped 關係由
      //    store 的 `validateResultLocation` 判定（不在此重做第二套檢查）。
      const registerInput: RegisterPipelineResultInput = {
        result_id: read.manifest.result_id,
        attempt_id: read.manifest.attempt_id,
        pipeline_job_id: read.manifest.pipeline_job_id,
        source_bundle_id: read.manifest.source_bundle_id,
        external_model_version_id: read.manifest.external_model_version_id,
        attempt_number: input.attempt.attempt_number,
        result_prefix: read.manifest.result_prefix,
        result_manifest_ref: input.manifest_locator.ref,
        result_manifest_digest: read.observed_sha256,
        attempt_outcome: read.manifest.attempt_outcome,
        // 讀得到、驗得過 = AVAILABLE。failed／cancelled 的 audit-only manifest 同樣
        // 是 AVAILABLE，但 `isSelectableResult` 會擋掉它的 activation —— publication
        // 與 selection 是兩條互不覆蓋的軸（契約 `$defs/attempt` 的 selectable matrix）。
        publication_state: "AVAILABLE",
        completed_at: input.attempt.completed_at,
        now: input.now,
        correlation_id: input.correlation_id,
      };

      // 5. 唯一寫入點。replay 冪等／attempt 已綁他 result／revision 衝突都由 store 判。
      const registration = deps.results.registerResult(registerInput);

      deps.structLog?.info(LOG_COMPONENT, "formal result registered from manifest", {
        pipeline_job_id: registration.result.pipeline_job_id,
        result_id: registration.result.result_id,
        attempt_id: registration.result.attempt_id,
        attempt_outcome: registration.result.attempt_outcome,
        publication_state: registration.result.publication_state,
        selection_state: registration.result.selection_state,
        replay: registration.replay,
        auto_activated: registration.activation_audit_entry !== null,
      });

      return {
        registration,
        manifest: read.manifest,
        observed_manifest_sha256: read.observed_sha256,
      };
    },
  };
}
