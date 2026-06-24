# NetSuite AI Voice Agent (AVA)

A voice-powered AI assistant that runs **natively inside Oracle NetSuite**. Speak or type natural-language commands — in 30+ languages — to search, view, create, edit, approve, and delete NetSuite records without touching a single form.

Built entirely with **SuiteScript 2.1** and NetSuite's new generative-AI modules (`N/llm`, `N/machineTranslation`), this project demonstrates a production-grade architecture: hybrid LLM + rule-based intent resolution, multi-turn tool-augmented conversations, full audit logging, and a two-phase confirmation pattern for write operations.

---

## Demo

https://github.com/Jaganjkt/NetSuite-AI-Voice-Agent/raw/master/NetSuite%20AI%20Voice%20Agent.mp4

> *Click the link above or download the video to watch the full walkthrough of AVA in action inside NetSuite.*

---

## Features

### Voice & Chat Interface
- Browser-native **Speech Recognition** (Web Speech API) with real-time transcription
- Text input fallback for environments without mic access
- **Speech Synthesis** — AVA reads responses aloud
- Keyboard shortcuts: `Ctrl+M` to toggle mic, `Enter` to send, `Esc` to cancel
- Responsive design that works on desktop and tablet inside the NetSuite chrome

### AI-Powered Intent Resolution
- **Hybrid engine**: LLM classification (`N/llm` GPT-OSS) + deterministic rule-based fallback
- Recognizes **30+ record types** — Sales Orders, Invoices, Purchase Orders, Journal Entries, Customers, Vendors, and more
- Extracts entity names, document numbers, items, quantities, memos, and dates from natural speech
- Confidence scoring with three execution policies:
  - **Auto-execute** (>= 85% confidence, read-only actions)
  - **Confirm** (>= 60% or any write action)
  - **Reject / Clarify** (< 60%)

### Multi-Language Translation
- **32 languages** supported via `N/machineTranslation`
- Automatic language detection with ASCII heuristic
- Bidirectional translation — speak in your language, AVA processes in English, responds in kind
- Languages include: English, Spanish, French, German, Portuguese, Japanese, Chinese, Korean, Arabic, Hindi, Tamil, Telugu, Estonian, Finnish, Swedish, Russian, Thai, Vietnamese, Turkish, and more

### Record Operations
| Action | Description |
|--------|-------------|
| **Search** | Find records by entity name, document number, date range |
| **View** | Open a specific record with summary (amount, status, entity) |
| **Create** | Create transactions with entity, line items, memo |
| **Edit** | Open records in edit mode |
| **Approve** | Set approval status on pending records |
| **Delete** | Remove records (with confirmation) |

### LLM Tool-Augmented Orchestration
- Multi-turn agentic loop with up to **5 tool iterations** per query
- Five built-in LLM tools:
  - `search_records` — parameterized record search
  - `get_record` — load full record details
  - `get_record_count` — aggregate counts with filters
  - `check_permission` — runtime permission validation
  - `get_user_context` — current user/role/subsidiary info
- Streaming support via `N/llm.generateTextStreamed`

### Enterprise Safety
- **Two-phase confirmation** for all write operations (create, edit, delete, approve, void)
- Confidence bar visualization (green/amber/red) before execution
- Visual inline confirmation buttons in chat
- Comprehensive **audit log** (custom record `customrecord_ava_audit_log`) tracking:
  - Voice inputs, translations, intent resolutions
  - LLM calls with governance usage
  - Tool executions, user confirmations/rejections
  - Errors and permission denials

