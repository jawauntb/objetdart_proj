# h2-rhf-v1 model and provenance

The cassette is a neutral singlet H₂ molecule in the STO-3G basis, with two
AO functions (`0 H 1s`, `1 H 1s`) on the z axis. The committed envelope is
0.600–1.200 Å at 0.025 Å spacing. PySCF 2.6.2 generates the 25 nodes and
independent checks at all 24 adjacent-node midpoints.

The runtime uses the measured three-node quadratic interpolation for overlap,
core, and ERI matrices. Nuclear repulsion is the exact two-centre Coulomb
value `1 / (R_angstrom × 1.8897261246257702)` Hartree; the payload stores all
numeric leaves at decimal-12 precision and declares a propagated canonical
tolerance for that conversion boundary. ERIs use chemists’ `(μν|λσ)` order.

The offline SCF options are `conv_tol=1e-12`, `conv_tol_grad=1e-10`,
`max_cycle=100`, and `diis_space=8`; the geometry build uses `basis=sto-3g`,
`charge=0`, `spin=0`, `unit=Angstrom`, `cart=false`, spherical overlap
(`int1e_ovlp_sph`) and spherical ERI (`int2e_sph`) integrals. The bounded
runtime replay uses damping 0.5, a 64-iteration budget, and requires two
consecutive fixed-point gate ticks.

The reviewed build used Python 3.11.1, NumPy 1.26.4, SciPy 1.11.4, PySCF
2.6.2, and `openblas64 0.3.23.dev`. `provenance.sourceHash` is the SHA-256 of
the generator source itself. The contract carries these toolchain values plus
all SCF/build options; the verifier rejects any unrecognized toolchain, source
hash, or build option.

The current review anchors are generator
`1aadcc6b7b3718637737f63a29132da7b7733387f4f76278a4ef7fc1a44e74ae`, Swift
source
`91186c0ebe8f7539b1eacbf57aa7bcfedd53754dd6699472ee3f21b210a58dc9`, and
canonicalization vectors
`bbeef961e925cdf901a1a1bace91eb60b69322a815e18120b33ac07edb118926`.
After intentional generator regeneration, review and update the payload,
generator-source, Swift-source, and vector anchors together; `shasum -a 256`
over those four files is the deterministic update procedure.
