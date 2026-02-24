import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  host: { class: 'page' },
  imports: [CommonModule],
  selector: 'gf-ai-commands-page',
  standalone: true,
  templateUrl: './ai-commands-page.html'
})
export class GfAiCommandsPageComponent {}
