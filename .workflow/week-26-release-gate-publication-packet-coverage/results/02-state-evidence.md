# Result 02: State Evidence

## Accepted

- Recorded CI run `28864040079` in the release publish packet workflow state.
- Recorded CI run `28864381009` in the release published packet workflow state.

## Rejected

- No unrelated workflow state files were rewritten.

## Evidence

- `gh run view 28864040079 --repo kazu-42/HonoWarden --json databaseId,headSha,status,conclusion,url,workflowName,event`
- `gh run view 28864381009 --repo kazu-42/HonoWarden --json databaseId,headSha,status,conclusion,url,workflowName,event`
