import { createCareerScene, supportsWebGL } from './career-scene.js';

const STORAGE_KEY = 'lang';
const ICONS = {
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z"/></svg>',
};

const state = {
  content: null,
  lang: 'en',
  active: 0,
  scene: null,
  labels: [],
};

function readStoredLang() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    return;
  }
}

function matchLang(value) {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith('pt')) {
    return 'pt-BR';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }
  return null;
}

function resolveLang() {
  const candidates = [new URLSearchParams(location.search).get('lang'), readStoredLang(), ...navigator.languages];
  for (const candidate of candidates) {
    const lang = matchLang(candidate);
    if (lang) {
      return lang;
    }
  }
  return 'en';
}

function t(value) {
  if (value && typeof value === 'object') {
    return value[state.lang] ?? value.en;
  }
  return value;
}

function ui(key) {
  return state.content.ui[state.lang][key];
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function richText(text) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? el('strong', { text: part }) : part));
}

function parseMonth(value) {
  if (!value) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

function formatMonth({ year, month }) {
  const name = new Intl.DateTimeFormat(state.lang, { month: 'short' }).format(new Date(year, month - 1, 1)).replace('.', '');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

function formatDuration(start, end) {
  const total = (end.year * 12 + end.month) - (start.year * 12 + start.month) + 1;
  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts = [];
  if (years > 0) {
    parts.push(`${years} ${ui(years === 1 ? 'year' : 'years')}`);
  }
  if (months > 0) {
    parts.push(`${months} ${ui(months === 1 ? 'month' : 'months')}`);
  }
  return parts.join(' ');
}

function bind(name) {
  return document.querySelector(`[data-bind="${name}"]`);
}

function renderStaticText() {
  document.documentElement.lang = state.lang;
  document.title = ui('title');
  document.querySelector('meta[name="description"]').setAttribute('content', ui('description'));
  document.querySelectorAll('[data-ui]').forEach((node) => {
    node.textContent = ui(node.dataset.ui);
  });
  document.querySelectorAll('[data-ui-label]').forEach((node) => {
    node.setAttribute('aria-label', ui(node.dataset.uiLabel));
  });
  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  });
}

function renderHero() {
  const { profile } = state.content;
  bind('location').textContent = t(profile.location);
  bind('name').textContent = profile.name;
  bind('headline').textContent = t(profile.headline);
  bind('summary').replaceChildren(...t(profile.summary).map((paragraph) => el('p', {}, richText(paragraph))));

  const contacts = [
    { icon: 'email', label: ui('email'), handle: profile.email, href: `mailto:${profile.email}` },
    { icon: 'linkedin', label: 'LinkedIn', handle: 'in/willamesyano', href: profile.links.linkedin },
    { icon: 'x', label: 'X', handle: '@willamesyano', href: profile.links.x },
  ];
  bind('contact').replaceChildren(...contacts.map((contact) => {
    const link = el('a', { attrs: { href: contact.href } }, [el('span', { text: contact.label }), el('span', { className: 'handle', text: contact.handle })]);
    if (!contact.href.startsWith('mailto:')) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.insertAdjacentHTML('afterbegin', ICONS[contact.icon]);
    return el('li', {}, [link]);
  }));
}

function buildPhaseList() {
  const list = document.getElementById('phase-list');
  state.labels = state.content.phases.map((phase, index) => {
    const button = el('button', { className: 'phase-button', attrs: { type: 'button' } }, [
      el('span', { className: 'phase-tag' }, [
        el('span', { className: 'phase-year', text: phase.start.slice(0, 4) }),
        el('span', { className: 'phase-company', text: phase.short }),
      ]),
    ]);
    button.addEventListener('click', () => selectPhase(index));
    const item = el('li', { className: index % 2 === 0 ? 'is-above' : 'is-below' }, [button]);
    list.append(item);
    return item;
  });
}

function renderPhaseList() {
  state.content.phases.forEach((phase, index) => {
    const button = state.labels[index].querySelector('button');
    button.setAttribute('aria-pressed', String(index === state.active));
    button.setAttribute('aria-label', `${phase.start.slice(0, 4)} · ${phase.company} · ${t(phase.role)}`);
  });
}

