---
name: 'performance'
description: 'Performance optimization best practices including Core Web Vitals, bundle optimization, caching strategies, and runtime performance tuning.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['performance', 'optimization', 'core-web-vitals', 'caching']
  source: 'chunks/performance-optimization.instructions'
  last-updated: '2026-02-26'
---

## Overview

Performance optimization best practices including Core Web Vitals, bundle optimization, caching strategies, and runtime performance tuning.


# Performance Optimization

## When to Use
- Optimizing application load time
- Improving Core Web Vitals scores
- Implementing caching strategies
- Reducing bundle size

## Key Metrics
1. **LCP** — Largest Contentful Paint (< 2.5s)
2. **FID** — First Input Delay (< 100ms)
3. **CLS** — Cumulative Layout Shift (< 0.1)
4. **TTFB** — Time to First Byte (< 800ms)

## Key Practices
- Code splitting and lazy loading
- Image optimization (WebP, responsive images)
- Service worker caching
- Database query optimization

## Resources
See the `references/` directory for:
- Core Web Vitals optimization guide
- Caching strategies reference
- Bundle optimization checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
