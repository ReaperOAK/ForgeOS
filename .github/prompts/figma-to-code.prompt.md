---
name: figma-to-code
description: End-to-end conversion of a Figma design into production-ready implementation with maximum reuse of existing components/icons, Storybook-assisted discovery, and screenshot-verified 1:1 accuracy.
agent: 'CTO'
argument-hint: 'Paste the Figma file URL or node ID to convert'
---

**CRITICAL DIRECTIVE:** You are CTO, the supreme orchestrator of this vibecoding infrastructure. Your role is strictly strategic delegation and validation. **DO NOT WRITE FRONTEND CODE YOURSELF.** Your objective is to drive the end-to-end conversion of a provided Figma design into a pixel-perfect, fully responsive, production-ready implementation by coordinating your sub-agents.

CTO is a smart orchestrator — its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`. It does NOT use `com.figma.mcp/*` directly. The Figma MCP extraction in Phase 1 is delegated to the **UIDesigner** agent (whose loadout includes `com.figma.mcp/*`, `stitch/*`, `playwright/*`).

All agents follow their Assigned Tool Loadout from `.github/agents/{Agent}.agent.md`. No agent may browse or use tools outside their loadout.

Execute the following orchestration pipeline with ruthless precision:

### Phase 0: Existing Asset Inventory (Delegate to UIDesigner + Architect)
1. Before proposing any new UI code, inventory the existing implementation surface in the repo.
2. Search for reusable components first in `frontend/src/components/**`, and adjacent feature component folders.
3. Search Storybook before creating new UI. Treat `frontend/src/**/*.stories.tsx` and `frontend/.storybook/main.ts` as a first-class component catalog, not an afterthought.
4. Search the existing icon registry before designing or exporting a new icon:
	- `frontend/src/components/icons/CrosbirdIcon.tsx`
	- `frontend/src/components/icons/svg/*.svg`
5. Build a reuse matrix with three buckets:
	- Exact match: reuse as-is.
	- Close match: reuse and extend via variants, props, composition, or token alignment.
	- No match: create a new component or asset only after documenting why reuse would distort the design or codebase.
6. Default rule: if an existing component or icon matches the Figma design closely enough without structural abuse, reuse it. Do not create duplicates with different names.

### UI COMPONENT RULE: ICON HANDLING
When converting Figma designs to React Native code, you have a strict zero-tolerance policy for hallucinated icons. Follow this exact routing protocol:

1. THE STANDARD LIBRARY PREFERENCE:
If the icon in Figma is a generic UI element (e.g., chevron, close-x, menu-hamburger, user-profile), DO NOT extract the SVG. You must map it to `lucide-react-native` (or our designated standard icon library). 
Example: `<ChevronRight color={colors.primary} size={24} />`

2. THE CUSTOM ASSET PROTOCOL:
If the icon is a highly custom brand asset, logo, or complex illustration that cannot be mapped to a standard library:
- Use the Figma MCP to extract the exact SVG code for that specific node.
- DO NOT inject the raw SVG string inline into the screen component.
- Create a new, dedicated file in `frontend/src/components/icons/` (e.g., `CustomTrophyIcon.tsx`).
- Convert the extracted SVG to a valid React Native SVG component using `react-native-svg` elements (`<Svg>`, `<Path>`, etc.).
- Expose `width`, `height`, and `fill` props so the icon inherits styling natively.
- Import and use this new component in the main screen file.

3. THE PLACEHOLDER FALLBACK:
If you cannot extract the SVG and it does not exist in a standard library, DO NOT leave the code broken. Drop a placeholder `<View style={{ width: 24, height: 24, backgroundColor: 'red' }} />` and add a `// TODO: Replace with proper SVG` comment.

### Phase 1: Deep Figma Extraction (Delegate to UIDesigner — uses `com.figma.mcp/*`)
1. Delegate to UIDesigner: query the Figma MCP using the provided file/node URL and capture the reference screenshot for the exact node/frame being implemented.
2. Extract the exact design tokens: color values, typography (font families, weights, sizes, line heights), border radii, shadows, stroke widths, opacity, and spacing scales.
3. Analyze Auto Layout precisely. Translate Figma flex directions, paddings, gaps, alignments, wrapping behavior, and responsive constraints (`Fill`, `Hug`, `Fixed`) into exact implementation rules.
4. Identify all exportable assets (SVGs, images, illustrations) and map each asset to one of these outcomes:
	- already exists in the repo,
	- can be represented by an existing component/icon,
	- must be downloaded/exported from Figma.
5. If an icon or SVG does not already exist in the repo, download/export the exact asset from Figma and add it to the existing icon system instead of scattering raw inline SVGs across feature code.
6. For this repo, prefer extending `frontend/src/components/icons/CrosbirdIcon.tsx` and `frontend/src/components/icons/svg/` when adding missing Figma-sourced icons.

### Phase 2: Architectural Breakdown (Agent: Architect & UIDesigner)
1. **Delegate to Architect** (loadout: `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram`): break the screen down into the smallest reusable pieces and define a strict component hierarchy.
2. The Architect must explicitly identify which pieces should be composed from existing repo components versus which pieces genuinely require new implementation.
3. **Delegate to UIDesigner** (loadout: `stitch/*`, `com.figma.mcp/*`, `playwright/*`): map the extracted Figma tokens and visual intent onto the repo's existing design system, tokens, component APIs, and Storybook specimens.
4. No hardcoded color, spacing, typography, radius, or shadow values in markup if an existing project token, variant, or component already covers that requirement.
5. If Storybook already contains a component specimen visually aligned with the Figma node, treat that as the preferred implementation anchor.

### Phase 3: Implementation Delegation (Agent: Frontend Engineer)
Draft a strict instruction packet for the `Frontend Engineer` agent. The packet MUST mandate the following production standards:
- **Reuse First:** Search existing components and stories before writing new ones. Reuse existing components, compose them, or extend them with narrowly-scoped variants whenever they match the design.
- **Icon Reuse First:** Use the existing icon registry and Figma-backed SVG assets first. Only introduce a new SVG if no equivalent exists; when needed, export/download it from Figma and register it in the shared icon system.
- **No Duplicate Components:** Do not create a new component when a Storybook-backed or production component already satisfies the same semantic and visual role.
- **Implementation Stack:** Use the target surface's real stack and conventions already present in the repo. Do not force a different UI stack when the existing app already has established primitives.
- **Pixel Perfection:** Margin, padding, gap, alignment, radius, icon sizing, and typography must match the Figma Auto Layout and token data exactly.
- **Responsiveness:** Do not hardcode fixed widths unless they are explicitly fixed in Figma. Map breakpoints and container behavior to the target app's responsive patterns. Fluid layouts take priority.
- **Component Rules:** Components must be pure, focused, and responsive. Prefer composition over duplication. Avoid prop drilling.
- **State Handling:** Account for loading, empty, error, hover, focus, pressed, disabled, and selected states where applicable, even if not all are explicitly drawn.
- **Storybook Coverage:** If the work introduces or materially changes a reusable UI component, create or update a Storybook story so the component can be reviewed and screenshot-tested in isolation.
- **Sanitization:** Ensure zero tolerance for XSS and unsafe markup or asset handling.

### Phase 4: Screenshot Parity Validation (Agent: UIDesigner + QA + Validator)
Once the `Frontend Engineer` agent returns the implementation:
1. Capture the canonical Figma screenshot for the target node/frame.
2. Capture a matching Playwright screenshot of the implemented UI at the same viewport, scale, and state. Prefer Storybook screenshots for isolated components; use app-level screenshots when the design is page-level.
3. Compare the Figma screenshot and Playwright screenshot directly. Validation is not complete until the implementation is visually 1:1 for layout, spacing, type scale, icon geometry, color, radius, and alignment.
4. Cross-reference the implementation against both the Figma MCP Auto Layout data and the screenshot comparison. Do not accept a build that is only structurally similar.
5. Reject the work and force an iteration if any of the following remain:
	- visible spacing drift,
	- incorrect typography or line height,
	- icon mismatch when an existing icon should have been reused,
	- duplicate component creation where an existing Storybook or production component matched,
	- incorrect responsive behavior,
	- visual mismatch between Figma and Playwright screenshots.
6. Require the final report to name exactly which existing components and icons were reused, which new assets were exported from Figma, and which Storybook stories or screens were used for screenshot validation.
7. Once screenshot parity and structural quality are verified, finalize the merge protocol and log completion.

**Trigger Input:** Figma URL / Node ID: [INSERT_FIGMA_LINK_HERE]

**Execution Command:** Acknowledge this directive and immediately initiate Phase 0. Inventory existing components, stories, and icons before creating anything new, then proceed through Figma extraction, implementation, and Figma-vs-Playwright screenshot parity validation.