### RESTlet API
- Full REST endpoint for **mobile apps and external integrations**
- Supports: `process`, `confirm`, `reject`, `languages` actions
- GET endpoint returns agent status and governance remaining

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / Client                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Web Speech   │  │ Text Input   │  │ Speech Synthesis      │  │
│  │ Recognition  │  │              │  │ (TTS Readback)        │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────┘  │
│         └────────┬────────┘                                     │
│                  ▼                                               │
│         AVA_ClientScript.js                                     │
│              AJAX POST                                          │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                    NetSuite Server-Side                           │
│                                                                  │
│  AVA_Suitelet.js  ◄──── GET: serves Voice UI (inline HTML)      │
│        │                POST: handles AJAX commands               │
│        │                                                         │
│  AVA_RESTlet.js   ◄──── External / mobile integrations           │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              Processing Pipeline                         │     │
│  │                                                         │     │
│  │  1. TranslationEngine  ─── N/machineTranslation         │     │
│  │         ▼                                               │     │
│  │  2. IntentResolver     ─── N/llm + Rule Engine          │     │
│  │         ▼                                               │     │
│  │  3. LLMOrchestrator    ─── Multi-turn tool loop         │     │
│  │         │                                               │     │
│  │         ├── ToolEngine ─── search, get, count, perms    │     │
│  │         │                                               │     │
│  │  4. ActionRouter       ─── N/record, N/search, N/url    │     │
│  │         ▼                                               │     │
│  │  5. AuditLog           ─── customrecord_ava_audit_log   │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
NetSuite-AI-Voice-Agent/
├── NetSuite AI Voice Agent/              # SDF Project Root
│   ├── src/
│   │   ├── FileCabinet/
│   │   │   └── SuiteScripts/ai_voice_agent/
│   │   │       ├── AVA_Suitelet.js           # Suitelet — UI + AJAX handler
│   │   │       ├── AVA_RESTlet.js            # RESTlet — external API
│   │   │       ├── AVA_ClientScript.js       # Client script — keyboard shortcuts
│   │   │       └── lib/
│   │   │           ├── AVA_IntentResolver.js      # Hybrid LLM + rules intent engine
│   │   │           ├── AVA_TranslationEngine.js   # 32-language translation
│   │   │           ├── AVA_LLMOrchestrator.js     # Multi-turn agentic loop
│   │   │           ├── AVA_ToolEngine.js          # LLM tool definitions & execution
│   │   │           ├── AVA_ActionRouter.js        # Record CRUD operations
│   │   │           └── AVA_AuditLog.js            # Custom record audit trail
│   │   ├── Objects/
│   │   │   ├── customrecord_ava_audit_log.xml     # Audit log record type
│   │   │   ├── customscript_ava_suitelet.xml      # Suitelet script definition
│   │   │   ├── customscript_ava_restlet.xml       # RESTlet script definition
│   │   │   └── customscript_ava_client.xml        # Client script definition
│   │   ├── manifest.xml
│   │   └── deploy.xml
│   ├── __tests__/
│   │   ├── AVA_IntentResolver.test.js             # Intent resolution tests
│   │   └── AVA_TranslationEngine.test.js          # Translation tests
│   ├── jest.config.js
│   ├── package.json
│   └── suitecloud.config.js
│
├── demo/                                 # Demo videos & screenshots
├── README.md                             # This file
└── LICENSE                               # MIT License
```

---

## Technologies Used

| Technology | Purpose |
|------------|---------|
| **SuiteScript 2.1** | Server-side & client-side scripting framework |
| **N/llm** (GPT-OSS) | LLM text generation, tool definitions, and streaming |
| **N/machineTranslation** | Real-time translation across 32 languages |
| **N/record** | Create, load, submit, and delete NetSuite records |
| **N/search** | Saved & ad-hoc searches with dynamic filters |
| **N/url** | Record URL resolution for navigation |
| **N/runtime** | User context, permissions, governance tracking |
| **N/ui/serverWidget** | Suitelet form with inline HTML UI |
| **Web Speech API** | Browser speech recognition & synthesis |
| **Jest** | Unit testing with Oracle SuiteCloud mocks |
| **SuiteCloud CLI (SDF)** | Project structure, deployment, and validation |

---

## Prerequisites

- **NetSuite Account** with SuiteScript 2.1 enabled
- **NetSuite 2025.1+** (required for `N/llm` and `N/machineTranslation` modules)
- **SuiteCloud Development Framework (SDF)** configured
- **Node.js 18+** (for local development and testing)
- **Chrome or Edge** browser (for Web Speech API voice features)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Jaganjkt/NetSuite-AI-Voice-Agent.git
cd NetSuite-AI-Voice-Agent
```

