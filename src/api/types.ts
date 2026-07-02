/**
 * Public type surface for the wasm-icare SDK.
 *
 * These describe the v2 API shape (camelCase options, polymorphic `DataInput`).
 * Input-handling and output-marshalling live in later phases; the result types
 * here are intentionally loose in Phase 0 and get tightened in Phases 3/5.
 */

// --- Input sources ----------------------------------------------------------

/** A fetchable URL source (browser or Node). */
export interface UrlInput {
  url: string | URL;
}

/** A filesystem path source (Node). */
export interface PathInput {
  path: string;
}

/** In-memory columnar table: named columns of typed arrays or string[]. */
export interface ColumnarTable {
  columns: Record<string, Float64Array | Int32Array | number[] | string[]>;
}

/** Least-efficient in-memory form (columnarized JS-side before transfer). */
export type RowTable = Array<Record<string, unknown>>;

/**
 * An `apache-arrow` `Table` (minimal structural view — no static dependency on
 * the optional `apache-arrow` package). Crosses to Python as Arrow IPC bytes and
 * is rebuilt with `pyarrow`, which must be loaded via
 * `loadICARE({ packages: ['pyarrow'] })`.
 */
export interface ArrowTable {
  schema: unknown;
  numRows: number;
}

/**
 * A tabular dataset argument. Accepts every supported form; the input
 * normalizer resolves each to a Pyodide FS file or a Python object. `File` is
 * structurally a `Blob`, so it is covered by the `Blob` member.
 */
export type TabularInput = UrlInput | PathInput | ColumnarTable | RowTable | Blob | ArrowTable;

/** A Patsy covariate formula: inline text, or a file source. */
export type FormulaInput = string | UrlInput | PathInput | Blob;

/** Log relative risks (log odds ratios): an inline mapping, or a JSON source. */
export type LogOddsRatiosInput = Record<string, number> | UrlInput | PathInput | Blob;

/** The broad union referenced by "every dataset arg accepts a DataInput". */
export type DataInput = TabularInput | FormulaInput | LogOddsRatiosInput;

// --- Scalar/param helpers ---------------------------------------------------

/** A single age/length or a per-instance array. */
export type AgeSpec = number | number[];

/** Validation window: the full follow-up, or N years after entry. */
export type PredictedRiskInterval = 'total-followup' | number | number[];

// --- Operation option objects (camelCase; map to snake_case in params.ts) ---

export interface ComputeAbsoluteRiskOptions {
  applyAgeStart: AgeSpec;
  applyAgeIntervalLength: AgeSpec;
  modelDiseaseIncidenceRates: TabularInput;
  modelCompetingIncidenceRates?: TabularInput;
  modelCovariateFormula?: FormulaInput;
  modelLogRelativeRisk?: LogOddsRatiosInput;
  modelReferenceDataset?: TabularInput;
  modelReferenceDatasetWeightsVariableName?: string;
  modelSnpInfo?: TabularInput;
  modelFamilyHistoryVariableName?: string;
  numImputations?: number;
  applyCovariateProfile?: TabularInput;
  applySnpProfile?: TabularInput;
  returnLinearPredictors?: boolean;
  returnReferenceRisks?: boolean;
  seed?: number;
}

