# AI Layer — Architecture, Providers & Vector Search

## Overview

The AI layer handles four distinct concerns:

| Concern | Where | When |
|---------|-------|------|
| **LLM inference** — generate tests, explain failures, summarise runs, verify outcomes | API + Worker | On demand |
| **Embeddings** — convert code chunks and queries to vectors for semantic search | Worker (indexing) + API (retrieval) | Background + on demand |
| **Vector search** — find relevant code chunks given a user query | API | On demand, at generation time |
| **Selector healing** — vision model identifies correct CSS selector from screenshot | Worker | When a selector fails during a run |

All LLM and embedding calls go through **LangChain** for provider abstraction. Switching
providers is an env var change — no code changes.

---

## LLM Provider Abstraction (LangChain)

LangChain's `BaseChatModel` interface is used for all LLM calls. The factory
`createAiModel(config)` resolves the correct model at startup.

```
AI_PROVIDER env var
        ↓
provider.factory.ts → createAiModel()
        ↓
┌─────────────────────────────────────────────────────────┐
│  anthropic      → ChatAnthropic (claude-sonnet-4-*)     │
│  openai         → ChatOpenAI (gpt-4o)                   │
│  azure          → AzureChatOpenAI                       │
│  ollama         → ChatOllama (local, any model)         │
│  openai-compatible → ChatOpenAI with custom baseURL     │
│                    (vLLM, LM Studio, Together AI, etc.) │
└─────────────────────────────────────────────────────────┘
        ↓
Returns: BaseChatModel (same interface regardless of provider)
```

### Provider selection env vars

```bash
AI_PROVIDER=anthropic          # anthropic | openai | azure | ollama | openai-compatible
AI_MODEL=claude-sonnet-4-20250514   # model name within the provider
AI_API_KEY=sk-...              # provider API key
AI_MAX_TOKENS=4096

# Azure specific
AI_AZURE_INSTANCE=myinstance
AI_AZURE_DEPLOYMENT=gpt-4o
AI_AZURE_API_VERSION=2024-02-01

# Ollama / local
AI_BASE_URL=http://ollama:11434

# Legacy fallbacks (if AI_PROVIDER not set)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### Vision capability

Selector healing and outcome verification require a **vision-capable model** (can
accept image inputs). The factory detects this:

| Provider | Vision model |
|----------|-------------|
| `anthropic` | `claude-sonnet-4-*` ✅ |
| `openai` | `gpt-4o` ✅ |
| `azure` | `gpt-4o` deployment ✅ |
| `ollama` | `llava`, `bakllava`, `moondream` ✅ |
| `openai-compatible` | model-dependent ✅ |

If the configured model has no vision support and `healSelectors` or `verifyOutcomes`
is enabled, the worker logs a warning and skips the AI call (deterministic-only fallback).

---

## Embedding Provider

Embeddings are used for two things:
1. Indexing code chunks at repo-connect time
2. Embedding the user's query at test-generation time

The embedding model is separate from the LLM model but uses the same provider:

| `AI_PROVIDER` | Embedding model used | Dimensions |
|---------------|---------------------|------------|
| `openai` | `text-embedding-3-small` | 1536 |
| `azure` | `text-embedding-ada-002` | 1536 |
| `ollama` | `OLLAMA_EMBEDDING_MODEL` env var (e.g. `nomic-embed-text`) | 768 |
| `anthropic` | No native embedding API → falls back to OpenAI if `OPENAI_API_KEY` set, else errors | — |
| `openai-compatible` | Same as OpenAI path, uses custom `AI_BASE_URL` | model-dependent |

```bash
# When using Ollama for embeddings
OLLAMA_EMBEDDING_MODEL=nomic-embed-text   # 768 dims, fast, good quality

# When using Anthropic as LLM but need embeddings (OpenAI fallback)
OPENAI_API_KEY=sk-...   # used only for embeddings when AI_PROVIDER=anthropic
```

---

## Vector Search — pgvector vs Qdrant

### Decision: pgvector for MVP, Qdrant as optional upgrade

| | pgvector (default) | Qdrant (optional) |
|--|-------------------|-------------------|
| **Setup** | Extension on existing PostgreSQL — zero extra services | Separate Docker container |
| **Ops overhead** | None — same DB, same backups, same connection | Must operate, backup, monitor separately |
| **Performance at scale** | Good up to ~1M vectors; 15–50ms query at 10K chunks | Excellent at 10M+ vectors; 1–5ms query |
| **Filtering** | SQL `WHERE` clauses — flexible, familiar | Native payload filtering — fast |
| **Typical QA platform use** | 500–50K code chunks per project | Not needed until 100+ large repos indexed |
| **When to switch** | When query latency > 100ms or > 500K chunks | Large enterprise, many repos, many projects |

**For the vast majority of self-hosted instances, pgvector is sufficient and preferred
— it keeps the stack simple (one fewer service to operate).**

Qdrant can be introduced as a drop-in swap when needed, because the retrieval
interface (`RetrievalService`) abstracts the backend.

### pgvector setup

```sql
-- In Prisma migration
CREATE EXTENSION IF NOT EXISTS vector;

