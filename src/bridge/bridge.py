"""wasm-icare resident Python bridge.

Loaded once (see ``bridgeClient.defineBridge``) and registered in ``sys.modules``
as ``icare_bridge``. This is the ONLY module the JS side speaks to: it dispatches
to py-icare's three public functions with in-memory objects and
``output_format='dataframe'``, and (from Phase 3) reshapes results into a
marshalling-friendly form the JS layer turns into zero-copy typed arrays.

The scientific stack (numpy/pandas/scipy/patsy) and the pyicare wheel are loaded
BEFORE this module is defined, so the module-level imports below always succeed.
"""

import sys

import numpy as np
import pandas as pd

import icare

# op (JS) -> py-icare public function name.
_DISPATCH = {
    "compute": "compute_absolute_risk",
    "splitInterval": "compute_absolute_risk_split_interval",
    "validate": "validate_absolute_risk_model",
}

# Marker keys used by columnarize() so the JS marshaller can walk the tree and
# decide what to extract via PyBuffer (zero-copy) vs. convert with toJs().
# Chosen so they never collide with a pandas column name.
_ARRAY_MARK = "__icare_array__"
_FRAME_MARK = "__icare_frame__"
_STRINGS_MARK = "__icare_strings__"


def pyicare_version():
    """Version of the installed pyicare distribution (asserts the wheel loaded)."""
    return icare.__version__


def runtime_versions():
    """Versions of the Python runtime + the scientific stack the bridge relies on."""
    import patsy
    import scipy

    return {
        "python": sys.version.split()[0],
        "icare": icare.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": scipy.__version__,
        "patsy": patsy.__version__,
    }


def build_df(columns):
    """Build a DataFrame from a columnar mapping ``{name: sequence}``.

    ``columns`` arrives from JS via ``toPy`` as a Python dict of lists (numeric
    TypedArrays convert to buffers/lists; string[] to lists). Phase 4 wires the
    real object-sink input path through here; authored now so the round-trip is
    testable.
    """
    data = {str(name): list(values) for name, values in dict(columns).items()}
    return pd.DataFrame(data)


def describe_dataframe(columns):
    """Probe: build a DataFrame from ``columns`` and return a JSON-safe summary.

    Exercises the JS -> Python -> JS round-trip (toPy object -> build_df -> toJs)
    without a full compute. Used by the Phase 2 engine smoke test.
    """
    df = build_df(columns)
    return {
        "columns": [str(c) for c in df.columns],
        "n_rows": int(len(df)),
        "column_sums": {
            str(c): float(df[c].sum())
            for c in df.columns
            if pd.api.types.is_numeric_dtype(df[c])
        },
    }


def run(op, kwargs, frames=None):
    """Dispatch to a py-icare public function with ``output_format='dataframe'``.

    - ``op``: 'compute' | 'splitInterval' | 'validate'.
    - ``kwargs``: snake_case keyword args (already name-mapped and
      ``undefined``-pruned by params.ts ``toPythonKwargs``); omitted keys let
      py-icare apply its own defaults.
    - ``frames``: optional ``{py_param_name: columnar-mapping}`` for the
      object-sink input path (Phase 4); each is materialized via ``build_df``.
    """
    try:
        fn_name = _DISPATCH[op]
    except KeyError:
        raise ValueError(f"unknown operation: {op!r}")

    kw = dict(kwargs) if kwargs is not None else {}
    if frames is not None:
        for name, columns in dict(frames).items():
            kw[str(name)] = build_df(columns)
    kw["output_format"] = "dataframe"

    return getattr(icare, fn_name)(**kw)


def columnarize(result, op=None):
    """Reshape a py-icare 'dataframe'-mode result into a marshalling-friendly tree.

    Big numeric data becomes C-contiguous numpy ndarrays flagged with
    ``_ARRAY_MARK`` (the JS marshaller extracts these zero-copy via
    ``getBuffer``); DataFrames become ``_FRAME_MARK`` column maps; everything
    else (dicts, lists, scalars, strings) passes through for ``toJs``. Authored
    now; wired to the JS getBuffer path in Phase 3.
    """
    return _columnarize(result)


def _columnarize(obj):
    if isinstance(obj, pd.DataFrame):
        return {
            _FRAME_MARK: True,
            "order": [str(c) for c in obj.columns],
            "n_rows": int(len(obj)),
            "columns": {str(c): _columnarize_series(obj[c]) for c in obj.columns},
        }
    if isinstance(obj, pd.Series):
        return _columnarize_series(obj)
    if isinstance(obj, np.ndarray):
        return _wrap_array(obj)
    if isinstance(obj, dict):
        return {key: _columnarize(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_columnarize(value) for value in obj]
    return obj


def _columnarize_series(series):
    numeric = pd.api.types.is_numeric_dtype(series)
    if numeric and not pd.api.types.is_bool_dtype(series):
        return _wrap_array(series.to_numpy())
    return {
        _STRINGS_MARK: True,
        "data": [None if pd.isna(v) else str(v) for v in series],
    }


def _wrap_array(array):
    contiguous = np.ascontiguousarray(array)
    return {
        _ARRAY_MARK: True,
        "dtype": str(contiguous.dtype),
        "shape": list(contiguous.shape),
        "data": contiguous,
    }
