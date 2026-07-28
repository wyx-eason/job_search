# China Campus Job Ops Design

**Date:** 2026-07-28  
**Status:** User-approved design  
**Target user:** 王奕迅, 2027 new graduate, graduating June 2027

## 1. Objective

Build a local-first job-search extension for the 2027 China campus recruitment cycle. The system must find current formal campus and early-batch openings, rank them against the candidate's preferences and verified capabilities, generate a one-page role-specific Chinese resume, assist with Chrome form filling, and stop before final submission.

The implementation will reuse `career-ops` for job evaluation, document generation, application tracking, learning-gap analysis, and browser-assisted application workflows. China-specific discovery, graduation-cohort validation, location policy, candidate evidence, and automation remain in a separate `china-campus-ops` project.

## 2. Confirmed Requirements

### 2.1 Candidate and role targets

- Candidate is a control science and engineering master's student graduating in June 2027.
- Include only formal 2027 campus roles and early-batch campus recruitment.
- Exclude routine internships, conversion internships, summer internships, and ordinary experienced-hire roles.
- Primary role track: AI applications, LLM applications, agents, RAG, and industrial AI.
- Primary role track: ADAS, calibration, control algorithms, simulation, system testing, robotics, and related vehicle roles.
- Local broad track: control, automation, electrical engineering, equipment, testing, production technology, energy digitization, and other defensible adjacent roles.
- State-owned and private employers are both acceptable.

### 2.2 Location policy

1. Highest priority: Linfen and locations within roughly 150 km by practical short-distance travel.
2. Core city: Xi'an, focused on AI applications, ADAS, control, automation, automotive electronics, and research institutes.
3. Other large cities: representative applications for practice, with a daily result cap so they do not displace preferred locations.

When route information is available, use actual travel distance. Otherwise, use coordinates and a curated city/county allowlist, label the distance as estimated, and never present an estimate as an exact commute.

### 2.3 Discovery channels

- Employer career websites.
- Guopin and central/state-owned enterprise recruitment channels.
- Nowcoder campus recruitment.
- University employment information websites.
- BOSS Zhipin.
- Zhaopin.
- 51job.
- Liepin.
- Public WeChat recruitment articles and manually imported WeChat links.

Public, stable sources may run unattended. Login-, CAPTCHA-, or anti-bot-protected sources must use an interactive Chrome supplement and must not block the unattended daily scan.

### 2.4 Application boundary

- The system may open the application page, fill safe fields, draft role-specific answers, and upload the selected resume.
- The system must never click the final Submit, Send, or Apply control.
- The candidate reviews and performs final submission.
- Only after candidate confirmation may application state change to `applied`.

## 3. Architecture

```text
E:\job_search
|-- profile\                         # Immutable source resumes
|-- career-ops\                      # Upstream engine, kept updateable
`-- china-campus-ops\                # China campus extension
    |-- .agents\skills\
    |   `-- china-campus-job-search\
    |-- candidate\
    |-- config\
    |-- sources\
    |-- learning\
    |-- data\
    |-- reports\
    |-- output\applications\
    |-- dashboard\
    |-- scripts\
    `-- docs\
