# Local models for an RTX 5090 with Ollama and Pi

> **Target machine:** a separate computer with one NVIDIA RTX 5090 and 32 GB VRAM. Nothing in this guide has been installed or changed on the current machine.
>
> Researched: **2026-08-22**.

## Short recommendation

Use **Qwen3.8-27B** as the default model for both agentic coding and most general work.

- In Ollama, use the official **`qwen3.8:27b`** build. It is an approximately 18 GB Q4_K_M model with vision, tool calling, thinking, and a native 256K context window.
- Configure an actual **64K context** for Pi. Ollama otherwise defaults a 32 GB GPU to only 32K. Do not assume the advertised 256K context will fit in 32 GB VRAM.
- Use **high thinking** for coding, difficult logic, and research synthesis; use **off or low thinking** for routine writing, summaries, and quick questions.
- A second model is optional. If a different writing style or a fast general/multimodal assistant is useful, try **Gemma 4 26B A4B**. Qwen3.8 remains the better default overall.

Qwen's official model card reports **61.7 SWE-bench Pro** and **73.0 Terminal-Bench 2.1**. These are vendor-reported benchmark results, not a guarantee of identical performance after Q4 quantization or in Pi. [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B)

## Why the Ollama recommendation differs from Q6_K

Q6_K was the quality-first recommendation for `llama.cpp`. Ollama's official `qwen3.8:27b` tag is Q4_K_M and is the easiest reliable Ollama deployment:

| Ollama build | Approx. weights | Recommendation |
|---|---:|---|
| `qwen3.8:27b` / Q4_K_M | 18 GB | **Use this.** Leaves substantial room for KV cache and 64K context. |
| `qwen3.8:27b-q8_0` | 30 GB | Avoid on 32 GB: almost no room remains for context and runtime overhead. |
| Custom Q6 GGUF | about 24 GB | Better weight fidelity, but use `llama.cpp` if this is the priority. It has less context headroom and is not the standard Ollama tag. |

