---
name: 'a11y'
description: 'Accessibility best practices including WCAG 2.2 AA compliance, ARIA patterns, keyboard navigation, and screen reader optimization for web applications.'
metadata:
  version: '2.0.0'
  author: 'Vibecoding'
  tags: ['accessibility', 'wcag', 'aria', 'screen-reader']
  source: 'chunks/a11y.instructions'
  last-updated: '2026-04-10'
  last_reviewed: '2026-04-10'
---

## Overview

Accessibility engineering practices for WCAG 2.2 AA compliance. Covers semantic
HTML, ARIA patterns, keyboard navigation, color contrast, and screen reader
optimization with testing procedures.

---

# Accessibility Best Practices

## When to Use

- Implementing new UI components
- Reviewing code for accessibility compliance
- Ensuring WCAG 2.2 AA standards are met
- Testing with screen readers and keyboard navigation
- Building forms, modals, or interactive widgets

---

## 1. WCAG 2.2 AA — The Four Principles

| Principle | Key Requirements |
|-----------|-----------------|
| **Perceivable** | Alt text on images, captions on video, sufficient contrast (4.5:1 text, 3:1 large) |
| **Operable** | All interactive elements keyboard-accessible, no keyboard traps, skip links |
| **Understandable** | Clear labels, predictable navigation, error identification with suggestions |
| **Robust** | Valid HTML, ARIA used correctly, works across assistive technologies |

---

## 2. Procedure: Make a Component Accessible

```
Step 1 — SEMANTIC HTML: Use the correct native element first
   └─ <button> not <div onClick>
   └─ <nav>, <main>, <aside>, <header>, <footer> for landmarks
   └─ <input type="email"> not <input type="text"> for emails

Step 2 — ARIA (only when HTML semantics are insufficient):
   └─ aria-label for elements without visible text
   └─ aria-describedby to link error messages
   └─ aria-expanded, aria-haspopup for disclosure widgets
   └─ role only when no native HTML element fits

Step 3 — KEYBOARD:
   └─ Tab order follows visual order (no positive tabindex)
   └─ Enter/Space activates buttons and links
   └─ Escape closes modals/popups
   └─ Arrow keys navigate within composite widgets (tabs, menus)

Step 4 — FOCUS MANAGEMENT:
   └─ Focus moves to modal on open, returns on close
   └─ Focus visible indicator on all interactive elements
   └─ Never remove outline without providing alternative

Step 5 — TEST:
   └─ Tab through entire component with keyboard only
   └─ Run axe-core: npx @axe-core/cli <url>
   └─ Test with screen reader (VoiceOver/NVDA)
```

---

## 3. Common Component Patterns

### Accessible Button

```html
<!-- Native button — preferred -->
<button type="button" aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>

<!-- Icon-only button needs aria-label -->
```

### Accessible Form Field

```html
<div>
  <label for="email">Email address</label>
  <input
    id="email"
    type="email"
    aria-describedby="email-error"
    aria-invalid="true"
    required
  />
  <p id="email-error" role="alert">Please enter a valid email</p>
</div>
```

### Accessible Modal

```html
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
>
  <h2 id="modal-title">Confirm deletion</h2>
  <p>This action cannot be undone.</p>
  <button type="button">Cancel</button>
  <button type="button">Delete</button>
</div>
```

```typescript
// Focus management for modal:
function openModal(modalEl: HTMLElement, triggerEl: HTMLElement) {
  modalEl.removeAttribute('hidden');
  const firstFocusable = modalEl.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  firstFocusable?.focus();

  // On close, return focus to trigger:
  modalEl.addEventListener('close', () => triggerEl.focus());
}
```

---

## 4. Color Contrast Requirements

| Text Size | Minimum Ratio (AA) | Tool |
|-----------|-------------------|------|
| Normal text (<18pt) | 4.5:1 | contrast-ratio.com |
| Large text (≥18pt or 14pt bold) | 3:1 | axe-core |
| UI components & graphics | 3:1 | browser DevTools |

---

## 5. Testing Checklist

| Test | Method | Pass Criterion |
|------|--------|----------------|
| Keyboard navigation | Tab through page manually | All interactive elements reachable |
| Focus visibility | Tab and observe | Every focused element has visible indicator |
| Screen reader | VoiceOver/NVDA walkthrough | All content read in logical order |
| axe-core scan | `npx @axe-core/cli http://localhost:3000` | Zero violations |
| Color contrast | DevTools Accessibility panel | All text meets AA ratios |
| Zoom | Browser zoom to 200% | No content loss or overlap |

---

## 6. Decision Tree: Which ARIA Pattern?

```
Is there a native HTML element that does what you need?
├─ YES → Use the native element (no ARIA needed)
└─ NO → Is it a common widget pattern?
    ├─ Tabs → role="tablist", role="tab", role="tabpanel"
    ├─ Menu → role="menu", role="menuitem"
    ├─ Tree → role="tree", role="treeitem"
    ├─ Dialog → role="dialog", aria-modal="true"
    ├─ Combobox → role="combobox", aria-expanded
    └─ Other → Check WAI-ARIA Authoring Practices
```

---

## Resources

See the `references/` directory for:
- WCAG 2.2 guidelines reference (chunk-01, chunk-02)
- ARIA patterns and examples
- Keyboard navigation patterns

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