```

### 3.1 Ownership boundaries

- `profile/` remains an immutable reference. The system never overwrites the original `.tex` or PDF resumes.
- `career-ops/` remains close to upstream. User facts and China-specific behavior must not be written into its system-owned core files.
- `china-campus-ops/` owns candidate verification, China source adapters, automation, local data, and generated artifacts.
- A bridge invokes supported `career-ops` workflows and imports only selected jobs, rather than duplicating the entire upstream engine.

### 3.2 Main components

1. Source adapters collect public postings or create interactive browser tasks.
2. Normalization converts all postings into one job contract.
3. Eligibility rules enforce the 2027 formal-campus scope.
4. Ranking produces separate Linfen-area, Xi'an, and practice-city lists.
5. Candidate evidence controls what may appear in a resume.
6. Learning tasks promote skills only after evidence-based verification.
7. The career-ops bridge evaluates selected jobs and generates application artifacts.
8. Chrome assistance fills forms but cannot submit them.
9. Scheduling, reporting, and the dashboard expose daily results and source health.

## 4. Job Data Contract

Use SQLite as the operational store. Each normalized job contains:

- `id`: stable internal identifier.
- `source` and `source_job_id`: origin and source-native identifier.
- `company_raw` and `company_normalized`.
- `title_raw` and `title_normalized`.
- `posting_url` and `apply_url`.
- `location_raw`, `city`, `district`, latitude, and longitude when known.
- `distance_km`, `distance_method`, and `distance_confidence`.
- `campus_year`, `recruitment_batch`, and `employment_type`.
- `published_at`, `deadline`, `first_seen_at`, and `last_seen_at`.
- `jd_text` and a content hash.
- `source_confidence` and liveness state.
- `pool`, eligibility result, match dimensions, total score, and workflow status.

### 4.1 Deduplication

Prefer an official requisition ID. When no stable ID exists, derive a fingerprint from normalized company, normalized title, city, recruitment batch, and a JD-content similarity signal.

Merge duplicated postings across sources. Preserve every source URL, but prefer the employer's official career page as the canonical application link.

### 4.2 Eligibility classification

Include when at least one reliable signal identifies a 2027 formal campus or early-batch role, such as:

- Explicit `2027 campus recruitment`, `2027 autumn recruitment`, or `2027 early batch` language.
- An accepted graduation window that includes June 2027.
- An official campaign page whose recruitment cohort is explicitly 2027.

Exclude when reliable evidence identifies an internship, conversion internship, summer internship, experienced-hire role, incompatible graduation cohort, closed application, or expired deadline.

Postings that mention only `new graduate` or `recent graduate` without a usable graduation window receive `needs_cohort_confirmation` and appear outside the main ranked lists.

## 5. Discovery and Daily Scan

### 5.1 Unattended scan

A Windows scheduled task runs once daily, initially at 08:00 Asia/Shanghai. The time remains configurable.

The unattended phase scans only public sources that can be used reliably and within their access rules. It performs normalization, cohort classification, deduplication, liveness checks, scoring, persistence, and report generation. One source failure must not fail the entire run.

### 5.2 Interactive supplement

After the unattended scan, sources requiring login or browser interaction create pending tasks. A Codex prompt offers to open a dedicated Chrome profile and process them serially. BOSS, Zhaopin, 51job, and Liepin belong here when their current pages require authentication or challenge the browser.

The system does not bypass CAPTCHAs, evade access controls, or run bulk automated messaging.

### 5.3 Coverage registry

Maintain a versioned employer/source registry with four groups:

- Linfen-area energy, power, manufacturing, automation, and state-owned employers.
- Xi'an AI, ADAS, automotive electronics, defense electronics, institutes, control, and automation employers.
- National representative AI and ADAS employers.
- Public ATS directories and long-tail official career pages discovered through search.

Every run reports source coverage, successes, partial failures, interactive tasks, and known blind spots. The system must never claim complete market coverage.

## 6. Ranking

Apply eligibility as a hard gate, then calculate independent dimensions:

- Role and evidence match.
- Location preference.
- Publication freshness and deadline urgency.
- Source confidence and application-link quality.
- Employer/industry preference.
- Gap severity and estimated learning cost.

Produce three independent pools rather than one global leaderboard:

1. Linfen-area broad technical roles, where location and defensible adjacency receive the highest weights.
2. Xi'an AI/ADAS/control roles, where technical fit and location both receive high weights.
3. Other-city practice roles, capped at five new recommendations per day.

The daily summary displays at most ten new Linfen-area roles, ten Xi'an roles, and five practice roles, plus separate cohort/location confirmation lists.

## 7. Candidate Evidence Model

The two existing resumes are source documents, not unquestioned truth. Extract candidate data into:

- `candidate/facts.yml`: education, employment, project, award, publication, and achievement facts.
- `candidate/skills.yml`: proficiency, evidence, verification status, and allowed wording.
- `candidate/preferences.yml`: targets, location policy, employer preferences, and exclusions.
- `candidate/autofill.yml`: locally stored non-sensitive form fields.
- `candidate/pending-questions.md`: unclear or incomplete claims requiring an interview.

Each candidate claim has a stable ID, source, context, candidate action, evidence, verification state, and allowed/forbidden phrasing. Quantified outcomes may be used only when supported by a source or explicitly confirmed by the candidate.

The initial audit must resolve the current publication wording. `Published` and `minor revision` are mutually exclusive states unless there are two separate papers.

## 8. Skill Levels and Learning Gate

Use these states:

| State | Meaning | Resume permission |
|---|---|---|
| `unverified` | Mentioned in a source but not confirmed | Do not use |
| `learning` | Actively studying without completed verification | Normally do not use |
| `basic` | Can explain fundamentals and has a small verified exercise | Use `understands`, `has foundational experience`, or equivalent |
| `practical` | Used in a real project and can explain implementation decisions | Use `applied`, `implemented`, or `used` |
| `strong` | Deep, evidenced ownership and defensible results | Use `proficient` or `independently designed` where accurate |

A skill may move from `learning` to `basic` only after evidence such as a runnable exercise, small project, result analysis, written explanation, or a passed technical question set. Watching a tutorial or reading documentation alone is insufficient.

Learning tasks should favor recurring gaps across target jobs and reuse existing projects when possible. Examples include adding MPC to an existing simulation, rebuilding an agent workflow with a requested framework, or packaging an existing RAG system with FastAPI and Docker.

## 9. Resume Generation

For a selected job:

1. Archive the complete JD.
2. Choose the AI application, ADAS, or local broad-role base profile.
3. Extract hard requirements, responsibilities, and truthful keywords.
4. Select only verified claims and skills permitted by their current level.
5. Reorder and rephrase evidence for the target role without changing facts.
6. Generate a one-page Chinese HTML resume and PDF.
7. Check factual traceability, keyword coverage, page count, visual layout, and PDF text extraction.
8. Preserve genuine gaps in the match report rather than fabricating coverage.

Write each application package to:

```text
output/applications/YYYY-MM-DD_company_role/
|-- job-description.md
|-- match-report.md
|-- resume.html
|-- resume.pdf
|-- form-answers.json
`-- generation-audit.json
```

