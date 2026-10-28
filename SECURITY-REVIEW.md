# Security Review

Review date: 2026-10-28

## Finding

### Medium: `/warn` hierarchy failures bypass the command cooldown

The interaction handler runs moderation-target prechecks before checking the
command cooldown. For `/warn`, a hierarchy failure can reply and return from
the precheck, so the request never reaches the cooldown. Repeated interactions
that take this path can generate bot handling and response work without being
limited by the cooldown.

The cooldown map otherwise bounds admitted entries to 10,000 live keys and
rejects additional commands while it is full. Member fetching on the `/warn`
precheck path is cache-dependent, so this is a conditional interaction/API-load
concern, not a demonstrated outage or unbounded REST-fetch flood. No load test
was performed.

Evidence:

- [`src/index.js`](src/index.js#L240-L253) runs `checkModerationTarget` before
  checking the cooldown.
- [`src/commands/moderation.js`](src/commands/moderation.js#L165-L198) shows
  the `/warn` target checks and the hierarchy-failure reply/return path.
- [`src/cooldowns.js`](src/cooldowns.js#L1-L20) shows the cooldown keying,
  two-second duration, and 10,000-entry cap.

Severity: Medium  
Confidence: 7/10

## Review scope and other observations

The full working-tree repository was reviewed for token exposure, code
execution and injection, interaction abuse and rate limiting, authorization,
data exposure/storage, dependency/configuration risks, and external service
integrations. No other substantiated vulnerabilities were found.

The bot reads its token from the environment, and `.env` is excluded by
`.gitignore`. Message auditing is opt-in and stored locally. No external
verification or anti-raid provider integration was found, so breach scenarios
involving those services do not apply to this project.

Current dependency advisories could not be verified because the package
registry was unreachable during the review.