Sources: [Ollama Qwen3.8 page](https://ollama.com/library/qwen3.8), [Ollama tags](https://ollama.com/library/qwen3.8/tags), [GGUF sizes](https://huggingface.co/bartowski/Qwen3.8-27B-GGUF).

## 1. Install and verify Ollama on the RTX 5090 computer

Install a current Ollama release using the instructions for that computer's operating system. On Linux, Ollama publishes this installer:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Then verify the NVIDIA driver and Ollama:

```bash
nvidia-smi
ollama --version
```

Keep Ollama bound to localhost unless remote access is intentionally required.

## 2. Pull Qwen3.8-27B

```bash
ollama pull qwen3.8:27b
```

The official model already includes its prompt template, vision projector, tool support, thinking configuration, and recommended generation parameters. Do not replace its template.

## 3. Create a 64K model alias

Ollama's OpenAI-compatible API cannot set context length per request. Create an alias with a fixed context instead.

Create `Modelfile.qwen3.8-64k`:

```text
FROM qwen3.8:27b
PARAMETER num_ctx 65536
```

Build it:

```bash
ollama create qwen3.8-coding-64k -f Modelfile.qwen3.8-64k
```

Test it:

```bash
ollama run qwen3.8-coding-64k
```

In another terminal, check residency:

```bash
ollama ps
```

The goal is:

- `PROCESSOR` shows **100% GPU**.
- `CONTEXT` shows **65536**.
- No material CPU offload is occurring.

If it does not remain fully on the GPU, rebuild the alias at 49152 or 32768 tokens. A fully GPU-resident 48K model is preferable to a nominal 64K model with slow CPU offload.

Ollama recommends at least 64K context for web search, agents, and coding tools, while warning that larger contexts consume more memory. [Ollama context documentation](https://docs.ollama.com/context-length)

## 4. Configure Pi

Pi connects to Ollama through its OpenAI-compatible Chat Completions endpoint. On the **RTX 5090 computer**, create or merge the following into:

```text
~/.pi/agent/models.json
```

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": true,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "qwen3.8-coding-64k",
          "name": "Qwen3.8 27B 64K — local coding/general",
          "reasoning": true,
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "max",
            "max": "max"
          },
          "input": ["text", "image"],
          "contextWindow": 65536,
          "maxTokens": 16384,
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      ]
    }
  }
}
```

Why these settings:

- The dummy API key is required by OpenAI clients but ignored by Ollama.
- `supportsDeveloperRole: false` makes Pi send its instructions as a conventional system message.
- Current Ollama supports `reasoning_effort` values `none`, `low`, `medium`, `high`, and `max`.
- `maxTokensField: "max_tokens"` matches Ollama's supported Chat Completions field.
- Pi's declared `contextWindow` matches the actual alias, allowing compaction to occur at the right time.

References: [Pi custom-model documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

### Optional Pi defaults

To make the local model the default on that computer, merge these fields into `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "qwen3.8-coding-64k",
  "defaultThinkingLevel": "high",
  "enabledModels": [
    "ollama/qwen3.8-coding-64k"
  ]
}
```

Alternatively, leave the existing cloud model as the default and select Qwen through `/model` or start Pi with:

```bash
pi --model ollama/qwen3.8-coding-64k --thinking high
```

Inside Pi:

- `/model` or `Ctrl+L`: select the model.
- `Shift+Tab`: change the thinking level.
- `/settings`: inspect or change the current thinking setting.

Pi reloads `models.json` whenever `/model` is opened.

## Thinking-level policy

| Workload | Suggested level |
|---|---|
| Multi-file implementation, debugging, architecture | `high` |
| Hard logic, research synthesis, unfamiliar code | `high` |
| Normal code edits and reviews | `medium` |
| General questions and summarization | `low` |
| Polished prose, rewriting, extraction | `off` or `low` |

Higher thinking is slower and consumes more context. It is not automatically better for prose.

## Should there be a separate general model?

**Usually, no.** Qwen3.8-27B is a general multimodal reasoning model with unusually strong agentic-coding results; it is not merely a code-completion model. Using it for coding, logic, writing, and Pi's web-research tools avoids model reloads and keeps one consistent tool-calling behavior.

Also, a different model does not make web answers current. Pi's search/scraping tools obtain current sources; the model's job is to call those tools and synthesize their results. Tool reliability and reasoning matter more than a model's memorized cutoff.

### Optional second model: Gemma 4 26B A4B

Try Gemma when you want a different prose style, independent second opinion, or fast general/multimodal reasoning. Ollama distributes an approximately 18 GB Q4 build with a native 256K context. Google's card reports 82.6 MMLU Pro, 88.3 AIME 2026, and 82.3 GPQA Diamond, but those are vendor results from the unquantized/instruction model and are not directly comparable to Qwen's agent benchmarks. [Gemma model card](https://huggingface.co/google/gemma-4-26B-A4B-it), [Ollama Gemma page](https://ollama.com/library/gemma4:26b)

Pull it:

```bash
ollama pull gemma4:26b
```

Create `Modelfile.gemma4-64k`:

```text
FROM gemma4:26b
PARAMETER num_ctx 65536
PARAMETER temperature 1.0
PARAMETER top_p 0.95
PARAMETER top_k 64
```

```bash
ollama create gemma4-general-64k -f Modelfile.gemma4-64k
```

Add this object to the `models` array in Pi's Ollama provider:

```json
{
  "id": "gemma4-general-64k",
  "name": "Gemma 4 26B A4B 64K — local general",
  "reasoning": true,
  "thinkingLevelMap": {
    "off": "none",
    "minimal": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "max",
    "max": "max"
  },
  "input": ["text", "image"],
  "contextWindow": 65536,
  "maxTokens": 16384,
  "cost": {
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  }
}
```

Do not try to keep both approximately 18 GB models resident simultaneously on a 32 GB GPU. Before switching, free the current model:

```bash
ollama stop qwen3.8-coding-64k
# or, when switching back:
ollama stop gemma4-general-64k
```

Then select the other model in Pi with `/model`.

## Practical conclusion

Start with only **`qwen3.8-coding-64k`**. Use it for coding and general/research work, changing the thinking level rather than the model. Add Gemma only after an A/B test on representative writing prompts demonstrates that its different style is useful.

For the best possible Qwen weight fidelity instead of the easiest Ollama setup, use Pi's native `llama.cpp` router with a Q6_K GGUF. For Ollama, the official Q4_K_M build plus 64K context is the best-balanced starting point on 32 GB VRAM.