export interface ComputeAbsoluteRiskSplitIntervalOptions {
  applyAgeStart: AgeSpec;
  applyAgeIntervalLength: AgeSpec;
  modelDiseaseIncidenceRates: TabularInput;
  modelCompetingIncidenceRates?: TabularInput;
  modelCovariateFormulaBeforeCutpoint?: FormulaInput;
  modelCovariateFormulaAfterCutpoint?: FormulaInput;
  modelLogRelativeRiskBeforeCutpoint?: LogOddsRatiosInput;
  modelLogRelativeRiskAfterCutpoint?: LogOddsRatiosInput;
  modelReferenceDatasetBeforeCutpoint?: TabularInput;
  modelReferenceDatasetAfterCutpoint?: TabularInput;
  modelReferenceDatasetWeightsVariableNameBeforeCutpoint?: string;
  modelReferenceDatasetWeightsVariableNameAfterCutpoint?: string;
  modelSnpInfo?: TabularInput;
  modelFamilyHistoryVariableNameBeforeCutpoint?: string;
  modelFamilyHistoryVariableNameAfterCutpoint?: string;
  applyCovariateProfileBeforeCutpoint?: TabularInput;
  applyCovariateProfileAfterCutpoint?: TabularInput;
  applySnpProfile?: TabularInput;
  cutpoint?: AgeSpec;
  numImputations?: number;
  returnLinearPredictors?: boolean;
  returnReferenceRisks?: boolean;
  seed?: number;
}

/**
 * The nested `icareModelParameters` argument of `validateAbsoluteRiskModel`.
 * Its keys are the `compute_absolute_risk` parameters; in a validation call the
 * age arguments are usually omitted (derived from the study data), so every key
 * is optional here.
 */
export type IcareModelParameters = Partial<ComputeAbsoluteRiskOptions>;

export interface ValidateAbsoluteRiskModelOptions {
  studyData: TabularInput;
  predictedRiskInterval: PredictedRiskInterval;
  icareModelParameters?: IcareModelParameters;
  predictedRiskVariableName?: string;
  linearPredictorVariableName?: string;
  referenceEntryAge?: AgeSpec;
  referenceExitAge?: AgeSpec;
  referencePredictedRisks?: number[];
  referenceLinearPredictors?: number[];
  numberOfPercentiles?: number;
  linearPredictorCutoffs?: number[];
  datasetName?: string;
  modelName?: string;
  seed?: number;
}

// --- Results (tightened in Phase 3 for compute; validation stays loose) ------

/** A marshalled pandas Categorical column: integer codes + ordered category labels. */
export interface CategoricalColumn {
  /** Per-row index into `categories`; `-1` marks a missing value. */
  codes: Int32Array;
  /** Ordered category labels (e.g. Interval strings like `"(-0.12, 0.34]"`). */
  categories: string[];
}

/**
 * A marshalled DataFrame: named columns (numeric columns as typed arrays; string
 * columns as `string[]`; a pandas Categorical as a {@link CategoricalColumn}), the
 * original column order, and the row count. Numeric columns are `Float64Array` for
 * float data and `number[]` for integer data.
 */
export interface ColumnarTableResult {
  columns: Record<string, Float64Array | number[] | string[] | CategoricalColumn>;
  order: string[];
  nRows: number;
}

/** One reference-population risk interval (present when `returnReferenceRisks`). */
export interface ReferenceRiskInterval {
  ageIntervalStart: number;
  ageIntervalEnd: number;
  populationRisks: Float64Array;
}

export interface AbsoluteRiskResult {
  /** Design-matrix column name → fitted log relative-risk (beta). */
  model: Record<string, number>;
  /** Per-subject results: `risk_estimates`, `linear_predictors` (if requested), etc. */
  profile: ColumnarTableResult;
  /** Reference-population risks per age interval (if `returnReferenceRisks`). */
  referenceRisks?: ReferenceRiskInterval[];
  method: string;
}

/** Per-side fitted betas when a split interval uses distinct pre/post-cutpoint models. */
export interface SplitModel {
  beforeCutpoint: Record<string, number>;
  afterCutpoint: Record<string, number>;
}

/** Per-side reference-population risks for a split interval. */
export interface SplitReferenceRisks {
  beforeCutpoint: ReferenceRiskInterval[];
  afterCutpoint: ReferenceRiskInterval[];
}

