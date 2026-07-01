import { describe, expect, test } from 'vitest';

import { createICARE, type InputMaterializer } from '../../src/api/icareFacade';
import { isColumnarInput } from '../../src/io/guards';
import type { Engine } from '../../src/runtime/engine';

/** A stub engine that records the last `run` call and returns an empty result. */
function makeEngine() {
  const calls: Array<{
    op: string;
    kwargs: Record<string, unknown>;
    frames: Record<string, unknown> | null | undefined;
  }> = [];
  const engine = {
    run(op: string, kwargs: Record<string, unknown>, frames?: Record<string, unknown> | null) {
      calls.push({ op, kwargs, frames });
      return { model: {}, profile: { columns: {}, order: [], nRows: 0 }, method: 'stub' };
    },
    async close() {},
  } as unknown as Engine;
  return { engine, calls };
}

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
});