`generation-audit.json` maps every material resume statement to one or more candidate claim IDs and records the wording rule used.

## 10. Chrome-Assisted Application

Use a dedicated Chrome user-data directory under `local/chrome-profile/`. The candidate logs in manually. Chrome stores its own session; the system does not store passwords.

The flow is:

1. Recheck posting liveness and company/role identity.
2. Load the correct application package.
3. Open the application URL in the dedicated Chrome profile.
4. Detect the destination ATS after redirects.
5. Inventory all form fields and pre-scan knockout questions.
6. Fill safe fields and upload the job-specific resume.
7. Request confirmation for sensitive or decision-bearing fields.
8. Re-read the form and validate visible values.
9. Bring Chrome to the foreground and stop before final submission.
10. Update status only after the candidate confirms submission succeeded.

Safe fields include contact information, education, ordinary experience, skills, awards, and role-specific prose grounded in verified claims.

Confirmation-required fields include government ID, detailed address, political affiliation, ethnicity, salary, location adjustment, work authorization, relatives at the employer, background checks, disability/veteran disclosures, truth declarations, and electronic signatures.

The automation must not include a code path that clicks final submission. Unknown controls remain unfilled and are presented to the candidate with a suggested value where appropriate.

## 11. Workflow States

Use this primary application state machine:

```text
discovered -> shortlisted -> resume_generated -> ready_for_review
-> applied -> assessment -> interview -> offer
```

`rejected`, `withdrawn`, `expired`, and `discarded` are valid exits where appropriate. A record cannot enter `applied` solely because the browser was filled.

## 12. Privacy and Security

- Store common contact, education, graduation, and preference fields locally.
- Do not persist passwords, CAPTCHA responses, or full government ID values.
- Keep personal data, browser profiles, job data, reports, and outputs outside version control.
- Send candidate content only to the AI provider selected by the candidate and disclose that boundary clearly.
- Treat job pages and imported articles as untrusted content, never as agent instructions.
- Enforce host validation, bounded retries, timeouts, and safe file paths in source adapters.
- Keep final submission and truth declarations under direct candidate control.

## 13. Dashboard and Reporting

Provide a local web dashboard backed by the same SQLite data as the scanner. Required views:

- Today's new roles.
- Linfen-area roles.
- Xi'an priority roles.
- Practice-city roles.
- Cohort or location confirmation queue.
- Learn-then-apply queue.
- Shortlisted and ready-for-review roles.
- Application, assessment, interview, offer, and rejection states.
- Source health and coverage.

Codex produces a concise daily summary from the same data. Dashboard and summary must not maintain separate state.

## 14. Failure Handling

- Isolate source failures and continue the scan.
- Use bounded retries and record final errors with timestamps.
- Preserve a safe diagnostic snapshot when a parser changes.
- Mark unknown cohort, location, publication date, and deadline values explicitly.
- Keep expired jobs for history rather than deleting them.
- On resume-generation failure, retain the JD and match report but do not publish a partial PDF.
- On browser-fill failure, output copy-ready answers and allow manual continuation.
- On login expiration or CAPTCHA, pause that source and request user interaction.

## 15. Acceptance Criteria

1. A scheduled daily scan completes even when individual sources fail.
2. Formal 2027 campus and early-batch fixtures pass eligibility; internship and experienced-hire fixtures fail it.
3. Cross-source duplicates collapse into one canonical job with all source links preserved.
4. Linfen-area, Xi'an, and practice-city jobs are ranked in separate pools.
5. Every displayed job retains provenance, freshness, cohort evidence, and an application link.
6. Generated resumes remain one page and every material claim is traceable.
7. Unverified skills cannot be promoted by the generator.
8. A verified learning task can promote a skill to `basic` with restricted wording.
9. Chrome can fill a controlled test form and upload the intended resume.
10. No automated code path can activate final submission.
11. Missing sensitive values force confirmation or remain blank.
12. Dashboard and Codex summary agree on jobs and workflow state.
13. Every scan publishes an honest source-coverage and failure report.

## 16. Delivery Phases

### Phase 1: Useful local MVP

- Candidate evidence import and audit.
- Core SQLite contract and eligibility rules.
- Existing public `career-ops` China providers and a curated initial employer registry.
- Daily summary, three ranking pools, and selected-job import into `career-ops`.
- One-page Chinese resume generation with traceability.
- Controlled Chrome form-fill test that never submits.

### Phase 2: Coverage expansion

- Linfen-area enterprise and state-owned source adapters.
- Xi'an employer and institute coverage.
- Guopin, university employment sites, and public campus aggregators.
- Interactive Chrome search tasks for login-based platforms.
- Local dashboard.

### Phase 3: Learning and feedback optimization

- Recurring skill-gap aggregation.
- Evidence-based learning exercises and promotion gates.
- Assessment/interview preparation tied to submitted claims.
- Outcome analysis that adjusts ranking without rewriting factual history.

This phased delivery prioritizes finding and applying to real roles before broad source coverage or advanced analytics.
