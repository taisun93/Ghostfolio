import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterModule } from '@angular/router';

@Component({
  host: { class: 'page' },
  imports: [CommonModule, MatButtonModule, RouterModule],
  selector: 'gf-dashboard-page',
  standalone: true,
  styleUrls: ['./dashboard-page.scss'],
  templateUrl: './dashboard-page.html'
})
export class GfDashboardPageComponent {
  public routerLinkHome = internalRoutes.home.routerLink;

  public netWorth = 284_750;
  public allocation = [
    { label: 'Stocks', value: 52, color: '#36cfcc' },
    { label: 'ETFs', value: 28, color: '#58a6ff' },
    { label: 'Cash', value: 12, color: '#7ee787' },
    { label: 'Crypto', value: 8, color: '#d2a8ff' }
  ];
  public recentActivity = [
    { symbol: 'VTI', type: 'Buy', date: 'Today', value: '+$2,400' },
    { symbol: 'AAPL', type: 'Dividend', date: 'Yesterday', value: '+$18.24' },
    { symbol: 'BTC', type: 'Buy', date: 'Feb 22', value: '+$500' },
    { symbol: 'ETH', type: 'Sell', date: 'Feb 20', value: '-$320' }
  ];
}
