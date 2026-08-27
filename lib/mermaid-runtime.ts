import type { MermaidConfig } from 'mermaid';

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  theme: 'base',
  fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
  themeVariables: {
    primaryColor: '#e6f3ec',
    primaryTextColor: '#183b2e',
    primaryBorderColor: '#76a590',
    lineColor: '#527463',
    secondaryColor: '#f7f4ec',
    tertiaryColor: '#eef7f2',
    clusterBkg: '#f7faf8',
    clusterBorder: '#cbd8d1',
    fontSize: '14px',
  },
  flowchart: { curve: 'basis', htmlLabels: true, padding: 16 },
};

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    });
  }
  return mermaidPromise;
}

export async function parseMermaid(source: string) {
  const mermaid = await getMermaid();
  return mermaid.parse(source);
}

export async function renderMermaid(id: string, source: string) {
  const mermaid = await getMermaid();
  return mermaid.render(id, source);
}