export interface SplitIntervalResult {
  /**
   * Nested per-side betas when a cutpoint splits the interval; a flat
   * `{ feature: beta }` map on the degrade path (no cutpoint / after-* params).
   */
  model: SplitModel | Record<string, number>;
  /**
   * Per-subject combined results: `id`, `age_interval_start`, `cutpoint`,
   * `age_interval_end`, `age_interval_length`, `risk_estimates`, the two
   * `linear_predictors_*_cutpoint` columns (if requested), then covariates.
   */
  profile: ColumnarTableResult;
  /** Nested per-side reference risks when split; a flat array on the degrade path. */
  referenceRisks?: SplitReferenceRisks | ReferenceRiskInterval[];
  method: string;
}

// --- Validation result -------------------------------------------------------

/** The follow-up window + naming echoed back by validation. */
export interface ValidationInfo {
  riskPredictionInterval: string;
  datasetName: string;
  modelName: string;
}

/** AUC with its variance and confidence interval. */
export interface AucMetric {
  auc: number;
  variance: number;
  lowerCi: number;
  upperCi: number;
}

/** Brier score with its variance and confidence interval. */
export interface BrierScoreMetric {
  brierScore: number;
  variance: number;
  lowerCi: number;
  upperCi: number;
}

/** Overall expected/observed ratio with its confidence interval. */
export interface ExpectedByObservedRatio {
  ratio: number;
  lowerCi: number;
  upperCi: number;
}

/** A goodness-of-fit test (Hosmer-Lemeshow for absolute risk; GOF for relative risk). */
export interface GoodnessOfFitTest {
  method: string;
  pValue: number;
  /** The test's variance matrix (row-major). */
  variance: number[][];
  statistic: { chiSquare: number };
  parameter: { degreesOfFreedom: number };
}

/** Absolute- and relative-risk calibration tests. */
export interface Calibration {
  absoluteRisk: GoodnessOfFitTest;
  relativeRisk: GoodnessOfFitTest;
}

/** Reference-population absolute risks + risk scores (present only if supplied/computed). */
export interface ValidationReference {
  absoluteRisk: number[];
  riskScore: number[];
}

export interface ValidationResult {
  info: ValidationInfo;
  auc: AucMetric;
  brierScore: BrierScoreMetric;
  expectedByObservedRatio: ExpectedByObservedRatio;
  calibration: Calibration;
  /** Per-category calibration table (`category` + observed/predicted/CI columns). */
  categorySpecificCalibration: ColumnarTableResult;
  /**
   * Per-subject study data with validation columns added, including the
   * `linear_predictors_category` {@link CategoricalColumn}.
   */
  studyData: ColumnarTableResult;
  /** Study vs. population incidence rates by age. */
  incidenceRates: ColumnarTableResult;
  /** Reference-population risks (present only when reference risks are supplied/computed). */
  reference?: ValidationReference;
  method: string;
}

// --- Fit-once model (build → apply / applyBatches) ---------------------------

/**
 * Model arguments for {@link ICARE.buildAbsoluteRiskModel} — the profile-independent (fit-once)
 * subset of `computeAbsoluteRisk`. This path fits a general-purpose covariate model, so the covariate
 * trio (formula, log relative risks, reference dataset) is required; the SNP option is not supported
 * here (use `computeAbsoluteRisk` for SNP models).
 */
export interface BuildAbsoluteRiskModelOptions {
  modelDiseaseIncidenceRates: TabularInput;
  modelCovariateFormula: FormulaInput;
  modelLogRelativeRisk: LogOddsRatiosInput;
  modelReferenceDataset: TabularInput;
  modelCompetingIncidenceRates?: TabularInput;
  modelReferenceDatasetWeightsVariableName?: string;
  numImputations?: number;
  seed?: number;
}

/** Apply a fitted model to one covariate profile batch (parity with a single `computeAbsoluteRisk`). */
export interface ApplyProfileOptions {
  applyAgeStart: AgeSpec;
  applyAgeIntervalLength: AgeSpec;
  applyCovariateProfile: TabularInput;
  returnLinearPredictors?: boolean;
  returnReferenceRisks?: boolean;
}

