import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { SettingsPage } from './settings.page';

const routes: Routes = [{ path: '', component: SettingsPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsPageRoutingModule {}

@NgModule({
  imports: [SharedModule, SettingsPageRoutingModule],
  declarations: [SettingsPage],
})
export class SettingsPageModule {}
