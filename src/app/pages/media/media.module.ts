import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { MediaPage } from './media.page';

const routes: Routes = [{ path: '', component: MediaPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MediaPageRoutingModule {}

@NgModule({
  imports: [SharedModule, MediaPageRoutingModule],
  declarations: [MediaPage],
})
export class MediaPageModule {}
