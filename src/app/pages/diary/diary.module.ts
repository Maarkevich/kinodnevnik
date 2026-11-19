import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { DiaryPage } from './diary.page';

const routes: Routes = [{ path: '', component: DiaryPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DiaryPageRoutingModule {}

@NgModule({
  imports: [SharedModule, DiaryPageRoutingModule],
  declarations: [DiaryPage],
})
export class DiaryPageModule {}
