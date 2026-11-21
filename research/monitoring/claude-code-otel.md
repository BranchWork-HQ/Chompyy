# Claude Code's own telemetry: first-party tokens and cost per request

- Source: official docs https://code.claude.com/docs/en/monitoring-usage, read 2026-11-21. First-party, documented.
- Nothing to copy; it's a data source. Opt-in per user via env vars; data goes only to the endpoint you configure.

## Turn it on

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp|prometheus|console   OTEL_LOGS_EXPORTER=otlp|console
OTEL_EXPORTER_OTLP_PROTOCOL=grpc|http/json|http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
# traces (beta):
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1   OTEL_TRACES_EXPORTER=otlp
```

Export intervals: metrics 60 s, logs 5 s, traces 5 s. Prompt text, tool details, responses and raw bodies are **off by default** (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_RAW_API_BODIES`, `OTEL_LOG_TOOL_CONTENT`).

## What it emits

| Kind | Name | Useful fields |
|---|---|---|
| Metric | `claude_code.cost.usage` (USD) | `model`, `query_source`, `speed`, `effort`, attribution: `agent.name`, `skill.name`, `plugin.name`, `mcp_server.name`, `mcp_tool.name` |
| Metric | `claude_code.token.usage` | `type` = input / output / cacheRead / cacheCreation, same attributes |
| Metric | `session.count`, `lines_of_code.count`, `pull_request.count`, `commit.count`, `code_edit_tool.decision`, `active_time.total` | |
| Event | **`claude_code.api_request`** | `model`, **`cost_usd`** + `cost_usd_micros`, `duration_ms`, `input_tokens` (excludes cache), `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cache_creation_5m/1h_tokens` (v2.1.300+), `request_id`, `speed`, `effort`, `query_source`, **`prompt.id`** |
| Event | `user_prompt`, `assistant_response`, `tool_result` (`duration_ms`, `success`, `error_type`, `tool_result_size_bytes`), `tool_decision`, `api_error`, `api_refusal` | all carry `prompt.id` |
| Span (beta) | `claude_code.interaction` → `llm_request`, `tool` (→ `tool.blocked_on_user`, `tool.execution`), subagent spans under the Agent tool; `hook` only in detailed beta | `llm_request`: tokens, `duration_ms`, **`ttft_ms`**, `request_id`, `stop_reason`, `agent_id`/`parent_agent_id`. **No cost on the span.** `tool`: `duration_ms`, **`result_tokens`** |

Standard attributes on everything: `session.id` (replaced by `/clear`), `app.version`, user/org ids, `terminal.type`. `prompt.id` (UUID) links every event of one user prompt; metrics never carry it. Docs: "Cost metrics are approximations."

## What it means for Chompyy

- It is the only **first-party per-request cost** (`cost_usd`) and the only source of **time to first token** and **tool result tokens**. `request_id` joins it to the JSONL row (`requestId`) exactly.
- But it needs env vars in the user's shell and a local collector (an OTLP receiver on localhost). Chompyy could run a tiny OTLP/HTTP-JSON receiver and write events to its ledger. That is opt-in and only covers sessions after setup; **history must come from JSONL anyway**.
- For **away runs** Chompyy launches the process itself, so it can set these env vars per run at no cost to the user, and cross-check our JSONL pricing against `cost_usd`.
- `api_request` covers subagents and side queries (`query_source`), which JSONL scatters across `subagents/*.jsonl`.
