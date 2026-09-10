import { getLocale } from './i18n.ts';
import { INITIAL_MARKDOWN } from './editor.ts';
import type { MermaidTemplate } from './mermaid-workbench.ts';

// These are built-in examples only. Existing documents and drafts are never translated.
const englishTemplates: Record<string, string> = {
  "usecase": "flowchart LR\n  %% prosemap:usecase\n  User[\"\u00abactor\u00bb User\"]\n  Admin[\"\u00abactor\u00bb Admin\"]\n  subgraph System[\"Order system\"]\n    Browse([\"Browse products\"])\n    Order([\"Place order\"])\n    Login([\"Authentication\"])\n    Coupon([\"Apply coupon\"])\n    Manage([\"Manage products\"])\n  end\n  User --- Browse\n  User --- Order\n  Admin --- Manage\n  Order -.->|\u00abinclude\u00bb| Login\n  Coupon -.->|\u00abextend\u00bb| Order",
  "package": "flowchart TB\n  %% prosemap:package\n  subgraph App[\"Application\"]\n    subgraph Presentation[\"Presentation\"]\n      Pages[\"Pages\"]\n      Controllers[\"Controllers\"]\n    end\n    subgraph Domain[\"Domain\"]\n      Services[\"Domain services\"]\n      Models[\"Domain models\"]\n    end\n    subgraph Infrastructure[\"Infrastructure\"]\n      Repository[\"Repository\"]\n      Gateway[\"External APIs\"]\n    end\n  end\n  Pages --> Controllers\n  Controllers -.->|depends on| Services\n  Services --> Models\n  Services -.->|depends on| Repository\n  Services -.->|depends on| Gateway",
  "basic-flowchart": "flowchart TD\n  Start([\"Start\"])\n  Input[\"Receive request\"]\n  Check{\"Valid?\"}\n  Process[\"Process request\"]\n  Error[\"Return error\"]\n  End([\"End\"])\n  Start --> Input\n  Input --> Check\n  Check -->|Yes| Process\n  Check -->|No| Error\n  Process --> End\n  Error --> End",
  "four-plus-one": "flowchart TB\n  Logical[\"Logical view: domain models and abstractions\"]\n  Development[\"Development view: modules and code organization\"]\n  Scenario([\"Scenarios (+1): key use cases and requirements\"])\n  Process[\"Process view: runtime, concurrency, communication\"]\n  Physical[\"Physical view: deployment and infrastructure\"]\n  Logical -->|validated by| Scenario\n  Development -->|implements| Scenario\n  Scenario -->|drives| Process\n  Scenario -->|deployed to| Physical",
  "architecture": "flowchart LR\n  Client[\"Client\"]\n  Gateway[\"API gateway\"]\n  Service[\"Business service\"]\n  Database[(\"Database\")]\n  External[\"External service\"]\n  Client --> Gateway\n  Gateway --> Service\n  Service --> Database\n  Service --> External",
  "sequence": "sequenceDiagram\n  autonumber\n  actor User as User\n  participant App as Client\n  participant API as Server\n  User->>App: Submit request\n  App->>API: Send data\n  API-->>App: Return result\n  App-->>User: Show result",
  "state": "stateDiagram-v2\n  [*] --> Draft\n  Draft --> InReview: Submit\n  InReview --> Published: Approve\n  InReview --> Draft: Reject\n  Published --> [*]",
  "class": "classDiagram\n  class User {\n    +String id\n    +String name\n    +signIn()\n  }\n  class Order {\n    +String id\n    +create()\n  }\n  User \"1\" --> \"many\" Order : creates",
  "er": "erDiagram\n  USER ||--o{ ORDER : creates\n  USER {\n    string id PK\n    string name\n  }\n  ORDER {\n    string id PK\n    string user_id FK\n    decimal amount\n  }",
  "mindmap": "mindmap\n  root((Product planning))\n    User value\n      Core problems\n      Target audience\n    Product capabilities\n      MVP\n      Future iterations\n    Delivery plan\n      Milestones\n      Risks",
  "gantt": "gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Design\n  Requirements :done, req, 2026-01-01, 3d\n  Solution design :design, after req, 5d\n  section Development\n  Core development :dev, after design, 8d\n  Release :milestone, after dev, 1d"
};

export function templateSource(template: MermaidTemplate): string {
  return getLocale() === 'en' ? (englishTemplates[template.id] ?? template.source) : template.source;
}

const englishWelcome = `# Turn complex ideas into clear writing

ProseMap is a quiet workspace for Markdown and Mermaid. Focus on writing, and review AI suggestions before they change your document.

> You decide which changes to keep. AI suggestions never overwrite your text automatically.

## A workflow you can trust

\`\`\`mermaid
flowchart LR
  A[Open or create] --> B[Write]
  B --> C{Need AI help?}
  C -- Writing --> D[Polish / Continue / Summarize]
  C -- Diagrams --> E[Create or edit Mermaid]
  D --> F[Review changes]
  E --> F
  F --> G{Accept changes?}
  G -- Yes --> H[Save Markdown]
  G -- No --> B
\`\`\`

## Get started

- Select text and open the **AI assistant**.
- Open a Markdown file or a folder in the desktop app.
- Choose **Edit canvas** on a diagram to drag, resize, and edit it.
- Review all AI changes before accepting or rejecting them.
- Switch between **English** and **简体中文** in the top bar or settings.

| Feature | Status |
| --- | --- |
| GitHub Flavored Markdown | Ready |
| Live Mermaid rendering | Ready |
| OpenAI-compatible / Claude | Connect a model |
`;

export function initialDocument(): string {
  return getLocale() === 'en' ? englishWelcome : INITIAL_MARKDOWN;
}
