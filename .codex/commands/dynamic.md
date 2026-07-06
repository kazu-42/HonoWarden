# /dynamic

Use the project-local `codex-dynamic-workflows` skill.

Invoke when the task benefits from explicit orchestration, work packets, approval gates, integration notes, and verification evidence.

Workflow:

1. Read `.codex/skills/codex-dynamic-workflows/SKILL.md`.
2. Create or update a `.workflow/<slug>/` run artifact.
3. Split the task into small packets.
4. Use simulated packet passes unless a real subagent runner is available and authorized.
5. Integrate packet results explicitly.
6. Run verification matched to the risk and blast radius.

Default constraints for this repository:

- Do not commit secrets or real vault data.
- Keep upstream-provider brand strings out of tracked source and docs.
- Keep Hono route handlers thin; domain and repository logic should live outside `src/app.ts`.
- Run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm compat:test`, and `pnpm format` before pushing implementation slices.
