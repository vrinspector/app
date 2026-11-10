# Commissioning guide excerpts for ITP templates

Source: Stacey Roberts, *From Blueprint to Operation: The Complete Industrial Commissioning and Startup Guide*. Owner's own published work; reproduced with her permission (2026-11-10). Check numbers against the governing code before use.

## Appendix A — Commissioning checklists by discipline

These checklists are designed to be photocopied or printed for direct field use. Each line item includes a checkbox, description, acceptance criteria, and space for signature and date. The commissioning manager must ensure that every item is completed, signed, and dated before the system advances to the next commissioning phase. No item may be left blank — if not applicable, write “N/A” with justification and initial.

Instructions for Use:

-   Complete one checklist per system or subsystem as defined in the system breakdown structure.
-   All items must be verified by the responsible discipline lead and countersigned by the commissioning manager.
-   Any item that does not meet acceptance criteria must be recorded on the punch list with a priority classification (A, B, or C) per Chapter 6.
-   Completed checklists become part of the permanent turnover dossier (see Chapter 22).

A-1: Pre-Commissioning Readiness Checklist

System/Subsystem: __________________ System Number: __________________ Project: __________________ Date: __________________ Prepared By: __________________ Reviewed By: __________________

This checklist confirms that all prerequisites are satisfied before any commissioning activity begins on a system. Every item must show “PASS” or “N/A” before the commissioning manager authorizes commencement of cold commissioning activities.

  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  #    Item Description                                                  Acceptance Criteria                                                                                                               ☐   Sign/Date
  ---- ----------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------- --- --------------
  1    Mechanical completion certificate issued for this system          MC certificate signed by construction manager and QC manager; no outstanding A-punch items                                        ☐   _________

  2    All A-punch items closed; B-punch list documented                 Zero open A-items confirmed; B-list reviewed and accepted by commissioning manager as non-blocking                                ☐   _________

  3    Turnover package received and reviewed                            Package contains all required documents per turnover index (see Book 1, Chapter 15); red-line markups included                    ☐   _________

  4    P&IDs verified against field installation                         Walk-down confirms piping routing, valve locations, instrument locations, and equipment orientation match latest revision P&IDs   ☐   _________

  5    Electrical drawings verified against field installation           Single-line diagrams, cable schedules, and termination drawings match as-installed conditions                                     ☐   _________

  6    Instrument data sheets available for all instruments in system    Current revision data sheets on file; calibration ranges confirmed against process requirements                                   ☐   _________

  7    Loop diagrams available for all control loops in system           Current revision loop diagrams on file; signal types, ranges, and failure modes documented                                        ☐   _________

  8    Vendor O&M manuals received for all major equipment               Manuals on file for every tagged equipment item; startup/commissioning sections flagged and reviewed                              ☐   _________

  9    Operating procedures drafted for this system                      Draft SOPs available covering normal startup, normal shutdown, emergency shutdown, and abnormal conditions                        ☐   _________

  10   Commissioning procedures approved for this system                 System-specific commissioning procedures reviewed and signed by commissioning manager and operations representative               ☐   _________

  11   Hazard review (PHA/HAZOP) recommendations resolved or addressed   All action items from PHA/HAZOP applicable to this system are closed or formally deferred with management approval                ☐   _________

  12   Construction power available and verified                         Temporary or permanent power supply energized and tested; voltage, phase, and grounding confirmed at MCC or switchgear            ☐   _________

  13   Construction utilities available (air, water, nitrogen)           Utility supplies tested and confirmed at required flow rates and pressures for commissioning activities                           ☐   _________

  14   DCS/PLC powered and communicating                                 Control system powered, I/O modules communicating, and system-level configuration loaded and verified                             ☐   _________

  15   LOTO procedures established and personnel trained                 Commissioning-phase LOTO procedure in place; all commissioning team members trained and verified (see Chapter 20)                 ☐   _________

  16   Permit-to-work system operational                                 PTW system active for the commissioning area; issuing authority designated; forms available                                       ☐   _________

  17   System boundaries defined and isolation points identified         Physical system boundaries documented on marked-up P&IDs; isolation valves and blinds identified and tagged                       ☐   _________

  18   Exclusion zones established for first energization areas          Barricades, signage, and restricted access controls in place per Chapter 13 first energization protocol                           ☐   _________

  19   Commissioning team mobilized and briefed                          All discipline leads on site; kick-off meeting held; communication protocols established; contact list distributed                ☐   _________

  20   Operator training started or scheduled                            Operations personnel assigned; training schedule issued covering system-specific procedures and emergency response                ☐   _________

  21   Safety equipment staged                                           Fire extinguishers, spill kits, first aid supplies, gas monitors, and emergency PPE staged in commissioning area                  ☐   _________

  22   Communication systems tested                                      Radios, PA system, and emergency notification system tested and operational in commissioning area                                 ☐   _________

  23   Environmental permits and notifications complete                  All required environmental permits active; regulatory notifications filed per applicable state/federal requirements               ☐   _________

  24   Chemical management plan in place                                 SDS sheets on file for all commissioning chemicals; storage, handling, and disposal procedures documented                         ☐   _________

  25   Preservation status verified                                      All preserved equipment inspected; preservation measures current and adequate; no expired preservation items                      ☐   _________
  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Commissioning Manager Authorization:

