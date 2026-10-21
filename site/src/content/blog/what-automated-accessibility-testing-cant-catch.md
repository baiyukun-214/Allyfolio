---
title: "What automated accessibility testing can't catch"
description: "Automated tools find roughly 57% of accessibility issues, according to Deque's study. Here is what they find well, what still needs people, and how to plan a manual review."
pubDate: 2026-10-20
tags: ["Testing", "WCAG", "Manual review"]
---

Automated accessibility testing is fast, cheap and repeatable – and it is only part of the picture. Deque analysed nearly 300,000 issues from more than 13,000 pages in first-time audits and found that **57.38% of issues by volume** were identified by automated tests using the open-source axe-core rules ([Deque: The Automated Accessibility Coverage Report](https://www.deque.com/automated-accessibility-testing-coverage/)). The rest needed people.

*This article is general information, not legal advice.*

## What automated checks do well

- **Colour contrast** of text against its background (WCAG 1.4.3) – the single biggest category in Deque's data.
- **Missing names** for buttons, links and form fields (4.1.2, 3.3.2).
- **Missing alt attributes** on images (1.1.1).
- **Missing page language** (3.1.1) and missing page titles.
- **Structural problems** such as skipped heading levels or invalid ARIA.

These issues are common, so catching them automatically on every release removes a lot of work.

## What still needs a person

- **Meaningful alt text.** A tool can see that `alt` exists. It cannot tell whether "image123" describes a blue running shoe.
- **Focus order and focus visibility** (2.4.3, 2.4.7). In Deque's data, every focus order and focus visible issue was found manually.
- **Keyboard operation** (2.1.1) of custom menus, sliders and date pickers.
- **Understandable content** – clear instructions, helpful error messages, consistent navigation.
- **Captions and audio descriptions** for video – whether they exist and are accurate.
- **Whole journeys.** Can a screen-reader user actually find a product, pay and receive confirmation?
- **New WCAG 2.2 criteria** such as Focus Not Obscured, Dragging Movements and Accessible Authentication often need human judgement – see [EN 301 549 and WCAG 2.2](/en-301-549-wcag).

## Plan a manual review

1. Run automated scans on your key templates and journeys (start with a [free scan](/free-scan)).
2. Fix what they find – it is the quickest win.
3. Walk through your main journeys with only a keyboard, then with a screen reader.
4. Review alt text, link text, headings and error messages by reading them.
5. Write down what you tested, when and what you changed. A dated record is useful evidence of your work under the [EAA](/eaa) and [BFSG](/bfsg).

A clean automated scan is a good start, not a finish line – and no [overlay widget](/blog/why-accessibility-overlays-dont-work) can do the manual part for you. Allyfolio's [plans](/pricing) combine scheduled scans with a checklist for the manual review that automation cannot do.
