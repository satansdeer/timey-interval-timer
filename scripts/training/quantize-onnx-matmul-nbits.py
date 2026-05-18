#!/usr/bin/env python3
"""Quantize ONNX MatMul weights with ORT's MatMulNBits quantizer.

The ONNX Runtime quantizer bundled with our local environment imports the
optional `onnx_ir` package. We only need a tiny subset of that API for the
default MatMulNBits path, so this wrapper installs a compatibility shim before
loading ORT's quantizer.
"""

from __future__ import annotations

import argparse
import sys
import types
from pathlib import Path

import onnx
from onnx import numpy_helper


class _Tensor:
    def __init__(self, array, name: str | None = None):
        self._array = array
        self.name = name

    def numpy(self):
        return self._array


class _Serde:
    @staticmethod
    def serialize_tensor(tensor: _Tensor):
        return numpy_helper.from_array(tensor.numpy(), tensor.name)


def _install_onnx_ir_shim() -> None:
    if "onnx_ir" in sys.modules:
        return

    shim = types.ModuleType("onnx_ir")
    shim.Tensor = _Tensor
    shim.serde = _Serde
    shim.from_proto = lambda proto: _Tensor(numpy_helper.to_array(proto), getattr(proto, "name", None))
    sys.modules["onnx_ir"] = shim


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-model", required=True, type=Path)
    parser.add_argument("--output-model", required=True, type=Path)
    parser.add_argument("--bits", type=int, default=4, choices=[2, 4, 8])
    parser.add_argument("--block-size", type=int, default=128)
    parser.add_argument("--accuracy-level", type=int)
    parser.add_argument("--asymmetric", action="store_true", help="Use asymmetric quantization. Default is symmetric.")
    parser.add_argument("--nodes-to-exclude", nargs="*", default=[])
    parser.add_argument("--nodes-to-include", nargs="*")
    parser.add_argument("--op-types-to-quantize", nargs="*", default=["MatMul"], choices=["MatMul", "Gather"])
    parser.add_argument("--external-data", action="store_true", help="Save tensor data beside the ONNX file.")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.output_model.exists() and not args.overwrite:
        raise SystemExit(f"Output already exists: {args.output_model}")

    args.output_model.parent.mkdir(parents=True, exist_ok=True)
    _install_onnx_ir_shim()

    from onnxruntime.quantization.matmul_nbits_quantizer import (  # noqa: PLC0415
        DefaultWeightOnlyQuantConfig,
        MatMulNBitsQuantizer,
        QuantFormat,
    )

    config = DefaultWeightOnlyQuantConfig(
        block_size=args.block_size,
        is_symmetric=not args.asymmetric,
        accuracy_level=args.accuracy_level,
        quant_format=QuantFormat.QOperator,
        op_types_to_quantize=tuple(args.op_types_to_quantize),
        bits=args.bits,
    )
    quantizer = MatMulNBitsQuantizer(
        model=onnx.load(args.input_model),
        bits=args.bits,
        block_size=args.block_size,
        is_symmetric=not args.asymmetric,
        accuracy_level=args.accuracy_level,
        nodes_to_exclude=args.nodes_to_exclude,
        nodes_to_include=args.nodes_to_include,
        algo_config=config,
    )
    quantizer.process()
    quantizer.model.save_model_to_file(str(args.output_model), args.external_data)
    print(f"Wrote {args.output_model}")


if __name__ == "__main__":
    main()
