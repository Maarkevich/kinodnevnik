import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { SeasonPage } from './season.page';

const routes: Routes = [{ path: '', component: SeasonPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SeasonPageRoutingModule {}

@NgModule({
  imports: [SharedModule, SeasonPageRoutingModule],
  declarations: [SeasonPage],
})
export class SeasonPageModule {}
