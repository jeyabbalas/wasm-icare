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
 * A tabular dataset argument. Accepts every supported form; the input
 * normalizer (Phase 4) resolves each to a Pyodide FS file or a Python object.
 * `File` is structurally a `Blob`, so it is covered by the `Blob` member.
 */
export type TabularInput = UrlInput | PathInput | ColumnarTable | RowTable | Blob;

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

/**
 * A marshalled DataFrame: named columns (numeric columns as typed arrays; string
 * columns as `string[]`), the original column order, and the row count. Numeric
 * columns are `Float64Array` for float data and `number[]` for integer data.
 */
export interface ColumnarTableResult {
  columns: Record<string, Float64Array | number[] | string[]>;
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

export interface ValidationResult {
  method: string;
  [key: string]: unknown;
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
  ): Promise<AbsoluteRiskResult>;
  validateAbsoluteRiskModel(
    options: ValidateAbsoluteRiskModelOptions,
  ): Promise<ValidationResult>;
  /** Release the Pyodide runtime and any workers. */
  close(): Promise<void>;
}
