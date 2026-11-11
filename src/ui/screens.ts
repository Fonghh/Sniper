import type { HarvestEntry, Records } from '../game/records';
import type { Settings } from '../game/settings';
import type { AnimalScore } from '../game/scoring';
import { STRINGS } from '../i18n';
import { ICONS } from './icons';

const $ = (id: string) => document.getElementById(id)!;
const click = (id: string, fn: () => void) => $(id).addEventListener('click', fn);

export type ScreenId = 'cabin' | 'menu' | 'map' | 'settings' | 'records' | 'summary';

export interface ScreenCallbacks {
  startHunt(): void;
  resume(): void;
  quit(): void;
  openMap(): void;
  settingsChanged(s: Settings): void;
}

/** Cabin, pause menu, settings, records and end-of-hunt summary overlays. */
export class Screens {
  private stack: ScreenId[] = [];

  constructor(
    private cb: ScreenCallbacks,
    private settings: Settings,
  ) {
    const c = STRINGS.cabin;
    document.querySelector('.cabin-name')!.textContent = c.name;
    document.querySelector('.cabin-sub')!.textContent = c.sub;
    $('btn-start').textContent = c.start;
    $('btn-records').textContent = c.records;
    $('btn-settings').textContent = c.settings;
    $('btn-shop').textContent = c.shop;
    $('menu-title').textContent = STRINGS.menu.title;
    $('btn-resume').textContent = STRINGS.menu.resume;
    $('btn-map').textContent = STRINGS.menu.map;
    $('btn-menu-settings').textContent = STRINGS.menu.settings;
    $('btn-quit').textContent = STRINGS.menu.quit;
    $('btn-menu').innerHTML = ICONS.menu;
    $('map-title').textContent = STRINGS.map.title;
    $('map-hint').textContent = STRINGS.map.hint;
    $('btn-map-close').textContent = STRINGS.map.close;
    $('settings-title').textContent = STRINGS.settings.title as string;
    $('btn-settings-close').textContent = STRINGS.settings.close as string;
    $('records-title').textContent = STRINGS.records.title;
    $('btn-records-close').textContent = STRINGS.records.close;
    $('summary-title').textContent = STRINGS.summary.title;
    $('btn-summary-close').textContent = STRINGS.summary.close;

    click('btn-start', () => cb.startHunt());
    click('btn-records', () => this.push('records'));
    click('btn-settings', () => this.push('settings'));
    click('btn-resume', () => cb.resume());
    click('btn-map', () => cb.openMap());
    click('btn-menu-settings', () => this.push('settings'));
    click('btn-quit', () => cb.quit());
    click('btn-map-close', () => this.pop());
    click('btn-settings-close', () => this.pop());
    click('btn-records-close', () => this.pop());
    click('btn-summary-close', () => this.show('cabin'));
    this.buildSettings();
  }

  get top(): ScreenId | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Replaces the whole stack with one screen (or none). */
  show(id: ScreenId | null) {
    this.stack = id ? [id] : [];
    this.render();
  }

  push(id: ScreenId) {
    this.stack.push(id);
    this.render();
  }

  pop() {
    this.stack.pop();
    this.render();
  }

  private render() {
    const top = this.top;
    for (const id of ['cabin', 'menu', 'map', 'settings', 'records', 'summary'] as ScreenId[]) {
      $(id).classList.toggle('show', id === top);
    }
    document.body.classList.toggle('in-cabin', this.stack[0] === 'cabin' || top === 'summary');
    if (top === 'records') this.fillRecords(this.recordsSource());
  }

  /** Set by the game so the records page always shows fresh data. */
  recordsSource: () => Records = () => ({ bestAnimal: null, bestSession: null, harvests: 0, log: [] });

  setCabinBest(r: Records) {
    document.querySelector('.cabin-best')!.textContent = STRINGS.cabin.best(r.bestAnimal, r.bestSession);
  }

  setClock(seconds: number) {
    $('menu-clock').textContent = STRINGS.menu.clock(Math.floor(seconds / 60), Math.floor(seconds % 60));
  }

  private buildSettings() {
    const list = $('settings-list');
    list.innerHTML = '';
    for (const key of Object.keys(this.settings) as (keyof Settings)[]) {
      const [label, note] = STRINGS.settings[key] as [string, string];
      const row = document.createElement('div');
      row.className = 'setting';
      row.innerHTML = `<div>${label}<small>${note}</small></div>`;
      const t = document.createElement('button');
      t.className = `toggle${this.settings[key] ? ' on' : ''}`;
      t.setAttribute('aria-label', label);
      t.addEventListener('click', () => {
        this.settings[key] = !this.settings[key];
        t.classList.toggle('on', this.settings[key]);
        this.cb.settingsChanged(this.settings);
      });
      row.appendChild(t);
      list.appendChild(row);
    }
  }

  private fillRecords(r: Records) {
    $('records-best').textContent = STRINGS.records.best(r.bestAnimal, r.bestSession, r.harvests);
    $('records-log').innerHTML = r.log.length
      ? r.log.map((e: HarvestEntry) => this.entryRow(e)).join('')
      : `<li>${STRINGS.records.empty}</li>`;
  }

  private entryRow(e: HarvestEntry) {
    const date = new Date(e.at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    return `<li><span><span class="grade-chip ${e.grade}">${e.grade}</span>${STRINGS.records.entry(e.buck, e.range, date)}</span><b>${e.score}</b></li>`;
  }

  showSummary(harvested: Array<{ buck: boolean; score: AnimalScore }>, unrecovered: number, penalty: number, total: number, best: boolean) {
    const rows = harvested.map(
      (h) =>
        `<li><span><span class="grade-chip ${h.score.grade}">${h.score.grade}</span>${STRINGS.harvestTitle(h.buck)} · ${STRINGS.grade[h.score.grade]}</span><b>${h.score.total}</b></li>`,
    );
    if (unrecovered) rows.push(`<li><span>${STRINGS.summary.unrecovered(unrecovered)}</span><b class="neg">${penalty}</b></li>`);
    $('summary-list').innerHTML = rows.length ? rows.join('') : `<li>${STRINGS.summary.nothing}</li>`;
    $('summary-total').textContent = STRINGS.total(total);
    $('summary-record').textContent = best ? STRINGS.newBest : '';
    this.show('summary');
  }
}
