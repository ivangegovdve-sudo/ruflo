# AGENTS.md - RuFlo Local Working Guide

This repository is a local copy or fork of the RuFlo / claude-flow orchestration platform. Treat it as a framework and orchestration product repo, not as a generic dump for unrelated experiments.

## Goal

- evaluate, run, and extend RuFlo as an orchestration platform
- keep local changes understandable against the upstream product intent
- separate framework work from project-specific integrations whenever possible

## Current Idea And Progress

- Product idea:
  enterprise AI orchestration, swarm coordination, memory, and plugin-driven agent tooling
- Current state:
  large and mature Node-based platform repo with multiple versions and supporting docs
- Local role:
  reference, experimentation, and potential integration work

## Initial Setup Requirements

- Node.js environment compatible with the repo’s package tooling
- install dependencies before meaningful work:
  `npm install`
- use the repo’s existing docs, scripts, and versioned areas instead of inventing a parallel structure

## Environments

- local development:
  package and CLI iteration
- versioned internal environments:
  the repo already carries `v2` and `v3` histories / structures
- production:
  depends on which RuFlo package or orchestration surface is actually being deployed

## Dependencies

- Node / npm toolchain
- CLI and plugin infrastructure
- orchestration, memory, and swarm features already present in the repo
- extensive docs and internal command systems

## Backend Need

- backend required at root:
  this is a platform repo, not a single thin frontend app
- product backend shape:
  embedded in the platform and packages rather than one tiny API service
- downstream app backend:
  should be defined in the downstream app repo, not improvised in the framework root

## How Development Should Progress

1. Respect the repo’s versioned structure.
2. Decide whether work belongs in current root, `v2`, or `v3` before editing.
3. Keep local experiments narrowly scoped and documented.
4. Prefer adapters, plugins, and integrations over deep core divergence unless necessary.
5. If a use case becomes project-specific, move it to a dedicated repo and keep RuFlo focused.

## Local Fork Plan

- Short term:
  use the repo as a reference and experimentation ground
- Medium term:
  add focused integrations or patches that support your orchestration workflows
- Long term:
  either upstream useful changes or maintain a documented local-fork strategy

## End Goal

The end goal is a disciplined RuFlo workspace that stays useful for orchestration work without losing clarity about what is upstream platform behavior versus what is local customization.