/**
 * A stream of covariate profile batches for {@link AbsoluteRiskModelHandle.applyBatches}: either one
 * in-memory {@link ColumnarTable} (sliced into `batchRows`-row chunks SDK-side) or an (async) iterable
 * of columnar batches supplied by the caller.
 */
export type ProfileBatchSource =
  | ColumnarTable
  | Iterable<ColumnarTable>
  | AsyncIterable<ColumnarTable>;

/** Streaming apply options. Ages are scalars applied to every row in every batch. */
export interface ApplyBatchesOptions {
  applyAgeStart: number;
  applyAgeIntervalLength: number;
  /**
   * Rows per batch when `source` is a single {@link ColumnarTable} sliced SDK-side (default 100_000).
   * Ignored when `source` is already an (async) iterable of batches.
   */
  batchRows?: number;
  returnLinearPredictors?: boolean;
}

/** Lean per-batch result: just the numeric result columns (+ ids) so peak heap stays ≈ one batch. */
export interface ApplyBatchResult {
  /** The batch's `id` values — string ids if it carried an `id` column, else the row-index fallback. */
  ids?: string[] | number[];
  riskEstimates: Float64Array;
  linearPredictors?: Float64Array;
  nRows: number;
}

/**
 * A fit-once absolute-risk model resident in Python: the reference dataset was read (and the baseline
 * hazard fitted) once at build time. Apply it to many profile batches without re-fitting; call
 * {@link AbsoluteRiskModelHandle.free} when done.
 */
export interface AbsoluteRiskModelHandle {
  /** Design-matrix column name → fitted log relative-risk (beta), from the one-time fit. */
  readonly model: Record<string, number>;
  /** Apply the fitted model to one covariate profile batch; returns the full {@link AbsoluteRiskResult}. */
  apply(options: ApplyProfileOptions): Promise<AbsoluteRiskResult>;
  /** Stream many profile batches through the fitted model, yielding a lean numeric result per batch. */
  applyBatches(
    source: ProfileBatchSource,
    options: ApplyBatchesOptions,
  ): AsyncIterable<ApplyBatchResult>;
  /** Release the resident model in Python. Idempotent. */
  free(): Promise<void>;
}

// --- Runtime / loader --------------------------------------------------------

/** Options for `loadICARE` (fully specified across Phases 2/7/8). */
export interface LoadICAREOptions {
  /** Base URL of a self-hosted Pyodide distribution. */
  indexURL?: string;
  /** Override URL for the pyicare wheel (defaults to the vendored snapshot). */
  pyicareWheelUrl?: string;
  /** Disable any PyPI/micropip fallback (fully offline). */
  offline?: boolean;
  /** Extra Pyodide packages to load (e.g. `['pyarrow']`). */
  packages?: string[];
  /** Run the engine in a Web Worker (browser default true). */
  useWorker?: boolean;
  /** Custom worker entry URL. */
  workerUrl?: string | URL;
}

/** The loaded SDK handle returned by `loadICARE`. */
export interface ICARE {
  computeAbsoluteRisk(options: ComputeAbsoluteRiskOptions): Promise<AbsoluteRiskResult>;
  computeAbsoluteRiskSplitInterval(
    options: ComputeAbsoluteRiskSplitIntervalOptions,
  ): Promise<SplitIntervalResult>;
  validateAbsoluteRiskModel(
    options: ValidateAbsoluteRiskModelOptions,
  ): Promise<ValidationResult>;
  /**
   * Fit a reusable model once (the reference dataset is read a single time), then apply it to many
   * covariate profile batches via the returned handle — the streaming / large-dataset path.
   * Covariate models only; use `computeAbsoluteRisk` for SNP models.
   */
  buildAbsoluteRiskModel(
    options: BuildAbsoluteRiskModelOptions,
  ): Promise<AbsoluteRiskModelHandle>;
  /** Release the Pyodide runtime and any workers. */
  close(): Promise<void>;
}
