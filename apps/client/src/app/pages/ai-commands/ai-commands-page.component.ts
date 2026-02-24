import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
}

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
  public isThinking = false;
  public messages: ChatMessage[] = [];
  private nextId = 0;

  public ngOnInit() {
    this.addAssistantMessage(
      $localize`Hi. I'm your portfolio assistant. Ask me anything—I'll echo it back backwards for now.`
    );
  }

  public ngOnDestroy() {}

  public send() {
    const text = this.inputText?.trim();
    if (!text || this.isThinking) return;

    this.inputText = '';
    this.addUserMessage(text);
    this.isThinking = true;

    setTimeout(() => {
      const reversed = text.split('').reverse().join('');
      this.addAssistantMessage(reversed);
      this.isThinking = false;
      this.scrollToBottom();
    }, 400 + Math.random() * 400);
    this.scrollToBottom();
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
