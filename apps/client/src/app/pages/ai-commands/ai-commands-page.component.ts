import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { parrotResponse } from './parrot-agent';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
  /** True for the quick parrot reply; excluded from API context */
  isParrot?: boolean;
}

const WELCOME_TEXT = $localize`Hi. I'm your portfolio assistant. Ask about your holdings, allocation, or anything else—I'll use your portfolio data when relevant.`;

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

  public errorMessage: string | null = null;
  public inputText = '';
  public isLoadingHistory = false;
  public isThinking = false;
  public messages: ChatMessage[] = [
    {
      id: 'msg-0',
      role: 'assistant',
      text: WELCOME_TEXT,
      at: new Date()
    }
  ];
  private nextId = 1;

  public constructor(
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly http: HttpClient
  ) {}

  public ngOnInit() {
    this.loadHistory();
  }

  public ngOnDestroy() {}

  public clearError() {
    this.errorMessage = null;
  }

  private getErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as { error?: { message?: string } | string; message?: string; status?: number };
      if (typeof e.error === 'object' && e.error?.message) {
        return e.error.message;
      }
      if (typeof e.error === 'string' && e.error.trim()) {
        return e.error.trim();
      }
      if (e.message) {
        return e.message;
      }
      if (e.status === 503) {
        return $localize`Service unavailable. Set OPENAI_API_KEY in your Vercel project environment (or API key in Ghostfolio settings).`;
      }
      if (e.status === 504) {
        return $localize`Request timed out. Please try a shorter message or try again.`;
      }
      if (e.status && e.status >= 400) {
        return $localize`Request failed (${e.status}). Check the API key and try again.`;
      }
    }
    return $localize`Something went wrong. Check that the OpenAI API key is set (Ghostfolio settings or Vercel env OPENAI_API_KEY).`;
  }

  public send() {
    const text = this.inputText?.trim();
    if (!text || this.isThinking) return;

    this.clearError();
    this.inputText = '';
    this.addUserMessage(text);
    this.persistMessage('user', text);

    // First response: quick parrot rephrasing for perceived responsiveness
    const parrotText = parrotResponse(text);
    this.addAssistantMessage(parrotText, true);
    this.persistMessage('assistant', parrotText);

    this.isThinking = true;

    // Only send user and non-parrot assistant messages to the API
    const messagesForApi = this.messages
      .filter((m) => !m.isParrot)
      .map((m) => ({
        role: m.role,
        content: m.text
      }));

    this.http
      .post<{ content: string }>('/api/v1/ai/chat', { messages: messagesForApi })
      .pipe(
        catchError((err) => {
          this.errorMessage = this.getErrorMessage(err);
          return of(null);
        })
      )
      .subscribe((res) => {
        this.isThinking = false;
        if (res?.content != null) {
          this.addAssistantMessage(res.content);
          this.persistMessage('assistant', res.content);
        }
        this.scrollToBottom();
        this.changeDetectorRef.detectChanges();
      });
  }

  public startNewChat() {
    this.clearError();
    this.http
      .post<{ ok?: boolean }>('/api/v1/ai-chat/new', {})
      .pipe(catchError(() => of({})))
      .subscribe(() => {
        this.messages = [
          {
            id: `msg-${++this.nextId}`,
            role: 'assistant',
            text: WELCOME_TEXT,
            at: new Date()
          }
        ];
        this.scrollToBottom();
      });
  }

  private loadHistory() {
    this.http
      .get<{ id: string; role: string; text: string; at: string }[]>(
        '/api/v1/ai-chat/messages'
      )
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
        }
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

  private addAssistantMessage(text: string, isParrot = false) {
    this.messages.push({
      id: `msg-${++this.nextId}`,
      role: 'assistant',
      text,
      at: new Date(),
      ...(isParrot && { isParrot: true })
    });
    this.scrollToBottom();
  }

  private scrollToBottom() {
    setTimeout(() => {
      this.messagesEndRef?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }
}