-- Index for fast ANN search (IVFFlat — good for ≤1M vectors)
CREATE INDEX ON code_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Or HNSW index (better recall, slightly higher memory — use for >100K vectors)
CREATE INDEX ON code_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

```typescript
// RetrievalService — pgvector path
async findRelevantChunks(
  projectId: string,
  repoIds: string[],
  query: string,
  filePaths: string[] = [],
  topK = 15,
): Promise<CodeChunk[]> {
  const queryEmbedding = await this.embeddingService.embed(query);

  const pathFilter = filePaths.length
    ? Prisma.sql`AND (${Prisma.join(
        filePaths.map(p => Prisma.sql`c.file_path LIKE ${p + '%'}`),
        ' OR ',
      )})`
    : Prisma.empty;

  return this.prisma.$queryRaw<CodeChunk[]>`
    SELECT c.*, (c.embedding <=> ${queryEmbedding}::vector) AS distance
    FROM code_chunks c
    WHERE c.project_id = ${projectId}
      AND c.repo_id = ANY(${repoIds}::uuid[])
      ${pathFilter}
    ORDER BY distance ASC
    LIMIT ${topK}
  `;
}
```

### Qdrant path (when needed)

```typescript
// Same interface — swap the implementation, not the callers
async findRelevantChunks(...): Promise<CodeChunk[]> {
  const queryEmbedding = await this.embeddingService.embed(query);

  const results = await this.qdrantClient.search('code_chunks', {
    vector: queryEmbedding,
    filter: {
      must: [
        { key: 'project_id', match: { value: projectId } },
        { key: 'repo_id', match: { any: repoIds } },
        ...(filePaths.length ? [{
          key: 'file_path', match: { any: filePaths.map(p => ({ prefix: p })) }
        }] : []),
      ],
    },
    limit: topK,
    with_payload: true,
  });

  return results.map(r => r.payload as CodeChunk);
}
```

To enable Qdrant:
```bash
VECTOR_BACKEND=qdrant            # default: pgvector
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=                  # optional, for cloud Qdrant
```

```yaml
# docker-compose.yml (optional — only when VECTOR_BACKEND=qdrant)
qdrant:
  image: qdrant/qdrant:latest
  ports: ["6333:6333"]
  volumes: ["qdrant_data:/qdrant/storage"]
```

---

## LangChain Agent — AI Execution Engine

The Worker uses LangChain for two agent-style tasks:

### 1. Selector resolver (AiStepResolver)

Called when a CSS selector fails or is absent. Vision + code context → returns the best selector.

```typescript
const chain = ChatPromptTemplate.fromMessages([
  ['system', SELECTOR_SYSTEM_PROMPT],
  ['human', [
    { type: 'text', text: `Find selector for: "${description}"\nStep type: ${stepType}\nURL: ${currentUrl}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
  ]],
]).pipe(model).pipe(new JsonOutputParser());