### 2. Install Dependencies (for testing)

```bash
cd "NetSuite AI Voice Agent"
npm install
```

### 3. Run Unit Tests

```bash
npm test
```

### 4. Configure SuiteCloud CLI

```bash
suitecloud account:setup
```

Follow the prompts to authenticate with your NetSuite account.

### 5. Validate & Deploy

```bash
suitecloud project:validate
suitecloud project:deploy
```

---

## Configuration

### Script Deployments

After deployment, the following scripts will be available in your NetSuite account:

| Script | Type | Entry Point |
|--------|------|-------------|
| `customscript_ava_suitelet` | Suitelet | `AVA_Suitelet.js → onRequest` |
| `customscript_ava_restlet` | RESTlet | `AVA_RESTlet.js → get / post` |
| `customscript_ava_client` | Client Script | `AVA_ClientScript.js → pageInit` |

### Custom Record

The deployment creates a custom record type `customrecord_ava_audit_log` with fields for:
- Event type, user ID, user name, role ID
- Transcript, intent JSON, action result
- Confidence score, governance used
- Source language, session ID, timestamp, error message

### Permissions

Ensure the executing role has:
- **SuiteScript** — Full permission
- **Custom Records** — Create/Edit for `customrecord_ava_audit_log`
- **Transactions** — Appropriate level for the record types users will interact with
- **Lists / Records** — View access for entity and item lookups

---

## Usage

### Access the Voice Agent

1. Navigate to the Suitelet URL in your NetSuite account
2. You'll see the AVA chat interface

### Voice Commands (examples)

```
"Search sales orders for ABC Corp"
"Open invoice 10021"
"Create a purchase order for Acme"
"Approve purchase order PO-4421"
"How many open invoices do we have?"
"Show me vendor bills from last month"
"Delete sales order SO-9988"
```

### Multilingual Examples

```
"Buscar pedidos de venta para ABC Corp"          (Spanish)
"Rechnungen für Müller GmbH suchen"              (German)
"ABC社の販売注文を検索して"                           (Japanese)
"Rechercher les factures de ce mois"              (French)
"ABC Corp için satış siparişlerini ara"           (Turkish)
```

### RESTlet Integration

```javascript
// POST to the RESTlet endpoint
var response = https.requestRestlet({
    scriptId: 'customscript_ava_restlet',
    deploymentId: 'customdeploy_ava_restlet',
    method: 'POST',
    body: JSON.stringify({
        action: 'process',
        transcript: 'Search open invoices for ABC Corp',
        sessionId: 'mobile_001'
    })
});
```

---

## Future Improvements

- [ ] **Conversation memory** — persist multi-turn context across sessions using custom records
- [ ] **Scheduled action support** — "remind me to approve PO-4421 tomorrow"
- [ ] **Dashboard widgets** — voice-activated KPI summaries and charts
- [ ] **Role-based command filtering** — restrict available commands per NetSuite role
- [ ] **Batch operations** — "approve all pending purchase orders under $500"
- [ ] **Voice biometric authentication** — speaker verification for sensitive actions
- [ ] **Webhook integrations** — trigger external workflows from voice commands
- [ ] **Mobile companion app** — native iOS/Android wrapper using the RESTlet API
- [ ] **Streaming responses** — real-time token streaming for long LLM answers
- [ ] **Custom vocabulary training** — teach AVA company-specific terms and record names

---

## Testing

The project includes Jest unit tests with Oracle SuiteCloud virtual mocks:

```bash
cd "NetSuite AI Voice Agent"
npm test
```

**Test coverage includes:**
- Intent classification for all action types
- Document number extraction
- Record type abbreviation mapping (SO, PO, JE, etc.)
- LLM-to-rules fallback behavior
- Execution policy assignment (auto/confirm/reject)
- Write action detection
- Empty/invalid input handling

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Author

**Jagan** ([@Jaganjkt](https://github.com/Jaganjkt))

Built with SuiteScript 2.1 and NetSuite's generative AI platform.
