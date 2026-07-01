import { describe, expect, it } from 'vitest';
import {
  camelToSnake,
  fromPythonKwargs,
  jsNames,
  type Operation,
  type ParamKind,
  paramSpecs,
  pythonNames,
  toPythonKwargs,
  toPythonName,
} from '../../src/api/params';

/**
 * Drift oracle — the EXACT snake_case parameter names (in signature order) of
 * py-icare's three public functions, captured verbatim from
 * py-icare/icare/absolute_risk_main.py (compute_absolute_risk :8,
 * compute_absolute_risk_split_interval :141, validate_absolute_risk_model :430).
 *
 * params.ts DERIVES its Python names (camelToSnake + `_path` for file kinds), so
 * this independent, hand-transcribed list makes the check a genuine cross-check:
 * if py-icare renames a parameter, or the derivation/kind is wrong, this fails.
 */
const PY_NAMES = {
  compute: [
    'apply_age_start',
    'apply_age_interval_length',
    'model_disease_incidence_rates_path',
    'model_competing_incidence_rates_path',
    'model_covariate_formula_path',
    'model_log_relative_risk_path',
    'model_reference_dataset_path',
    'model_reference_dataset_weights_variable_name',
    'model_snp_info_path',
    'model_family_history_variable_name',
    'num_imputations',
    'apply_covariate_profile_path',
    'apply_snp_profile_path',
    'return_linear_predictors',
    'return_reference_risks',
    'seed',
  ],
  splitInterval: [
    'apply_age_start',
    'apply_age_interval_length',
    'model_disease_incidence_rates_path',
    'model_competing_incidence_rates_path',
    'model_covariate_formula_before_cutpoint_path',
    'model_covariate_formula_after_cutpoint_path',
    'model_log_relative_risk_before_cutpoint_path',
    'model_log_relative_risk_after_cutpoint_path',
    'model_reference_dataset_before_cutpoint_path',
    'model_reference_dataset_after_cutpoint_path',
    'model_reference_dataset_weights_variable_name_before_cutpoint',
    'model_reference_dataset_weights_variable_name_after_cutpoint',
    'model_snp_info_path',
    'model_family_history_variable_name_before_cutpoint',
    'model_family_history_variable_name_after_cutpoint',
    'apply_covariate_profile_before_cutpoint_path',
    'apply_covariate_profile_after_cutpoint_path',
    'apply_snp_profile_path',
    'cutpoint',
    'num_imputations',
    'return_linear_predictors',
    'return_reference_risks',
    'seed',
  ],
  validate: [
    'study_data_path',
    'predicted_risk_interval',
    'icare_model_parameters',
    'predicted_risk_variable_name',
    'linear_predictor_variable_name',
    'reference_entry_age',
    'reference_exit_age',
    'reference_predicted_risks',
    'reference_linear_predictors',
    'number_of_percentiles',
    'linear_predictor_cutoffs',
    'dataset_name',
    'model_name',
    'seed',
  ],
} satisfies Record<Operation, string[]>;

const OPS = ['compute', 'splitInterval', 'validate'] as const satisfies readonly Operation[];

/** Build a fully-populated options object with a distinctive value per key. */
function makeSample(op: Operation): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const spec of paramSpecs(op)) {
    obj[spec.js] = sampleValue(spec.js, spec.kind);
  }
  return obj;
}

function sampleValue(js: string, kind: ParamKind): unknown {
  switch (kind) {
    case 'nested':
      return makeSample('compute');
    case 'data':
    case 'formula':
    case 'logOR':
    case 'snpInfo':
      // Stand-in for a DataInput; the mapping layer is value-agnostic.
      return { marker: js };
    case 'value':
      return `value:${js}`;
  }
}

