import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ProfilePage } from './profile.page';

const routes: Routes = [{ path: '', component: ProfilePage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ProfilePageRoutingModule {}

@NgModule({
  imports: [SharedModule, ProfilePageRoutingModule],
  declarations: [ProfilePage],
})
export class ProfilePageModule {}
