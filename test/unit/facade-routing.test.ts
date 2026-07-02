import { describe, expect, test } from 'vitest';

import { createICARE, type InputMaterializer } from '../../src/api/icareFacade';
import { isColumnarInput } from '../../src/io/guards';
import type { EngineClient } from '../../src/worker/transport';

/**
 * A stub engine client that records the last `run` call and returns an empty result.
 * Its methods return values synchronously; the facade `await`s them, which resolves
 * a plain value just as it would a Promise — so no async wrapping is needed here.
 */
function makeEngine() {
  const calls: Array<{
    op: string;
    kwargs: Record<string, unknown>;
    frames: Record<string, unknown> | null | undefined;
  }> = [];
  const emptyFrame = { columns: {}, order: [], nRows: 0 };
  const gof = {
    method: 'stub',
    p_value: 1,
    variance: [[0]],
    statistic: { chi_square: 0 },
    parameter: { degrees_of_freedom: 0 },
  };
  const modelCalls = {
    build: [] as Array<{ kwargs: Record<string, unknown>; frames: Record<string, unknown> | null }>,
    apply: [] as Array<{
      handle: number;
      kwargs: Record<string, unknown>;
      frames: Record<string, unknown> | null;
    }>,
    free: [] as number[],
  };
  const engine = {
    run(op: string, kwargs: Record<string, unknown>, frames?: Record<string, unknown> | null) {
      calls.push({ op, kwargs, frames });
      if (op === 'validate') {
        // A minimal validation-shaped result so shapeValidationResult succeeds.
        return {
          info: { risk_prediction_interval: 'total-followup', dataset_name: 'd', model_name: 'm' },
          study_data: emptyFrame,
          incidence_rates: emptyFrame,
          category_specific_calibration: emptyFrame,
          auc: { auc: 0, variance: 0, lower_ci: 0, upper_ci: 0 },
          brier_score: { brier_score: 0, variance: 0, lower_ci: 0, upper_ci: 0 },
          expected_by_observed_ratio: { ratio: 0, lower_ci: 0, upper_ci: 0 },
          calibration: { absolute_risk: gof, relative_risk: gof },
          method: 'stub',
        };
      }
      return { model: {}, profile: emptyFrame, method: 'stub' };
    },
    buildModel(kwargs: Record<string, unknown>, frames?: Record<string, unknown> | null) {
      modelCalls.build.push({ kwargs, frames: frames ?? null });
      return { handle: 7, model: { Intercept: 0, x: 0.5 } };
    },
    applyModel(handle: number, kwargs: Record<string, unknown>, frames?: Record<string, unknown> | null) {
      modelCalls.apply.push({ handle, kwargs, frames: frames ?? null });
      return {
        model: {},
        profile: {
          columns: {
            id: ['a', 'b'],
            risk_estimates: new Float64Array([0.1, 0.2]),
            linear_predictors: new Float64Array([1.1, 1.2]),
          },
          order: ['id', 'risk_estimates', 'linear_predictors'],
          nRows: 2,
        },
        method: 'stub',
      };
    },
    freeModel(handle: number) {
      modelCalls.free.push(handle);
    },
    async close() {},
  } as unknown as EngineClient;
  return { engine, calls, modelCalls };
}

/** Minimal required build args (covariate trio + disease rates), reference as a {path} kwarg. */
const BUILD_ARGS = {
  modelDiseaseIncidenceRates: { path: 'inc.csv' },
  modelCovariateFormula: 'y ~ x',
  modelLogRelativeRisk: { x: 0.5 },
  modelReferenceDataset: { path: 'ref.csv' },
} as const;

/** A materializer that routes columnar tables to a frame, everything else to a kwarg. */
const materialize: InputMaterializer = async (input, _kind, jsName) => {
  if (isColumnarInput(input)) {
    return { via: 'frame', frame: { columns: { c: [1] }, dtypes: { c: 'i8' } } };
  }
  return { via: 'kwarg', value: `resolved:${jsName}` };
};

