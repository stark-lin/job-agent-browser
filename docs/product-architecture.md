# Job Browser — Product Architecture Baseline

Purpose: define product scope and delivery order. Status: **Planned**, the adopted direction for future design and development. This document describes the target MVP, not completed functionality. See [current implementation architecture](architecture.md) for what exists today.

Language: English · [简体中文](product-architecture.zh-CN.md). Both versions describe the same baseline and should be updated together.

## 1. Product positioning

**A browser package purpose-built for job seeking.**

Job Browser brings existing job sites, AI tools, and email into one cohesive, polished workspace with a continuous job-seeking workflow. It does not aim to rebuild those tools.

> The browser is the foundation. Job-seeking capabilities form the package.

“Package” describes how the product composes capabilities; it does not require an MVP plugin marketplace or extension framework.

## 2. Home: a 3 × 3 launcher

The app opens to a simple grid of feature entry points, without a complex dashboard.

| | | |
| --- | --- | --- |
| Find Jobs | Tailor Resume | Interview Prep |
| Applications | Inbox | My Profile |
| Browser | Ask AI | Settings |

The rows represent three groups:

- **Job-seeking actions:** Find Jobs → Tailor Resume → Interview Prep.
- **Job-seeking management:** Applications → Inbox → My Profile.
- **Foundational tools:** Browser → Ask AI → Settings.

All nine entries are accessible; eight business pages are currently scaffolded. Add new capabilities within existing entry points whenever possible.

### Initial Inbox

Inbox is the entry point for job-seeking email. Its first version reuses user-configured webmail such as Gmail or Outlook. Users select an email provider and configure its web URL in Settings; entering `app://inbox` opens that URL inside the Browser Shell through the unified Navigation API. If no mailbox is configured, guide the user to email settings.

Users sign in directly on the email website, with Electron Session maintaining the login session. The first version stores only the mailbox entry configuration, not email passwords, and does not require email APIs, message synchronization, an aggregated inbox, or local message entities. Reading and replying use the email website’s existing features.

## 3. Browser Shell

Internal features, external websites and AI pages share one navigation environment. Browser is a React page whose tab strip, address bar and controls belong to that page. Home and other internal pages hide the entire browser bar; internal URLs remain hidden from users.

The shell provides these global capabilities:

| Capability | Responsibilities |
| --- | --- |
| Navigation | Back, Forward, Home, and a page history stack |
| Browser | Open URLs; maintain web sessions and cookies; upload and download files; retrieve page content; accept pasted URLs or page content |
| Agent | Keep an Agent button available; send the current page, current job, or selected text to AI |

The global Agent button offers help from the current page. The Ask AI Home entry opens the dedicated AI page. Both use shared context and the configured AI capability.

## 4. Anything is URL

Internal features and internet pages are addressed through URLs.

| Internal URL | Destination |
| --- | --- |
| `app://home` | Home |
| `app://find` | Find Jobs |
| `app://resume` | Tailor Resume |
| `app://interview` | Interview Prep |
| `app://applications` | Applications |
| `app://inbox` | Inbox |
| `app://profile` | My Profile |
| `app://browser` | Browser |
| `app://ai` | Ask AI |
| `app://settings` | Settings |

External destinations retain their existing website URLs.

A single navigation journey can therefore cross internal pages and websites:

```text
Home → Find Jobs → LinkedIn Job → Tailor Resume → Company Application
```

Each tab has independent mixed history across internal pages and websites. Home adds history in the current tab; switching tabs adds none. Startup, new tabs and closing the final tab open Home. The Browser card opens an empty workspace, with an empty address field until a website is opened. Internal pages provide page-local Back/Home and keyboard history navigation; only Browser renders browser controls. Runtime implementation details belong to the current architecture.

## 5. Shared Context

Shared Context connects the nine entry points using the current page (URL, title, content, selection), current Job, Profile, and Resume.

Resume tailoring combines the captured Job with Profile and Resume, then uses AI to produce tailored output.

The same context supports other actions:

```text
Job + Profile        → Interview Prep
Current Page + Job   → Ask AI
```

**Context follows the user; each feature should not ask for it again.** Job capture and extraction should populate the shared model; this baseline does not prescribe a particular extraction mechanism.

## 6. Core data

The MVP is local first and does not require a complex backend. Local storage is the starting point; external websites and configured AI services may still require a network connection.

