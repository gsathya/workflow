---
"@workflow/ai": patch
---

Refactor DurableAgent.stream to return UIMessage[] instead of ModelMessage[]

This change makes it easier to persist messages in databases, as UIMessage is the format expected by the AI SDK for UI state management. The stream method now converts the internal message representation to UIMessage format before returning.
