# Job Browser — Product Architecture Baseline

Status: adopted product direction for future design and development. This document describes the target MVP, not completed functionality. See [current implementation architecture](architecture.md) for what exists today.

Language: English · [简体中文](product-architecture.zh-CN.md). Both versions describe the same baseline and should be updated together.

## 1. Product positioning

**A browser package purpose-built for job seeking.**

Job Browser brings existing job sites, AI tools, email, and calendars into one cohesive, polished workspace with a continuous job-seeking workflow. It does not aim to rebuild those tools.

> The browser is the foundation. Job-seeking capabilities form the package.

“Package” describes how the product composes capabilities; it does not require an MVP plugin marketplace or extension framework.

## 2. Home: a 3 × 3 launcher

The app opens to a simple grid of feature entry points, without a complex dashboard.

| | | |
| --- | --- | --- |
| Find Jobs | Tailor Resume | Interview Prep |
| Applications | Calendar | My Profile |
| Browser | Ask AI | Settings |

The rows represent three groups:

- **Job-seeking actions:** Find Jobs → Tailor Resume → Interview Prep.
- **Job-seeking management:** Applications → Calendar → My Profile.
- **Foundational tools:** Browser → Ask AI → Settings.

Add new capabilities within existing entry points whenever possible, instead of continually adding Home buttons.

## 3. Browser Shell

The entire app runs within a unified Browser Shell. Internal features, external websites, and AI pages share the same navigation environment.

```text
┌─────────────────────────────────────────┐
│ Back    Forward    Home          Agent  │
├─────────────────────────────────────────┤
│                                         │
│                  PAGE                   │
│                                         │
│       Internal Page / Website / AI      │
│                                         │
└─────────────────────────────────────────┘
```

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
| `app://calendar` | Calendar |
| `app://profile` | My Profile |
| `app://browser` | Browser |
| `app://ai` | Ask AI |
| `app://settings` | Settings |

External destinations use their existing URLs, such as:

```text
https://linkedin.com/...
https://seek.com.au/...
https://company.com/careers/...
https://chatgpt.com/...
```

A single navigation journey can therefore cross internal pages and websites:

```text
Home → Find Jobs → LinkedIn Job → Tailor Resume → Company Application
```

Back and Forward follow a consistent history model across both page types. The exact implementation of internal routing and the combined history stack remains an engineering decision; the current foundation uses Chromium history for external pages only.

## 5. Shared Context

Shared Context connects the nine entry points, so users do not have to repeatedly copy, paste, or re-enter the same information.

```text
Context
├── Current Page
│   ├── URL
│   ├── Title
│   ├── Content
│   └── Selected Text
├── Current Job
│   ├── Company
│   ├── Title
│   ├── Job Description (JD)
│   └── URL
├── Profile
└── Resume
```

For example, tailoring a resume follows this flow:

```text
Browse a LinkedIn job
        ↓
Capture job context from the page
        ↓
Open Tailor Resume
        ↓
Job + Profile + Resume
        ↓
AI
        ↓
Tailored Resume
```

The same context supports other actions:

```text
Job + Profile        → Interview Prep
Current Page + Job   → Ask AI
```

**Context follows the user; each feature should not ask for it again.** Job capture and extraction should populate the shared model; this baseline does not prescribe a particular extraction mechanism.

## 6. Core data

The MVP is local first and does not require a complex backend. Local storage is the starting point; external websites and configured AI services may still require a network connection.

These are conceptual data fields, not a finalized database schema:

| Entity | Fields |
| --- | --- |
| Profile | Basic Info, Education, Experience, Projects, Skills, Preferences |
| Job | Company, Title, URL, Description, Created At |
| Application | Job, Status, Applied At, Notes |
| Resume | Name, File, Content, Created At |
| Event | Application, Type, Date / Time, Notes |
| Settings | Agent URL, API Key, Default Job Site, Browser Settings |

An Application refers to a Job, and an Event can be associated with an Application. Resume records describe locally managed files and their content. Shared Context identifies the page and job currently in use alongside the user's profile and resume; it is not a separate copy of every record.

The initial storage approach is **SQLite + the local file system + Electron Session**:

- SQLite stores structured product records.
- The local file system stores resumes and generated files.
- Electron Session manages cookies and other website session data.

Settings describe configuration needs; credential storage details must be decided during implementation. This baseline does not require storing API keys in plaintext SQLite records.

## 7. Compose capabilities instead of duplicating infrastructure

The nine entry points are not nine independent systems. Features compose shared capabilities:

| Feature | Composition |
| --- | --- |
| Find Jobs | Browser + Job Capture |
| Tailor Resume | Job Context + Profile + Resume + AI |
| Interview Prep | Job Context + Profile + AI |
| Ask AI | Current Context + Configured AI |
| Applications | Job + Application |

Navigation, context, AI access, and file handling should be reusable across these workflows.

## 8. Technical layers

Keep the architecture to four layers:

```text
┌────────────────────────────────────────┐
│              Electron App              │
├────────────────────────────────────────┤
│             Browser Shell              │
│       Navigation / Agent / Page        │
├────────────────────────────────────────┤
│                Services                │
│       Context / Job / AI / Files        │
├────────────────────────────────────────┤
│                  Data                  │
│       SQLite / Files / Settings        │
└────────────────────────────────────────┘
```

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
| Data | Profile, Job, Application, Resume, and Event records persist the work. |

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

**Find Jobs → Applications → Interview Prep → Calendar → Ask AI → Settings**

This is the order for expanding the full features. The minimal AI connection and configuration needed for Tailor Resume must be available by Stage 6.

The foundation milestone is:

> Build a polished, stable, URL-addressable Electron Browser Shell with Shared Context. The Home grid is the product entry point, and job-seeking capabilities are added incrementally as the package.

The repository's existing browser foundation is a starting point toward this milestone, not evidence that the milestone is already complete.

## 11. How to use this baseline

Use this document as the reference for subsequent product design, interface design, and development planning. It supersedes the earlier product direction while keeping the current implementation documented separately.

The baseline fixes the product structure and development direction. Detailed page layouts, extraction methods, AI integration contracts, database schemas, application statuses, and calendar integrations remain implementation decisions. Any change to the nine entry points, URL model, Shared Context, local-first approach, or capability composition should be reflected in both language versions before it becomes the new baseline.
