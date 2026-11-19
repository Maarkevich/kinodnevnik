import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ListPage } from './list.page';

const routes: Routes = [{ path: '', component: ListPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ListPageRoutingModule {}

@NgModule({
  imports: [SharedModule, ListPageRoutingModule],
  declarations: [ListPage],
})
export class ListPageModule {}
