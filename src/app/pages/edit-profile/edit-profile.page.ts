import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-edit-profile',
  templateUrl: './edit-profile.page.html',
  styleUrls: ['./edit-profile.page.scss'],
  standalone: false,
})
export class EditProfilePage implements OnInit {
  name = '';
  bio = '';

  constructor(
    private readonly settings: SettingsService,
    private readonly router: Router,
    private readonly toast: ToastController,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.settings.load();
    this.name = this.settings.value.displayName;
    this.bio = this.settings.value.bio;
  }

  async save(): Promise<void> {
    await this.settings.patch({ displayName: this.name.trim(), bio: this.bio.trim() });
    const t = await this.toast.create({ message: 'Профиль сохранён', duration: 2000, position: 'bottom', cssClass: 'kd-toast-glass' });
    await t.present();
    await this.router.navigate(['/profile']);
  }

  cancel(): void {
    void this.router.navigate(['/profile']);
  }
}
