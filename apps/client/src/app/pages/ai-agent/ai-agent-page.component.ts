import type {
  AiAgentMessage,
  AiAgentResponse
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { marked } from 'marked';
import { Subject, takeUntil } from 'rxjs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  contentHtml?: SafeHtml;
  timestamp: string;
  toolCalls?: AiAgentResponse['toolCalls'];
  confidence?: number;
  sources?: AiAgentResponse['sources'];
}

@Component({
  host: { class: 'page' },
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule
  ],
  selector: 'gf-ai-agent-page',
  standalone: true,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 64px);
        padding: 1rem;
      }

      .chat-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }

      .messages {
        flex: 1;
        overflow-y: auto;
        padding: 1rem 0;
      }

      .message {
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        max-width: 85%;
        word-wrap: break-word;
      }

      .message.user {
        white-space: pre-wrap;
        background-color: rgba(var(--dark-dividers));
        margin-left: auto;
        text-align: right;
        color: rgba(var(--dark-primary-text));
      }

      .message.assistant {
        background-color: rgba(var(--dark-focused));
        border: 1px solid rgba(var(--dark-dividers));
        margin-right: auto;
        color: rgba(var(--dark-primary-text));
      }

      :host-context(.is-dark-theme) .message.user {
        background-color: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }

      :host-context(.is-dark-theme) .message.assistant {
        background-color: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.12);
        color: #e0e0e0;
      }

      .tool-calls {
        margin-top: 0.5rem;
        font-size: 0.85rem;
      }

      .confidence {
        font-size: 0.8rem;
        opacity: 0.7;
        margin-top: 0.25rem;
      }

      .sources {
        font-size: 0.8rem;
        opacity: 0.6;
        margin-top: 0.25rem;
      }

      .disclaimer {
        font-size: 0.75rem;
        opacity: 0.5;
        font-style: italic;
        text-align: center;
        padding: 0.5rem;
        border-top: 1px solid rgba(var(--dark-dividers));
      }

      :host-context(.is-dark-theme) .disclaimer {
        border-top-color: rgba(var(--light-dividers));
      }

      .input-area {
        display: flex;
        gap: 0.5rem;
        padding: 1rem 0;
        align-items: flex-end;
      }

      .input-area mat-form-field {
        flex: 1;
      }

      .loading {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        opacity: 0.7;
      }

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }
    `,
    `
      :host ::ng-deep .markdown-body h1,
      :host ::ng-deep .markdown-body h2,
      :host ::ng-deep .markdown-body h3 {
        margin: 0.75rem 0 0.5rem;
        font-weight: 600;
      }

      :host ::ng-deep .markdown-body h2 { font-size: 1.2rem; }
      :host ::ng-deep .markdown-body h3 { font-size: 1.05rem; }

      :host ::ng-deep .markdown-body p {
        margin: 0.4rem 0;
      }

      :host ::ng-deep .markdown-body ul,
      :host ::ng-deep .markdown-body ol {
        padding-left: 1.5rem;
        margin: 0.4rem 0;
      }

      :host ::ng-deep .markdown-body table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.5rem 0;
      }

      :host ::ng-deep .markdown-body th,
      :host ::ng-deep .markdown-body td {
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 0.4rem 0.6rem;
        text-align: left;
      }

      :host ::ng-deep .markdown-body th {
        font-weight: 600;
      }

      :host ::ng-deep .markdown-body hr {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        margin: 0.75rem 0;
      }

      :host ::ng-deep .markdown-body strong {
        font-weight: 600;
      }
    `
  ],
  template: `
    <div class="chat-container">
      <h1 i18n>AI Agent</h1>

      <div class="messages">
        @for (msg of messages; track msg.timestamp) {
          <div class="message" [class]="msg.role">
            @if (msg.role === 'assistant' && msg.contentHtml) {
              <div class="markdown-body" [innerHTML]="msg.contentHtml"></div>
            } @else {
              <div>{{ msg.content }}</div>
            }

            @if (msg.toolCalls?.length) {
              <mat-expansion-panel class="tool-calls">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    Tool Calls ({{ msg.toolCalls.length }})
                  </mat-panel-title>
                </mat-expansion-panel-header>
                @for (tc of msg.toolCalls; track tc.toolName) {
                  <div>
                    <strong>{{ tc.toolName }}</strong>
                    <pre>{{ tc.args | json }}</pre>
                  </div>
                }
              </mat-expansion-panel>
            }

            @if (msg.confidence !== undefined) {
              <div class="confidence">
                Confidence: {{ (msg.confidence * 100).toFixed(0) }}%
              </div>
            }

            @if (msg.sources?.length) {
              <div class="sources">
                Sources:
                @for (src of msg.sources; track src.service) {
                  {{ src.service }}
                }
              </div>
            }
          </div>
        }

        @if (isLoading) {
          <div class="loading">
            <mat-spinner diameter="20"></mat-spinner>
            <span i18n>Thinking...</span>
          </div>
        }
      </div>

      <div class="disclaimer" i18n>
        This AI assistant is for educational purposes only and does not
        constitute financial advice. Consult a qualified financial advisor.
      </div>

      <div class="input-area">
        <mat-form-field appearance="outline">
          <mat-label i18n>Ask about your portfolio...</mat-label>
          <input
            matInput
            [(ngModel)]="userMessage"
            (keydown.enter)="sendMessage()"
            [disabled]="isLoading"
          />
        </mat-form-field>
        <button
          mat-raised-button
          color="primary"
          (click)="sendMessage()"
          [disabled]="isLoading || !userMessage?.trim()"
          i18n
        >
          Send
        </button>
      </div>
    </div>
  `
})
export class GfAiAgentPageComponent implements OnDestroy {
  public isLoading = false;
  public messages: ChatMessage[] = [];
  public userMessage = '';

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private dataService: DataService,
    private sanitizer: DomSanitizer
  ) {}

  public sendMessage() {
    const message = this.userMessage?.trim();
    if (!message || this.isLoading) {
      return;
    }

    this.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    this.userMessage = '';
    this.isLoading = true;

    const conversationHistory: AiAgentMessage[] = this.messages
      .slice(0, -1)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }));

    this.dataService
      .postAiAgentChat({ conversationHistory, message })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (response: AiAgentResponse) => {
          this.messages.push({
            role: 'assistant',
            content: response.message.content,
            contentHtml: this.sanitizer.bypassSecurityTrustHtml(
              marked(response.message.content) as string
            ),
            timestamp: response.message.timestamp,
            toolCalls: response.toolCalls,
            confidence: response.confidence,
            sources: response.sources
          });
          this.isLoading = false;
        },
        error: () => {
          this.messages.push({
            role: 'assistant',
            content:
              'Sorry, I encountered an error processing your request. Please try again.',
            timestamp: new Date().toISOString()
          });
          this.isLoading = false;
        }
      });
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }
}
