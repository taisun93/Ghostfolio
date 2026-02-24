import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { catchError, of } from 'rxjs/operators';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
}

const WELCOME_TEXT = $localize`Hi. I'm your portfolio assistant. Ask me anything—I'll echo it back backwards for now.`;

@Component({
  host: { class: 'page' },
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
  ],
  selector: 'gf-ai-commands-page',
  standalone: true,
  styleUrls: ['./ai-commands-page.scss'],
  templateUrl: './ai-commands-page.html'
})
export class GfAiCommandsPageComponent implements OnInit, OnDestroy {
  @ViewChild('messagesEnd') messagesEndRef: ElementRef<HTMLElement>;

  public inputText = '';
  public isLoadingHistory = true;
  public isThinking = false;
  public messages: ChatMessage[] = [];
  private nextId = 0;

  public constructor(private http: HttpClient) {}

  public ngOnInit() {
    this.loadHistory();
  }

  public ngOnDestroy() {}

  public send() {
    const text = this.inputText?.trim();
    if (!text || this.isThinking) return;

    this.inputText = '';
    this.addUserMessage(text);
    this.persistMessage('user', text);
    this.isThinking = true;

    setTimeout(() => {
      const reversed = text.split('').reverse().join('');
      this.addAssistantMessage(reversed);
      this.persistMessage('assistant', reversed);
      this.isThinking = false;
      this.scrollToBottom();
    }, 400 + Math.random() * 400);
    this.scrollToBottom();
  }

  private loadHistory() {
    this.http
      .get<{ id: string; role: string; text: string; at: string }[]>('/api/v1/ai-chat/messages')
      .pipe(catchError(() => of([])))
      .subscribe((list) => {
        if (Array.isArray(list) && list.length > 0) {
          this.messages = list.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            text: m.text,
            at: new Date(m.at)
          }));
          this.nextId = this.messages.length + 1;
        } else {
          this.messages = [
            {
              id: `msg-${++this.nextId}`,
              role: 'assistant',
              text: WELCOME_TEXT,
              at: new Date()
            }
          ];
        }
        this.isLoadingHistory = false;
        this.scrollToBottom();
      });
  }

  private persistMessage(role: 'user' | 'assistant', content: string) {
    this.http
      .post('/api/v1/ai-chat/messages', { role, content })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  private addUserMessage(text: string) {
    this.messages.push({
      id: `msg-${++this.nextId}`,
      role: 'user',
      text,
      at: new Date()
    });
    this.scrollToBottom();
  }

  private addAssistantMessage(text: string) {
    this.messages.push({
      id: `msg-${++this.nextId}`,
      role: 'assistant',
      text,
      at: new Date()
    });
    this.scrollToBottom();
  }

  private scrollToBottom() {
    setTimeout(() => {
      this.messagesEndRef?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }
}