The [V1 data architecture](data-architecture.md) owns the implemented 11-table model, ER diagram, application statuses, generation pipeline, provenance, audit, settings, and secrets design.

Applications uses Job lifecycle data; its calendar view uses JobEvent. Generated resumes are Artifacts, and personal material is represented by Profile, ProfileItem, and Fact. These are shared records, not separate page-owned copies. Calendar and Resume Builder do not add Home entries.

SQLite stores business records, local files store configuration and outputs, and Electron Session manages website sessions. API keys belong in encrypted secrets storage. Business persistence and Electron Session are implemented; settings, secrets and compiled outputs remain planned, as recorded in the [current architecture](architecture.md).

## 7. Compose capabilities instead of duplicating infrastructure

The nine entry points are not nine independent systems. Features compose shared capabilities:

| Feature | Composition |
| --- | --- |
| Find Jobs | Browser + Job Capture |
| Tailor Resume | Job Context + Profile + Resume + AI |
| Interview Prep | Job Context + Profile + AI |
| Ask AI | Current Context + Configured AI |
| Applications | Job + Application lifecycle + JobEvent |
| Inbox | User-configured Webmail + Browser + Session |

Navigation, context, AI access, and file handling should be reusable across these workflows.

## 8. Technical layers

The four logical layers are Electron App → Browser Shell → Services → Data. Process responsibilities are:

- **Electron Main** owns system capabilities: windows, WebContents, sessions, and file-system access.
- **Renderer** owns the Home grid, internal pages, Browser Shell UI, and other presentation logic.
- **Services and IPC** separate UI workflows from privileged system operations.

These are logical layers, not four independent applications or a requirement to put every service in the Renderer. The current process isolation and security boundaries remain the starting point for implementation.

## 9. Five product primitives

**URL → Page → Context → Action → Data**

| Primitive | Meaning |
| --- | --- |
| URL | Every page can be addressed. |
| Page | Websites, AI, and internal features live within one browser environment. |
| Context | The app knows the current page, job, profile, and resume. |
| Action | Users Find, Tailor, Prepare, Save, Ask, and perform related operations. |
| Data | Profile, Job lifecycle, and resume Artifacts persist the work. |

Use these primitives to guide feature design and avoid creating separate systems for overlapping workflows.

## 10. Development sequence

The first phase does not need to implement all nine features in full.

| Stage | Focus | Intended outcome |
| --- | --- | --- |
| 1 | Browser Shell | Electron browser with internal and external pages, plus Back, Forward, and Home |
| 2 | Nine-entry Home | All nine destinations exist; unfinished features can begin as placeholder pages |
| 3 | Anything is URL | Internal pages and external websites participate in one navigation stack |
| 4 | Profile + Resume | Establish the user's job-seeking context |
| 5 | Job Context | Save or extract the current job from a webpage |
| 6 | Tailor Resume | Complete the first end-to-end workflow: Browser → Job → Profile → AI → Output, using the user's resume |

Stage 1 establishes page hosting and navigation controls; Stage 3 completes the unified URL and history behavior. After the first resume-tailoring workflow, progressively fill out:

**Find Jobs → Applications → Interview Prep → Inbox → Ask AI → Settings**

This is the order for expanding the full features. The minimal AI connection and configuration needed for Tailor Resume must be available by Stage 6; mailbox entry configuration must ship alongside Inbox.

The foundation milestone is:

> Build a polished, stable, URL-addressable Electron Browser Shell with Shared Context. The Home grid is the product entry point, and job-seeking capabilities are added incrementally as the package.

The current foundation implements stages 1–3 and reference-only App Context. Business workflows and full context capture remain planned; accessible page skeletons do not complete the MVP.

## 11. How to use this baseline

Use this document as the reference for subsequent product design, interface design, and development planning. It supersedes the earlier product direction while keeping the current implementation documented separately.

The baseline fixes the product structure and development direction. Detailed page layouts, extraction methods, AI integration contracts, and future deeper email integrations remain implementation decisions. The implemented data model, statuses, SQL migrations and transition rules are owned by the data architecture. Any change to the nine entry points, URL model, Shared Context, local-first approach, or capability composition should be reflected in both language versions before it becomes the new baseline.

## Related documents

- [Current architecture](architecture.md): implemented behavior and limitations.
- [Code architecture](code-architecture.md): target organization and dependency boundaries.
- [README](../README.md): setup and documentation index.
