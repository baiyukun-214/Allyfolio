---
title: "Why accessibility overlays don't make a site accessible"
description: "Overlay widgets promise accessibility with one line of JavaScript. Here is why they cannot fix the underlying code, why many disabled users avoid them, and what to do instead."
pubDate: 2026-10-21
tags: ["Overlays", "EAA", "WCAG"]
---

An **accessibility overlay** is a third-party script, usually added with one line of code, that shows a toolbar or "accessibility button" and tries to repair problems in the visitor's browser. Overlays are often sold as a quick answer to the [European Accessibility Act (EAA)](/eaa) and the German [BFSG](/bfsg). They are not.

*This article is general information, not legal advice.*

## The problem lives in your code

Accessibility barriers sit in the HTML, CSS and JavaScript you ship: a button built from a `div`, a form field without a label, a checkout step that traps keyboard focus, an image whose meaning is never described. An overlay runs *after* your page loads and has to guess what the page means. It cannot know what a product photo shows, what a vague link should say, or how your custom date picker is supposed to work.

When the guess is wrong, the page can become *harder* to use than before.

## Disabled users already bring their own tools

Screen readers, screen magnifiers, voice control, high-contrast modes and browser zoom are built into operating systems and browsers, or installed by the people who rely on them. An overlay's toolbar mostly duplicates those settings – and some overlays interfere with assistive technology, for example by changing how content is announced. Many accessibility practitioners and disabled users have publicly asked businesses not to use them.

## The law asks for accessible services, not widgets

The EAA ([Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj)) and the BFSG set requirements for the service itself: that it is perceivable, operable, understandable and robust. In practice, teams measure that against [EN 301 549 and WCAG](/en-301-549-wcag). A widget sitting on top of an inaccessible checkout does not change the checkout.

## What to do instead

1. **Test.** Start with automated checks – try a [free scan](/free-scan) – then review manually, because [automated testing can't catch everything](/blog/what-automated-accessibility-testing-cant-catch).
2. **Fix the source.** Use native HTML elements, label every field, provide meaningful alt text, keep focus visible and in a logical order.
3. **Keep fixing.** Every release can introduce new issues. Scheduled scans and a dated record of fixes show your progress over time – see our [plans](/pricing).
4. **Check whether you are in scope.** [Who is affected?](/who-is-affected) and the [microenterprise exemption](/microenterprise-exemption) explain the rules.

Allyfolio will never inject an overlay into your site. We help you find and fix issues in your own code.