describe('facade input routing — kwargs vs frames', () => {
  test('a columnar input goes to frames[py_name] and is absent from kwargs', async () => {
    const { engine, calls } = makeEngine();
    const icare = createICARE(engine, materialize);

    await icare.computeAbsoluteRisk({
      applyAgeStart: 1,
      applyAgeIntervalLength: 1,
      modelDiseaseIncidenceRates: { path: 'inc.csv' },
      modelCovariateFormula: 'y ~ x',
      modelLogRelativeRisk: { a: 1 },
      modelReferenceDataset: { columns: { c: [1] } },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.op).toBe('compute');

    // Scalars pass through; path/inline inputs are kwargs under snake_case _path names.
    expect(call.kwargs.apply_age_start).toBe(1);
    expect(call.kwargs.model_disease_incidence_rates_path).toBe('resolved:modelDiseaseIncidenceRates');
    expect(call.kwargs.model_covariate_formula_path).toBe('resolved:modelCovariateFormula');
    expect(call.kwargs.model_log_relative_risk_path).toBe('resolved:modelLogRelativeRisk');

    // The columnar input is a frame keyed by py-name, NOT a kwarg.
    expect(call.kwargs).not.toHaveProperty('model_reference_dataset_path');
    expect(call.frames).toEqual({
      model_reference_dataset_path: { columns: { c: [1] }, dtypes: { c: 'i8' } },
    });
  });

  test('with no frame inputs, frames is null', async () => {
    const { engine, calls } = makeEngine();
    const icare = createICARE(engine, materialize);

    await icare.computeAbsoluteRisk({
      applyAgeStart: 1,
      applyAgeIntervalLength: 1,
      modelDiseaseIncidenceRates: { path: 'inc.csv' },
      modelReferenceDataset: { path: 'ref.csv' },
    });

    const call = calls[0]!;
    expect(call.frames).toBeNull();
    expect(call.kwargs.model_reference_dataset_path).toBe('resolved:modelReferenceDataset');
  });

  test('splitInterval routes a before-cutpoint columnar reference to frames[py_name]', async () => {
    const { engine, calls } = makeEngine();
    const icare = createICARE(engine, materialize);

    await icare.computeAbsoluteRiskSplitInterval({
      applyAgeStart: 30,
      applyAgeIntervalLength: 40,
      cutpoint: 50,
      modelDiseaseIncidenceRates: { path: 'inc.csv' },
      modelCovariateFormulaBeforeCutpoint: 'y ~ x',
      modelReferenceDatasetBeforeCutpoint: { columns: { c: [1] } },
    });

    const call = calls[0]!;
    expect(call.op).toBe('splitInterval');
    expect(call.kwargs.cutpoint).toBe(50);
    expect(call.kwargs.model_covariate_formula_before_cutpoint_path).toBe(
      'resolved:modelCovariateFormulaBeforeCutpoint',
    );
    // The before-cutpoint columnar table is a frame keyed by py-name, NOT a kwarg.
    expect(call.kwargs).not.toHaveProperty('model_reference_dataset_before_cutpoint_path');
    expect(call.frames).toEqual({
      model_reference_dataset_before_cutpoint_path: { columns: { c: [1] }, dtypes: { c: 'i8' } },
    });
  });

  test('validate routes studyData to a top-level frame and resolves nested {path}/inline inputs', async () => {
    const { engine, calls } = makeEngine();
    const icare = createICARE(engine, materialize);

    await icare.validateAbsoluteRiskModel({
      studyData: { columns: { c: [1] } },
      predictedRiskInterval: 'total-followup',
      numberOfPercentiles: 10,
      icareModelParameters: {
        modelDiseaseIncidenceRates: { path: 'inc.csv' },
        modelCovariateFormula: 'y ~ x',
        modelReferenceDataset: { path: 'ref.csv' },
      },
    });

    const call = calls[0]!;
    expect(call.op).toBe('validate');
    // Top-level studyData columnar → frame merged at the top level.
    expect(call.frames).toEqual({ study_data_path: { columns: { c: [1] }, dtypes: { c: 'i8' } } });
    expect(call.kwargs).not.toHaveProperty('study_data_path');
    expect(call.kwargs.predicted_risk_interval).toBe('total-followup');
    expect(call.kwargs.number_of_percentiles).toBe(10);
    // Nested data inputs are materialized in place, then renamed once to snake_case _path keys.
    const nested = call.kwargs.icare_model_parameters as Record<string, unknown>;
    expect(nested.model_disease_incidence_rates_path).toBe('resolved:modelDiseaseIncidenceRates');
    expect(nested.model_covariate_formula_path).toBe('resolved:modelCovariateFormula');
    expect(nested.model_reference_dataset_path).toBe('resolved:modelReferenceDataset');
  });

  test('an in-memory table inside icareModelParameters throws a clear error', async () => {
    const { engine } = makeEngine();
    const icare = createICARE(engine, materialize);

    await expect(
      icare.validateAbsoluteRiskModel({
        studyData: { path: 'study.csv' },
        predictedRiskInterval: 'total-followup',
        icareModelParameters: {
          modelDiseaseIncidenceRates: { path: 'inc.csv' },
          modelReferenceDataset: { columns: { c: [1] } }, // columnar → frame → unsupported nested
        },
      }),
    ).rejects.toThrow(/icareModelParameters/);
  });
});

describe('fit-once model routing — build / apply / applyBatches / free', () => {
  test('buildAbsoluteRiskModel routes model args (columnar → frames) to engine.buildModel', async () => {
    const { engine, modelCalls } = makeEngine();
    const icare = createICARE(engine, materialize);

    const model = await icare.buildAbsoluteRiskModel({
      modelDiseaseIncidenceRates: { path: 'inc.csv' },
      modelCovariateFormula: 'y ~ x',
      modelLogRelativeRisk: { x: 0.5 },
      modelReferenceDataset: { columns: { c: [1] } },
    });

    expect(modelCalls.build).toHaveLength(1);
    const b = modelCalls.build[0]!;
    expect(b.kwargs.model_disease_incidence_rates_path).toBe('resolved:modelDiseaseIncidenceRates');
    expect(b.kwargs.model_covariate_formula_path).toBe('resolved:modelCovariateFormula');
    // Columnar reference → frame keyed by py-name, NOT a kwarg.
    expect(b.kwargs).not.toHaveProperty('model_reference_dataset_path');
    expect(b.frames).toEqual({
      model_reference_dataset_path: { columns: { c: [1] }, dtypes: { c: 'i8' } },
    });
    // The fitted betas are exposed on the handle.
    expect(model.model).toEqual({ Intercept: 0, x: 0.5 });
  });

  test('handle.apply routes the profile to engine.applyModel(handle, ...) and shapes the result', async () => {
    const { engine, modelCalls } = makeEngine();
    const icare = createICARE(engine, materialize);
    const model = await icare.buildAbsoluteRiskModel(BUILD_ARGS);

    const result = await model.apply({
      applyAgeStart: 50,
      applyAgeIntervalLength: 5,
      applyCovariateProfile: { columns: { c: [1] } },
      returnLinearPredictors: true,
    });

    expect(modelCalls.apply).toHaveLength(1);
    const a = modelCalls.apply[0]!;
    expect(a.handle).toBe(7);
    expect(a.kwargs.apply_age_start).toBe(50);
    expect(a.kwargs.return_linear_predictors).toBe(true);
    // Columnar profile → frame under apply_covariate_profile_path.
    expect(a.frames).toEqual({
      apply_covariate_profile_path: { columns: { c: [1] }, dtypes: { c: 'i8' } },
    });
    expect(result.profile.columns.risk_estimates).toBeInstanceOf(Float64Array);
  });

  test('applyBatches slices one ColumnarTable into batchRows chunks — one applyModel per chunk', async () => {
    const { engine, modelCalls } = makeEngine();
    const icare = createICARE(engine, materialize);
    const model = await icare.buildAbsoluteRiskModel(BUILD_ARGS);

    const table = { columns: { c: [1, 2, 3, 4, 5] } }; // 5 rows, batchRows 2 => 3 batches
    const batches = [];
    for await (const batch of model.applyBatches(table, {
      applyAgeStart: 50,
      applyAgeIntervalLength: 5,
      batchRows: 2,
      returnLinearPredictors: true,
    })) {
      batches.push(batch);
    }

    expect(modelCalls.apply).toHaveLength(3);
    expect(batches).toHaveLength(3);
    expect(batches[0]!.riskEstimates).toBeInstanceOf(Float64Array);
    expect(batches[0]!.linearPredictors).toBeInstanceOf(Float64Array);
    expect(batches[0]!.ids).toEqual(['a', 'b']);
    expect(batches[0]!.nRows).toBe(2);
  });

  test('applyBatches consumes a caller-supplied async iterable of batches as-is', async () => {
    const { engine, modelCalls } = makeEngine();
    const icare = createICARE(engine, materialize);
    const model = await icare.buildAbsoluteRiskModel(BUILD_ARGS);

    async function* source() {
      yield { columns: { c: [1] } };
      yield { columns: { c: [2] } };
    }
    let count = 0;
    for await (const _ of model.applyBatches(source(), {
      applyAgeStart: 50,
      applyAgeIntervalLength: 5,
    })) {
      count += 1;
    }
    expect(count).toBe(2);
    expect(modelCalls.apply).toHaveLength(2);
  });

  test('free calls engine.freeModel(handle) once (idempotent) and blocks further applies', async () => {
    const { engine, modelCalls } = makeEngine();
    const icare = createICARE(engine, materialize);
    const model = await icare.buildAbsoluteRiskModel(BUILD_ARGS);

    await model.free();
    await model.free(); // idempotent — no second freeModel call
    expect(modelCalls.free).toEqual([7]);

    await expect(
      model.apply({
        applyAgeStart: 50,
        applyAgeIntervalLength: 5,
        applyCovariateProfile: { path: 'p.csv' },
      }),
    ).rejects.toThrow(/freed/);
  });
});
