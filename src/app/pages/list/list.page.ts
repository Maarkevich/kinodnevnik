import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ListItemEntry } from '../../models/storage.models';
import { CatalogService } from '../../services/catalog.service';
import { DbService } from '../../services/db.service';
import { PosterService } from '../../services/poster.service';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  standalone: false,
})
export class ListPage implements OnInit {
  id = '';
  title = '';
  items: ListItemEntry[] = [];
  loading = true;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly db: DbService,
    private readonly catalog: CatalogService,
    private readonly toast: ToastController,
    public readonly poster: PosterService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    const list = await this.db.run('lists', 'readonly', (tx) => this.db.get<{ id: string; title: string }>(tx, 'lists', this.id));
    this.title = list?.title ?? 'Список';

    this.items = await this.db.run('listItems', 'readonly', async (tx) => {
      const all = await this.db.all<ListItemEntry>(tx, 'listItems');
      return all.filter((i) => i.listId === this.id);
    });

    // Метаданные берём из локальных снимков: список должен открываться офлайн.
    for (const item of this.items) {
      const snap = await this.catalog.cachedSnapshot(item.media_type, item.id);
      if (snap) {
        item.snapshot = snap;
      }
    }
    this.loading = false;
  }

  async remove(item: ListItemEntry): Promise<void> {
    await this.db.run('listItems', 'readwrite', (tx) => this.db.del(tx, 'listItems', [item.listId, item.mediaKey]));
    this.items = this.items.filter((i) => i.mediaKey !== item.mediaKey);
    const t = await this.toast.create({ message: 'Убрано из списка', duration: 2000, position: 'bottom', cssClass: 'kd-toast-glass' });
    await t.present();
  }
}
