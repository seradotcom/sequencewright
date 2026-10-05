# Sequencewright design system

Sequencewright uses an **Operate** visual mode: a professional editor should disappear into the editing task rather than behave like a marketing dashboard. The current product already has a coherent visual world, so this document records and constrains that incumbent system instead of replacing it.

## Interaction model

The main desktop composition follows professional audiovisual-editor conventions without cloning any one product:

- project/scene explorer on the left;
- primary canvas or task workspace in the center;
- contextual inspector on the right;
- persistent sequence timeline below the canvas;
- transport controls attached to the viewer rather than floating as decoration;
- task workspaces for Brief, Narrative, Storyboard, Canvas, Alternatives, Changes, Dependencies, Review and Deliver;
- a command palette and keyboard playback/undo shortcuts for repeated operations.

Reference research used official product documentation for the category: DaVinci Resolve's Media Pool/viewer/timeline separation and stacked-timeline workflows; Adobe Premiere's Program Monitor, timeline, J/K/L transport and context-sensitive Properties panel; and Descript's coexistence of script/storyboard/timeline with hideable panels. Those patterns informed information architecture only. Sequencewright retains its own application model, terminology and visual assets.

## Visual character

- Restrained neutral surfaces with one functional accent for primary action, selection and focus.
- Dense professional information layout; no hero metrics, glass cards, decorative gradients or dashboard tile grids.
- UI typography uses a familiar sans; monospace is reserved for revisions, time/data and technical identifiers.
- Borders and elevation communicate hierarchy once, not simultaneously as ornamental card effects.
- Corner radii remain moderate. Pills are limited to compact status badges and controls.
- Icons come from the project's authored SVG symbol set; emoji and Unicode stand-ins are not used as controls.
- Dark and light themes are first-class because creators may work for long sessions in different ambient-light conditions.

## State and evidence language

Sequencewright distinguishes four kinds of visual truth:

1. **Editable design preview** — browser SVG approximation used for authoring.
2. **Application state** — persisted revision, branch, lock, proposal and review data.
3. **Native production evidence** — only data returned by a verified Semwright Host/driver call and bound to a source revision/digest.
4. **Unknown / not run** — integrations that have not produced canonical evidence.

The interface must never recolor an unknown integration into a success state merely because a local operation completed. Native render, Graph and Effects language always states coverage.

## Accessibility and motion

- Controls keep explicit accessible names and visible keyboard focus.
- Text and placeholders target WCAG contrast appropriate to their size.
- Most state transitions stay in the 150–250 ms range.
- Reduced-motion preferences are respected.
- Playback/dragging convey task state; there is no orchestrated page-load animation.
- Empty, loading, error, disabled, hover, active and selected states are part of the component vocabulary.
- Responsive behavior changes structure: narrow widths hide/collapse secondary panels rather than shrinking desktop typography indiscriminately.

## Product-specific rules

- Timeline time is frame-based and half-open intervals stay visible in labels/forms where ambiguity matters.
- Destructive-looking history actions are worded as restore/new revision because prior revisions are preserved.
- A/B alternatives remain separate from active content until explicitly accepted.
- Review comments show their original revision/frame anchor.
- The canvas always labels itself as a design approximation until native rendering has supplied real pixels.
- Deliver separates editable handoff from native production; an export control never implies an MP4 exists unless a native receipt actually does.

## Quality floor

The project-scoped Impeccable skill at `.agents/skills/impeccable` is a development aid only and is not part of the source package. Its Operate/craft guidance is applied as a quality floor: consistent components, deliberate hierarchy, keyboard states, responsive structure, no decorative slop and bounded screenshot review. No global skill or hook installation is required.
