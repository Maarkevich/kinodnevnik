import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { EditProfilePage } from './edit-profile.page';

const routes: Routes = [{ path: '', component: EditProfilePage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class EditProfilePageRoutingModule {}

@NgModule({
  imports: [SharedModule, EditProfilePageRoutingModule],
  declarations: [EditProfilePage],
})
export class EditProfilePageModule {}
