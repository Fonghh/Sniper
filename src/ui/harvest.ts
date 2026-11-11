import type { Deer } from '../animals/deer';
import type { AnimalScore } from '../game/scoring';
import { STRINGS } from '../i18n';
import { XRay } from './xray';

const $ = (id: string) => document.getElementById(id)!;

export interface HarvestInfo {
  deer: Deer;
  buck: boolean;
  score: AnimalScore;
  firstCategory: string;
  firstRange: number;
  extraShots: number;
  runDistance: number;
  organs: string[];
  newBest: boolean;
}

/** The harvest summary panel, with an X-ray that opens on demand. */
export class HarvestScreen {
  private panel = $('harvest');
  private xrayCanvas = $('xray') as HTMLCanvasElement;
  private xrayBtn = $('btn-xray');
  private xray: XRay | null = null;
  private current: HarvestInfo | null = null;
  private xrayOpen = false;
  onClose: (() => void) | null = null;

  constructor() {
    this.xrayBtn.addEventListener('click', () => this.toggleXray());
    $('btn-continue').addEventListener('click', () => this.close());
    $('btn-continue').textContent = STRINGS.continueHunt;
  }

  get open(): boolean {
    return this.current !== null;
  }

  show(info: HarvestInfo) {
    this.current = info;
    const s = info.score;
    $('h-grade').textContent = s.grade;
    $('h-grade').dataset.grade = s.grade;
    $('h-verdict').textContent = STRINGS.grade[s.grade];
    $('h-title').textContent = STRINGS.harvestTitle(info.buck);
    const label = (key: string) => {
      switch (key) {
        case 'placement':
          return STRINGS.scoreLine.placement(STRINGS.category[info.firstCategory]);
        case 'distance':
          return STRINGS.scoreLine.distance(info.firstRange);
        case 'quickKill':
          return STRINGS.scoreLine.quickKill(s.timeToDown ?? 0);
        case 'extraShots':
          return STRINGS.scoreLine.extraShots(info.extraShots);
        default:
          return STRINGS.scoreLine.poorFirst;
      }
    };
    $('h-lines').innerHTML = s.lines
      .map((l) => `<li><span>${label(l.key)}</span><b class="${l.points < 0 ? 'neg' : ''}">${l.points > 0 ? '+' : ''}${l.points}</b></li>`)
      .join('');
    $('h-facts').textContent = `${STRINGS.organsHit(info.organs)} · ${STRINGS.ran(info.runDistance)}`;
    $('h-total').textContent = STRINGS.total(s.total);
    $('h-record').textContent = info.newBest ? STRINGS.newBest : '';
    this.setXray(false);
    this.panel.classList.add('show');
    document.body.classList.add('harvesting');
  }

  private toggleXray() {
    this.setXray(!this.xrayOpen);
  }

  private setXray(open: boolean) {
    this.xrayOpen = open;
    this.xrayCanvas.classList.toggle('show', open);
    this.xrayBtn.textContent = open ? STRINGS.xrayHide : STRINGS.xray;
    if (open && this.current) {
      this.xray ??= new XRay(this.xrayCanvas);
      this.xray.show(this.current.deer.hits);
    } else {
      this.xray?.hide();
    }
  }

  close() {
    this.setXray(false);
    this.current = null;
    this.panel.classList.remove('show');
    document.body.classList.remove('harvesting');
    this.onClose?.();
  }
}
