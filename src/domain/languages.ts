export type LanguageMetadata = {
  color: string;
  extension: string;
  icon: string;
  name: string;
};

const icon = (label: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${label}"><rect width="48" height="48" rx="10" fill="${color}"/><text x="24" y="30" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="16" font-weight="800" fill="#ffffff">${label}</text></svg>`;

const catalog: Record<string, Omit<LanguageMetadata, 'extension'>> = {
  '.css': {
    color: '#5b8def',
    icon: icon('CSS', '#2965f1'),
    name: 'CSS',
  },
  '.go': {
    color: '#00add8',
    icon: icon('GO', '#00add8'),
    name: 'Go',
  },
  '.html': {
    color: '#e44d26',
    icon: icon('HT', '#e44d26'),
    name: 'HTML',
  },
  '.js': {
    color: '#f7df1e',
    icon: icon('JS', '#b49c00'),
    name: 'JavaScript',
  },
  '.json': {
    color: '#9b8cff',
    icon: icon('JSN', '#6554c0'),
    name: 'JSON',
  },
  '.md': {
    color: '#b8c4d9',
    icon: icon('MD', '#52606d'),
    name: 'Markdown',
  },
  '.py': {
    color: '#3776ab',
    icon: icon('PY', '#3776ab'),
    name: 'Python',
  },
  '.rs': {
    color: '#dea584',
    icon: icon('RS', '#9a5f35'),
    name: 'Rust',
  },
  '.sh': {
    color: '#89e051',
    icon: icon('SH', '#3f7d20'),
    name: 'Shell',
  },
  '.ts': {
    color: '#3178c6',
    icon: icon('TS', '#3178c6'),
    name: 'TypeScript',
  },
  '.tsx': {
    color: '#3178c6',
    icon: icon('TSX', '#3178c6'),
    name: 'TypeScript',
  },
};

const unknownLanguage = (extension: string): LanguageMetadata => ({
  color: '#8b98ad',
  extension,
  icon: icon('FILE', '#667085'),
  name: 'Other',
});

export function extensionForPath(path: string) {
  const basename = path.split('/').pop() ?? path;
  const lastDot = basename.lastIndexOf('.');

  if (lastDot <= 0) {
    return '';
  }

  return basename.slice(lastDot).toLowerCase();
}

export function canonicalLanguageForExtension(
  extension: string,
  overrides: Record<string, Partial<Omit<LanguageMetadata, 'extension'>>> = {},
): LanguageMetadata {
  const normalizedExtension = extension.toLowerCase();
  const base = catalog[normalizedExtension] ?? unknownLanguage(normalizedExtension);
  const override = overrides[normalizedExtension];

  return {
    ...base,
    ...override,
    extension: normalizedExtension,
  };
}

export function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
