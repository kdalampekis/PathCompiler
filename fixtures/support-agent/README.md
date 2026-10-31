# Support agent fixture

An agentic application written in Python whose tools are declared in JSON
Schema (`tools.json`, OpenAI and Anthropic shapes). Used to show that tool
definitions become operations, that approved rules apply to agent tool calls,
and that answers are checked before they are rendered
(`spec/output-policies.json`). Author-written, like the other fixtures.
