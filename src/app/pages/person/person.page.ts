import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CatalogService, PersonCredit } from '../../services/catalog.service';
import { TitleDisplayService } from '../../services/title-display.service';

@Component({
  selector: 'app-person',
  templateUrl: './person.page.html',
  styleUrls: ['./person.page.scss'],
  standalone: false,
})
export class PersonPage implements OnInit {
  id = 0;
  person: { name: string; bio: string; birthday: string | null; deathday: string | null; photo: string | null; place: string } | null = null;
  credits: PersonCredit[] = [];
  loading = true;
  failed = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalog: CatalogService,
    public readonly titles: TitleDisplayService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.id = Number(this.route.snapshot.paramMap.get('id') ?? 0);
    await this.titles.load();
    const res = await this.catalog.person(this.id);
    if (res) {
      this.person = res.person;
      this.credits = res.credits;
    } else {
      this.failed = true;
    }
    this.loading = false;
  }

  /** Годы жизни — одной строкой, без «Born/Died» калькой с английского. */
  trackById(_i: number, c: PersonCredit): string {
    return `${c.kind}:${c.id}-${c.job}-${c.character}`;
  }

  get lifespan(): string {
    const p = this.person;
    if (!p) {
      return '';
    }
    const born = p.birthday?.slice(0, 4) ?? '';
    const died = p.deathday?.slice(0, 4) ?? '';
    if (born && died) {
      return `${born} — ${died}`;
    }
    if (born) {
      return `род. ${born}`;
    }
    return died ? `ум. ${died}` : '';
  }
}
