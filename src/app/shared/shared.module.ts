import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';

import { MediaCardComponent } from './media-card/media-card.component';
import { StarRatingComponent } from './star-rating/star-rating.component';
import { EmptyStateComponent } from './empty-state/empty-state.component';
import { MetricCardComponent } from './metric-card/metric-card.component';
import { QuickLogComponent } from './quick-log/quick-log.component';

const COMPONENTS = [
  MediaCardComponent,
  StarRatingComponent,
  EmptyStateComponent,
  MetricCardComponent,
  QuickLogComponent,
];

@NgModule({
  declarations: COMPONENTS,
  imports: [CommonModule, FormsModule, IonicModule],
  exports: [...COMPONENTS, CommonModule, FormsModule, IonicModule, RouterModule],
})
export class SharedModule {}
