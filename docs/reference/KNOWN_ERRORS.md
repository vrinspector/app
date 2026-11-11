# Known-errors list — book figures not used as acceptance values

Draft prepared in increment 13.9 for the owner to confirm or correct
(decision 67 in `docs/SCREENS.md`). The plan refers to "the known-errors
list"; no such list was found in the repo, the Claude Project or the Dropbox
transfer package, so this one was drawn up by checking the figures in
`FIELD_GUIDE_EXCERPTS.md` and `COMMISSIONING_GUIDE_EXCERPTS.md` against the
standards they cite.

Every figure below appears in the starter library as **"Project-specific value
required — verify before issue."** instead of the number. A backend test
(`tests/core/test_itp_library.py::KNOWN_ERROR_FIGURES`) fails if one of these
figures comes back into a criterion. Remove a row (and its pattern in the
test) to restore a figure the owner confirms.

The "what the standard says" column is the session's reading and is itself to
be verified before it is used anywhere.

| Book, place | Book figure | Why it is listed | What the standard says (to verify) |
|---|---|---|---|
| Field guide Ch. 5 (rebar) | Tolerance "plus or minus 3 inches for d" and "plus or minus 1/2 inch for clear cover" | ACI 318 / ACI 117 tolerances on d and cover are fractions of an inch and depend on member depth | ±3/8 in for d ≤ 8 in, ±1/2 in for d > 8 in; cover tolerance not more than −1/3 of the specified cover |
| Field guide Ch. 5 (cover) | 1.5 in for interior slabs and walls; 2 in for exposed bars No. 5 and smaller | Does not match ACI 318 Table 20.5.1.3.1 | Interior slabs / walls / joists (No. 11 and smaller): 3/4 in; exposed to weather or earth: 1-1/2 in for No. 5 and smaller, 2 in for No. 6–18; cast against and permanently exposed to earth: 3 in (kept) |
| Field guide Ch. 5 (anchor bolts) | "typically plus or minus 1/8 inch from true position" | Tolerance is set by the drawings / AISC Code of Standard Practice and differs within a group vs. group centre | Set on the drawings; AISC COSP: 1/8 in centre-to-centre within a group, 1/4 in group centre to control line |
| Field guide Ch. 5 (testing frequency) | One test set per 50 yd³ or half-day, plus first and last truck | Project-dependent; ACI 318 / ACI 301 minimum is different | ACI 318 §26.12: at least once a day, per 150 yd³ and per 5,000 ft² of slab or wall |
| Field guide Ch. 5 (slump) | Cone lifted "in 5 to 6 seconds" | Procedure detail differs from ASTM C143 | ASTM C143: 5 ± 2 s (procedure left to the standard) |
| Field guide Ch. 5 (temperature) | Thermometer inserted "at least 4 inches" | ASTM C1064 states a different cover | ASTM C1064: at least 3 in (75 mm) of concrete around the sensor |
| Field guide Ch. 5 (hot weather) | Max placing temperature 90 °F; triggers 90 °F, RH < 40 %, wind > 15 mph | Set by the specification; ACI 305 gives no fixed trigger | Project specification |
| Field guide Ch. 5 (air) | 5 to 8 % "typically" | Depends on exposure class and aggregate size | ACI 318 Table 19.3.3.1 / project specification |
| Field guide Ch. 5 (cylinders) | "three equal layers, each rodded 25 times (for cylinders up to 4-inch diameter)"; "24 hours before transport" | Rodding layers depend on mold size; initial curing period is up to 48 h | ASTM C31: 4 × 8 in molds in two layers, 6 × 12 in in three, 25 strokes each; initial curing up to 48 h at 60–80 °F (60–80 °F kept) |
| Field guide Ch. 5 (cylinders) | 7-day / 28-day split given two ways (one + one, and two + two) | Inconsistent in the text; set by the specification | Test ages and count per specification; at least four cylinders per set kept |
| Field guide Ch. 5 (placement) | "ACI 318 prohibits free-fall placement from heights exceeding 5 feet" | ACI 318 has no free-fall limit | Project specification (ACI 304R guidance) |
| Field guide Checklist A-2 item 7 | DTI "feeler gauge refusal at ≤0.015-inch gap" | Gauge size and number of gaps come from RCSC / ASTM F959 | RCSC: 0.005 in feeler gauge refused in at least half the spaces (check edition) |
| Field guide Checklist A-2 item 8 | "Bolt threads protrude through nut a minimum of one thread" | RCSC accepts a flush end | RCSC: end of bolt flush with or outside the face of the nut |
| Field guide Checklist A-2 item 15 | "AWS D1.1 Table 6.1" | Table number changed between editions | AWS D1.1 visual acceptance criteria table for the edition in the contract (Table 8.1 in 2020) |
| Field guide Checklist A-2 item 18 | Column plumb "within 1/1000 of height (1/16 per foot maximum)" | Does not match AISC Code of Standard Practice; the two figures also disagree | AISC COSP §7.13: 1/500 of the height between splice points |
| Field guide Checklist A-2 item 22 | Torque wrench calibration within 6 months | Project / RCSC procedure | Project specification; RCSC pre-installation verification |
| Field guide Checklist A-3 items 4, 5, 15 | Gauge calibration within 6 months; relief set ≤110 % of test pressure; 10-minute stabilization | Code / procedure dependent | ASME B31.3 §345.2.1: relief set not above test pressure plus the lesser of 50 psi or 10 % |
| Field guide Checklist A-3 item 17 | Hold "minimum 10 minutes to 1 hour" | Range, not a value | ASME B31.3: at least 10 min (kept as the code minimum); longer per specification |
| Field guide Checklist A-4 item 14 | Megger "500V for ≤600V systems; 1000V for MV" | NETA ATS test voltages differ | NETA ATS: 600 V cable at 1,000 V DC; higher for MV |
| Field guide Checklist A-4 item 15 | 100 MΩ "typical" | Set by specification / NETA ATS table | Project specification |
| Commissioning guide A-2 item 2 | NAS 1638 class; flushing velocity ≥ 1.5 m/s | Procedure / project dependent | Flushing procedure |
| Commissioning guide A-2 item 3 | "pressure drop <2% of gauge range" | Not an ASME B31.3 criterion | B31.3: no leakage; any allowance per specification |
| Commissioning guide A-2 item 6 | As-left within ±0.5 % of span | Per data sheet | Instrument data sheet |
| Commissioning guide A-2 item 10 | Motors minimum 100 MΩ at 500 V DC (< 1 kV) | IEEE 43 minimum depends on winding type | IEEE 43: 100 MΩ for form-wound and post-1970 AC windings; 5 MΩ for random-wound and form-wound below 1 kV (500 V DC test voltage kept) |
| Commissioning guide A-2 item 22 | Ground resistance "≤5 Ω per NFPA 70/NEC" | NEC does not set 5 Ω | NEC 250.53: 25 Ω for a single rod electrode (else a second); 5 Ω is a specification / IEEE value |
| Commissioning guide A-3 items 19, 20 | Design rate "for minimum 4 hours"; "72 hours at ≥80% design rate" | Contract performance criteria | Contract / performance test procedure |

Figures **kept** because they match the cited standard: ACI 318 embedded
conduit (OD ≤ 1/3 slab thickness, ≥ 3 diameters on centre); 3 in cover cast
against earth; ASTM C31 initial curing 60–80 °F; ASTM C1064 reading within 5
minutes; ACI 306 cold-weather definition (40 °F) and 50 °F protection and
~500 psi before freezing; ACI 308 seven-day curing; ASME B31.3 hydrotest
1.5 × design and 10-minute minimum; NEC 500.8 five full threads; NEC 501.15
seals; IEEE 43 500 V DC test voltage below 1 kV; five-point calibration at
0 / 25 / 50 / 75 / 100 %; formwork joint gap 1/16 in and curing within 30
minutes of finishing (field-guide practice, not code values).