I confirm that all prerequisites above have been satisfied and authorize commencement of cold commissioning activities for this system.

Signature: __________________ Date: __________________ Time: __________________

A-2: Cold Commissioning Checklist (Per System)

System/Subsystem: __________________ System Number: __________________ Project: __________________ Date: __________________ Prepared By: __________________ Reviewed By: __________________

Cold commissioning activities are performed without process fluids, hazardous materials, or operating temperatures/pressures. These activities verify that equipment and systems function correctly under benign conditions before introducing process materials.

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  #    Item Description                                        Acceptance Criteria                                                                                                                            ☐   Sign/Date
  ---- ------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------- --- --------------
  1    Pre-commissioning readiness checklist (A-1) complete    All 25 items signed off; commissioning manager authorization obtained                                                                          ☐   _________

  2    Piping flushed or blown per procedure                   Flush water clarity meets NAS 1638 Class or visual cleanliness standard; debris screens inspected and clean; flow velocity ≥1.5 m/s achieved   ☐   _________

  3    Piping hydrostatic test complete and accepted           Test pressure held at 1.5× design per ASME B31.3 for minimum 10 minutes; no visible leaks; pressure drop <2% of gauge range                    ☐   _________

  4    Vessel/tank hydrostatic test complete and accepted      Test per ASME Section VIII or API 650 as applicable; test certificates signed by authorized inspector                                          ☐   _________

  5    Pressure relief devices installed and verified          PSVs installed at correct locations; set pressures verified against data sheets; tag numbers match P&ID                                        ☐   _________

  6    Instrument calibration complete — all loops             Five-point ascending/descending calibration per Appendix E-1; as-left errors within ±0.5% of span or per data sheet                            ☐   _________

  7    Loop checks complete — all loops                        Field-to-DCS signal verified per IEC 62382 using Appendix E-2; signal reads correctly at DCS; alarms trigger at setpoints                      ☐   _________

  8    Control valve stroke testing complete                   All control valves stroked full range from DCS; fail position verified against data sheet; positioner calibrated                               ☐   _________

  9    On/off valve verification complete                      All automated on/off valves cycled from DCS; open/close times recorded; limit switch feedback confirmed                                        ☐   _________

  10   Motor insulation resistance (Megger) testing complete   All motors Megger tested per IEEE 43; minimum 100 MΩ at 500 VDC (motors <1 kV) or corrected to 40°C; results recorded                          ☐   _________

  11   Motor bump test / rotation check complete               All motors bumped to confirm correct rotation direction; rotation verified against equipment requirements                                      ☐   _________

  12   Motor solo run test complete                            Motors run unloaded per Appendix F; bearing temperatures stable; vibration within ISO 10816 limits; no-load current recorded                   ☐   _________

  13   Electrical protection relay settings verified           Relay settings match coordination study; trip values confirmed by secondary injection test; test reports on file                               ☐   _________

  14   Cable Megger testing complete                           All power and control cables tested; insulation resistance meets NETA ATS minimums; results logged                                             ☐   _________

  15   Transformer testing complete                            TTR, polarity, power factor, winding resistance, and oil analysis complete per IEEE C57.12 and NETA ATS; results acceptable                    ☐   _________

  16   UPS / battery systems tested                            UPS load bank tested; battery discharge test performed; backup duration meets design specification                                             ☐   _________

  17   DCS/PLC sequence simulation complete                    All automated sequences tested in simulation mode; outputs verified against control narrative; sequence timing confirmed                       ☐   _________

  18   Alarm rationalization complete                          All alarms reviewed per ISA 18.2; nuisance alarms suppressed; alarm setpoints confirmed against process requirements                           ☐   _________

  19   Fire and gas detection system tested                    All detectors bump tested; alarm and trip functions verified at fire alarm panel and DCS; cause-and-effect confirmed                           ☐   _________

  20   Fire suppression systems tested                         Sprinkler trip tests, deluge valve tests, or clean agent discharge tests complete per NFPA 3; systems restored and armed                       ☐   _________

  21   Emergency shutdown (ESD) system tested                  All SIF loops tested per IEC 61511; cause-and-effect matrix fully verified; fail-safe positions confirmed                                      ☐   _________

  22   Grounding system tested                                 Ground resistance ≤5 Ω per NFPA 70/NEC; all equipment bonding connections verified; test report on file                                        ☐   _________

  23   Rotating equipment alignment verified                   Laser alignment performed; misalignment within vendor-specified tolerances; alignment report signed                                            ☐   _________

  24   Piping reinstatement after testing complete             All test blinds removed; permanent gaskets installed; torque values per ASME PCC-1; reinstatement walked down and signed                       ☐   _________

  25   Punch list updated                                      All new items from cold commissioning added to punch list with priority classification; no A-items remaining                                   ☐   _________
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Cold Commissioning Completion Authorization:

