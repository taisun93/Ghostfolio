import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
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

import {
  HEADER_KEY_IMPERSONATION,
  HEADER_KEY_TIMEZONE,
  HEADER_KEY_TOKEN
} from '@ghostfolio/common/config';
import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { TokenStorageService } from '@ghostfolio/client/services/token-storage.service';

import { environment } from '../../../environments/environment';

import { parrotResponse } from './parrot-agent';

/** Base URL for API requests. When set (e.g. Nest backend), stream and other AI calls go there. */
function getApiBaseUrl(): string {
  const base = environment.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

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
    private readonly http: HttpClient,
    private readonly impersonationStorageService: ImpersonationStorageService,
    private readonly ngZone: NgZone,
    private readonly tokenStorageService: TokenStorageService
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

    this.streamChat(messagesForApi);
  }

  private async streamChat(messagesForApi: { role: string; content: string }[]): Promise<void> {
    const token = this.tokenStorageService.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [HEADER_KEY_TIMEZONE]: Intl?.DateTimeFormat().resolvedOptions().timeZone ?? ''
    };
    if (token != null) {
      headers[HEADER_KEY_TOKEN] = `Bearer ${token}`;
      const impersonationId = this.impersonationStorageService.getId();
      if (impersonationId != null) {
        headers[HEADER_KEY_IMPERSONATION] = impersonationId;
      }
    }

    try {
      const streamUrl = getApiBaseUrl()
        ? `${getApiBaseUrl()}/api/v1/ai/chat/stream`
        : '/api/v1/ai/chat/stream';
      const res = await fetch(streamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: messagesForApi })
      });

      const aiSource = res.headers.get('X-Ghostfolio-AI-Source');
      if (aiSource !== null && aiSource !== undefined) {
        console.debug('[Ghostfolio AI] Response from:', aiSource, '(edge = no portfolio data, nest = full backend)');
      }

      if (!res.ok) {
        let errPayload: { status: number; message?: string; error?: { message?: string } } = {
          status: res.status,
          message: res.statusText
        };
        try {
          const body = await res.json();
          if (body?.message) errPayload.message = body.message;
          if (typeof body?.message === 'string') errPayload.error = { message: body.message };
        } catch {
          // ignore non-JSON body
        }
        this.ngZone.run(() => {
          this.isThinking = false;
          this.errorMessage = this.getErrorMessage(errPayload);
          this.changeDetectorRef.detectChanges();
        });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      if (!reader) {
        this.ngZone.run(() => {
          this.isThinking = false;
          this.errorMessage = $localize`Stream not supported.`;
          this.changeDetectorRef.detectChanges();
        });
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() ?? '';
        for (const raw of events) {
          let eventType = '';
          let dataLine = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: ')) dataLine = line.slice(6);
          }
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine) as { chirp?: string; content?: string; error?: string };
            this.ngZone.run(() => {
              if (eventType === 'error' && data.error) {
                this.isThinking = false;
                this.errorMessage = data.error;
              } else if (eventType === 'chirp' && data.chirp != null && data.chirp.trim() !== '') {
                this.addAssistantMessage(data.chirp);
                this.persistMessage('assistant', data.chirp);
              } else if (eventType === 'content' && data.content != null) {
                if (data.content.trim() !== '') {
                  this.addAssistantMessage(data.content);
                  this.persistMessage('assistant', data.content);
                }
                this.isThinking = false;
              }
              this.scrollToBottom();
              this.changeDetectorRef.detectChanges();
            });
          } catch {
            // ignore malformed event
          }
        }
      }

      this.ngZone.run(() => {
        this.isThinking = false;
        this.changeDetectorRef.detectChanges();
      });
    } catch (err) {
      this.ngZone.run(() => {
        this.isThinking = false;
        this.errorMessage = this.getErrorMessage(err);
        this.changeDetectorRef.detectChanges();
      });
    }
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
