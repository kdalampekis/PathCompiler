# 0002 — Isolated fixture sessions

Status: accepted for the local reference fixture only.

## Context

Phase 0 needs realistic API mutations, permission and feature gates, and repeatable
browser flows without choosing product persistence or authentication infrastructure.

## Decision

The Next.js fixture stores a small validated session in an HTTP-only, SameSite
cookie. New browser contexts start empty, so tests need no global mutable store,
database, reset endpoint or shared test account. A 3,500-byte encoded payload limit
produces an actionable error instead of silent browser cookie eviction.

Demo controls explicitly let visitors switch between Editor and Viewer and toggle
the plan structure flag. Mutation handlers check the session role and flag. Moving
a weekly plan back to simple requires confirmation in both UI and API.

## Alternatives

A module-global map could diverge across Next.js workers. A file or database would
need isolation/reset coordination. A production identity provider is outside scope.

## Consequences

This is an intentionally forgeable demo session, not authentication or a production
storage pattern. Use fictional data on localhost. Clearing cookies resets it.
Cookie size bounds the dataset, and simultaneous mutations in the same browser can
overwrite one another. A production app requires real authorization and storage;
PathCompiler itself makes no such infrastructure choice in this phase.