I confirm that all cold commissioning activities are complete and authorize this system to proceed to hot commissioning / RFSU review.

Signature: __________________ Date: __________________ Time: __________________

A-3: Hot Commissioning Checklist (Per System)

System/Subsystem: __________________ System Number: __________________ Project: __________________ Date: __________________ Prepared By: __________________ Reviewed By: __________________

Hot commissioning involves the introduction of process fluids, elevated temperatures, elevated pressures, or hazardous materials. All activities below must be executed under a formal permit-to-work system with appropriate safety controls in place.

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  #    Item Description                                              Acceptance Criteria                                                                                                                            ☐   Sign/Date
  ---- ------------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------- --- --------------
  1    Cold commissioning checklist (A-2) complete for this system   All 25 items signed off; cold commissioning completion authorization obtained                                                                  ☐   _________

  2    RFSU checklist (A-4) complete and signed                      All RFSU items verified; RFSU authorization signed by commissioning manager and operations manager                                             ☐   _________

  3    PSSR complete (where required by PSM)                         PSSR checklist (Appendix C) fully executed and signed; all PSSR findings resolved or formally accepted                                         ☐   _________

  4    Operating procedures finalized and distributed                Final SOPs issued to operators; emergency procedures posted in control room and field; operator sign-off on file                               ☐   _________

  5    Operator training complete and verified                       All assigned operators have completed system-specific training; competency verified by examination or demonstration                            ☐   _________

  6    Process fluid introduction procedure approved                 Step-by-step fluid introduction procedure reviewed and approved by operations, commissioning, and process engineering                          ☐   _________

  7    Leak test at operating conditions complete                    System pressurized with process fluid or nitrogen to operating pressure; all flanges, connections, and seals inspected; zero leaks confirmed   ☐   _________

  8    Thermal expansion verification (where applicable)             System heated to operating temperature; pipe shoe movement, spring hanger positions, and expansion joint deflections verified against design   ☐   _________

  9    Process fluid quality confirmed                               Feed material analyzed; meets process input specifications for composition, temperature, and contaminants                                      ☐   _________

  10   Utility systems at full operating conditions                  Steam, cooling water, instrument air, nitrogen, and other utilities at design flow rates, pressures, and temperatures                          ☐   _________

  11   Rotating equipment loaded run complete                        Pumps, compressors, and fans run at operating conditions; performance curves verified; vibration within ISO 10816 limits                       ☐   _________

  12   Heat exchangers at operating conditions                       Process-side and utility-side at design conditions; approach temperatures, pressure drops, and flow rates verified against data sheets         ☐   _________

  13   Control loops tuned at operating conditions                   All PID loops tuned with process fluid; response to setpoint changes and disturbances verified; control stability confirmed                    ☐   _________

  14   Process interlocks tested with live process                   All process interlocks verified at actual process conditions; trip setpoints confirmed; reset functions verified                               ☐   _________

  15   Analyzer systems validated                                    Online analyzers calibrated with process samples; readings cross-checked against lab analysis; within specified accuracy                       ☐   _________

  16   Flare/vent systems operational                                Flare ignited and stable (or vent system open); knockout drum level controls verified; molecular seal or purge confirmed                       ☐   _________

  17   Waste handling systems operational                            Wastewater treatment, solid waste handling, and emission control systems operating within permit limits                                        ☐   _________

  18   Product quality on-specification                              Product samples analyzed; meet specification for all quality parameters; off-spec product routing verified                                     ☐   _________

  19   Throughput ramped to design rate                              Production rate increased stepwise per startup plan; design throughput achieved and sustained for minimum 4 hours                              ☐   _________

  20   72-hour continuous operation complete                         System operated continuously for 72 hours at ≥80% design rate; no unplanned shutdowns; all parameters within limits                            ☐   _________

  21   Vibration baseline survey complete                            Full baseline vibration survey per ISO 10816 on all rotating equipment at operating conditions; data stored in monitoring system               ☐   _________

  22   Shift handover procedures in practice                         Minimum three shift handovers completed successfully; handover logs reviewed and acceptable                                                    ☐   _________

  23   Emergency response drill conducted                            At least one emergency drill (fire, spill, or evacuation) conducted with commissioning/operations crew; deficiencies corrected                 ☐   _________

  24   Environmental monitoring confirmed                            Stack emissions, wastewater discharge, and ambient monitoring within permit limits at operating conditions; data logged                        ☐   _________

  25   System accepted for performance testing                       All hot commissioning items above complete; system declared ready for performance test per Chapter 11 criteria                                 ☐   _________
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Hot Commissioning Completion Authorization:

