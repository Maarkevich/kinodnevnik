import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import ru from '@angular/common/locales/ru';
import { LOCALE_ID, NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// Русский ставим один раз и везде: от LOCALE_ID зависят DatePipe, DecimalPipe
// и плюралы Intl (спецификация, 4.3).
registerLocaleData(ru);

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot({ mode: 'md', animated: true }), AppRoutingModule],
  providers: [
    { provide: LOCALE_ID, useValue: 'ru' },
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptorsFromDi()),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
