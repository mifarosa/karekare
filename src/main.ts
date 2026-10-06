import './styles/main.css';
import { EditorView } from './editor/editorView';
import { HomeView } from './home/home';
import { lang, t } from './i18n';
import { initPwa } from './pwa';
import { openFileStore } from './storage/opfs';
import { ProjectRepo } from './storage/repo';
import { h } from './ui/dom';
import { toast } from './ui/toast';

const app = document.getElementById('app')!;
let repo: ProjectRepo;
let home: HomeView | null = null;
let editor: EditorView | null = null;
let routing: Promise<void> = Promise.resolve();

async function main(): Promise<void> {
  document.documentElement.lang = lang();
  initPwa();
  repo = new ProjectRepo(await openFileStore());
  window.addEventListener('hashchange', () => void route());
  await route();
  document.getElementById('boot')?.remove();
}

function editorId(): string | null {
  return location.hash.match(/^#\/p\/([A-Za-z0-9_-]{1,64})$/)?.[1] ?? null;
}

/** Serialized so rapid navigation never opens two screens at once. */
function route(): Promise<void> {
  routing = routing.then(doRoute, doRoute);
  return routing;
}

async function doRoute(): Promise<void> {
  const id = editorId();
  if (editor && editor.ed.project.id !== id) {
    const closing = editor;
    editor = null;
    await closing.close();
  }
  if (id) {
    if (editor) return;
    home?.dispose();
    home = null;
    try {
      const { project, missing } = await repo.load(id);
      const view = new EditorView(repo, project, () => {
        if (editorId() === project.id) location.hash = '#/';
      });
      editor = view;
      app.append(view.el);
      view.mounted();
      if (missing) toast(t('importMissing', { n: missing }));
    } catch (err) {
      console.error(err);
      toast(t('openFailed'), { kind: 'error' });
      location.hash = '#/';
    }
    return;
  }
  showHome();
}

function showHome(): void {
  if (home) {
    void home.refresh();
    return;
  }
  home = new HomeView(
    repo,
    (id) => {
      location.hash = `#/p/${id}`;
    },
    () => {
      // Rebuild with the new language.
      home?.dispose();
      home = null;
      showHome();
    },
  );
  app.append(home.el);
}

main().catch((err) => {
  console.error(err);
  app.append(h('div', { class: 'fatal' }, h('h1', null, 'Kare Kare'), h('p', null, t('fatalError')), h('pre', null, String(err))));
});