I confirm that all hot commissioning activities are complete and this system is accepted for performance testing or operational handover.

Commissioning Manager: __________________ Date: __________________ Operations Manager: __________________ Date: __________________

A-4: RFSU Checklist (Ready for Startup)

System/Subsystem: __________________ System Number: __________________ Project: __________________ Date: __________________ Prepared By: __________________ Reviewed By: __________________

RFSU is the formal gate between cold commissioning and the introduction of process fluids, hazardous materials, or operating conditions. This checklist must be fully executed before any hot commissioning activity begins. The RFSU review requires participation from commissioning, operations, safety, process engineering, and construction (if work continues in adjacent areas).

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  #    Item Description                                Acceptance Criteria                                                                                                      ☐   Sign/Date
  ---- ----------------------------------------------- ------------------------------------------------------------------------------------------------------------------------ --- --------------
  1    Cold commissioning complete for this system     Checklist A-2 fully signed; cold commissioning authorization obtained                                                    ☐   _________

  2    All A-punch and blocking B-punch items closed   Zero outstanding items that affect safety, operability, or environmental compliance                                      ☐   _________

  3    PSSR complete (PSM-covered facilities)          PSSR checklist (Appendix C) executed; all findings resolved; PSSR authorization signed                                   ☐   _________

  4    Safety instrumented systems validated           All SIFs tested and certified per IEC 61511; SIS logic solver in “run” mode; bypass management in place                  ☐   _________

  5    Fire and gas detection systems operational      All detectors in service; F&G logic verified; suppression systems armed; fire alarm panel in normal mode                 ☐   _________

  6    Emergency shutdown system armed                 ESD system in run mode; all ESD push buttons tested; cause-and-effect verified (see Chapter 17)                          ☐   _________

  7    Pressure relief devices in service              All PSVs installed; isolation valves (if any) locked open; car seals verified; PSV register updated                      ☐   _________

  8    Electrical systems energized and stable         All switchgear, MCCs, and distribution panels energized; no alarms; protection systems armed                             ☐   _________

  9    DCS/PLC in full operational mode                All I/O in scan; control schemes active; historization running; operator displays configured and tested                  ☐   _________

  10   Operating procedures in place and accessible    Final SOPs printed, posted, and electronically accessible; emergency procedures posted at operator stations              ☐   _________

  11   Operator training verified                      Training records on file for all operators assigned to this system; competency sign-off by operations supervisor         ☐   _________

  12   Communication systems operational               Control room phone, radio system, PA system, and emergency notification system tested on day of RFSU                     ☐   _________

  13   LOTO transitioned to operations protocol        Construction LOTO tags removed; operations LOTO procedure active; all personnel briefed on new protocol (Chapter 20)     ☐   _________

  14   Permit-to-work system active                    Hot work, confined space, and line break permits available; issuing authorities designated; permit boards posted         ☐   _________

  15   SIMOPS controls in place (if applicable)        Construction/commissioning boundary defined; physical barriers installed; communication protocols active (Chapter 19)    ☐   _________

  16   Process fluids / hazardous materials staged     Chemicals, catalysts, and process fluids on site; SDS sheets posted; handling and loading procedures reviewed            ☐   _________

  17   Environmental controls operational              Emission control, wastewater treatment, and containment systems operational and tested; permits active                   ☐   _________

  18   Area classification verified                    Hazardous area classifications confirmed; electrical equipment in classified areas verified as appropriate rating        ☐   _________

  19   Temporary facilities removed or secured         Temporary construction power, scaffolding, laydown areas, and debris cleared from operating area                         ☐   _________

  20   As-built drawings available                     Red-lined P&IDs, electrical drawings, and instrument drawings available in control room reflecting actual installation   ☐   _________

  21   Spare parts inventory verified                  Critical startup spares on site; spare parts list reviewed by operations and maintenance; storage locations documented   ☐   _________

  22   Vendor representatives scheduled                Required vendor reps confirmed on site or on call for startup (per equipment criticality); contact list distributed      ☐   _________

  23   Startup sequence reviewed and approved          Step-by-step startup procedure reviewed in team meeting; roles assigned; hold points identified                          ☐   _________

  24   Night/weekend staffing plan in place            Shift coverage confirmed for continuous operations; on-call roster for engineering and management distributed            ☐   _________

  25   Management of change (MOC) review complete      All field changes during commissioning documented per MOC procedure; PSI updated; PHA revalidated if required            ☐   _________
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

RFSU Authorization:

We confirm that this system has been reviewed and is Ready for Startup. Authorization is granted to introduce process fluids and commence hot commissioning activities.

  ----------------------------------------------------------------------------------------------
  Role                               Name (Print)              Signature             Date
  ---------------------------------- ------------------------- --------------------- -----------
  Commissioning Manager              ____________              ____________          ______

  Operations Manager                 ____________              ____________          ______

  Safety Manager / PSM Coordinator   ____________              ____________          ______

  Process Engineer                   ____________              ____________          ______

  Construction Manager (if SIMOPS)   ____________              ____________          ______
  ----------------------------------------------------------------------------------------------