function renderDetail() {
  const phases = state.content.phases;
  const phase = phases[state.active];
  const start = parseMonth(phase.start);
  const end = parseMonth(phase.end);
  const period = `${formatMonth(start)} · ${phase.end ? formatMonth(end) : ui('present')}`;
  const counter = `${String(state.active + 1).padStart(2, '0')} / ${String(phases.length).padStart(2, '0')}`;

  const body = el('div', { className: 'detail-body' }, [
    el('div', { className: 'detail-meta' }, [
      el('span', { className: 'detail-period', text: period }),
      el('span', { text: `${formatDuration(start, end)} · ${counter}` }),
    ]),
    el('h3', { text: phase.company }),
    el('p', { className: 'detail-role', text: t(phase.role) }),
  ]);
  if (phase.location) {
    body.append(el('p', { className: 'detail-location', text: t(phase.location) }));
  }
  body.append(el('p', { className: 'detail-summary', text: t(phase.summary) }));
  body.append(
    el('h4', { text: ui('activities') }),
    el('ul', { className: 'activities' }, t(phase.activities).map((activity) => el('li', { text: activity }))),
  );
  if (phase.tech.length > 0) {
    body.append(
      el('h4', { text: ui('technologies') }),
      el('ul', { className: 'chips' }, phase.tech.map((tech) => el('li', { text: tech }))),
    );
  }

  const previous = el('button', { attrs: { type: 'button' }, text: `← ${ui('previous')}` });
  const next = el('button', { attrs: { type: 'button' }, text: `${ui('next')} →` });
  previous.disabled = state.active === 0;
  next.disabled = state.active === phases.length - 1;
  previous.addEventListener('click', () => selectPhase(state.active - 1));
  next.addEventListener('click', () => selectPhase(state.active + 1));

  document.getElementById('detail').replaceChildren(body, el('nav', { className: 'detail-nav' }, [previous, next]));
}

function renderBackground() {
  const { education, certifications, languages } = state.content;
  bind('education').replaceChildren(...education.map((item) => el('li', {}, [
    el('span', { className: 'fact-title', text: t(item.degree) }),
    el('span', { className: 'fact-sub', text: `${item.school} · ${item.start === item.end ? item.start : `${item.start} · ${item.end}`}` }),
  ])));
  bind('certifications').replaceChildren(...certifications.map((item) => {
    const entry = el('li', {}, [el('span', { className: 'fact-title', text: item.name })]);
    if (item.issuer) {
      entry.append(el('span', { className: 'fact-sub', text: `${item.issuer} · ${formatMonth(parseMonth(item.date))}` }));
    }
    return entry;
  }));
  bind('languages').replaceChildren(...languages.map((item) => el('li', {}, [
    el('span', { className: 'fact-title', text: t(item.name) }),
    el('span', { className: 'fact-sub', text: t(item.level) }),
  ])));
  bind('copyright').textContent = `© ${new Date().getFullYear()} ${state.content.profile.name}`;
}

function render() {
  renderStaticText();
  renderHero();
  renderPhaseList();
  renderDetail();
  renderBackground();
}

function selectPhase(index) {
  const last = state.content.phases.length - 1;
  state.active = Math.max(0, Math.min(last, index));
  renderPhaseList();
  renderDetail();
  if (state.scene) {
    state.scene.select(state.active);
  }
}

function setLang(lang) {
  state.lang = lang;
  storeLang(lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
  render();
}

function setupScene() {
  const stage = document.getElementById('stage');
  if (!supportsWebGL()) {
    stage.classList.add('is-flat');
    return;
  }
  try {
    state.scene = createCareerScene({
      canvas: document.getElementById('scene'),
      stage,
      labels: state.labels,
      techCounts: state.content.phases.map((phase) => phase.tech.length),
      onSelect: selectPhase,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    state.scene.select(state.active);
  } catch {
    stage.classList.remove('is-3d');
    stage.classList.add('is-flat');
  }
}

function setupKeyboard() {
  document.getElementById('stage').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectPhase(state.active + 1);
      state.labels[state.active].querySelector('button').focus();
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectPhase(state.active - 1);
      state.labels[state.active].querySelector('button').focus();
    }
  });
}

async function init() {
  const response = await fetch('assets/data/content.json');
  state.content = await response.json();
  state.lang = resolveLang();
  state.active = state.content.phases.length - 1;
  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => setLang(button.dataset.lang));
  });
  buildPhaseList();
  render();
  setupScene();
  setupKeyboard();
}

init();
