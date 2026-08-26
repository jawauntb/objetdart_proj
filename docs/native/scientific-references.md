# native scientific references

## use of sources

These sources constrain the Release 1 reduced models and the later chemistry
instruments declared in the native manifest. They are not runtime
dependencies, nor permission to claim a broader model than the corresponding
simulation contract declares. The settled runtime `SimulationContract` does
not carry citations; the matching scene's
`requirements.science.evidence.sourceIds` carries these stable IDs, alongside
the scientific review record and release evidence.

## wave and spectrum

| source ID | reference | release use |
| --- | --- | --- |
| `wave-fdtd-taflove-hagness-2005` | Taflove, A. & Hagness, S. C. *Computational Electrodynamics: The Finite-Difference Time-Domain Method*, 3rd ed., Artech House (2005). | finite-difference stability, boundary conditions, and the stated limits of a discretized wave field |
| `wave-cooley-tukey-1965` | Cooley, J. W. & Tukey, J. W. “An algorithm for the machine calculation of complex Fourier series.” *Mathematics of Computation* 19, 297–301 (1965). DOI: [10.1090/S0025-5718-1965-0178586-1](https://doi.org/10.1090/S0025-5718-1965-0178586-1). | FFT reference cases and forward/inverse reconstruction |
| `wave-nist-dlmf` | NIST Digital Library of Mathematical Functions, Chapter 1: Algebraic and Analytic Methods. | Fourier conventions and analytical comparison cases; fixture metadata names the normalization explicitly |

## cellular colony

| source ID | reference | release use |
| --- | --- | --- |
| `cell-turing-1952` | Turing, A. M. “The Chemical Basis of Morphogenesis.” *Philosophical Transactions of the Royal Society B* 237, 37–72 (1952). DOI: [10.1098/rstb.1952.0012](https://doi.org/10.1098/rstb.1952.0012). | reaction-diffusion as a bounded environmental model, not a claim to reproduce an organism |
| `cell-murray-2002` | Murray, J. D. *Mathematical Biology I: An Introduction*, 3rd ed., Springer (2002). DOI: [10.1007/b98868](https://doi.org/10.1007/b98868). | stability, nondimensionalization, and interpretation of reduced reaction-diffusion cases |
| `cell-alberts-2022` | Alberts, B. et al. *Molecular Biology of the Cell*, 7th ed., W. W. Norton (2022). | biological vocabulary and limits for membranes, lineage, nutrient competition, and engulfment |

## solar formation

| source ID | reference | release use |
| --- | --- | --- |
| `solar-murray-dermott-1999` | Murray, C. D. & Dermott, S. F. *Solar System Dynamics*, Cambridge University Press (1999). DOI: [10.1017/CBO9781139174817](https://doi.org/10.1017/CBO9781139174817). | Kepler elements, resonance, two-body reference cases, and the meaning of orbital quantities |
| `solar-wisdom-holman-1991` | Wisdom, J. & Holman, M. “Symplectic maps for the n-body problem.” *The Astronomical Journal* 102, 1528–1538 (1991). DOI: [10.1086/115978](https://doi.org/10.1086/115978). | the choice and stated error behavior of a symplectic reduced N-body integrator |
| `solar-hairer-lubich-wanner-2006` | Hairer, E., Lubich, C. & Wanner, G. *Geometric Numerical Integration*, 2nd ed., Springer (2006). DOI: [10.1007/3-540-30666-8](https://doi.org/10.1007/3-540-30666-8). | long-run energy behavior, timestep limits, and why numerical conservation is tolerance-based |

## molecular chemistry

| source ID | reference | release use |
| --- | --- | --- |
| `chemistry-iupac-gold-book` | IUPAC. *Compendium of Chemical Terminology (the Gold Book)*, online 5th ed. | canonical terminology for compounds, bonds, geometry, and reaction language |
| `chemistry-nist-webbook` | NIST. *Chemistry WebBook*, SRD 69. | reference thermochemical values and infrared/vibrational vocabulary for the curated compound register |
| `chemistry-alberts-2022` | Alberts, B. et al. *Molecular Biology of the Cell*, 7th ed., W. W. Norton (2022). | molecular structure vocabulary and the declared boundary before biological chemistry |
| `h2-rhf-roothaan-1951` | Roothaan, C. C. J. “New Developments in Molecular Orbital Theory.” *Reviews of Modern Physics* 23, 69–89 (1951). DOI: [10.1103/RevModPhys.23.69](https://doi.org/10.1103/RevModPhys.23.69). | the closed-shell restricted Hartree–Fock matrix construction used by the two-AO H₂ fixed-point map |
| `h2-rhf-pyscf-sun-2018` | Sun, Q. et al. “PySCF: the Python-based simulations of chemistry framework.” *WIREs Computational Molecular Science* 8, e1340 (2018). DOI: [10.1002/wcms.1340](https://doi.org/10.1002/wcms.1340). | the pinned PySCF 2.6.2 offline oracle that generated 25 cassette nodes and 24 independent midpoint references; PySCF does not ship in either client |
| `h2-self-consistency-khan-2026` | Khan, D. et al. [“Learning the Kohn–Sham map with neural operators for quasi-linear scaling density functional theory.”](https://tensorlab.cms.caltech.edu/users/anima/ks_fno/KS-FNO-manuscript.pdf) Manuscript (2026). | inspiration for exposing self-consistent correction and refusal; it is not authority for this RHF instrument, and no KS-FNO weights, DFT claim, or runtime learned model are used |

## atomic structure and fusion

| source ID | reference | release use |
| --- | --- | --- |
| `atoms-nist-asd` | NIST. *Atomic Spectra Database*, version 5.12. | measured energy levels, shell transitions, and spectral identity |
| `atoms-iupac-periodic-table` | IUPAC. *Periodic Table of the Elements*, current standard release. | element identity, atomic number, shell register, and periodic naming |
| `atoms-cowan-1981` | Cowan, R. D. *The Theory of Atomic Structure and Spectra*. University of California Press (1981). | reduced shell, covalence, and binding-energy approximations; not a claim of a full quantum solver |

## review practice

A reviewer records the source IDs actually used, model version, reference
case, validity range, approximation, and approval decision in the scene's
scientific review record; its immutable ID, reviewer ID, and approval link are
then recorded in `requirements.science.evidence`. The listed sources do not turn
visual plausibility into validation: a changed integrator, unit convention,
or perceptual mapping must be reviewed against the changed contract and its
fixtures.

The bounded H₂ approval is recorded at
`docs/native/reviews/h2-rhf-v1.json`. Its hash is repeated in the native
manifest, so any reviewed scientific or perceptual artifact drift fails the
release gate until a new internal audit is stamped.
