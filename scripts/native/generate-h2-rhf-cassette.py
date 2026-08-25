#!/usr/bin/env python3
"""Generate the bounded H2 RHF/STO-3G scientific cassette.

This is an offline build tool.  The committed JSON is the only runtime input;
the PySCF dependency is deliberately imported here, in a disposable pinned
environment, and is never needed by the web or native clients.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from pathlib import Path
from typing import Any

import numpy as np
from pyscf import gto, scf


PYSCF_VERSION = "2.6.2"
NUMPY_VERSION = "1.26.4"
SCIPY_VERSION = "1.11.4"
# 1 Angstrom = 1.8897261246257702 bohr.  PySCF's nuclear repulsion is
# 1 / R_bohr, so this is the conversion used by the explicit midpoint seam.
BOHR_PER_ANGSTROM = 1.8897261246257702
MIN_ANGSTROM = 0.6
MAX_ANGSTROM = 1.2
SPACING_ANGSTROM = 0.025
NODE_COUNT = 25
DAMPING = 0.5
MAX_ITERATIONS = 64
DENSITY_TOLERANCE = 5e-4
ENERGY_TOLERANCE = 5e-5
ELECTRON_COUNT_TOLERANCE = 1e-8

MODEL_TUPLE: dict[str, Any] = {
    "model": "RHF/STO-3G",
    "modelVersion": "h2-rhf-sto-3g-v1",
    "species": "H2",
    "charge": 0,
    "multiplicity": 1,
    "basis": "STO-3G",
    "envelope": {
        "minAngstrom": MIN_ANGSTROM,
        "maxAngstrom": MAX_ANGSTROM,
        "spacingAngstrom": SPACING_ANGSTROM,
        "nodeCount": NODE_COUNT,
    },
    "solver": {
        "damping": DAMPING,
        "logicalHz": 20,
        "maxIterations": MAX_ITERATIONS,
        "densityTolerance": DENSITY_TOLERANCE,
        "energyTolerance": ENERGY_TOLERANCE,
        "electronCountTolerance": ELECTRON_COUNT_TOLERANCE,
        "fixedPointDensityTolerance": 1e-10,
        "fixedPointEnergyTolerance": 1e-10,
        "consecutiveGateTicks": 2,
    },
    "interpolation": {
        "matrices": "quadratic-three-node",
        "nuclearRepulsion": "exact-coulomb-from-separation",
    },
    "bohrPerAngstrom": BOHR_PER_ANGSTROM,
    "quantizationVersion": "decimal-12",
    "traceVersion": 1,
}

UNITS = {
    "distance": "angstrom",
    "energy": "hartree",
    "density": "AO density matrix (dimensionless coefficients)",
}

AO_CONVENTION = {
    "labels": ["0 H 1s", "1 H 1s"],
    "axis": "z",
    "matrixOrder": "row-major",
    "eriOrder": ["mu", "nu", "lambda", "sigma"],
    "occupiedOrbitals": 1,
    "electronCount": 2,
}

COMPARISON = {
    "densityMatrixMaxAbs": DENSITY_TOLERANCE,
    "totalEnergyMaxAbs": ENERGY_TOLERANCE,
    "electronCountMaxAbs": ELECTRON_COUNT_TOLERANCE,
}


def quantize(value: float) -> float:
    """Round all numeric leaves using the cross-language decimal-12 rule."""

    if not math.isfinite(float(value)):
        raise ValueError("cannot quantize a non-finite number")
    rounded = round(float(value), 12)
    return 0.0 if rounded == 0 else rounded


def canonical_number(value: int | float) -> str:
    value_float = float(value)
    if not math.isfinite(value_float):
        raise ValueError("canonical JSON cannot encode NaN or Infinity")
    if value_float == 0:
        return "0"
    text = f"{value_float:.12f}".rstrip("0").rstrip(".")
    return text or "0"


def canonical_json(value: Any) -> str:
    """Match canonicalH2RHFJson in the shared TypeScript contract."""

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return canonical_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False)
            + ":"
            + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise TypeError(f"unsupported canonical JSON value: {type(value).__name__}")


def payload_digest(payload: dict[str, Any]) -> str:
    body = {key: value for key, value in payload.items() if key != "payloadSha256"}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def matrix_values(matrix: np.ndarray) -> list[float]:
    return [quantize(float(value)) for value in np.asarray(matrix, dtype=np.float64).reshape(-1, order="C")]


def build_fock(density: np.ndarray, core: np.ndarray, eri: np.ndarray) -> np.ndarray:
    """The exact two-AO RHF map used by both runtime authorities."""

    eri4 = np.asarray(eri, dtype=np.float64).reshape(2, 2, 2, 2)
    density = np.asarray(density, dtype=np.float64).reshape(2, 2)
    coulomb = np.einsum("rs,pqrs->pq", density, eri4, optimize=False)
    exchange = np.einsum("rs,prqs->pq", density, eri4, optimize=False)
    fock = np.asarray(core, dtype=np.float64).reshape(2, 2) + coulomb - 0.5 * exchange
    return (fock + fock.T) * 0.5


def symmetric_inverse_sqrt(overlap: np.ndarray) -> np.ndarray:
    eigenvalues, eigenvectors = np.linalg.eigh(np.asarray(overlap, dtype=np.float64))
    if np.any(eigenvalues <= 0) or not np.all(np.isfinite(eigenvalues)):
        raise ValueError("overlap matrix is not positive definite")
    transform = eigenvectors @ np.diag(eigenvalues ** -0.5) @ eigenvectors.T
    return (transform + transform.T) * 0.5


def density_from_fock(fock: np.ndarray, overlap: np.ndarray) -> np.ndarray:
    orthogonalizer = symmetric_inverse_sqrt(overlap)
    transformed = orthogonalizer @ fock @ orthogonalizer
    transformed = (transformed + transformed.T) * 0.5
    eigenvalues, eigenvectors = np.linalg.eigh(transformed)
    if not np.all(np.isfinite(eigenvalues)):
        raise ValueError("Fock diagonalization produced a non-finite eigenvalue")
    orbital = orthogonalizer @ eigenvectors[:, :1]
    density = 2.0 * (orbital @ orbital.T)
    return (density + density.T) * 0.5


def rhf_energy(density: np.ndarray, core: np.ndarray, eri: np.ndarray, enuc: float) -> float:
    fock = build_fock(density, core, eri)
    return float(0.5 * np.sum(density * (np.asarray(core).reshape(2, 2) + fock)) + enuc)


def electron_count(density: np.ndarray, overlap: np.ndarray) -> float:
    return float(np.einsum("ij,ji->", density, np.asarray(overlap).reshape(2, 2), optimize=False))


def replay_rhf(
    overlap: np.ndarray,
    core: np.ndarray,
    eri: np.ndarray,
    enuc: float,
) -> tuple[np.ndarray, float, float, int]:
    """Replay the damped fixed-point map from a zero-density warm start."""

    overlap = np.asarray(overlap, dtype=np.float64).reshape(2, 2)
    core = np.asarray(core, dtype=np.float64).reshape(2, 2)
    eri = np.asarray(eri, dtype=np.float64).reshape(16)
    density = np.zeros((2, 2), dtype=np.float64)
    previous_energy: float | None = None
    for iteration in range(1, MAX_ITERATIONS + 1):
        target = density_from_fock(build_fock(density, core, eri), overlap)
        mixed = (1.0 - DAMPING) * density + DAMPING * target
        energy = rhf_energy(mixed, core, eri, enuc)
        density_delta = float(np.max(np.abs(mixed - density)))
        energy_delta = math.inf if previous_energy is None else abs(energy - previous_energy)
        count_error = abs(electron_count(mixed, overlap) - 2.0)
        density = mixed
        previous_energy = energy
        if (
            density_delta <= MODEL_TUPLE["solver"]["fixedPointDensityTolerance"]
            and energy_delta <= MODEL_TUPLE["solver"]["fixedPointEnergyTolerance"]
            and count_error <= ELECTRON_COUNT_TOLERANCE
        ):
            return density, energy, count_error, iteration
    return density, previous_energy if previous_energy is not None else math.nan, abs(electron_count(density, overlap) - 2.0), MAX_ITERATIONS


def make_pyscf_node(separation: float) -> dict[str, Any]:
    atom = f"H 0 0 0; H 0 0 {separation:.12f}"
    molecule = gto.M(
        atom=atom,
        basis="sto-3g",
        charge=0,
        spin=0,
        unit="Angstrom",
        cart=False,
        verbose=0,
    )
    method = scf.RHF(molecule)
    method.conv_tol = 1e-12
    method.conv_tol_grad = 1e-10
    method.max_cycle = 100
    method.diis_space = 8
    method.kernel()
    if not method.converged:
        raise RuntimeError(f"PySCF RHF did not converge at {separation:.12f} Angstrom")
    overlap = molecule.intor("int1e_ovlp_sph")
    core = method.get_hcore()
    eri = molecule.intor("int2e_sph")
    labels = [label.strip() for label in molecule.ao_labels()]
    if labels != AO_CONVENTION["labels"]:
        raise RuntimeError(f"PySCF AO ordering drifted: expected {AO_CONVENTION['labels']}, got {labels}")
    density = method.make_rdm1()
    enuc = float(molecule.energy_nuc())
    return {
        "separationAngstrom": quantize(separation),
        "overlap": matrix_values(overlap),
        "core": matrix_values(core),
        "eri": matrix_values(eri),
        "enuc": quantize(enuc),
        "referenceDensity": matrix_values(density),
        "referenceEnergy": quantize(float(method.e_tot)),
        "referenceElectronCount": quantize(electron_count(density, overlap)),
    }


def matrix_from_node(node: dict[str, Any], key: str, shape: tuple[int, ...]) -> np.ndarray:
    return np.asarray(node[key], dtype=np.float64).reshape(shape)


def midpoint_node(nodes: list[dict[str, Any]], midpoint_reference: dict[str, Any], index: int) -> dict[str, Any]:
    left = nodes[index]
    right = nodes[index + 1]

    def quadratic(key: str) -> list[float]:
        if index == 0:
            samples = nodes[0:3]
            weights = (0.375, 0.75, -0.125)
        elif index == len(nodes) - 2:
            samples = nodes[-3:]
            weights = (-0.125, 0.75, 0.375)
        else:
            samples = nodes[index - 1 : index + 2]
            weights = (-0.125, 0.75, 0.375)
        return [quantize(sum(weight * float(sample[key][entry]) for weight, sample in zip(weights, samples))) for entry in range(len(samples[0][key]))]

    separation = quantize((left["separationAngstrom"] + right["separationAngstrom"]) * 0.5)
    enuc = quantize(1.0 / (BOHR_PER_ANGSTROM * separation))
    overlap = np.asarray(quadratic("overlap"), dtype=np.float64).reshape(2, 2)
    core = np.asarray(quadratic("core"), dtype=np.float64).reshape(2, 2)
    eri = np.asarray(quadratic("eri"), dtype=np.float64).reshape(16)
    replay_density, replay_energy, count_error, _ = replay_rhf(overlap, core, eri, enuc)
    reference_density = np.asarray(midpoint_reference["referenceDensity"], dtype=np.float64).reshape(2, 2)
    density_error = float(np.max(np.abs(replay_density - reference_density)))
    energy_error = abs(replay_energy - float(midpoint_reference["referenceEnergy"]))
    return {
        "separationAngstrom": separation,
        "overlap": [quantize(float(value)) for value in overlap.reshape(-1)],
        "core": [quantize(float(value)) for value in core.reshape(-1)],
        "eri": [quantize(float(value)) for value in eri.reshape(-1)],
        "enuc": enuc,
        "referenceDensity": midpoint_reference["referenceDensity"],
        "referenceEnergy": midpoint_reference["referenceEnergy"],
        "referenceElectronCount": midpoint_reference["referenceElectronCount"],
        "leftNode": index,
        "rightNode": index + 1,
        "densityError": quantize(density_error),
        "energyError": quantize(energy_error),
        "electronCountError": quantize(count_error),
    }


def blas_provenance() -> str:
    config = getattr(np.__config__, "CONFIG", {})
    try:
        blas = config["Build Dependencies"]["blas"]
        name = str(blas.get("name", "unknown"))
        version = str(blas.get("version", "unknown"))
        return f"{name} {version}"
    except (KeyError, AttributeError, TypeError):
        return f"numpy-configured-blas ({platform.system().lower()})"


def make_cassette() -> dict[str, Any]:
    nodes = [make_pyscf_node(quantize(MIN_ANGSTROM + index * SPACING_ANGSTROM)) for index in range(NODE_COUNT)]
    replay_density_errors: list[float] = []
    replay_energy_errors: list[float] = []
    replay_count_errors: list[float] = []
    for node in nodes:
        overlap = matrix_from_node(node, "overlap", (2, 2))
        core = matrix_from_node(node, "core", (2, 2))
        eri = matrix_from_node(node, "eri", (16,))
        density, energy, count_error, _ = replay_rhf(overlap, core, eri, node["enuc"])
        reference_density = matrix_from_node(node, "referenceDensity", (2, 2))
        replay_density_errors.append(float(np.max(np.abs(density - reference_density))))
        replay_energy_errors.append(abs(energy - node["referenceEnergy"]))
        replay_count_errors.append(count_error)

    midpoints: list[dict[str, Any]] = []
    midpoint_density_errors: list[float] = []
    midpoint_energy_errors: list[float] = []
    midpoint_count_errors: list[float] = []
    for index, (left, right) in enumerate(zip(nodes, nodes[1:])):
        separation = quantize((left["separationAngstrom"] + right["separationAngstrom"]) * 0.5)
        reference = make_pyscf_node(separation)
        midpoint = midpoint_node(nodes, reference, index)
        midpoints.append(midpoint)
        midpoint_density_errors.append(midpoint["densityError"])
        midpoint_energy_errors.append(midpoint["energyError"])
        midpoint_count_errors.append(midpoint["electronCountError"])

    oracle = {
        "nodeReplayMaxDensityError": quantize(max(replay_density_errors)),
        "nodeReplayMaxEnergyError": quantize(max(replay_energy_errors)),
        "nodeReplayMaxElectronCountError": quantize(max(replay_count_errors)),
        "midpointMaxDensityError": quantize(max(midpoint_density_errors)),
        "midpointMaxEnergyError": quantize(max(midpoint_energy_errors)),
        "midpointMaxElectronCountError": quantize(max(midpoint_count_errors)),
    }
    ceilings = (
        ("nodeReplayMaxDensityError", DENSITY_TOLERANCE),
        ("nodeReplayMaxEnergyError", ENERGY_TOLERANCE),
        ("nodeReplayMaxElectronCountError", ELECTRON_COUNT_TOLERANCE),
        ("midpointMaxDensityError", DENSITY_TOLERANCE),
        ("midpointMaxEnergyError", ENERGY_TOLERANCE),
        ("midpointMaxElectronCountError", ELECTRON_COUNT_TOLERANCE),
    )
    for key, ceiling in ceilings:
        if oracle[key] > ceiling:
            raise RuntimeError(f"{key}={oracle[key]} exceeds declared ceiling {ceiling}")

    cassette: dict[str, Any] = {
        "cassetteVersion": 1,
        "model": MODEL_TUPLE["model"],
        "modelVersion": MODEL_TUPLE["modelVersion"],
        "modelTuple": MODEL_TUPLE,
        "units": UNITS,
        "aoConvention": AO_CONVENTION,
        "envelope": MODEL_TUPLE["envelope"],
        "solver": MODEL_TUPLE["solver"],
        "provenance": {
            "generator": "scripts/native/generate-h2-rhf-cassette.py",
            "python": platform.python_version(),
            "pyscf": PYSCF_VERSION,
            "numpy": NUMPY_VERSION,
            "scipy": SCIPY_VERSION,
            "blas": blas_provenance(),
            "sourceIds": [
                "pyscf:2.6.2:gto-rhf",
                "basis:sto-3g:ao-order:0H1s-1H1s",
                "oracle:adjacent-midpoints:v1",
            ],
        },
        "comparison": COMPARISON,
        "oracle": oracle,
        "nodes": nodes,
        "midpoints": midpoints,
    }
    cassette["payloadSha256"] = payload_digest(cassette)
    return cassette


def swift_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def swift_number(value: int | float) -> str:
    return canonical_number(value)


def swift_array(values: list[Any]) -> str:
    return "[" + ", ".join(swift_number(item) if isinstance(item, (int, float)) and not isinstance(item, bool) else swift_string(item) for item in values) + "]"


def render_swift(cassette: dict[str, Any]) -> str:
    model = cassette["modelTuple"]
    envelope = model["envelope"]
    solver = model["solver"]
    interpolation = model["interpolation"]
    lines = [
        "// Generated by scripts/native/generate-h2-rhf-cassette.py; do not edit.",
        "import Foundation",
        "",
        "public enum H2RHFCassetteGenerated {",
        "  public struct Envelope: Sendable {",
        "    public let minAngstrom: Double",
        "    public let maxAngstrom: Double",
        "    public let spacingAngstrom: Double",
        "    public let nodeCount: Int",
        "  }",
        "  public struct Solver: Sendable {",
        "    public let damping: Double",
        "    public let logicalHz: Int",
        "    public let maxIterations: Int",
        "    public let densityTolerance: Double",
        "    public let energyTolerance: Double",
        "    public let electronCountTolerance: Double",
        "    public let fixedPointDensityTolerance: Double",
        "    public let fixedPointEnergyTolerance: Double",
        "    public let consecutiveGateTicks: Int",
        "  }",
        "  public struct Interpolation: Sendable {",
        "    public let matrices: String",
        "    public let nuclearRepulsion: String",
        "  }",
        "  public struct ModelTuple: Sendable {",
        "    public let model: String",
        "    public let modelVersion: String",
        "    public let species: String",
        "    public let charge: Int",
        "    public let multiplicity: Int",
        "    public let basis: String",
        "    public let envelope: Envelope",
        "    public let solver: Solver",
        "    public let interpolation: Interpolation",
        "    public let bohrPerAngstrom: Double",
        "    public let quantizationVersion: String",
        "    public let traceVersion: Int",
        "  }",
        "  public struct Units: Sendable { public let distance: String; public let energy: String; public let density: String }",
        "  public struct AOConvention: Sendable { public let labels: [String]; public let axis: String; public let matrixOrder: String; public let eriOrder: [String]; public let occupiedOrbitals: Int; public let electronCount: Int }",
        "  public struct Provenance: Sendable { public let generator: String; public let python: String; public let pyscf: String; public let numpy: String; public let scipy: String; public let blas: String; public let sourceIds: [String] }",
        "  public struct Comparison: Sendable { public let densityMatrixMaxAbs: Double; public let totalEnergyMaxAbs: Double; public let electronCountMaxAbs: Double }",
        "  public struct Oracle: Sendable { public let nodeReplayMaxDensityError: Double; public let nodeReplayMaxEnergyError: Double; public let nodeReplayMaxElectronCountError: Double; public let midpointMaxDensityError: Double; public let midpointMaxEnergyError: Double; public let midpointMaxElectronCountError: Double }",
        "  public struct Node: Sendable {",
        "    public let separationAngstrom: Double",
        "    public let overlap: [Double]",
        "    public let core: [Double]",
        "    public let eri: [Double]",
        "    public let enuc: Double",
        "    public let referenceDensity: [Double]",
        "    public let referenceEnergy: Double",
        "    public let referenceElectronCount: Double",
        "  }",
        "  public struct Midpoint: Sendable {",
        "    public let node: Node",
        "    public let leftNode: Int",
        "    public let rightNode: Int",
        "    public let densityError: Double",
        "    public let energyError: Double",
        "    public let electronCountError: Double",
        "  }",
        "  public static let cassetteVersion = 1",
        f"  public static let model = {swift_string(cassette['model'])}",
        f"  public static let modelVersion = {swift_string(cassette['modelVersion'])}",
        f"  public static let modelTuple = ModelTuple(model: {swift_string(model['model'])}, modelVersion: {swift_string(model['modelVersion'])}, species: {swift_string(model['species'])}, charge: {model['charge']}, multiplicity: {model['multiplicity']}, basis: {swift_string(model['basis'])}, envelope: Envelope(minAngstrom: {swift_number(envelope['minAngstrom'])}, maxAngstrom: {swift_number(envelope['maxAngstrom'])}, spacingAngstrom: {swift_number(envelope['spacingAngstrom'])}, nodeCount: {envelope['nodeCount']}), solver: Solver(damping: {swift_number(solver['damping'])}, logicalHz: {solver['logicalHz']}, maxIterations: {solver['maxIterations']}, densityTolerance: {swift_number(solver['densityTolerance'])}, energyTolerance: {swift_number(solver['energyTolerance'])}, electronCountTolerance: {swift_number(solver['electronCountTolerance'])}, fixedPointDensityTolerance: {swift_number(solver['fixedPointDensityTolerance'])}, fixedPointEnergyTolerance: {swift_number(solver['fixedPointEnergyTolerance'])}, consecutiveGateTicks: {solver['consecutiveGateTicks']}), interpolation: Interpolation(matrices: {swift_string(interpolation['matrices'])}, nuclearRepulsion: {swift_string(interpolation['nuclearRepulsion'])}), bohrPerAngstrom: {swift_number(model['bohrPerAngstrom'])}, quantizationVersion: {swift_string(model['quantizationVersion'])}, traceVersion: {model['traceVersion']})",
        f"  public static let units = Units(distance: {swift_string(cassette['units']['distance'])}, energy: {swift_string(cassette['units']['energy'])}, density: {swift_string(cassette['units']['density'])})",
        f"  public static let aoConvention = AOConvention(labels: {swift_array(cassette['aoConvention']['labels'])}, axis: {swift_string(cassette['aoConvention']['axis'])}, matrixOrder: {swift_string(cassette['aoConvention']['matrixOrder'])}, eriOrder: {swift_array(cassette['aoConvention']['eriOrder'])}, occupiedOrbitals: {cassette['aoConvention']['occupiedOrbitals']}, electronCount: {cassette['aoConvention']['electronCount']})",
        f"  public static let provenance = Provenance(generator: {swift_string(cassette['provenance']['generator'])}, python: {swift_string(cassette['provenance']['python'])}, pyscf: {swift_string(cassette['provenance']['pyscf'])}, numpy: {swift_string(cassette['provenance']['numpy'])}, scipy: {swift_string(cassette['provenance']['scipy'])}, blas: {swift_string(cassette['provenance']['blas'])}, sourceIds: {swift_array(cassette['provenance']['sourceIds'])})",
        f"  public static let comparison = Comparison(densityMatrixMaxAbs: {swift_number(cassette['comparison']['densityMatrixMaxAbs'])}, totalEnergyMaxAbs: {swift_number(cassette['comparison']['totalEnergyMaxAbs'])}, electronCountMaxAbs: {swift_number(cassette['comparison']['electronCountMaxAbs'])})",
        f"  public static let oracle = Oracle(nodeReplayMaxDensityError: {swift_number(cassette['oracle']['nodeReplayMaxDensityError'])}, nodeReplayMaxEnergyError: {swift_number(cassette['oracle']['nodeReplayMaxEnergyError'])}, nodeReplayMaxElectronCountError: {swift_number(cassette['oracle']['nodeReplayMaxElectronCountError'])}, midpointMaxDensityError: {swift_number(cassette['oracle']['midpointMaxDensityError'])}, midpointMaxEnergyError: {swift_number(cassette['oracle']['midpointMaxEnergyError'])}, midpointMaxElectronCountError: {swift_number(cassette['oracle']['midpointMaxElectronCountError'])})",
        f"  public static let payloadSha256 = {swift_string(cassette['payloadSha256'])}",
        "  public static let nodes: [Node] = [",
    ]
    for node in cassette["nodes"]:
        lines.append(
            "    Node(separationAngstrom: %s, overlap: %s, core: %s, eri: %s, enuc: %s, referenceDensity: %s, referenceEnergy: %s, referenceElectronCount: %s),"
            % (
                swift_number(node["separationAngstrom"]),
                swift_array(node["overlap"]),
                swift_array(node["core"]),
                swift_array(node["eri"]),
                swift_number(node["enuc"]),
                swift_array(node["referenceDensity"]),
                swift_number(node["referenceEnergy"]),
                swift_number(node["referenceElectronCount"]),
            )
        )
    lines.extend(["  ]", "  public static let midpoints: [Midpoint] = ["])
    for midpoint in cassette["midpoints"]:
        lines.append(
            "    Midpoint(node: Node(separationAngstrom: %s, overlap: %s, core: %s, eri: %s, enuc: %s, referenceDensity: %s, referenceEnergy: %s, referenceElectronCount: %s), leftNode: %s, rightNode: %s, densityError: %s, energyError: %s, electronCountError: %s),"
            % (
                swift_number(midpoint["separationAngstrom"]),
                swift_array(midpoint["overlap"]),
                swift_array(midpoint["core"]),
                swift_array(midpoint["eri"]),
                swift_number(midpoint["enuc"]),
                swift_array(midpoint["referenceDensity"]),
                swift_number(midpoint["referenceEnergy"]),
                swift_number(midpoint["referenceElectronCount"]),
                midpoint["leftNode"],
                midpoint["rightNode"],
                swift_number(midpoint["densityError"]),
                swift_number(midpoint["energyError"]),
                swift_number(midpoint["electronCountError"]),
            )
        )
    lines.extend(["  ]", "}", ""])
    return "\n".join(lines)


def write_outputs(cassette: dict[str, Any], fixture_path: Path, typescript_path: Path, swift_path: Path) -> None:
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    typescript_path.parent.mkdir(parents=True, exist_ok=True)
    swift_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_text = json.dumps(cassette, indent=2, ensure_ascii=False) + "\n"
    fixture_path.write_text(fixture_text, encoding="utf-8")
    canonical_payload = json.loads(fixture_text)
    typescript = (
        "// Generated by scripts/native/generate-h2-rhf-cassette.py; do not edit.\n"
        'import type { H2RHFCassette } from "../../packages/universe-contracts/src/h2-rhf.ts";\n\n'
        "export const H2_RHF_CASSETTE: H2RHFCassette = "
        + json.dumps(canonical_payload, indent=2, ensure_ascii=False)
        + ";\n\nexport default H2_RHF_CASSETTE;\n"
    )
    typescript_path.write_text(typescript, encoding="utf-8")
    swift_path.write_text(render_swift(canonical_payload), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=root / "scripts/native/fixtures/h2-rhf-v1.json")
    parser.add_argument("--typescript", type=Path, default=root / "src/lib/h2-rhf-cassette.generated.ts")
    parser.add_argument("--swift", type=Path, default=root / "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/H2RHFCassette.generated.swift")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    expected = {"pyscf": PYSCF_VERSION, "numpy": NUMPY_VERSION, "scipy": SCIPY_VERSION}
    actual = {"pyscf": getattr(__import__("pyscf"), "__version__", "unknown"), "numpy": np.__version__}
    import scipy

    actual["scipy"] = scipy.__version__
    for name, version in expected.items():
        if actual[name] != version:
            raise SystemExit(f"{name} {actual[name]} is unsupported; install {name}=={version} in the isolated generator environment")
    cassette = make_cassette()
    write_outputs(cassette, args.fixture, args.typescript, args.swift)
    print(f"generated {args.fixture} payload {cassette['payloadSha256']}")
    print(f"oracle {json.dumps(cassette['oracle'], sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