describe('camelToSnake / toPythonName', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnake('applyAgeStart')).toBe('apply_age_start');
    expect(camelToSnake('numImputations')).toBe('num_imputations');
    expect(camelToSnake('modelReferenceDatasetWeightsVariableNameBeforeCutpoint')).toBe(
      'model_reference_dataset_weights_variable_name_before_cutpoint',
    );
    expect(camelToSnake('seed')).toBe('seed');
  });

  it('appends _path only for file-backed kinds', () => {
    expect(toPythonName('modelDiseaseIncidenceRates', 'data')).toBe(
      'model_disease_incidence_rates_path',
    );
    expect(toPythonName('modelCovariateFormula', 'formula')).toBe('model_covariate_formula_path');
    expect(toPythonName('modelLogRelativeRisk', 'logOR')).toBe('model_log_relative_risk_path');
    expect(toPythonName('modelSnpInfo', 'snpInfo')).toBe('model_snp_info_path');
    expect(toPythonName('numImputations', 'value')).toBe('num_imputations');
    expect(toPythonName('icareModelParameters', 'nested')).toBe('icare_model_parameters');
  });
});

describe.each(OPS)('parameter map: %s', (op) => {
  it('matches py-icare parameter names exactly, in signature order (drift guard)', () => {
    expect(pythonNames(op)).toEqual(PY_NAMES[op]);
  });

  it('is a bijection (unique js and py names)', () => {
    const js = jsNames(op);
    const py = pythonNames(op);
    expect(new Set(js).size).toBe(js.length);
    expect(new Set(py).size).toBe(py.length);
    expect(js.length).toBe(py.length);
  });

  it('round-trips a fully-populated options object losslessly', () => {
    const sample = makeSample(op);
    const kwargs = toPythonKwargs(op, sample);
    expect(Object.keys(kwargs).sort()).toEqual([...PY_NAMES[op]].sort());
    expect(fromPythonKwargs(op, kwargs)).toEqual(sample);
  });
});

describe('toPythonKwargs behaviour', () => {
  it('omits absent keys so py-icare applies its own defaults (no seed = 1234)', () => {
    const kwargs = toPythonKwargs('compute', {
      applyAgeStart: 50,
      applyAgeIntervalLength: 5,
      modelDiseaseIncidenceRates: { path: 'inc.csv' },
    });
    expect(kwargs).toEqual({
      apply_age_start: 50,
      apply_age_interval_length: 5,
      model_disease_incidence_rates_path: { path: 'inc.csv' },
    });
    expect('seed' in kwargs).toBe(false);
    expect('num_imputations' in kwargs).toBe(false);
    expect('return_linear_predictors' in kwargs).toBe(false);
  });

  it('recurses into the nested icareModelParameters map', () => {
    const kwargs = toPythonKwargs('validate', {
      studyData: { path: 'study.csv' },
      predictedRiskInterval: 'total-followup',
      icareModelParameters: {
        modelReferenceDataset: { path: 'ref.csv' },
        numImputations: 3,
        seed: 7,
      },
    });
    expect(kwargs['icare_model_parameters']).toEqual({
      model_reference_dataset_path: { path: 'ref.csv' },
      num_imputations: 3,
      seed: 7,
    });
    expect(kwargs['study_data_path']).toEqual({ path: 'study.csv' });
    expect(kwargs['predicted_risk_interval']).toBe('total-followup');
  });

  it('passes an explicit null icareModelParameters through as Python None', () => {
    const kwargs = toPythonKwargs('validate', {
      studyData: { path: 'study.csv' },
      predictedRiskInterval: 5,
      icareModelParameters: null,
    });
    expect(kwargs['icare_model_parameters']).toBeNull();
    expect(fromPythonKwargs('validate', kwargs)['icareModelParameters']).toBeNull();
  });

  it('ignores unknown keys', () => {
    const kwargs = toPythonKwargs('compute', {
      applyAgeStart: 50,
      notARealParam: 'x',
    });
    expect(kwargs).toEqual({ apply_age_start: 50 });
  });
});
