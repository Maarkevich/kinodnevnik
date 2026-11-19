import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { SearchPage } from './search.page';

const routes: Routes = [{ path: '', component: SearchPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SearchPageRoutingModule {}

@NgModule({
  imports: [SharedModule, SearchPageRoutingModule],
  declarations: [SearchPage],
})
export class SearchPageModule {}
