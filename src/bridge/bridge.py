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
_CATEGORICAL_MARK = "__icare_categorical__"


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


def build_df(columns, dtypes=None):
    """Build a DataFrame from a columnar mapping ``{name: sequence}``.

    ``columns`` arrives from JS via ``toPy`` as a Python dict (numeric TypedArrays
    convert to buffers, ``string[]``/``number[]`` to lists). ``dtypes`` is an
    optional ``{name: 'f8'|'i8'|'bool'|'str'}`` map produced by ``columnar.ts``;
    when present, each column is built with that explicit dtype so the frame
    reproduces ``read_csv`` inference (``None`` -> ``NaN`` for numeric, ``None``
    preserved for object). Without ``dtypes`` the columns fall back to pandas'
    own inference (used by the ``describe_dataframe`` round-trip probe).
    """
    tags = dict(dtypes) if dtypes is not None else {}
    data = {}
    for name, values in dict(columns).items():
        name = str(name)
        tag = tags.get(name)
        if tag == "f8":
            data[name] = pd.Series(np.asarray(values, dtype="float64"))
        elif tag == "i8":
            data[name] = pd.Series(np.asarray(values, dtype="int64"))
        elif tag == "bool":
            data[name] = pd.Series(list(values), dtype="bool")
        elif tag == "str":
            # pandas 3.0's read_csv infers text columns as the ``str`` dtype
            # (not object). Matching it is load-bearing: the reference dataset's
            # dtypes drive the covariate-profile coupling, and ``astype('str')``
            # stringifies an integer-looking profile column ('0') whereas
            # ``astype(object)`` would leave it an int (breaking patsy levels).
            data[name] = pd.Series(
                [None if v is None else str(v) for v in values], dtype="str"
            )
        else:
            data[name] = list(values)
    return pd.DataFrame(data)


def build_df_from_arrow(ipc):
    """Rebuild a DataFrame from Arrow IPC stream bytes via pyarrow.

    ``ipc`` arrives from JS (``apache-arrow`` ``tableToIPC``) as a buffer. pyarrow
    must be loaded (``loadICARE({packages:['pyarrow']})``). Text columns are cast
    to pandas 3.0's ``str`` dtype so an Arrow ``Dictionary``/``Utf8`` column
    (which ``to_pandas`` maps to ``category``/``object``) reproduces ``read_csv``
    — load-bearing for the reference->profile dtype coupling.
    """
    try:
        import pyarrow as pa
    except ImportError as exc:
        raise ImportError(
            "Arrow inputs require pyarrow; load it via "
            "loadICARE({ packages: ['pyarrow'] })."
        ) from exc

    table = pa.ipc.open_stream(pa.py_buffer(ipc)).read_all()
    df = table.to_pandas()
    for col in df.columns:
        series = df[col]
        if not pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            df[col] = series.astype("str")
    return df


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
    - ``frames``: optional ``{py_param_name: frame}`` for the object-sink input
      path. ``frame`` is either ``{'columns': ..., 'dtypes': ...}`` (built by
      ``build_df``) or ``{'arrow_ipc': <bytes>}`` (built by
      ``build_df_from_arrow``). Merged into ``kw`` under ``py_param_name`` so it
      overrides any same-named path kwarg.
    """
    try:
        fn_name = _DISPATCH[op]
    except KeyError:
        raise ValueError(f"unknown operation: {op!r}")

    kw = dict(kwargs) if kwargs is not None else {}
    if frames is not None:
        for name, frame in dict(frames).items():
            frame = dict(frame)
            if "arrow_ipc" in frame:
                kw[str(name)] = build_df_from_arrow(frame["arrow_ipc"])
            else:
                kw[str(name)] = build_df(frame["columns"], frame.get("dtypes"))
    kw["output_format"] = "dataframe"

    return getattr(icare, fn_name)(**kw)


def columnarize(result, op=None):
    """Reshape a py-icare 'dataframe'-mode result into a flat structure the JS
    layer turns into zero-copy typed arrays.

    Returns ``{"structure": <tree>, "buffers": [ndarray, ...]}``:
    - ``structure`` is fully JSON-native (contains NO numpy arrays), so the JS
      side converts it with a single ``toJs``. Every numeric column/array is
      replaced by a node ``{__icare_array__: True, dtype, shape, index}`` whose
      ``index`` points into ``buffers``.
    - ``buffers`` is a flat list of C-contiguous ndarrays; the JS side extracts
      each zero-copy via ``getBuffer`` and splices it back in by index.

    String columns stay inline (``__icare_strings__``); DataFrames become
    ``__icare_frame__`` column maps; dicts/lists/scalars pass through. Keeping
    the arrays out of ``structure`` means the JS marshaller never has to walk a
    tree of PyProxies — it converts ``structure`` natively and iterates
    ``buffers`` by index.
    """
    buffers = []
    structure = _columnarize(result, buffers)
    return {"structure": structure, "buffers": buffers}


def _columnarize(obj, buffers):
    if isinstance(obj, pd.DataFrame):
        return {
            _FRAME_MARK: True,
            "order": [str(c) for c in obj.columns],
            "n_rows": int(len(obj)),
            "columns": {
                str(c): _columnarize_series(obj[c], buffers) for c in obj.columns
            },
        }
    if isinstance(obj, pd.Series):
        return _columnarize_series(obj, buffers)
    if isinstance(obj, np.ndarray):
        return _wrap_array(obj, buffers)
    if isinstance(obj, dict):
        return {key: _columnarize(value, buffers) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_columnarize(value, buffers) for value in obj]
    return obj


def _columnarize_series(series, buffers):
    # A pandas Categorical (e.g. validation's ``linear_predictors_category``) is
    # marshalled as integer codes + ordered category labels, so JS keeps the
    # ordering and a compact Int32Array instead of a giant repeated string array.
    # ``-1`` codes mark missing values (JS must NOT index ``categories`` with them).
    # pandas 3.0: ``is_categorical_dtype`` is removed — test the dtype directly.
    if isinstance(series.dtype, pd.CategoricalDtype):
        return {
            _CATEGORICAL_MARK: True,
            "codes": _wrap_array(series.cat.codes.to_numpy(), buffers),
            "categories": [str(c) for c in series.cat.categories],
        }
    numeric = pd.api.types.is_numeric_dtype(series)
    if numeric and not pd.api.types.is_bool_dtype(series):
        return _wrap_array(series.to_numpy(), buffers)
    return {
        _STRINGS_MARK: True,
        "data": [None if pd.isna(v) else str(v) for v in series],
    }


def _wrap_array(array, buffers):
    contiguous = np.ascontiguousarray(array)
    index = len(buffers)
    buffers.append(contiguous)
    return {
        _ARRAY_MARK: True,
        "dtype": str(contiguous.dtype),
        "shape": list(contiguous.shape),
        "index": index,
    }
