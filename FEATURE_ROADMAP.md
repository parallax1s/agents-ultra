# Agents Ultra Feature Roadmap

Date updated: 2026-02-23

Legend:
- `[x]` Done
- `[~]` In progress
- `[ ]` Planned

## Completed

1. [x] Implement belt drag placement and auto-rotation.
2. [x] Implement remove-cycling fallback to right-click behavior.
3. [x] Add adjacent interactive entity detection and stable ordering.
4. [x] Add interactive entity click handling and collision-aware interaction wiring.
5. [x] Add minimap rendering and live updates.
6. [x] Add template save/place/export/import flow.
7. [x] Add runtime CSV/JSON export with runtime metrics.
8. [x] Add paused checkpoint capture/recovery with local history.
9. [x] Add checkpoint restore/clear controls in the control panel.
10. [x] Add conveyor diagnostics trend metrics in HUD.
11. [x] Add per-tile hover debug probe for entity state inspection.
12. [x] Add pause-step and runtime-state interaction checkpointing for all critical state changes.
13. [x] Reduce static render redraw pressure by only redrawing on real state/frame changes.
14. [x] Add contextual no-tool click interactions for chest/furnace interactions (deposit/pickup/refuel).
15. [x] Add coal-priority player refueling with furnace-output fallback.
16. [x] Add in-game automation controls (auto-refuel, auto-pickup, auto-deposit).
17. [x] Expand runtime metrics with transit, chest, and power telemetry for ores/plates/gears/coal.

## In progress / next up

14. [x] Rework click interactions to keep placement and interaction modes explicit and consistent with selected tool.
15. [x] Tune paused power draw behavior and stop background work from consuming resources.
16. [x] Expand collision and occupancy checks to include non-default static blockers.
17. [x] Add deterministic, collision-safe mobile/touch controls for camera + tool placement.
18. [x] Add undo/redo for build/remove actions in runtime and template editing.
19. [x] Add template/blueprint versioning and import validation UX.
20. [x] Add world-state persistence migration and backward-compatible loader.
21. [x] Add accessibility pass: accessible labels, keyboard-only pathways, focus order.
22. [x] Add test coverage for checkpoint restore ordering and save/load compatibility.
23. [x] Add per-lane conveyor visual congestion hints in renderer.
24. [x] Add in-game guided tutorial for tool usage, refuel, and mining loops.
25. [x] Add multiplayer snapshot sharing for templates/checkpoints.
26. [x] Add entity-specific info cards (production/speed) in a dedicated panel.
27. [x] Add save slots and quick slot switching.
28. [x] Add analytics charts for long-running throughput and power behavior.
29. [x] Add performance instrumentation and frame budget logging.
30. [x] Add developer-only debug command palette.

## Planned

31. [x] Add interactive production balancing suggestions in tutorial flow.
32. [x] Add per-entity performance cost visualization in entity cards.
33. [x] Add optional reduced-motion rendering profile for lower-powered devices.
34. [x] Add compact hotkey overlay for touch/keyboard hybrid users.
35. [x] Add export/import of local settings snapshots for sharing preferences.
36. [x] Add optional production heatmap in HUD for lane-specific congestion.
37. [x] Add minimap click-to-center camera navigation.
38. [x] Add keyboard shortcut (M) to center camera on player.
39. [x] Add mouse control button to center camera on player.
40. [x] Add optional auto-follow camera while moving with Alt+M toggle and settings persistence.

## Working rules

- Move `[~]` to `[x]` once behavior and save-path interaction are covered end-to-end.
- Keep one implementation track per pass unless dependencies justify multi-tasking.

## Stretch Features (active)

41. [x] Add checkpoint timeline controls with indexed restore and removal from the control panel.
42. [x] Add camera preset actions for center-on-spawn and camera reset.
43. [x] Add Home/End keyboard shortcuts for camera preset access.
44. [x] Add canvas screenshot export as a runtime artifact.
45. [x] Add richer checkpoint summary panel with human-readable recent timeline entries.