const result: SelectorResult = await chain.invoke({ codeContext });
// → { selector, confidence, source, reasoning }
```

### 2. Outcome verifier (AiOutcomeVerifier)

Called after a step executes if `verifyOutcomes: true` and `expectedOutcome` is set.

```typescript
const chain = ChatPromptTemplate.fromMessages([
  ['system', OUTCOME_SYSTEM_PROMPT],
  ['human', [
    { type: 'text', text: `Expected: "${expectedOutcome}"\nStep: ${stepType}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
  ]],
]).pipe(model).pipe(new JsonOutputParser());

const result: OutcomeResult = await chain.invoke({});
// → { passed, confidence, reason, observed }
```

### 3. Test generator (AiService.generateTests)

RAG-augmented generation pipeline:

```typescript
// 1. Retrieve relevant code chunks
const chunks = await retrievalService.findRelevantChunks(projectId, repoIds, prompt, filePaths);

// 2. Build context string
const codeContext = chunks.map(c => `--- ${c.filePath} ---\n${c.content}`).join('\n\n');

// 3. Generate via LangChain
const chain = ChatPromptTemplate.fromMessages([
  ['system', TEST_GENERATION_SYSTEM_PROMPT],
  ['human', `Feature: ${featureName}\nDescription: ${prompt}\n\nCode context:\n${codeContext}`],
]).pipe(model).pipe(new JsonOutputParser());

const tests: TestDefinitionDraft[] = await chain.invoke({});
```

### 4. Failure explainer & run summariser

Simple single-turn LangChain calls — no retrieval needed:

```typescript
// Failure explanation
const explanation = await model.invoke([
  new SystemMessage(FAILURE_EXPLAINER_SYSTEM_PROMPT),
  new HumanMessage(`Test: ${testName}\nStep ${stepIndex}: ${stepName}\nError: ${errorMessage}\nSelector: ${selector}`),
]);

// Run summary
const summary = await model.invoke([
  new SystemMessage(RUN_SUMMARISER_SYSTEM_PROMPT),
  new HumanMessage(JSON.stringify({ testName, steps: stepResults, duration, environment })),
]);
```

---

## Performance Optimisations

### Embedding cache

Identical queries (same prompt text) return the same embedding. A simple in-memory
LRU cache avoids re-embedding the same query string multiple times within a session:

```typescript
@Injectable()
export class EmbeddingService {
  private cache = new LRUCache<string, number[]>({ max: 500 });

  async embed(text: string): Promise<number[]> {
    const key = createHash('sha256').update(text).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key)!;
    const vector = await this.provider.embedQuery(text);
    this.cache.set(key, vector);
    return vector;
  }
}
```

### Streaming responses

For long AI calls (test generation with large code context), the API streams the
LangChain response to the frontend so the user sees tokens appearing rather than
waiting for the full response:

```typescript
// API controller — streaming endpoint
@Get('features/:id/generate-tests/stream')
async streamGenerate(@Param('id') id: string, @Body() dto: GenerateDto, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  const stream = await this.aiService.generateTestsStream(dto);
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end();
}
```

### Batched embeddings

Code chunks are embedded in batches of 50 during indexing to stay within API
rate limits and maximise throughput:

```typescript
const BATCH_SIZE = 50;
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const batch = chunks.slice(i, i + BATCH_SIZE);
  const embeddings = await embeddingModel.embedDocuments(batch.map(c => c.content));
  await prisma.codeChunk.createMany({ data: batch.map((c, j) => ({ ...c, embedding: embeddings[j] })) });
  emit('indexing:progress', { processed: i + batch.length, total: chunks.length });
}
```

### Parallel AI calls

Selector healing and outcome verification are independent — if both are needed for
a step, they can run in parallel:

```typescript
const [healResult, outcomeResult] = await Promise.all([
  healEnabled ? aiStepResolver.resolve(description, screenshot, codeChunks) : null,
  verifyEnabled && expectedOutcome ? aiOutcomeVerifier.verify(expectedOutcome, screenshot) : null,
]);
```

---

## Platform Admin — AI Provider Configuration

The platform admin configures the AI provider once for the entire platform.
Projects inherit this config; individual projects can override specific settings
(e.g. use a different model for test generation vs selector healing).

### Admin panel → AI Settings

```
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Settings → AI Configuration                                │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  LLM Provider                                                         │
│  [ Anthropic (Claude)              ▼ ]                               │
│  Model:      [ claude-sonnet-4-20250514  ]                           │
│  API Key:    [ sk-ant-●●●●●●●●●●●●●●●● ] [ Test Connection ]        │
│                                                                       │
│  Embedding Provider                                                   │
│  [ Same as LLM provider ▼ ]  (or choose separately)                 │
│  Embedding model: text-embedding-3-small  (auto-selected)            │
│                                                                       │
│  Vector Backend                                                       │
│  (●) pgvector (built-in)   — recommended for most installations      │
│  ( ) Qdrant                — for large-scale installations            │
│      Qdrant URL: [ http://qdrant:6333  ]                             │
│                                                                       │
│  AI Execution Defaults (can be overridden per test)                  │
│  [ ] Enable selector healing by default                              │
│  [ ] Enable outcome verification by default                          │
│  Max tokens per call:  [ 4096 ]                                      │
│                                                                       │
│  [ Save AI Settings ]          [ Test All Connections ]              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Platform Admin — Repo Provider Configuration

The platform admin configures OAuth apps once. Projects then use these configured
providers — users never see OAuth credentials, they just pick a provider and authenticate.

### Admin panel → Source Code Providers

```
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Settings → Source Code Providers                           │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  🐙 GitHub                                          [ Edit ] ✅     │
│     Client ID:    ●●●●●●●●●●●●●●●●●●●●                              │
│     Client Secret: ●●●●●●●●●●●●●●●●●●●●                             │
│     Callback URL: https://qa.co/api/v1/auth/github-repo/callback     │
│                                                                       │
│  🦊 GitLab                                          [ Edit ] ✅     │
│     Client ID:    ●●●●●●●●●●●●●●●●●●●●                              │
│     Callback URL: https://qa.co/api/v1/auth/gitlab-repo/callback     │
│                                                                       │
│  🍵 Gitea Instances                          [ + Add Gitea Instance ]│
│     git.acme-corp.com         [ Edit ] [ ✕ ]                        │
│     git.partner-company.com   [ Edit ] [ ✕ ]                        │
│                                                                       │
│  Note: GitHub Enterprise and self-hosted GitLab use PAT              │
│  authentication — no OAuth app setup needed. Users provide           │
│  their own PAT when connecting a repo.                               │
└──────────────────────────────────────────────────────────────────────┘
```

The project-level "Connect Repository" wizard then becomes:

```
Step 1 — Provider:
  [ 🐙 GitHub ]   [ 🦊 GitLab ]   [ 🍵 git.acme-corp.com ]
  [ GitHub Enterprise (PAT) ]   [ GitLab Self-hosted (PAT) ]
  [ 📁 Local Path ]
  ↑ list populated from admin-configured providers
```

No OAuth client IDs or secrets ever shown to project users.

---

## Data Model Additions

```prisma
// ─── PLATFORM AI CONFIG (stored in PlatformConfig.aiConfig Json) ──
// Structure of PlatformConfig.aiConfig:
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "apiKey": "<encrypted>",
  "maxTokens": 4096,
  "embeddingModel": "text-embedding-3-small",
  "vectorBackend": "pgvector",          // "pgvector" | "qdrant"
  "qdrantUrl": null,
  "qdrantApiKey": null,
  "defaults": {
    "healSelectors": false,
    "verifyOutcomes": false
  }
}

// ─── PLATFORM REPO PROVIDER CONFIG ────────────────────────────────
model PlatformRepoProvider {
  id           String  @id @default(uuid())
  provider     RepoProvider              // GITHUB | GITLAB | GITEA
  displayName  String                    // "GitHub", "git.acme-corp.com"
  baseUrl      String?                   // null for github.com / gitlab.com
  clientId     String?                   // encrypted, OAuth only
  clientSecret String?                   // encrypted, OAuth only
  isEnabled    Boolean @default(true)
  createdAt    DateTime @default(now())

  @@map("platform_repo_providers")
}
```

---

## Environment Variables — Complete AI Reference

```bash
# ── LLM Provider ──────────────────────────────────────────────
AI_PROVIDER=anthropic       # anthropic | openai | azure | ollama | openai-compatible
AI_MODEL=claude-sonnet-4-20250514
AI_API_KEY=sk-ant-...
AI_MAX_TOKENS=4096
AI_BASE_URL=                # required for ollama + openai-compatible

# Azure OpenAI
AI_AZURE_INSTANCE=myinstance
AI_AZURE_DEPLOYMENT=gpt-4o
AI_AZURE_API_VERSION=2024-02-01

# ── Embeddings ────────────────────────────────────────────────
OLLAMA_EMBEDDING_MODEL=nomic-embed-text   # when AI_PROVIDER=ollama
# For Anthropic provider, embeddings fall back to:
OPENAI_API_KEY=sk-...   # optional — only needed for embeddings when using Anthropic LLM

# ── Vector Backend ─────────────────────────────────────────────
VECTOR_BACKEND=pgvector   # pgvector (default) | qdrant
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=           # optional (Qdrant Cloud)

# ── Repo Token Encryption ──────────────────────────────────────
REPO_TOKEN_SECRET=<min 32 chars random>

# ── OAuth Apps (configured by platform admin) ──────────────────
GITHUB_REPO_CLIENT_ID=
GITHUB_REPO_CLIENT_SECRET=
GITHUB_REPO_CALLBACK_URL=https://qa.co/api/v1/auth/github-repo/callback

GITLAB_REPO_CLIENT_ID=
GITLAB_REPO_CLIENT_SECRET=
GITLAB_REPO_CALLBACK_URL=https://qa.co/api/v1/auth/gitlab-repo/callback

# ── Legacy fallbacks (if AI_PROVIDER not set) ──────────────────
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

---

## Where This Fits

| Concern | Phase |
|---------|-------|
| LLM provider factory (already built) | Phase 0 (done) |
| AI execution engine (selector healing, outcome verification) | Phase 2.0.4 |
| pgvector extension + CodeChunk model | Phase 5.5.1 |
| Indexer service + embedding batching | Phase 5.5.2 |
| RAG retrieval + test generation with context | Phase 5.5.3 |
| Platform Admin — AI config UI | Phase 2.0.3 (extend) |
| Platform Admin — Repo provider config | Phase 5.5.4 (extend) |
| Qdrant as opt-in backend | Phase 5.5.1 (optional) |
